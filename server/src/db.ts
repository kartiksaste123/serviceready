import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  AgentEvent,
  Payment,
  Proposal,
  Quote,
  Reply,
  Seller,
  Service
} from './types.js';

const now = (): string => new Date().toISOString();
const id = (prefix: string): string => `${prefix}_${randomUUID()}`;

export class Store {
  readonly raw: Database.Database;

  constructor(path = process.env.DATABASE_PATH ?? './data/dev.db') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.raw = new Database(path);
    this.raw.pragma('journal_mode = WAL');
    this.raw.pragma('foreign_keys = ON');
    this.raw.exec(`
      CREATE TABLE IF NOT EXISTS sellers (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS services (id TEXT PRIMARY KEY, seller_id TEXT, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS quotes (id TEXT PRIMARY KEY, seller_id TEXT, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS payments (id TEXT PRIMARY KEY, quote_id TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, quote_id TEXT, created_at TEXT NOT NULL, seller_id TEXT, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS proposals (id TEXT PRIMARY KEY, quote_id TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS replies (id TEXT PRIMARY KEY, quote_id TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS webhook_events (event_id TEXT PRIMARY KEY, received_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT,
        seller_id TEXT NOT NULL,
        email_verified_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS auth_challenges (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        purpose TEXT NOT NULL,
        code_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        sent_at TEXT NOT NULL,
        send_count INTEGER NOT NULL DEFAULT 1,
        consumed_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS auth_code_sends (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        sent_at TEXT NOT NULL
      );
    `);
    this.migrateSellerColumns();
    if (!this.getSellerById('seller_maya')) this.seed();
    this.ensureDemoUser();
  }

  close(): void {
    this.raw.close();
  }

  getSellerById(id: string): Seller | null {
    const row = this.raw.prepare('SELECT payload FROM sellers WHERE id = ?').get(id) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) as Seller : null;
  }

  getSellerBySlug(slug: string): Seller | null {
    const row = this.raw.prepare("SELECT payload FROM sellers WHERE json_extract(payload, '$.slug') = ?").get(slug) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) as Seller : null;
  }

  isSellerActive(sellerId: string): boolean {
    if (sellerId === 'seller_maya') return true;
    return Boolean(this.raw.prepare(
      'SELECT 1 FROM users WHERE seller_id = ? AND email_verified_at IS NOT NULL LIMIT 1'
    ).get(sellerId));
  }

  sellerSlugExists(slug: string): boolean {
    return Boolean(this.raw.prepare("SELECT 1 FROM sellers WHERE json_extract(payload, '$.slug') = ?").get(slug));
  }

  saveSeller(seller: Seller): void {
    this.raw.prepare('INSERT OR REPLACE INTO sellers(id,payload) VALUES(?,?)')
      .run(seller.id, JSON.stringify(seller));
  }

  getService(serviceId: string): Service | null {
    const row = this.raw.prepare('SELECT payload FROM services WHERE id = ?').get(serviceId) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) as Service : null;
  }

  listServices(sellerId: string, status?: Service['status']): Service[] {
    const rows = this.raw.prepare('SELECT payload FROM services WHERE seller_id = ? ORDER BY rowid').all(sellerId) as { payload: string }[];
    const services = rows.map((row) => JSON.parse(row.payload) as Service);
    return status ? services.filter((service) => service.status === status) : services;
  }

  saveService(service: Service): void {
    this.raw.prepare('INSERT OR REPLACE INTO services(id,seller_id,payload) VALUES(?,?,?)')
      .run(service.id, service.seller_id, JSON.stringify(service));
  }

  replaceServices(sellerId: string, services: Service[]): void {
    const tx = this.raw.transaction((items: Service[]) => {
      this.raw.prepare('DELETE FROM services WHERE seller_id = ?').run(sellerId);
      for (const service of items) this.saveService({ ...service, seller_id: sellerId });
    });
    tx(services);
  }

  getQuote(quoteId: string): Quote | null {
    const row = this.raw.prepare('SELECT payload FROM quotes WHERE id = ?').get(quoteId) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) as Quote : null;
  }

  listQuotes(sellerId?: string): Quote[] {
    const rows = sellerId
      ? this.raw.prepare('SELECT payload FROM quotes WHERE seller_id = ? ORDER BY rowid DESC').all(sellerId) as { payload: string }[]
      : this.raw.prepare('SELECT payload FROM quotes ORDER BY rowid DESC').all() as { payload: string }[];
    return rows.map((row) => JSON.parse(row.payload) as Quote);
  }

  saveQuote(quote: Quote): void {
    this.raw.prepare('INSERT OR REPLACE INTO quotes(id,seller_id,payload) VALUES(?,?,?)')
      .run(quote.id, quote.seller_id, JSON.stringify(quote));
  }

  listPayments(quoteId: string): Payment[] {
    const rows = this.raw.prepare('SELECT payload FROM payments WHERE quote_id = ? ORDER BY rowid').all(quoteId) as { payload: string }[];
    return rows.map((row) => JSON.parse(row.payload) as Payment);
  }

  getPayment(quoteId: string, kind: Payment['kind']): Payment | null {
    const rows = this.listPayments(quoteId);
    return rows.find((payment) => payment.kind === kind) ?? null;
  }

  savePayment(quoteId: string, payment: Payment): void {
    this.raw.prepare('INSERT OR REPLACE INTO payments(id,quote_id,payload) VALUES(?,?,?)')
      .run(payment.id, quoteId, JSON.stringify(payment));
  }

  listEvents(quoteId?: string | null, actor?: AgentEvent['actor'], sellerId?: string): AgentEvent[] {
    let sql = 'SELECT payload FROM events WHERE 1 = 1';
    const args: (string | null)[] = [];
    if (quoteId !== undefined) {
      sql += ' AND quote_id IS ?';
      args.push(quoteId);
    }
    if (sellerId) {
      sql += ' AND seller_id = ?';
      args.push(sellerId);
    }
    if (actor) {
      sql += " AND json_extract(payload, '$.actor') = ?";
      args.push(actor);
    }
    sql += ' ORDER BY created_at';
    return (this.raw.prepare(sql).all(...args) as { payload: string }[])
      .map((row) => JSON.parse(row.payload) as AgentEvent);
  }

  saveEvent(event: AgentEvent): void {
    const sellerId = event.seller_id ?? (event.quote_id ? this.getQuote(event.quote_id)?.seller_id : undefined);
    const savedEvent = sellerId ? { ...event, seller_id: sellerId } : event;
    this.raw.prepare('INSERT INTO events(id,quote_id,created_at,seller_id,payload) VALUES(?,?,?,?,?)')
      .run(event.id, event.quote_id, event.created_at, sellerId ?? null, JSON.stringify(savedEvent));
  }

  listProposals(quoteId?: string, status?: Proposal['status'], sellerId?: string): Proposal[] {
    let sql = 'SELECT p.payload FROM proposals p JOIN quotes q ON q.id = p.quote_id WHERE 1 = 1';
    const args: string[] = [];
    if (quoteId) {
      sql += ' AND p.quote_id = ?';
      args.push(quoteId);
    }
    if (status) {
      sql += ' AND p.status = ?';
      args.push(status);
    }
    if (sellerId) {
      sql += ' AND q.seller_id = ?';
      args.push(sellerId);
    }
    sql += ' ORDER BY p.rowid DESC';
    return (this.raw.prepare(sql).all(...args) as { payload: string }[])
      .map((row) => JSON.parse(row.payload) as Proposal);
  }

  getProposal(proposalId: string): Proposal | null {
    const row = this.raw.prepare('SELECT payload FROM proposals WHERE id = ?').get(proposalId) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) as Proposal : null;
  }

  saveProposal(proposal: Proposal): void {
    this.raw.prepare('INSERT OR REPLACE INTO proposals(id,quote_id,status,payload) VALUES(?,?,?,?)')
      .run(proposal.id, proposal.quote_id, proposal.status, JSON.stringify(proposal));
  }

  listReplies(quoteId: string): Reply[] {
    return (this.raw.prepare('SELECT payload FROM replies WHERE quote_id = ? ORDER BY created_at').all(quoteId) as { payload: string }[])
      .map((row) => JSON.parse(row.payload) as Reply);
  }

  saveReply(reply: Reply): void {
    this.raw.prepare('INSERT INTO replies(id,quote_id,created_at,payload) VALUES(?,?,?,?)')
      .run(reply.id, reply.quote_id, reply.created_at, JSON.stringify(reply));
  }

  getUserByEmail(email: string): UserRecord | null {
    const row = this.raw.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRecord | undefined;
    return row ?? null;
  }

  getUserById(id: string): UserRecord | null {
    const row = this.raw.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRecord | undefined;
    return row ?? null;
  }

  saveUser(user: UserRecord): void {
    this.raw.prepare(`
      INSERT OR REPLACE INTO users(id,email,password_hash,seller_id,email_verified_at,created_at)
      VALUES(?,?,?,?,?,?)
    `).run(user.id, user.email, user.password_hash, user.seller_id, user.email_verified_at, user.created_at);
  }

  deleteUserAndSeller(userId: string, sellerId: string): void {
    this.raw.transaction(() => {
      this.raw.prepare('DELETE FROM auth_challenges WHERE user_id = ?').run(userId);
      this.raw.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
      this.raw.prepare('DELETE FROM auth_code_sends WHERE user_id = ?').run(userId);
      this.raw.prepare('DELETE FROM users WHERE id = ?').run(userId);
      this.raw.prepare('DELETE FROM sellers WHERE id = ?').run(sellerId);
    })();
  }

  getAuthChallenge(id: string): AuthChallengeRecord | null {
    const row = this.raw.prepare('SELECT * FROM auth_challenges WHERE id = ?').get(id) as AuthChallengeRecord | undefined;
    return row ?? null;
  }

  saveAuthChallenge(challenge: AuthChallengeRecord): void {
    this.raw.prepare(`
      INSERT OR REPLACE INTO auth_challenges(
        id,user_id,purpose,code_hash,expires_at,attempts,sent_at,send_count,consumed_at,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?)
    `).run(
      challenge.id,
      challenge.user_id,
      challenge.purpose,
      challenge.code_hash,
      challenge.expires_at,
      challenge.attempts,
      challenge.sent_at,
      challenge.send_count,
      challenge.consumed_at,
      challenge.created_at
    );
  }

  deleteAuthChallenge(id: string): void {
    this.raw.prepare('DELETE FROM auth_challenges WHERE id = ?').run(id);
  }

  invalidateChallenges(userId: string, purpose?: AuthPurpose): void {
    const sql = purpose
      ? 'UPDATE auth_challenges SET consumed_at = ? WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL'
      : 'UPDATE auth_challenges SET consumed_at = ? WHERE user_id = ? AND consumed_at IS NULL';
    if (purpose) this.raw.prepare(sql).run(now(), userId, purpose);
    else this.raw.prepare(sql).run(now(), userId);
  }

  countAuthSendsSince(userId: string, since: string): number {
    const row = this.raw.prepare('SELECT COUNT(*) AS count FROM auth_code_sends WHERE user_id = ? AND sent_at >= ?')
      .get(userId, since) as { count: number };
    return row.count;
  }

  recordAuthSend(userId: string, sentAt: string): void {
    this.raw.prepare('INSERT INTO auth_code_sends(id,user_id,sent_at) VALUES(?,?,?)')
      .run(id('mail'), userId, sentAt);
  }

  getSession(tokenHash: string): SessionRecord | null {
    const row = this.raw.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(tokenHash) as SessionRecord | undefined;
    return row ?? null;
  }

  saveSession(session: SessionRecord): void {
    this.raw.prepare('INSERT OR REPLACE INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)')
      .run(session.token_hash, session.user_id, session.expires_at, session.created_at);
  }

  deleteSession(tokenHash: string): void {
    this.raw.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  deleteSessions(userId: string): void {
    this.raw.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }

  hasWebhookEvent(eventId: string): boolean {
    return Boolean(this.raw.prepare('SELECT 1 FROM webhook_events WHERE event_id = ?').get(eventId));
  }

  recordWebhookEvent(eventId: string): void {
    this.raw.prepare('INSERT OR IGNORE INTO webhook_events(event_id,received_at) VALUES(?,?)')
      .run(eventId, now());
  }

  resetDemoStudio(): void {
    this.raw.transaction(() => {
      this.raw.prepare('DELETE FROM replies WHERE quote_id IN (SELECT id FROM quotes WHERE seller_id = ?)').run('seller_maya');
      this.raw.prepare('DELETE FROM proposals WHERE quote_id IN (SELECT id FROM quotes WHERE seller_id = ?)').run('seller_maya');
      this.raw.prepare('DELETE FROM events WHERE seller_id = ?').run('seller_maya');
      this.raw.prepare('DELETE FROM payments WHERE quote_id IN (SELECT id FROM quotes WHERE seller_id = ?)').run('seller_maya');
      this.raw.prepare('DELETE FROM quotes WHERE seller_id = ?').run('seller_maya');
      this.raw.prepare('DELETE FROM services WHERE seller_id = ?').run('seller_maya');
      this.raw.prepare('DELETE FROM sellers WHERE id = ?').run('seller_maya');
      this.seed();
    })();
  }

  seed(): void {
    const seller: Seller = {
      id: 'seller_maya',
      slug: 'maya-rao-studio',
      name: 'Maya Rao Studio',
      tagline: 'Brand identity for small businesses',
      email: 'hello@mayaraostudio.com',
      currency: 'USD',
      rules: {
        default_deposit_pct: 50,
        reminder_tone: 'friendly',
        max_reminders: 2,
        wait_days_before_nudge: 3
      }
    };
    this.saveSeller(seller);
    const services: Service[] = [
      {
        id: 'svc_logo_design',
        seller_id: seller.id,
        title: 'Logo design',
        description: 'A distinctive, versatile logo system designed around your business and audience.',
        deliverables: ['Primary logo and alternate lockup', 'Two rounds of refinements', 'Web-ready SVG and PNG files'],
        price_cents: 45000,
        deposit_pct: 50,
        lead_time_days: 7,
        status: 'published'
      },
      {
        id: 'svc_brand_identity_kit',
        seller_id: seller.id,
        title: 'Brand identity kit',
        description: 'A cohesive visual identity to help your small business show up consistently.',
        deliverables: ['Logo suite', 'Color palette and typography', 'Mini brand guide', 'Two rounds of refinements'],
        price_cents: 120000,
        deposit_pct: 50,
        lead_time_days: 14,
        status: 'published'
      },
      {
        id: 'svc_social_templates',
        seller_id: seller.id,
        title: 'Social media template pack',
        description: 'A reusable set of on-brand social templates for a confident, consistent feed.',
        deliverables: ['Ten editable post templates', 'Story and square formats', 'Quick-start usage notes'],
        price_cents: 30000,
        deposit_pct: 30,
        lead_time_days: 5,
        status: 'published'
      },
      {
        id: 'svc_landing_page',
        seller_id: seller.id,
        title: 'Landing page design',
        description: 'A conversion-focused landing page design tailored to your offer and brand.',
        deliverables: ['Desktop and mobile page designs', 'Reusable design components', 'Handoff-ready design file'],
        price_cents: 90000,
        deposit_pct: 40,
        lead_time_days: 14,
        status: 'published'
      }
    ];
    for (const service of services) {
      if (!this.getService(service.id)) this.saveService(service);
    }
    this.ensureDemoUser();
  }

  private ensureDemoUser(): void {
    const verifiedAt = '2026-01-01T00:00:00.000Z';
    this.raw.prepare(`
      INSERT OR IGNORE INTO users(id,email,password_hash,seller_id,email_verified_at,created_at)
      VALUES(?,?,?,?,?,?)
    `).run('user_demo', 'demo@serviceready.local', null, 'seller_maya', verifiedAt, verifiedAt);
  }

  private migrateSellerColumns(): void {
    for (const table of ['services', 'quotes', 'events'] as const) {
      const columns = this.raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      if (!columns.some((column) => column.name === 'seller_id')) {
        this.raw.exec(`ALTER TABLE ${table} ADD COLUMN seller_id TEXT`);
      }
      this.raw.exec(`
        UPDATE ${table} SET seller_id = 'seller_maya' WHERE seller_id IS NULL;
        UPDATE ${table}
        SET payload = json_set(payload, '$.seller_id', seller_id)
        WHERE seller_id IS NOT NULL AND json_extract(payload, '$.seller_id') IS NOT seller_id;
      `);
    }
  }
}

export type AuthPurpose = 'verify' | 'login' | 'reset';

export interface UserRecord {
  id: string;
  email: string;
  password_hash: string | null;
  seller_id: string;
  email_verified_at: string | null;
  created_at: string;
}

export interface AuthChallengeRecord {
  id: string;
  user_id: string;
  purpose: AuthPurpose;
  code_hash: string;
  expires_at: string;
  attempts: number;
  sent_at: string;
  send_count: number;
  consumed_at: string | null;
  created_at: string;
}

export interface SessionRecord {
  token_hash: string;
  user_id: string;
  expires_at: string;
  created_at: string;
}

export function createEvent(
  actor: AgentEvent['actor'],
  kind: AgentEvent['kind'],
  quoteId: string | null,
  details: Omit<AgentEvent, 'id' | 'actor' | 'kind' | 'quote_id' | 'created_at'> = {}
): AgentEvent {
  return { id: id('evt'), actor, kind, quote_id: quoteId, created_at: now(), ...details };
}

export function createId(prefix: string): string {
  return id(prefix);
}

export function timestamp(): string {
  return now();
}
