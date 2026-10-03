// In-memory mock backend implementing every /api endpoint with state transitions.
import type {
  AgentEvent, AgentRun, ChatMsg, Flag, Payment, Proposal, PublicStore, Quote, QuoteDetail,
  QuoteStatus, Reply, Seller, SellerRules, Service, ServiceDraft, Stats, ToolTrace, Source,
} from './types';

const wait = (ms = 350 + Math.random() * 350) => new Promise((r) => setTimeout(r, ms));
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
let seq = 1000;
const uid = (p: string) => `${p}_${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const ago = (days: number, hours = 0) => new Date(Date.now() - days * 864e5 - hours * 36e5).toISOString();
const now = () => new Date().toISOString();
const MCP_URL = 'https://serviceready.app/mcp/maya-rao-studio';
const WEBMCP_TOOLS = ['list_services', 'get_service', 'request_quote', 'get_quote_status'];

interface DB {
  seller: Seller; services: Service[]; quotes: Quote[]; payments: Record<string, Payment[]>;
  events: AgentEvent[]; proposals: Proposal[]; replies: Reply[];
}
let db: DB = seed();

function seed(): DB {
  const seller: Seller = {
    id: 'sel_maya', slug: 'maya-rao-studio', name: 'Maya Rao Studio',
    tagline: 'Brand identities for independent businesses — logos, kits and launch pages.',
    email: 'hello@mayarao.studio', currency: 'USD',
    rules: { default_deposit_pct: 50, reminder_tone: 'friendly', max_reminders: 3, wait_days_before_nudge: 3 },
  };
  const services: Service[] = [
    { id: 'svc_logo', title: 'Logo design', description: 'A custom wordmark or symbol with two revision rounds.', deliverables: ['Primary logo', 'Mono version', 'SVG + PNG files', '2 revision rounds'], price_cents: 45000, deposit_pct: 50, lead_time_days: 7, status: 'published' },
    { id: 'svc_kit', title: 'Brand identity kit', description: 'Logo, colour palette, type pairing and a one-page brand guide.', deliverables: ['Logo suite', 'Colour palette', 'Font pairing', 'Brand guide PDF'], price_cents: 120000, deposit_pct: 50, lead_time_days: 14, status: 'published' },
    { id: 'svc_social', title: 'Social media template pack', description: 'Ten on-brand editable templates for posts and stories.', deliverables: ['10 templates', 'Canva + Figma files', 'Usage notes'], price_cents: 30000, deposit_pct: 30, lead_time_days: 5, status: 'published' },
    { id: 'svc_landing', title: 'Landing page design', description: 'A conversion-focused single page design, handoff ready.', deliverables: ['Desktop + mobile design', 'Figma handoff', '1 revision round'], price_cents: 90000, deposit_pct: 40, lead_time_days: 14, status: 'published' },
  ];
  const d: DB = { seller, services, quotes: [], payments: {}, events: [], proposals: [], replies: [] };
  const rows: [string, string, string, Source, QuoteStatus, number, string][] = [
    ['q_jordan', 'svc_kit', 'Jordan Lee', 'web', 'quoted', 1, 'Rebrand for my coffee cart, warm and friendly.'],
    ['q_priya', 'svc_logo', 'Priya Shah', 'mcp', 'deposit_paid', 4, 'Logo for a yoga studio called Still Point.'],
    ['q_tomas', 'svc_landing', 'Tomás Ortega', 'webmcp', 'delivered', 12, 'Landing page for a bike repair app launch.'],
    ['q_hannah', 'svc_kit', 'Hannah Brooks', 'agent_sim', 'balance_invoiced', 20, 'Identity kit for a ceramics shop, earthy palette.'],
    ['q_kofi', 'svc_social', 'Kofi Mensah', 'web', 'paid', 30, 'Instagram templates for my food truck.'],
    ['q_elena', 'svc_logo', 'Elena Rossi', 'mcp', 'balance_invoiced', 10, 'Logo for an Italian language tutoring service.'],
    ['q_sam', 'svc_landing', 'Sam Carter', 'web', 'cancelled', 25, 'Landing page for a podcast.'],
    ['q_aiko', 'svc_social', 'Aiko Tanaka', 'webmcp', 'paid', 18, 'Story templates for a plant shop.'],
  ];
  for (const [id, sid, name, source, status, days, brief] of rows) {
    const s = services.find((x) => x.id === sid)!;
    const q = buildQuote(id, s, name, `${(name.split(' ')[0] ?? '').toLowerCase()}@example.com`, brief, source, ago(days));
    q.status = status;
    q.updated_at = ago(Math.max(0, days - 3));
    d.quotes.push(q);
    const pays: Payment[] = [];
    const created: AgentEvent[] = [
      source === 'web'
        ? ev(id, 'client', 'message', { text: `Quote requested via storefront: ${brief}` }, ago(days))
        : ev(id, 'client_agent', 'tool_call', { tool: 'request_quote', input: { service_id: sid, client_name: name, brief }, output: { quote_id: id, total_cents: q.total_cents } }, ago(days)),
    ];
    if (status !== 'quoted' && status !== 'cancelled') {
      pays.push({ id: uid('pay'), kind: 'deposit', amount_cents: q.deposit_cents, status: 'COMPLETED', paypal_order_id: `5O${rand(15)}`, paypal_capture_id: `3C${rand(15)}`, updated_at: ago(days - 1) });
      created.push(ev(id, 'paypal', 'webhook', { tool: 'PAYMENT.CAPTURE.COMPLETED', output: { amount: q.deposit_cents / 100, status: 'COMPLETED' }, text: 'Deposit captured' }, ago(days - 1)));
    }
    if (status === 'balance_invoiced' || status === 'paid') {
      const inv = `INV2-${rand(4)}-${rand(4)}-${rand(4)}-${rand(4)}`;
      pays.push({ id: uid('pay'), kind: 'balance', amount_cents: q.balance_cents, status: status === 'paid' ? 'PAID' : 'UNPAID', paypal_invoice_id: inv, invoice_url: `https://www.sandbox.paypal.com/invoice/p/#${inv}`, updated_at: ago(days - 6) });
      created.push(ev(id, 'seller', 'approval', { text: 'Marked delivered' }, ago(days - 6)));
      created.push(ev(id, 'seller_agent', 'tool_call', { tool: 'paypal.create_and_send_invoice', input: { amount: q.balance_cents / 100 }, output: { invoice_id: inv, status: 'SENT' } }, ago(days - 6)));
      if (status === 'paid') created.push(ev(id, 'paypal', 'webhook', { tool: 'INVOICING.INVOICE.PAID', output: { invoice_id: inv }, text: 'Balance paid' }, ago(days - 9)));
    }
    d.payments[id] = pays;
    d.events.push(...created);
  }
  // Pending proposal: client says already paid, PayPal says UNPAID.
  const hq = d.quotes.find((q) => q.id === 'q_hannah')!;
  const inv = d.payments['q_hannah']!.find((p) => p.kind === 'balance')!;
  d.replies.push({ id: uid('rep'), quote_id: hq.id, from: 'client', text: "Hi Maya! I already paid the invoice yesterday, should be there 🙂", created_at: ago(0, 3) });
  d.events.push(
    ev(hq.id, 'client', 'message', { text: "Hi Maya! I already paid the invoice yesterday, should be there 🙂" }, ago(0, 3)),
    ev(hq.id, 'collections_agent', 'tool_call', { tool: 'paypal.get_invoice', input: { invoice_id: inv.paypal_invoice_id }, output: { status: 'UNPAID', amount_due: hq.balance_cents / 100, last_payment: null } }, ago(0, 2.9)),
    ev(hq.id, 'collections_agent', 'decision', { text: 'Client claims payment but PayPal shows UNPAID. Propose a friendly reminder with the invoice link.' }, ago(0, 2.9)),
  );
  d.proposals.push({
    id: 'prop_hannah', quote_id: hq.id, client_name: hq.client_name, action: 'send_reminder',
    reason: 'Client says they already paid, but PayPal still reports the invoice as UNPAID. A gentle nudge with the link usually resolves a missed step.',
    evidence: `PayPal invoice ${inv.paypal_invoice_id} status: UNPAID, checked 2 min ago`,
    draft_message: `Hi Hannah, thanks so much! I just checked and PayPal still shows the balance invoice as open on my side — sometimes the payment doesn't go through the last step. Here's the link again in case it helps: ${inv.invoice_url}\n\nNo rush at all, and thank you again! — Maya`,
    status: 'pending', created_at: ago(0, 2.9),
  });
  return d;
}

