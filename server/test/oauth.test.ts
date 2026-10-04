import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../src/app.js';
import { hashSessionToken } from '../src/auth.js';
import { Store, timestamp } from '../src/db.js';
import type { AuthPurpose } from '../src/db.js';
import type { Mailer } from '../src/mail.js';
import type { Proposal, Quote } from '../src/types.js';

const BASE_URL = 'https://service.example';
const RESOURCE = `${BASE_URL}/mcp/seller`;
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const stores: Store[] = [];

class CapturingMailer implements Mailer {
  readonly sent: Array<{ purpose: AuthPurpose; code: string }> = [];

  async sendCode(_to: string, purpose: AuthPurpose, code: string): Promise<void> {
    this.sent.push({ purpose, code });
  }
}

function setup(options: { fetchClientMetadata?: (url: string) => Promise<unknown> } = {}) {
  const store = new Store(':memory:');
  stores.push(store);
  const mailer = new CapturingMailer();
  const app = createApp({ store, mailer, publicBaseUrl: BASE_URL, ...options });
  return { app, store, mailer };
}

async function request(
  app: ReturnType<typeof createApp>,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    cookie?: string;
    headers?: HeadersInit;
    ip?: string;
  } = {}
): Promise<Response> {
  const headers = new Headers(options.headers);
  if (options.cookie) headers.set('cookie', options.cookie);
  if (options.ip) headers.set('fly-client-ip', options.ip);
  const body = options.body === undefined
    ? undefined
    : typeof options.body === 'string' || options.body instanceof URLSearchParams
      ? options.body.toString()
      : JSON.stringify(options.body);
  if (body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return app.request(path, {
    method: options.method ?? (body === undefined ? 'GET' : 'POST'),
    headers,
    ...(body === undefined ? {} : { body })
  });
}

function sessionCookie(response: Response): string {
  const value = response.headers.get('set-cookie');
  if (!value) throw new Error('Authentication response did not set a session cookie.');
  return value.split(';', 1)[0] ?? '';
}

async function createAccount(
  app: ReturnType<typeof createApp>,
  store: Store,
  mailer: CapturingMailer,
  email: string,
  studioName = 'OAuth Studio'
): Promise<{ cookie: string; userId: string; sellerId: string }> {
  const signup = await request(app, '/api/auth/signup', {
    body: { studio_name: studioName, email, password: 'studio-password-1' }
  });
  expect(signup.status).toBe(201);
  const { challenge_id } = await signup.json() as { challenge_id: string };
  const code = mailer.sent.at(-1)?.code;
  if (!code) throw new Error('Verification email was not sent.');
  const verified = await request(app, '/api/auth/verify', { body: { challenge_id, code } });
  expect(verified.status).toBe(200);
  const user = store.getUserByEmail(email);
  if (!user) throw new Error('Account user was not stored.');
  return { cookie: sessionCookie(verified), userId: user.id, sellerId: user.seller_id };
}

function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

async function registerClient(
  app: ReturnType<typeof createApp>,
  redirectUri = CALLBACK,
  name = 'Claude'
): Promise<string> {
  const response = await request(app, '/oauth/register', {
    body: {
      client_name: name,
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none'
    }
  });
  expect(response.status).toBe(201);
  const registration = await response.json() as { client_id: string };
  expect(registration.client_id).toMatch(/^oc_/);
  return registration.client_id;
}

async function beginAuthorization(
  app: ReturnType<typeof createApp>,
  clientId: string,
  redirectUri = CALLBACK,
  verifier = 'A'.repeat(43),
  scope = 'studio offline_access',
  state = 'state-test'
): Promise<{ requestId: string; verifier: string; redirectUri: string; state: string }> {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    code_challenge: challengeFor(verifier),
    code_challenge_method: 'S256',
    scope,
    resource: RESOURCE,
    state
  });
  const response = await request(app, `/oauth/authorize?${params}`);
  expect(response.status).toBe(302);
  const location = response.headers.get('location');
  if (!location) throw new Error('Authorization endpoint did not redirect to consent.');
  const consentUrl = new URL(location, BASE_URL);
  expect(consentUrl.pathname).toBe('/authorize');
  return {
    requestId: consentUrl.searchParams.get('request') ?? '',
    verifier,
    redirectUri,
    state
  };
}

