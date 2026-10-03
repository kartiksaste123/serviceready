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
      CREATE TABLE IF NOT EXISTS services (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS quotes (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS payments (id TEXT PRIMARY KEY, quote_id TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, quote_id TEXT, created_at TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS proposals (id TEXT PRIMARY KEY, quote_id TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS replies (id TEXT PRIMARY KEY, quote_id TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS webhook_events (event_id TEXT PRIMARY KEY, received_at TEXT NOT NULL);
    `);
    if (!this.getSeller()) this.seed();
  }

  close(): void {
    this.raw.close();
  }

  getSeller(): Seller | null {
    const row = this.raw.prepare('SELECT payload FROM sellers LIMIT 1').get() as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) as Seller : null;
  }

  saveSeller(seller: Seller): void {
    this.raw.prepare('INSERT OR REPLACE INTO sellers(id,payload) VALUES(?,?)')
      .run(seller.id, JSON.stringify(seller));
  }

  getService(serviceId: string): Service | null {
    const row = this.raw.prepare('SELECT payload FROM services WHERE id = ?').get(serviceId) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) as Service : null;
  }

  listServices(status?: Service['status']): Service[] {
    const rows = this.raw.prepare('SELECT payload FROM services ORDER BY rowid').all() as { payload: string }[];
    const services = rows.map((row) => JSON.parse(row.payload) as Service);
    return status ? services.filter((service) => service.status === status) : services;
  }

  saveService(service: Service): void {
    this.raw.prepare('INSERT OR REPLACE INTO services(id,payload) VALUES(?,?)')
      .run(service.id, JSON.stringify(service));
  }

  replaceServices(services: Service[]): void {
    const tx = this.raw.transaction((items: Service[]) => {
      this.raw.prepare('DELETE FROM services').run();
      for (const service of items) this.saveService(service);
    });
    tx(services);
  }

  getQuote(quoteId: string): Quote | null {
    const row = this.raw.prepare('SELECT payload FROM quotes WHERE id = ?').get(quoteId) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) as Quote : null;
  }

  listQuotes(): Quote[] {
    const rows = this.raw.prepare('SELECT payload FROM quotes ORDER BY rowid DESC').all() as { payload: string }[];
    return rows.map((row) => JSON.parse(row.payload) as Quote);
  }

  saveQuote(quote: Quote): void {
    this.raw.prepare('INSERT OR REPLACE INTO quotes(id,payload) VALUES(?,?)')
      .run(quote.id, JSON.stringify(quote));
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

  listEvents(quoteId?: string | null, actor?: AgentEvent['actor']): AgentEvent[] {
    let sql = 'SELECT payload FROM events WHERE 1 = 1';
    const args: string[] = [];
    if (quoteId !== undefined) {
      sql += ' AND quote_id IS ?';
      args.push(quoteId ?? '');
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
    this.raw.prepare('INSERT INTO events(id,quote_id,created_at,payload) VALUES(?,?,?,?)')
      .run(event.id, event.quote_id, event.created_at, JSON.stringify(event));
  }

  listProposals(quoteId?: string, status?: Proposal['status']): Proposal[] {
    let sql = 'SELECT payload FROM proposals WHERE 1 = 1';
    const args: string[] = [];
    if (quoteId) {
      sql += ' AND quote_id = ?';
      args.push(quoteId);
    }
    if (status) {
      sql += ' AND status = ?';
      args.push(status);
    }
    sql += ' ORDER BY rowid DESC';
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

  hasWebhookEvent(eventId: string): boolean {
    return Boolean(this.raw.prepare('SELECT 1 FROM webhook_events WHERE event_id = ?').get(eventId));
  }

  recordWebhookEvent(eventId: string): void {
    this.raw.prepare('INSERT OR IGNORE INTO webhook_events(event_id,received_at) VALUES(?,?)')
      .run(eventId, now());
  }

  reset(): void {
    this.raw.transaction(() => {
      this.raw.exec('DELETE FROM webhook_events; DELETE FROM replies; DELETE FROM proposals; DELETE FROM events; DELETE FROM payments; DELETE FROM quotes; DELETE FROM services; DELETE FROM sellers;');
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
        title: 'Landing page design',
        description: 'A conversion-focused landing page design tailored to your offer and brand.',
        deliverables: ['Desktop and mobile page designs', 'Reusable design components', 'Handoff-ready design file'],
        price_cents: 90000,
        deposit_pct: 40,
        lead_time_days: 14,
        status: 'published'
      }
    ];
    this.replaceServices(services);
  }
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
