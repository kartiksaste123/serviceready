import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AIService } from '../src/ai.js';
import { createApp } from '../src/app.js';
import { createMailer } from '../src/mail.js';
import type { Mailer } from '../src/mail.js';
import { ClientTools } from '../src/client-tools.js';
import type { ChatCompletion } from 'openai/resources';
import { hashSessionToken } from '../src/auth.js';
import { createId, Store, timestamp } from '../src/db.js';
import type { AuthPurpose } from '../src/db.js';
import { createMcpServer } from '../src/mcp.js';
import type { Proposal, Quote } from '../src/types.js';

const migrationDirectories: string[] = [];

interface SentCode {
  to: string;
  purpose: AuthPurpose;
  code: string;
}

class CapturingMailer implements Mailer {
  readonly sent: SentCode[] = [];
  failure: Error | null = null;

  async sendCode(to: string, purpose: AuthPurpose, code: string): Promise<void> {
    if (this.failure) throw this.failure;
    this.sent.push({ to, purpose, code });
  }
}

class TestAI extends AIService {
  readonly completions: ChatCompletion[] = [];

  async quoteScope(): Promise<string> {
    return 'A focused, client-ready project scope.';
  }

  async chatCompletion(): Promise<ChatCompletion> {
    return this.completions.shift() ?? {
      choices: [{ message: { role: 'assistant', content: 'Here are the available services.' } }],
    } as unknown as ChatCompletion;
  }
}

function setup<T extends Mailer = CapturingMailer>(mailer: T = new CapturingMailer() as unknown as T) {
  const store = new Store(':memory:');
  const ai = new TestAI();
  const app = createApp({
    store,
    ai,
    mailer,
    publicBaseUrl: 'http://localhost:8080',
  });
  return { app, store, mailer, ai };
}