async function decide(
  app: ReturnType<typeof createApp>,
  cookie: string,
  requestId: string,
  allow: boolean,
  headers?: HeadersInit
): Promise<{ redirect_url: string }> {
  const response = await request(app, `/api/oauth/requests/${requestId}/decision`, {
    method: 'POST',
    cookie,
    body: { allow },
    headers
  });
  if (!response.ok) throw new Error(`Consent decision failed: ${response.status} ${await response.text()}`);
  return await response.json() as { redirect_url: string };
}

async function issueTokens(
  app: ReturnType<typeof createApp>,
  cookie: string,
  clientId: string,
  options: { redirectUri?: string; verifier?: string; scope?: string } = {}
): Promise<{ accessToken: string; refreshToken?: string; clientId: string; redirectUri: string; verifier: string }> {
  const redirectUri = options.redirectUri ?? CALLBACK;
  const verifier = options.verifier ?? 'A'.repeat(43);
  const auth = await beginAuthorization(
    app,
    clientId,
    redirectUri,
    verifier,
    options.scope ?? 'studio offline_access'
  );
  const consent = await decide(app, cookie, auth.requestId, true);
  const code = new URL(consent.redirect_url).searchParams.get('code');
  if (!code) throw new Error('Consent response did not include an authorization code.');
  const response = await request(app, '/oauth/token', {
    body: {
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      resource: RESOURCE
    }
  });
  expect(response.status).toBe(200);
  const tokens = await response.json() as {
    access_token: string;
    refresh_token?: string;
  };
  return {
    accessToken: tokens.access_token,
    ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
    clientId,
    redirectUri,
    verifier
  };
}

function appFetch(app: ReturnType<typeof createApp>, userId?: string) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    return app.fetch(request, userId ? { serviceReadyMcpUserId: userId } : undefined);
  };
}

function quoteFor(sellerId: string, id: string, clientName: string): Quote {
  const createdAt = timestamp();
  return {
    id,
    seller_id: sellerId,
    service_id: 'svc_test',
    service_title: 'Brand identity',
    client_name: clientName,
    client_email: `${clientName.toLowerCase()}@example.com`,
    brief: 'A visual identity for a neighborhood business.',
    scope_summary: 'Logo and brand guide.',
    line_items: [{ label: 'Brand identity', amount_cents: 50000 }],
    total_cents: 50000,
    deposit_cents: 25000,
    balance_cents: 25000,
    status: 'quoted',
    source: 'web',
    approval_url: `${BASE_URL}/q/${id}`,
    created_at: createdAt,
    updated_at: createdAt
  };
}

function textContent(result: unknown): string {
  const content = (result as { content?: unknown } | null)?.content;
  if (!Array.isArray(content)) return '';
  const text = content.find((item): item is { type: string; text: string } =>
    typeof item === 'object' && item !== null &&
    (item as { type?: unknown }).type === 'text' &&
    typeof (item as { text?: unknown }).text === 'string'
  );
  return text?.text ?? '';
}

afterEach(() => {
  for (const store of stores) store.close();
  stores.length = 0;
});