function rand(n: number) { return Array.from({ length: n }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join(''); }
function ev(quote_id: string | null, actor: AgentEvent['actor'], kind: AgentEvent['kind'], rest: Partial<AgentEvent>, at = now()): AgentEvent {
  return { id: uid('evt'), quote_id, actor, kind, created_at: at, ...rest };
}
function buildQuote(id: string, s: Service, client_name: string, client_email: string, brief: string, source: Source, at = now()): Quote {
  const deposit = Math.round((s.price_cents * s.deposit_pct) / 100);
  return {
    id, service_id: s.id, service_title: s.title, client_name, client_email, brief,
    scope_summary: `${s.title} for ${client_name}: ${s.deliverables.join(', ')}. Delivered in ~${s.lead_time_days} days.`,
    line_items: [{ label: s.title, amount_cents: s.price_cents }],
    total_cents: s.price_cents, deposit_cents: deposit, balance_cents: s.price_cents - deposit,
    status: 'quoted', source, approval_url: `/q/${id}`, created_at: at, updated_at: at,
  };
}
function getQ(id: string) { const q = db.quotes.find((x) => x.id === id); if (!q) throw new Error('Quote not found'); return q; }
function detail(id: string): QuoteDetail {
  return clone({
    quote: getQ(id), payments: db.payments[id] ?? [],
    events: db.events.filter((e) => e.quote_id === id).sort((a, b) => a.created_at.localeCompare(b.created_at)),
    replies: db.replies.filter((r) => r.quote_id === id), proposals: db.proposals.filter((p) => p.quote_id === id),
  });
}

// ---- endpoints ----
export async function getSeller() { await wait(); return clone(db.seller); }
export async function putRules(rules: SellerRules) { await wait(); db.seller.rules = { ...rules }; return clone(db.seller); }

export async function parseCatalog(raw_text: string): Promise<{ services: ServiceDraft[]; flags: Flag[] }> {
  await wait(1400);
  const parts = raw_text.split(/[|\n]+/).map((s) => s.trim()).filter(Boolean);
  const services: ServiceDraft[] = []; const flags: Flag[] = [];
  for (const p of parts) {
    const tmp_id = uid('tmp');
    const pct = p.match(/\+\s*(\d+)\s*%/);
    if (pct) {
      services.push({ tmp_id, title: p.replace(/\+.*$/, '').trim().replace(/^\w/, (c) => c.toUpperCase()) + ' surcharge', description: `Adds ${pct[1]}% to any service for faster delivery.`, deliverables: [], price_cents: 0, deposit_pct: 0, lead_time_days: null });
      flags.push({ tmp_id, field: 'price_cents', severity: 'error', message: `"${p}" looks like a +${pct[1]}% modifier, not a standalone service. Remove it or turn it into an add-on.` });
      continue;
    }
    const qty = p.match(/x\s*(\d+)/i);
    const nums = [...p.replace(/x\s*\d+/i, '').matchAll(/(\d[\d,.]*)/g)].map((m) => Number((m[1] ?? '0').replace(/,/g, '')));
    const price = nums[0] ?? 0;
    const weeks = p.match(/(\d+)\s*wk/i); const days = p.match(/(\d+)\s*d(ays?)?\b/i);
    const rounds = p.match(/\((\d+)\s*rounds?\)/i);
    const title = (p.split(/\s\d|\s-\s|\(/)[0] ?? p).replace(/\bpg\b/i, 'page').replace(/w\//i, 'with').trim();
    const deliverables: string[] = [];
    const w = p.match(/w\/\s*([^\d]+)/i);
    if (w) deliverables.push(...(w[1] ?? '').split('+').map((x) => x.trim().replace(/^\w/, (c) => c.toUpperCase())).filter(Boolean));
    if (qty) deliverables.push(`${qty[1]} templates`);
    if (rounds) deliverables.push(`${rounds[1]} revision rounds`);
    services.push({
      tmp_id, title: title.replace(/^\w/, (c) => c.toUpperCase()).replace(/\s+with.*$/i, ''),
      description: `Imported from your rate card: "${p}"`, deliverables,
      price_cents: price * 100, deposit_pct: /half upfront/i.test(p) ? 50 : db.seller.rules.default_deposit_pct,
      lead_time_days: weeks ? Number(weeks[1]) * 7 : days ? Number(days[1]) : null,
    });
    if (!weeks && !days) flags.push({ tmp_id, field: 'lead_time_days', severity: 'warning', message: 'No turnaround time found. Agents need one to quote reliably — add a lead time.' });
  }
  const prices = services.filter((s) => s.price_cents > 0).map((s) => s.price_cents).sort((a, b) => a - b);
  const median = prices[Math.floor(prices.length / 2)] ?? 0;
  for (const s of services) {
    if (s.price_cents > 0 && median && s.price_cents * 10 < median) {
      flags.push({ tmp_id: s.tmp_id, field: 'price_cents', severity: 'error', message: `$${s.price_cents / 100} ${s.deliverables[0] ? `for ${s.deliverables[0]}` : ''} is ${Math.round(median / s.price_cents)}× below your median — typo?` });
    }
  }
  return { services, flags };
}
export async function publishCatalog(drafts: ServiceDraft[]) {
  await wait(900);
  const created: Service[] = drafts.map((d) => ({ id: uid('svc'), title: d.title, description: d.description, deliverables: d.deliverables, price_cents: d.price_cents, deposit_pct: d.deposit_pct, lead_time_days: d.lead_time_days ?? 7, status: 'published' }));
  db.services.push(...created);
  db.events.push(ev(null, 'seller', 'approval', { text: `Published ${created.length} services to the agent-ready catalog` }));
  return clone(created);
}
export async function listServices() { await wait(); return clone(db.services); }
export async function getPublic(slug: string): Promise<PublicStore> {
  await wait();
  if (slug !== db.seller.slug) throw new Error('Storefront not found');
  return clone({ seller: { name: db.seller.name, slug, tagline: db.seller.tagline }, services: db.services.filter((s) => s.status === 'published'), agent: { mcp_url: MCP_URL, webmcp_tools: WEBMCP_TOOLS } });
}
function createQuote(b: { service_id: string; client_name: string; client_email: string; brief: string; source: Source }) {
  const s = db.services.find((x) => x.id === b.service_id); if (!s) throw new Error('Service not found');
  const q = buildQuote(uid('q'), s, b.client_name, b.client_email, b.brief, b.source);
  db.quotes.push(q); db.payments[q.id] = [];
  db.events.push(b.source === 'web' ? ev(q.id, 'client', 'message', { text: `Quote requested via storefront: ${b.brief}` }) : ev(q.id, 'client_agent', 'tool_call', { tool: 'request_quote', input: b, output: { quote_id: q.id, total_cents: q.total_cents } }));
  return q;
}
export async function postPublicQuote(_slug: string, b: { service_id: string; client_name: string; client_email: string; brief: string; source: Source }) { await wait(); return clone(createQuote(b)); }
export async function listQuotes() { await wait(); return clone([...db.quotes].sort((a, b) => b.updated_at.localeCompare(a.updated_at))); }
export async function getQuote(id: string, refresh = false) {
  await wait(refresh ? 900 : undefined);
  if (refresh) {
    for (const p of db.payments[id] ?? []) {
      db.events.push(ev(id, 'paypal', 'tool_call', { tool: p.kind === 'deposit' ? 'paypal.get_order' : 'paypal.get_invoice', input: { id: p.paypal_order_id ?? p.paypal_invoice_id }, output: { status: p.status } }));
      p.updated_at = now();
    }
  }
  return detail(id);
}
export async function createDepositOrder(id: string) {
  await wait(); const q = getQ(id);
  if (q.status !== 'quoted') throw new Error('Deposit already handled');
  const order_id = `5O${rand(15)}`;
  db.payments[id] = [...(db.payments[id] ?? []).filter((p) => p.kind !== 'deposit'), { id: uid('pay'), kind: 'deposit', amount_cents: q.deposit_cents, status: 'CREATED', paypal_order_id: order_id, updated_at: now() }];
  db.events.push(ev(id, 'system', 'tool_call', { tool: 'paypal.orders.create', input: { amount: q.deposit_cents / 100, currency: 'USD' }, output: { id: order_id, status: 'CREATED' } }));
  return { order_id };
}
export async function captureDeposit(id: string, order_id: string) {
  await wait(800); const q = getQ(id);
  const p = (db.payments[id] ?? []).find((x) => x.paypal_order_id === order_id); if (!p) throw new Error('Order not found');
  p.status = 'COMPLETED'; p.paypal_capture_id = `3C${rand(15)}`; p.updated_at = now();
  q.status = 'deposit_paid'; q.updated_at = now();
  db.events.push(ev(id, 'paypal', 'webhook', { tool: 'PAYMENT.CAPTURE.COMPLETED', output: { capture_id: p.paypal_capture_id, amount: p.amount_cents / 100 }, text: 'Deposit captured — work can start' }));
  return clone(q);
}
export async function deliver(id: string) {
  await wait(900); const q = getQ(id);
  if (q.status !== 'deposit_paid' && q.status !== 'delivered') throw new Error('Quote must have a paid deposit first');
  const inv = `INV2-${rand(4)}-${rand(4)}-${rand(4)}-${rand(4)}`;
  (db.payments[id] ??= []).push({ id: uid('pay'), kind: 'balance', amount_cents: q.balance_cents, status: 'UNPAID', paypal_invoice_id: inv, invoice_url: `https://www.sandbox.paypal.com/invoice/p/#${inv}`, updated_at: now() });
  q.status = 'balance_invoiced'; q.updated_at = now();
  db.events.push(ev(id, 'seller', 'approval', { text: 'Marked delivered' }), ev(id, 'seller_agent', 'tool_call', { tool: 'paypal.create_and_send_invoice', input: { amount: q.balance_cents / 100, recipient: q.client_email }, output: { invoice_id: inv, status: 'SENT' } }));
  return detail(id);
}
function runCollections(id: string, trigger?: string): AgentRun {
  const q = getQ(id); const steps: AgentEvent[] = [];
  const bal = (db.payments[id] ?? []).find((p) => p.kind === 'balance');
  let proposal: Proposal | null = null; let summary: string;
  if (!bal) {
    steps.push(ev(id, 'collections_agent', 'decision', { text: 'No balance invoice exists yet. Nothing to collect.' }));
    summary = 'No balance invoice yet — nothing to chase.';
  } else {
    steps.push(ev(id, 'collections_agent', 'tool_call', { tool: 'paypal.get_invoice', input: { invoice_id: bal.paypal_invoice_id }, output: { status: bal.status, amount_due: bal.status === 'PAID' ? 0 : bal.amount_cents / 100 } }));
    const claimsPaid = trigger ? /paid|sent|transferred|done/i.test(trigger) : false;
    const tone = db.seller.rules.reminder_tone;
    const first = q.client_name.split(' ')[0];
    if (bal.status === 'PAID') {
      proposal = mkProp(q, 'thank_and_close', 'PayPal confirms the balance is paid.', `PayPal invoice ${bal.paypal_invoice_id} status: PAID, checked just now`, `Hi ${first}, payment received — thank you! It was a joy working on this. — Maya`);
      summary = 'PayPal confirms PAID. Proposed a thank-you and closing the booking.';
    } else if (claimsPaid) {
      proposal = mkProp(q, 'send_reminder', 'Client says they paid, but PayPal still shows UNPAID.', `PayPal invoice ${bal.paypal_invoice_id} status: UNPAID, checked just now`, `${tone === 'firm' ? `Hi ${first},` : `Hi ${first}, thank you!`} I just checked and PayPal still shows the invoice as open on my side. Here's the link again: ${bal.invoice_url}${tone === 'friendly' ? '\n\nNo rush at all!' : ''} — Maya`);
      summary = 'Client says "already paid" — PayPal says UNPAID. Drafted a reminder for your approval.';
    } else {
      proposal = mkProp(q, 'wait', `Invoice is unpaid but within your ${db.seller.rules.wait_days_before_nudge}-day grace window.`, `PayPal invoice ${bal.paypal_invoice_id} status: UNPAID, checked just now`, `Hi ${first}, just a gentle heads-up that the balance invoice is here whenever you're ready: ${bal.invoice_url} — Maya`);
      summary = 'Invoice still UNPAID. Suggest waiting before nudging (draft ready if you prefer).';
    }
    steps.push(ev(id, 'collections_agent', 'decision', { text: summary }));
    db.proposals.push(proposal);
  }
  db.events.push(...steps);
  return clone({ id: uid('run'), quote_id: id, summary, steps, proposal });
}
function mkProp(q: Quote, action: Proposal['action'], reason: string, evidence: string, draft_message: string): Proposal {
  return { id: uid('prop'), quote_id: q.id, client_name: q.client_name, action, reason, evidence, draft_message, status: 'pending', created_at: now() };
}
export async function postReply(id: string, b: { text: string; from: 'client' | 'seller' }) {
  await wait(1100); getQ(id);
  const reply: Reply = { id: uid('rep'), quote_id: id, from: b.from, text: b.text, created_at: now() };
  db.replies.push(reply);
  db.events.push(ev(id, 'client', 'message', { text: b.from === 'seller' ? `(pasted by seller) ${b.text}` : b.text }));
  return { reply: clone(reply), agent_run: runCollections(id, b.text) };
}
export async function runCollectionsEp(id: string) { await wait(1200); return runCollections(id); }
export async function listProposals(status?: string) { await wait(); return clone(db.proposals.filter((p) => !status || p.status === status).sort((a, b) => b.created_at.localeCompare(a.created_at))); }
export async function approveProposal(id: string, draft_message: string) {
  await wait(700); const p = db.proposals.find((x) => x.id === id); if (!p) throw new Error('Proposal not found');
  p.draft_message = draft_message; p.status = 'executed';
  db.events.push(ev(p.quote_id, 'seller', 'approval', { text: `Approved: ${p.action}` }));
  if (p.action === 'send_reminder' || p.action === 'thank_and_close') db.events.push(ev(p.quote_id, 'collections_agent', 'message', { tool: 'send_email', text: draft_message }));
  if (p.action === 'thank_and_close') { const q = getQ(p.quote_id); q.status = 'paid'; q.updated_at = now(); }
  return clone(p);
}
export async function rejectProposal(id: string) {
  await wait(); const p = db.proposals.find((x) => x.id === id); if (!p) throw new Error('Proposal not found');
  p.status = 'rejected'; db.events.push(ev(p.quote_id, 'seller', 'approval', { text: `Rejected: ${p.action}` }));
  return clone(p);
}
export async function listEvents(actor?: string) { await wait(); return clone(db.events.filter((e) => !actor || e.actor === actor).sort((a, b) => b.created_at.localeCompare(a.created_at))); }
export async function getStats(): Promise<Stats> {
  await wait();
  const all = Object.values(db.payments).flat();
  const by_status = { quoted: 0, deposit_paid: 0, delivered: 0, balance_invoiced: 0, paid: 0, cancelled: 0 } as Record<QuoteStatus, number>;
  db.quotes.forEach((q) => by_status[q.status]++);
  const owed = db.quotes.filter((q) => q.status === 'balance_invoiced').map((q) => {
    const b = (db.payments[q.id] ?? []).find((p) => p.kind === 'balance')!;
    return { client_name: q.client_name, quote_id: q.id, outstanding_cents: b.amount_cents, days_since_invoice: Math.floor((Date.now() - Date.parse(b.updated_at)) / 864e5) };
  }).sort((a, b) => b.days_since_invoice - a.days_since_invoice);
  return {
    deposits_collected_cents: all.filter((p) => p.kind === 'deposit' && p.status === 'COMPLETED').reduce((s, p) => s + p.amount_cents, 0),
    outstanding_cents: all.filter((p) => p.kind === 'balance' && p.status !== 'PAID').reduce((s, p) => s + p.amount_cents, 0),
    paid_cents: db.quotes.filter((q) => q.status === 'paid').reduce((s, q) => s + q.total_cents, 0),
    avg_days_to_pay: by_status.paid ? 3.4 : null, by_status, owed_by_client: owed,
  };
}
export async function agentChat(slug: string, messages: ChatMsg[]): Promise<{ messages: ChatMsg[]; tool_calls: ToolTrace[]; quote: Quote | null }> {
  await wait(1200);
  const last = messages[messages.length - 1]?.content ?? '';
  const services = db.services.filter((s) => s.status === 'published');
  const tool_calls: ToolTrace[] = [];
  const listOut = services.map((s) => ({ id: s.id, title: s.title, price_usd: s.price_cents / 100, deposit_pct: s.deposit_pct, lead_time_days: s.lead_time_days }));
  tool_calls.push({ tool: 'list_services', input: { seller: slug }, output: listOut });
  const words = last.toLowerCase();
  const match = services.find((s) => s.title.toLowerCase().split(' ').some((w) => w.length > 3 && words.includes(w)));
  const wantsQuote = /book|quote|hire|want|need|get/i.test(last);
  let reply: string; let quote: Quote | null = null;
  if (match && wantsQuote) {
    const email = last.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0] ?? 'you@example.com';
    quote = createQuote({ service_id: match.id, client_name: 'Agent demo client', client_email: email, brief: last, source: 'agent_sim' });
    tool_calls.push({ tool: 'request_quote', input: { service_id: match.id, client_email: email, brief: last }, output: { quote_id: quote.id, total_usd: quote.total_cents / 100, deposit_usd: quote.deposit_cents / 100, approval_url: quote.approval_url } });
    reply = `I've requested a quote for **${match.title}** from Maya Rao Studio.\n\n- Total: $${quote.total_cents / 100}\n- Deposit due now: $${quote.deposit_cents / 100} (${match.deposit_pct}%)\n- Turnaround: ~${match.lead_time_days} days\n\nI can't pay on your behalf — review the quote and pay the deposit yourself using the button below.`;
  } else {
    reply = `Maya Rao Studio offers:\n\n${services.map((s) => `- **${s.title}** — $${s.price_cents / 100}, ${s.deposit_pct}% deposit, ~${s.lead_time_days} days`).join('\n')}\n\nTell me which one you'd like and I'll request a quote.`;
  }
  return { messages: [...messages, { role: 'assistant', content: reply }], tool_calls, quote: quote ? clone(quote) : null };
}
export async function paypalConfig() { await wait(100); return { client_id: 'sb-mock-client-id', env: 'sandbox' as const }; }
export async function reset() { await wait(); db = seed(); return { ok: true as const }; }