async function request(
  app: ReturnType<typeof createApp>,
  path: string,
  options: { method?: string; body?: unknown; cookie?: string; ip?: string } = {},
): Promise<Response> {
  const headers = new Headers();
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  if (options.cookie) headers.set('cookie', options.cookie);
  if (options.ip) headers.set('fly-client-ip', options.ip);
  return app.request(path, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

function sessionCookie(response: Response): string {
  const value = response.headers.get('set-cookie');
  if (!value) throw new Error('Authentication response did not set a session cookie.');
  return value.split(';', 1)[0] ?? '';
}

function lastCode(mailer: CapturingMailer): string {
  const sent = mailer.sent.at(-1);
  if (!sent) throw new Error('No code was sent.');
  return sent.code;
}

async function signup(
  app: ReturnType<typeof createApp>,
  mailer: CapturingMailer,
  email: string,
  studioName = 'New Studio',
  password = 'studio-password-1',
  ip?: string,
): Promise<{ challenge_id: string; purpose: AuthPurpose }> {
  const response = await request(app, '/api/auth/signup', {
    body: { studio_name: studioName, email, password },
    ...(ip ? { ip } : {}),
  });
  if (response.status !== 201) throw new Error(`Signup failed: ${response.status} ${await response.text()}`);
  return await response.json() as { challenge_id: string; purpose: AuthPurpose };
}

async function verify(
  app: ReturnType<typeof createApp>,
  challenge_id: string,
  code: string,
  new_password?: string,
  ip?: string,
): Promise<Response> {
  return request(app, '/api/auth/verify', {
    body: { challenge_id, code, ...(new_password ? { new_password } : {}) },
    ...(ip ? { ip } : {}),
  });
}

async function createAccount(
  app: ReturnType<typeof createApp>,
  mailer: CapturingMailer,
  email: string,
  studioName = 'New Studio',
): Promise<{ cookie: string; challenge_id: string }> {
  const challenge = await signup(app, mailer, email, studioName);
  const response = await verify(app, challenge.challenge_id, lastCode(mailer));
  if (!response.ok) throw new Error(`Email verification failed: ${response.status} ${await response.text()}`);
  return { cookie: sessionCookie(response), challenge_id: challenge.challenge_id };
}

afterEach(() => {
  for (const directory of migrationDirectories) rmSync(directory, { recursive: true, force: true });
  migrationDirectories.length = 0;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('email authentication', () => {
  it('signs up, verifies an OTP, creates a session, and provisions an empty studio', async () => {
    const { app, store, mailer } = setup();
    const challenge = await signup(app, mailer, '  New.Owner@Example.com  ', 'North Star Studio');
    expect((await request(app, '/api/auth/me')).status).toBe(401);
    expect(mailer.sent).toEqual([
      { to: 'new.owner@example.com', purpose: 'verify', code: lastCode(mailer) },
    ]);
    const wrongCode = lastCode(mailer) === '000000' ? '000001' : '000000';
    const wrong = await verify(app, challenge.challenge_id, wrongCode);
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toEqual({ error: "That code isn't right. 4 tries left." });

    const verified = await verify(app, challenge.challenge_id, lastCode(mailer));
    expect(verified.status).toBe(200);
    const setCookie = verified.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toContain('Max-Age=2592000');
    const cookie = sessionCookie(verified);
    const rawToken = cookie.slice('sr_session='.length);
    const sessionRows = store.raw.prepare('SELECT token_hash FROM sessions').all() as Array<{ token_hash: string }>;
    expect(sessionRows).toHaveLength(1);
    expect(sessionRows[0]?.token_hash).toBe(hashSessionToken(rawToken));
    expect(sessionRows[0]?.token_hash).not.toBe(rawToken);
    const me = await request(app, '/api/auth/me', { cookie });
    expect(me.status).toBe(200);
    const session = await me.json() as { user: { email: string; is_demo: boolean }; seller: { name: string; slug: string } };
    expect(session.user).toMatchObject({ email: 'new.owner@example.com', is_demo: false });
    expect(session.seller.name).toBe('North Star Studio');
    expect(session.seller.slug).toBe('north-star-studio');
    expect((await request(app, '/api/services', { cookie })).status).toBe(200);
    expect(await (await request(app, '/api/services', { cookie })).json()).toEqual([]);
    expect(store.getUserByEmail('new.owner@example.com')?.email_verified_at).not.toBeNull();

    const expiring = await request(app, '/api/auth/demo', { method: 'POST' });
    const expiredCookie = sessionCookie(expiring);
    const expiredToken = expiredCookie.slice('sr_session='.length);
    store.raw.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?')
      .run(new Date(Date.now() - 1_000).toISOString(), hashSessionToken(expiredToken));
    expect((await request(app, '/api/auth/me', { cookie: expiredCookie })).status).toBe(401);
    expect(store.getSession(hashSessionToken(expiredToken))).toBeNull();
    store.close();
  });

  it('rejects verified duplicates and refreshes an unverified account challenge', async () => {
    const { app, store, mailer } = setup();
    const original = await signup(app, mailer, 'owner@example.com', 'First Studio');
    const duplicatePending = await signup(app, mailer, 'OWNER@example.com', 'Updated Studio', 'new-password-2');
    expect(duplicatePending.challenge_id).not.toBe(original.challenge_id);
    expect(mailer.sent).toHaveLength(2);
    expect(store.getAuthChallenge(original.challenge_id)?.consumed_at).not.toBeNull();
    expect(store.getSellerById(store.getUserByEmail('owner@example.com')!.seller_id)?.name).toBe('Updated Studio');

    const verified = await verify(app, duplicatePending.challenge_id, lastCode(mailer));
    expect(verified.status).toBe(200);
    const duplicateVerified = await request(app, '/api/auth/signup', {
      body: { studio_name: 'Another Studio', email: 'owner@example.com', password: 'another-password' },
    });
    expect(duplicateVerified.status).toBe(409);
    expect(await duplicateVerified.json()).toEqual({
      error: 'An account with this email already exists. Log in instead.',
    });
    store.close();
  });

  it('uses a generic login failure and requires a code after a correct password', async () => {
    const { app, store, mailer } = setup();
    await createAccount(app, mailer, 'login@example.com', 'Login Studio');
    const unknown = await request(app, '/api/auth/login', {
      body: { email: 'missing@example.com', password: 'wrong-password' },
    });
    const wrongPassword = await request(app, '/api/auth/login', {
      body: { email: 'login@example.com', password: 'wrong-password' },
    });
    expect(unknown.status).toBe(401);
    const errorBody = await unknown.json();
    expect(await wrongPassword.json()).toEqual(errorBody);
    expect(errorBody).toEqual({ error: 'Email or password is incorrect.' });

    const login = await request(app, '/api/auth/login', {
      body: { email: 'LOGIN@example.com', password: 'studio-password-1' },
    });
    expect(login.status).toBe(200);
    const loginChallenge = await login.json() as { challenge_id: string; purpose: string; email_hint: string };
    expect(loginChallenge).toMatchObject({ purpose: 'login', email_hint: 'lo***@example.com' });
    expect(login.headers.get('set-cookie')).toBeNull();
    expect(mailer.sent.at(-1)?.purpose).toBe('login');
    const authenticated = await verify(
      app,
      loginChallenge.challenge_id,
      lastCode(mailer),
    );
    expect(authenticated.status).toBe(200);

    const unverified = await signup(app, mailer, 'unverified@example.com');
    const unverifiedLogin = await request(app, '/api/auth/login', {
      body: { email: 'unverified@example.com', password: 'studio-password-1' },
    });
    expect(unverifiedLogin.status).toBe(200);
    expect(await unverifiedLogin.json()).toMatchObject({ purpose: 'verify' });
    expect(mailer.sent.at(-1)?.purpose).toBe('verify');
    expect(store.getAuthChallenge(unverified.challenge_id)?.consumed_at).not.toBeNull();
    store.close();
  });

  it('locks after five wrong codes, expires codes, enforces resend cooldown and rolling send cap', async () => {
    const { app, store, mailer } = setup();
    const challenge = await signup(app, mailer, 'limits@example.com', 'New Studio', 'studio-password-1', 'wrong-codes');
    const wrongCode = lastCode(mailer) === '000000' ? '999999' : '000000';
    for (let attempt = 1; attempt < 5; attempt += 1) {
      const wrong = await verify(app, challenge.challenge_id, wrongCode, undefined, 'wrong-codes');
      expect(wrong.status).toBe(400);
      expect((await wrong.json() as { error: string }).error).toContain(`${5 - attempt} tries left`);
    }
    const fifth = await verify(app, challenge.challenge_id, wrongCode, undefined, 'wrong-codes');
    expect(await fifth.json()).toEqual({ error: 'Too many wrong codes. Request a new code.' });
    expect(store.getAuthChallenge(challenge.challenge_id)?.consumed_at).not.toBeNull();

    const expired = await signup(app, mailer, 'expired@example.com', 'New Studio', 'studio-password-1', 'expiry');
    store.raw.prepare('UPDATE auth_challenges SET expires_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 1_000).toISOString(), expired.challenge_id);
    const expiredResponse = await verify(app, expired.challenge_id, lastCode(mailer), undefined, 'expiry');
    expect(await expiredResponse.json()).toEqual({ error: 'This code has expired. Request a new one.' });

    const resend = await signup(app, mailer, 'resend@example.com', 'New Studio', 'studio-password-1', 'resend');
    const cooldown = await request(app, '/api/auth/resend', {
      body: { challenge_id: resend.challenge_id },
      ip: 'resend',
    });
    expect(cooldown.status).toBe(429);
    expect((await cooldown.json() as { error: string }).error).toMatch(/^Please wait \d+ seconds/);
    for (let send = 0; send < 4; send += 1) {
      store.raw.prepare('UPDATE auth_challenges SET sent_at = ? WHERE id = ?')
        .run(new Date(Date.now() - 61_000).toISOString(), resend.challenge_id);
      const response = await request(app, '/api/auth/resend', {
        body: { challenge_id: resend.challenge_id },
        ip: 'resend',
      });
      expect(response.status).toBe(200);
    }
    store.raw.prepare('UPDATE auth_challenges SET sent_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 61_000).toISOString(), resend.challenge_id);
    const capped = await request(app, '/api/auth/resend', {
      body: { challenge_id: resend.challenge_id },
      ip: 'resend',
    });
    expect(capped.status).toBe(429);
    expect(await capped.json()).toEqual({ error: 'Too many codes requested. Try again in an hour.' });
    store.close();
  });

  it('resets passwords, invalidates existing sessions, hides unknown emails, and supports logout', async () => {
    const { app, store, mailer } = setup();
    const account = await createAccount(app, mailer, 'reset@example.com', 'Reset Studio');
    const secondLogin = await request(app, '/api/auth/login', {
      body: { email: 'reset@example.com', password: 'studio-password-1' },
      ip: 'second-session',
    });
    const secondChallenge = await secondLogin.json() as { challenge_id: string };
    const secondSession = await verify(
      app,
      secondChallenge.challenge_id,
      lastCode(mailer),
      undefined,
      'second-session',
    );
    const secondCookie = sessionCookie(secondSession);
    const extraSession = await request(app, '/api/auth/demo', { method: 'POST', ip: 'demo-session' });
    const demoCookie = sessionCookie(extraSession);

    const unknownCount = mailer.sent.length;
    const unknownForgot = await request(app, '/api/auth/forgot', {
      body: { email: 'unknown@example.com' },
      ip: 'unknown-forgot',
    });
    expect(unknownForgot.status).toBe(200);
    expect(mailer.sent).toHaveLength(unknownCount);

    const forgot = await request(app, '/api/auth/forgot', {
      body: { email: 'RESET@example.com' },
      ip: 'reset-request',
    });
    expect(forgot.status).toBe(200);
    const challenge = await forgot.json() as { challenge_id: string };
    expect(challenge).toMatchObject({ purpose: 'reset' });
    const reset = await verify(
      app,
      challenge.challenge_id,
      lastCode(mailer),
      'new-password-2',
      'reset-verification',
    );
    expect(reset.status).toBe(200);
    expect((await request(app, '/api/auth/me', { cookie: account.cookie })).status).toBe(401);
    expect((await request(app, '/api/auth/me', { cookie: secondCookie })).status).toBe(401);
    expect((await request(app, '/api/auth/me', { cookie: demoCookie })).status).toBe(200);

    const oldPassword = await request(app, '/api/auth/login', {
      body: { email: 'reset@example.com', password: 'studio-password-1' },
      ip: 'old-password',
    });
    expect(oldPassword.status).toBe(401);
    const newPassword = await request(app, '/api/auth/login', {
      body: { email: 'reset@example.com', password: 'new-password-2' },
      ip: 'new-password',
    });
    expect(newPassword.status).toBe(200);

    const loggedOut = await request(app, '/api/auth/logout', {
      method: 'POST',
      cookie: sessionCookie(reset),
      ip: 'logout',
    });
    expect(loggedOut.status).toBe(200);
    expect((await request(app, '/api/auth/me', { cookie: sessionCookie(reset) })).status).toBe(401);
    store.close();
  });

  it('requires sessions for seller routes and rate-limits auth POSTs by IP', async () => {
    const { app, store } = setup();
    const quote: Quote = {
      id: 'protected-quote',
      seller_id: 'seller_maya',
      service_id: 'svc_logo_design',
      service_title: 'Logo design',
      client_name: 'Casey',
      client_email: 'casey@example.com',
      brief: 'A bakery logo',
      scope_summary: 'Scope',
      line_items: [{ label: 'Logo design', amount_cents: 45000 }],
      total_cents: 45000,
      deposit_cents: 22500,
      balance_cents: 22500,
      status: 'quoted',
      source: 'web',
      approval_url: 'http://localhost:8080/q/protected-quote',
      created_at: timestamp(),
      updated_at: timestamp(),
    };
    store.saveQuote(quote);
    const proposal: Proposal = {
      id: 'protected-proposal',
      quote_id: quote.id,
      client_name: quote.client_name,
      action: 'wait',
      reason: 'Wait.',
      evidence: 'No invoice.',
      draft_message: '',
      status: 'pending',
      created_at: timestamp(),
    };
    store.saveProposal(proposal);
    const protectedRequests: Array<[string, string, unknown?]> = [
      ['GET', '/api/seller'],
      ['PUT', '/api/seller/rules', { default_deposit_pct: 50, reminder_tone: 'friendly', max_reminders: 2, wait_days_before_nudge: 3 }],
      ['POST', '/api/catalog/parse', { raw_text: 'rate card' }],
      ['POST', '/api/catalog/publish', { services: [{ tmp_id: 'x', title: 'X', description: '', deliverables: [], price_cents: 1, deposit_pct: 50, lead_time_days: 1 }] }],
      ['GET', '/api/services'],
      ['GET', '/api/quotes'],
      ['POST', `/api/quotes/${quote.id}/deliver`],
      ['POST', `/api/quotes/${quote.id}/collections/run`],
      ['POST', `/api/quotes/${quote.id}/replies`, { from: 'seller', text: 'Hello' }],
      ['GET', '/api/proposals'],
      ['POST', `/api/proposals/${proposal.id}/approve`, { draft_message: 'Wait.' }],
      ['POST', `/api/proposals/${proposal.id}/reject`],
      ['GET', '/api/events'],
      ['GET', '/api/stats'],
      ['POST', '/api/studio/llm', { messages: [{ role: 'user', content: 'Hello' }] }],
      ['POST', '/api/demo/reset'],
    ];
    for (const [method, path, body] of protectedRequests) {
      const response = await request(app, path, { method, ...(body === undefined ? {} : { body }) });
      expect(response.status, `${method} ${path}`).toBe(401);
    }
    for (let index = 0; index < 10; index += 1) {
      const response = await request(app, '/api/auth/logout', { method: 'POST' });
      expect(response.status).toBe(200);
    }
    const limited = await request(app, '/api/auth/logout', { method: 'POST' });
    expect(limited.status).toBe(429);
    store.close();
  });

  it('isolates services, quotes, proposals, events and reset between studios', async () => {
    const { app, store, mailer, ai } = setup();
    const mayaServiceIds = store.listServices('seller_maya').map((service) => service.id);
    const accountA = await createAccount(app, mailer, 'a@example.com', 'Studio A');
    const accountB = await createAccount(app, mailer, 'b@example.com', 'Studio B');
    const sellerA = (await (await request(app, '/api/auth/me', { cookie: accountA.cookie })).json() as { seller: { id: string; slug: string } }).seller;

    const published = await request(app, '/api/catalog/publish', {
      method: 'POST',
      cookie: accountA.cookie,
      body: {
        services: [{
          tmp_id: 'logo',
          title: 'Bakery logo',
          description: 'A custom logo',
          deliverables: ['Logo files'],
          price_cents: 50000,
          deposit_pct: 50,
          lead_time_days: 5,
        }],
      },
    });
    expect(published.status).toBe(200);
    const [service] = await published.json() as Array<{ id: string }>;
    expect(service?.id).toMatch(/^svc_/);
    ai.completions.push({
      choices: [{
        message: {
          role: 'assistant',
          tool_calls: [{
            id: 'list-a-services',
            type: 'function',
            function: {
              name: 'list_services',
              arguments: JSON.stringify({ seller_slug: 'maya-rao-studio' }),
            },
          }],
        },
      }],
    } as unknown as ChatCompletion);
    const agentSim = await request(app, '/api/agent-sim/chat', {
      body: { slug: sellerA.slug, messages: [{ role: 'user', content: 'What can I book?' }] },
    });
    expect(agentSim.status).toBe(200);
    const simulated = await agentSim.json() as { tool_calls: Array<{ output: Array<{ id: string }> }> };
    expect(simulated.tool_calls[0]?.output.map((item) => item.id)).toEqual([service!.id]);

    const publicQuote = await request(app, `/api/public/${sellerA.slug}/quotes`, {
      body: {
        service_id: service!.id,
        client_name: 'Sam Baker',
        client_email: 'sam@bakery.com',
        brief: 'A logo for my bakery',
        source: 'web',
      },
    });
    expect(publicQuote.status).toBe(201);
    const quote = await publicQuote.json() as Quote;
    const proposal: Proposal = {
      id: createId('prop'),
      quote_id: quote.id,
      client_name: quote.client_name,
      action: 'wait',
      reason: 'Wait for the client.',
      evidence: 'No invoice.',
      draft_message: '',
      status: 'pending',
      created_at: timestamp(),
    };
    store.saveProposal(proposal);

    expect(await (await request(app, '/api/services', { cookie: accountB.cookie })).json()).toEqual([]);
    expect(await (await request(app, '/api/quotes', { cookie: accountB.cookie })).json()).toEqual([]);
    const stats = await request(app, '/api/stats', { cookie: accountB.cookie });
    expect(stats.status).toBe(200);
    expect(await stats.json()).toMatchObject({ deposits_collected_cents: 0, outstanding_cents: 0, paid_cents: 0 });
    expect((await request(app, `/api/quotes/${quote.id}/deliver`, { method: 'POST', cookie: accountB.cookie })).status).toBe(404);
    expect((await request(app, `/api/proposals/${proposal.id}/approve`, {
      method: 'POST',
      cookie: accountB.cookie,
      body: { draft_message: 'Wait.' },
    })).status).toBe(404);
    expect(await (await request(app, '/api/proposals', { cookie: accountB.cookie })).json()).toEqual([]);
    expect((await request(app, `/api/quotes/${quote.id}`, { cookie: accountB.cookie })).status).toBe(200);

    const clientTools = new ClientTools({
      store,
      publicBaseUrl: 'http://localhost:8080',
      createQuote: async () => quote,
    });
    const tools = await clientTools.execute('list_services', { seller_slug: sellerA.slug }, 'mcp') as Array<{ id: string }>;
    expect(tools.map((item) => item.id)).toEqual([service!.id]);
    const mcp = createMcpServer(clientTools);
    const client = new Client({ name: 'serviceready-tenant-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcp.connect(serverTransport);
    await client.connect(clientTransport);
    const mcpResult = await client.callTool({
      name: 'list_services',
      arguments: { seller_slug: sellerA.slug },
    });
    const mcpContent = mcpResult.content as Array<{ type: string; text?: string }>;
    const mcpOutput = JSON.parse(
      mcpContent[0]?.type === 'text' ? mcpContent[0].text ?? '[]' : '[]',
    ) as Array<{ id: string }>;
    expect(mcpOutput.map((item) => item.id)).toEqual([service!.id]);
    await client.close();
    await mcp.close();
    expect(await (await request(app, '/api/events', { cookie: accountB.cookie })).json()).toEqual([]);
    const detail = await request(app, `/api/quotes/${quote.id}`);
    expect(await detail.json()).toMatchObject({ seller: { name: 'Studio A', slug: sellerA.slug } });

    const demo = await request(app, '/api/auth/demo', { method: 'POST' });
    const demoCookie = sessionCookie(demo);
    const authCounts = {
      users: (store.raw.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }).count,
      sessions: (store.raw.prepare('SELECT COUNT(*) AS count FROM sessions').get() as { count: number }).count,
      challenges: (store.raw.prepare('SELECT COUNT(*) AS count FROM auth_challenges').get() as { count: number }).count,
    };
    store.recordWebhookEvent('keep-webhook');
    const deniedReset = await request(app, '/api/demo/reset', { method: 'POST', cookie: accountB.cookie });
    expect(deniedReset.status).toBe(403);
    const reset = await request(app, '/api/demo/reset', { method: 'POST', cookie: demoCookie });
    expect(reset.status).toBe(200);
    expect(store.listServices('seller_maya').map((item) => item.id)).toEqual(mayaServiceIds);
    expect(store.listServices(sellerA.id).map((item) => item.id)).toEqual([service!.id]);
    expect(store.getQuote(quote.id)?.seller_id).toBe(sellerA.id);
    expect((await request(app, '/api/auth/me', { cookie: accountA.cookie })).status).toBe(200);
    expect(store.raw.prepare('SELECT COUNT(*) AS count FROM users').get()).toMatchObject({ count: authCounts.users });
    expect(store.raw.prepare('SELECT COUNT(*) AS count FROM sessions').get()).toMatchObject({ count: authCounts.sessions });
    expect(store.raw.prepare('SELECT COUNT(*) AS count FROM auth_challenges').get()).toMatchObject({ count: authCounts.challenges });
    expect(store.hasWebhookEvent('keep-webhook')).toBe(true);
    store.close();
  });

  it('migrates old seller-less rows and backfills payload ownership', () => {
    const directory = mkdtempSync(join(tmpdir(), 'serviceready-auth-migration-'));
    migrationDirectories.push(directory);
    const path = join(directory, 'old.db');
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE sellers (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE services (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE quotes (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE events (id TEXT PRIMARY KEY, quote_id TEXT, created_at TEXT NOT NULL, payload TEXT NOT NULL);
    `);
    const maya = {
      id: 'seller_maya',
      slug: 'maya-rao-studio',
      name: 'Maya Rao Studio',
      tagline: 'Brand identity',
      email: 'hello@example.com',
      currency: 'USD',
      rules: { default_deposit_pct: 50, reminder_tone: 'friendly', max_reminders: 2, wait_days_before_nudge: 3 },
    };
    legacy.prepare('INSERT INTO services(id,payload) VALUES(?,?)')
      .run('legacy-service', JSON.stringify({ id: 'legacy-service', title: 'Legacy service' }));
    legacy.prepare('INSERT INTO quotes(id,payload) VALUES(?,?)')
      .run('legacy-quote', JSON.stringify({ id: 'legacy-quote' }));
    legacy.prepare('INSERT INTO events(id,quote_id,created_at,payload) VALUES(?,?,?,?)')
      .run('legacy-event', null, timestamp(), JSON.stringify({ id: 'legacy-event', quote_id: null }));
    legacy.close();

    const store = new Store(path);
    expect(store.getSellerById('seller_maya')?.name).toBe(maya.name);
    expect(store.getService('legacy-service')).toEqual({
      id: 'legacy-service',
      title: 'Legacy service',
      seller_id: 'seller_maya',
    });
    expect(store.listServices('seller_maya')).toContainEqual(expect.objectContaining({ id: 'legacy-service' }));
    expect(store.getQuote('legacy-quote')).toEqual({ id: 'legacy-quote', seller_id: 'seller_maya' });
    expect(store.listEvents(null)).toEqual([
      expect.objectContaining({ id: 'legacy-event', seller_id: 'seller_maya' }),
    ]);
    store.close();
  });

  it('maps mail delivery failures to 502 and removes the unsent challenge', async () => {
    const mailer = new CapturingMailer();
    mailer.failure = new Error('provider rejected the recipient');
    const { app, store } = setup(mailer);
    const response = await request(app, '/api/auth/signup', {
      body: { studio_name: 'Mail Failure Studio', email: 'recipient@example.com', password: 'password-123' },
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "We couldn't send a code to this email. Check the address and try again.",
    });
    expect(store.raw.prepare('SELECT COUNT(*) AS count FROM auth_challenges').get()).toMatchObject({ count: 0 });
    store.close();
  });

  it('maps a Resend recipient 403 to 502 and logs no API key', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SMTP_USER', '');
    vi.stubEnv('RESEND_API_KEY', 'test-api-key');
    vi.stubEnv('MAIL_FROM', 'ServiceReady <sender@example.com>');
    const fetchStub = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'recipient not verified' }), { status: 403 }),
    );
    vi.stubGlobal('fetch', fetchStub);
    const providerLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mailer = createMailer();
    const { app, store } = setup(mailer);
    const response = await request(app, '/api/auth/signup', {
      body: { studio_name: 'Resend Studio', email: 'owner@example.com', password: 'password-123' },
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "We couldn't send a code to this email. Check the address and try again.",
    });
    expect(fetchStub).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-api-key' }),
      }),
    );
    const requestBody = JSON.parse(String(fetchStub.mock.calls[0]?.[1]?.body)) as {
      from: string;
      subject: string;
      text: string;
      html: string;
    };
    expect(requestBody.from).toBe('ServiceReady <sender@example.com>');
    expect(requestBody.subject).toMatch(/^Your ServiceReady code: \d{6}$/);
    expect(requestBody.text).toContain('expires in 10 minutes');
    expect(requestBody.text).toContain("If you didn't ask for this, ignore this email.");
    expect(requestBody.html).toContain('font-family:Arial,sans-serif');
    expect(providerLog).toHaveBeenCalledWith('[email] provider failure status=403 error=ResendError');
    expect(providerLog.mock.calls.flat().join(' ')).not.toContain('test-api-key');
    store.close();
  });

  it('returns 503 when production has no email provider configured', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SMTP_USER', '');
    vi.stubEnv('RESEND_API_KEY', '');
    const mailer = createMailer();
    const { app, store } = setup(mailer);
    const response = await request(app, '/api/auth/signup', {
      body: { studio_name: 'Unconfigured Studio', email: 'owner@example.com', password: 'password-123' },
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Email sending isn't set up yet." });
    expect(store.raw.prepare('SELECT COUNT(*) AS count FROM auth_challenges').get()).toMatchObject({ count: 0 });
    store.close();
  });

  it('marks session cookies secure when the configured public URL uses HTTPS', async () => {
    const mailer = new CapturingMailer();
    const store = new Store(':memory:');
    const app = createApp({
      store,
      ai: new TestAI(),
      mailer,
      publicBaseUrl: 'https://serviceready.example',
    });
    const challenge = await signup(app, mailer, 'secure@example.com', 'Secure Studio');
    const verified = await verify(app, challenge.challenge_id, lastCode(mailer));
    expect(verified.headers.get('set-cookie')).toContain('Secure');
    store.close();
  });
});