describe('seller MCP OAuth', () => {
  it('publishes seller-only OAuth metadata, rejects unrelated well-known resources, and leaves public MCP open', async () => {
    const { app } = setup();
    const resourceMetadata = await request(app, '/.well-known/oauth-protected-resource/mcp/seller');
    expect(await resourceMetadata.json()).toEqual({
      resource: RESOURCE,
      authorization_servers: [BASE_URL],
      scopes_supported: ['studio', 'offline_access'],
      bearer_methods_supported: ['header'],
      resource_name: 'ServiceReady studio'
    });
    const authorizationMetadata = await request(app, '/.well-known/oauth-authorization-server');
    expect(await authorizationMetadata.json()).toEqual({
      issuer: BASE_URL,
      authorization_endpoint: `${BASE_URL}/oauth/authorize`,
      token_endpoint: `${BASE_URL}/oauth/token`,
      registration_endpoint: `${BASE_URL}/oauth/register`,
      revocation_endpoint: `${BASE_URL}/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      client_id_metadata_document_supported: true,
      scopes_supported: ['studio', 'offline_access']
    });
    for (const path of [
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/mcp',
      '/.well-known/openid-configuration',
      '/.well-known/other'
    ]) {
      const response = await request(app, path);
      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(await response.json()).toEqual({ error: 'Not found.' });
    }

    const client = new Client({ name: 'public-mcp-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(`${BASE_URL}/mcp`), {
      fetch: appFetch(app)
    });
    await client.connect(transport);
    expect((await client.listTools()).tools.map((tool) => tool.name).sort()).toEqual([
      'get_quote_status',
      'get_service',
      'list_services',
      'request_quote'
    ]);
    await client.close();
  });

  it('challenges seller MCP requests and preserves the public MCP without authentication', async () => {
    const { app } = setup();
    const missing = await request(app, '/mcp/seller');
    expect(missing.status).toBe(401);
    expect(missing.headers.get('www-authenticate')).toBe(
      `Bearer resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource/mcp/seller", scope="studio"`
    );
    const invalid = await request(app, '/mcp/seller', {
      headers: { authorization: 'Bearer invalid-token' }
    });
    expect(invalid.status).toBe(401);
    expect(invalid.headers.get('www-authenticate')).toBe(
      `Bearer resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource/mcp/seller", scope="studio", error="invalid_token"`
    );
    const publicInitialize = await request(app, '/mcp', {
      method: 'POST',
      headers: { accept: 'application/json, text/event-stream' },
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'public-test', version: '1.0.0' }
        }
      }
    });
    expect(publicInitialize.status).toBe(200);
  });

  it('validates DCR redirect URIs and completes single-use PKCE consent and token exchange', async () => {
    const { app, store, mailer } = setup();
    const account = await createAccount(app, store, mailer, 'owner@example.com', 'Owner Studio');
    const invalidRedirect = await request(app, '/oauth/register', {
      body: { redirect_uris: ['http://example.com/callback'] }
    });
    expect(invalidRedirect.status).toBe(400);
    expect(await invalidRedirect.json()).toMatchObject({ error: 'invalid_client_metadata' });
    const fragmentRedirect = await request(app, '/oauth/register', {
      body: { redirect_uris: ['https://client.example/callback#unsafe'] }
    });
    expect(fragmentRedirect.status).toBe(400);

    const registration = await request(app, '/oauth/register', {
      body: {
        client_name: 'Claude',
        redirect_uris: [CALLBACK],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code']
      }
    });
    expect(registration.status).toBe(201);
    const client = await registration.json() as Record<string, unknown> & { client_id: string };
    expect(client).toMatchObject({
      client_name: 'Claude',
      redirect_uris: [CALLBACK],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code']
    });
    expect(client.client_id).toMatch(/^oc_/);
    expect(client.client_id_issued_at).toEqual(expect.any(Number));

    const verifier = 'B'.repeat(43);
    const auth = await beginAuthorization(app, client.client_id, CALLBACK, verifier);
    const consentInfo = await request(app, `/api/oauth/requests/${auth.requestId}`, {
      cookie: account.cookie
    });
    expect(await consentInfo.json()).toEqual({
      client_name: 'Claude',
      redirect_host: 'claude.ai',
      studio_name: 'Owner Studio',
      scopes: ['studio', 'offline_access']
    });
    const deniedCrossSite = await request(app, `/api/oauth/requests/${auth.requestId}/decision`, {
      method: 'POST',
      cookie: account.cookie,
      headers: { origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' },
      body: { allow: true }
    });
    expect(deniedCrossSite.status).toBe(403);

    const consent = await decide(app, account.cookie, auth.requestId, true);
    const code = new URL(consent.redirect_url).searchParams.get('code');
    expect(new URL(consent.redirect_url).searchParams.get('state')).toBe('state-test');
    expect(new URL(consent.redirect_url).searchParams.get('iss')).toBe(BASE_URL);
    expect(code).toBeTruthy();

    const wrongVerifier = await request(app, '/oauth/token', {
      body: {
        grant_type: 'authorization_code',
        code,
        client_id: client.client_id,
        redirect_uri: CALLBACK,
        code_verifier: 'C'.repeat(43),
        resource: RESOURCE
      }
    });
    expect(wrongVerifier.status).toBe(400);
    expect(wrongVerifier.headers.get('cache-control')).toBe('no-store');
    expect(await wrongVerifier.json()).toMatchObject({ error: 'invalid_grant' });
    const wrongRedirect = await request(app, '/oauth/token', {
      body: {
        grant_type: 'authorization_code',
        code,
        client_id: client.client_id,
        redirect_uri: 'https://other.example/callback',
        code_verifier: verifier,
        resource: RESOURCE
      }
    });
    expect(wrongRedirect.status).toBe(400);
    expect(await wrongRedirect.json()).toMatchObject({ error: 'invalid_grant' });

    const exchange = await request(app, '/oauth/token', {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code ?? '',
        client_id: client.client_id,
        redirect_uri: CALLBACK,
        code_verifier: verifier,
        resource: RESOURCE
      })
    });
    expect(exchange.status).toBe(200);
    expect(exchange.headers.get('cache-control')).toBe('no-store');
    const tokens = await exchange.json() as {
      access_token: string;
      token_type: string;
      expires_in: number;
      refresh_token: string;
      scope: string;
    };
    expect(tokens).toMatchObject({
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'studio offline_access'
    });
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.refresh_token).toBeTruthy();
    const storedAccess = store.getOAuthToken(hashSessionToken(tokens.access_token));
    expect(storedAccess?.kind).toBe('access_token');
    expect(storedAccess?.token_hash).not.toBe(tokens.access_token);

    const reusedCode = await request(app, '/oauth/token', {
      body: {
        grant_type: 'authorization_code',
        code,
        client_id: client.client_id,
        redirect_uri: CALLBACK,
        code_verifier: verifier
      }
    });
    expect(reusedCode.status).toBe(400);
    expect(await reusedCode.json()).toMatchObject({ error: 'invalid_grant' });
  });

  it('supports CIMD, exact client identity validation, and loopback redirects on any port', async () => {
    const metadataUrl = 'https://claude.ai/.well-known/oauth-client.json';
    const metadataFetcher = vi.fn(async (url: string): Promise<unknown> => ({
      client_id: url,
      client_name: 'Claude',
      redirect_uris: [CALLBACK, 'http://localhost/callback']
    }));
    const { app } = setup({ fetchClientMetadata: metadataFetcher });
    const hosted = await beginAuthorization(app, metadataUrl, CALLBACK);
    expect(hosted.requestId).toMatch(/^oar_/);
    const loopback = await beginAuthorization(app, metadataUrl, 'http://localhost:49321/callback');
    expect(loopback.requestId).toMatch(/^oar_/);
    expect(metadataFetcher).toHaveBeenCalledTimes(1);
    for (const unsafeClientId of [
      'https://127.0.0.1/client.json',
      'https://[::1]/client.json',
      'https://localhost/client.json',
      'https://client.local/client.json',
      'https://client.internal/client.json',
      'https://user:secret@claude.ai/client.json',
      'https://claude.ai/client.json#fragment'
    ]) {
      const rejected = await request(app, `/oauth/authorize?${new URLSearchParams({
        client_id: unsafeClientId,
        redirect_uri: CALLBACK,
        response_type: 'code',
        code_challenge: challengeFor('F'.repeat(43)),
        code_challenge_method: 'S256'
      })}`);
      expect(rejected.status).toBe(400);
      expect(rejected.headers.get('location')).toBeNull();
    }
    expect(metadataFetcher).toHaveBeenCalledTimes(1);

    const mismatch = setup({
      fetchClientMetadata: async () => ({
        client_id: 'https://attacker.example/client.json',
        redirect_uris: [CALLBACK]
      })
    });
    const bad = await request(
      mismatch.app,
      `/oauth/authorize?${new URLSearchParams({
        client_id: 'https://claude.ai/bad-metadata.json',
        redirect_uri: CALLBACK,
        response_type: 'code',
        code_challenge: challengeFor('D'.repeat(43)),
        code_challenge_method: 'S256'
      })}`
    );
    expect(bad.status).toBe(400);
    expect(bad.headers.get('location')).toBeNull();

    const ipClient = await request(
      app,
      `/oauth/authorize?${new URLSearchParams({
        client_id: 'https://127.0.0.1/client.json',
        redirect_uri: CALLBACK,
        response_type: 'code',
        code_challenge: challengeFor('E'.repeat(43)),
        code_challenge_method: 'S256'
      })}`
    );
    expect(ipClient.status).toBe(400);
    expect(metadataFetcher).toHaveBeenCalledTimes(1);
  });

  it('rotates refresh tokens and revokes the grant when an old refresh token is reused', async () => {
    const { app, store, mailer } = setup();
    const account = await createAccount(app, store, mailer, 'refresh@example.com');
    const clientId = await registerClient(app);
    const tokens = await issueTokens(app, account.cookie, clientId);
    if (!tokens.refreshToken) throw new Error('Offline scope did not issue a refresh token.');
    const rotated = await request(app, '/oauth/token', {
      body: {
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: tokens.refreshToken,
        resource: RESOURCE
      }
    });
    expect(rotated.status).toBe(200);
    const newTokens = await rotated.json() as { access_token: string; refresh_token: string };
    expect(newTokens.refresh_token).not.toBe(tokens.refreshToken);
    const reused = await request(app, '/oauth/token', {
      body: {
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: tokens.refreshToken
      }
    });
    expect(reused.status).toBe(400);
    expect(await reused.json()).toMatchObject({ error: 'invalid_grant' });
    expect(store.listOAuthGrants(account.userId)).toEqual([]);
    const denied = await request(app, '/mcp/seller', {
      headers: { authorization: `Bearer ${newTokens.access_token}` }
    });
    expect(denied.status).toBe(401);
    expect(denied.headers.get('www-authenticate')).toContain('error="invalid_token"');
  });

  it('redirects denied consent, revokes owner grants and access on password reset', async () => {
    const { app, store, mailer } = setup();
    const account = await createAccount(app, store, mailer, 'reset@example.com');
    const clientId = await registerClient(app);
    const deniedRequest = await beginAuthorization(app, clientId);
    const denied = await decide(app, account.cookie, deniedRequest.requestId, false);
    const deniedUri = new URL(denied.redirect_url);
    expect(deniedUri.searchParams.get('error')).toBe('access_denied');
    expect(deniedUri.searchParams.get('state')).toBe('state-test');

    const tokens = await issueTokens(app, account.cookie, clientId);
    const grants = await request(app, '/api/oauth/grants', { cookie: account.cookie });
    const listed = await grants.json() as Array<Record<string, unknown>>;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ client_name: 'Claude' });
    expect(listed[0]).not.toHaveProperty('access_token');
    expect(listed[0]).not.toHaveProperty('refresh_token');
    const accessRecord = store.getOAuthToken(hashSessionToken(tokens.accessToken));
    expect(accessRecord).not.toBeNull();
    store.raw.prepare('UPDATE oauth_tokens SET expires_at = ? WHERE token_hash = ?')
      .run(new Date(Date.now() - 1000).toISOString(), hashSessionToken(tokens.accessToken));
    const expiredAccess = await request(app, '/mcp/seller', {
      headers: { authorization: `Bearer ${tokens.accessToken}` }
    });
    expect(expiredAccess.status).toBe(401);
    expect(expiredAccess.headers.get('www-authenticate')).toContain('error="invalid_token"');
    store.raw.prepare('UPDATE oauth_tokens SET expires_at = ? WHERE token_hash = ?')
      .run(new Date(Date.now() + 60 * 60_000).toISOString(), hashSessionToken(tokens.accessToken));
    const foreignAccount = await createAccount(app, store, mailer, 'other@example.com', 'Other Studio');
    const foreignDelete = await request(app, `/api/oauth/grants/${String(listed[0]?.id)}`, {
      method: 'DELETE',
      cookie: foreignAccount.cookie
    });
    expect(foreignDelete.status).toBe(404);
    const removed = await request(app, `/api/oauth/grants/${String(listed[0]?.id)}`, {
      method: 'DELETE',
      cookie: account.cookie
    });
    expect(removed.status).toBe(204);
    expect(await (await request(app, '/api/oauth/grants', { cookie: account.cookie })).json()).toEqual([]);
    const revokedAccess = await request(app, '/mcp/seller', {
      headers: { authorization: `Bearer ${tokens.accessToken}` }
    });
    expect(revokedAccess.status).toBe(401);
    expect(revokedAccess.headers.get('www-authenticate')).toContain('error="invalid_token"');
    const revokeUnknown = await request(app, '/oauth/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: 'unknown-token', token_type_hint: 'access_token' })
    });
    expect(revokeUnknown.status).toBe(200);

    const tokensAfterReconnect = await issueTokens(app, account.cookie, clientId);
    const forgot = await request(app, '/api/auth/forgot', {
      body: { email: 'reset@example.com' }
    });
    expect(forgot.status).toBe(200);
    const { challenge_id } = await forgot.json() as { challenge_id: string };
    const resetCode = mailer.sent.at(-1)?.code;
    if (!resetCode) throw new Error('Password reset email was not sent.');
    const reset = await request(app, '/api/auth/verify', {
      body: { challenge_id, code: resetCode, new_password: 'new-password-2' }
    });
    expect(reset.status).toBe(200);
    expect(store.listOAuthGrants(account.userId)).toEqual([]);
    const deniedAccess = await request(app, '/mcp/seller', {
      headers: { authorization: `Bearer ${tokensAfterReconnect.accessToken}` }
    });
    expect(deniedAccess.status).toBe(401);
    expect(deniedAccess.headers.get('www-authenticate')).toContain('error="invalid_token"');
    expect(tokens.accessToken).not.toBe(tokensAfterReconnect.accessToken);
  });

  it('exposes only the token owner’s seller tools, blocks cross-seller reads, and audits a Claude approval', async () => {
    const { app, store, mailer } = setup();
    const sellerA = await createAccount(app, store, mailer, 'seller-a@example.com', 'Studio A');
    const sellerB = await createAccount(app, store, mailer, 'seller-b@example.com', 'Studio B');
    const quoteA = quoteFor(sellerA.sellerId, 'quote_a', 'Client A');
    const quoteB = quoteFor(sellerB.sellerId, 'quote_b', 'Client B');
    store.saveQuote(quoteA);
    store.saveQuote(quoteB);
    const proposal: Proposal = {
      id: 'proposal_a',
      quote_id: quoteA.id,
      client_name: quoteA.client_name,
      action: 'wait',
      reason: 'The invoice is within the grace period.',
      evidence: 'No reminders are due.',
      draft_message: 'Wait for the client.',
      status: 'pending',
      created_at: timestamp()
    };
    store.saveProposal(proposal);

    const clientId = await registerClient(app);
    const tokens = await issueTokens(app, sellerA.cookie, clientId);
    const client = new Client({ name: 'seller-mcp-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(RESOURCE), {
      fetch: appFetch(app, sellerA.userId),
      requestInit: { headers: { authorization: `Bearer ${tokens.accessToken}` } }
    });
    await client.connect(transport);
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining([
      'get_studio',
      'list_bookings',
      'get_booking',
      'list_pending_approvals',
      'who_owes_what',
      'list_services',
      'get_activity_log',
      'get_stats',
      'approve_suggestion',
      'reject_suggestion',
      'mark_delivered_and_send_balance_invoice',
      'run_collections_check',
      'record_client_reply',
      'parse_rate_card',
      'publish_services',
      'update_service',
      'update_rules',
      'create_quote'
    ]));
    expect(tools.tools.find((tool) => tool.name === 'list_bookings')?.annotations?.readOnlyHint).toBe(true);
    expect(tools.tools.find((tool) => tool.name === 'publish_services')?.annotations).toMatchObject({
      destructiveHint: true,
      openWorldHint: true
    });

    const bookings = await client.callTool({ name: 'list_bookings', arguments: {} });
    const bookingsValue = JSON.parse(textContent(bookings)) as Quote[];
    expect(bookingsValue.map((quote) => quote.id)).toEqual([quoteA.id]);
    const foreignBooking = await client.callTool({
      name: 'get_booking',
      arguments: { quote_id: quoteB.id }
    });
    expect(foreignBooking.isError).toBe(true);
    expect(textContent(foreignBooking)).toContain('Booking not found.');

    const approved = await client.callTool({
      name: 'approve_suggestion',
      arguments: { proposal_id: proposal.id, draft_message: 'We will wait for now.' }
    });
    expect(approved.isError).not.toBe(true);
    expect(JSON.parse(textContent(approved))).toMatchObject({ status: 'executed' });
    expect(store.listEvents(quoteA.id).some((event) =>
      event.actor === 'seller' && event.text?.includes('Via Claude')
    )).toBe(true);
    await client.close();

    const grants = store.listOAuthGrants(sellerA.userId);
    expect(grants).toHaveLength(1);
    const invalidAfterExpiry = store.getOAuthToken(hashSessionToken(tokens.accessToken));
    expect(invalidAfterExpiry?.token_hash).not.toBe(tokens.accessToken);
  });
});
