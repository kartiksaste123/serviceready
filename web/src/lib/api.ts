import * as mock from './mock';
import type {
  AgentEvent, AgentRun, ChatMsg, Flag, Proposal, PublicStore, Quote, QuoteDetail, Reply,
  Seller, SellerRules, Service, ServiceDraft, Source, Stats, ToolTrace,
} from './types';

export const USE_MOCKS = import.meta.env['VITE_USE_MOCKS'] !== 'false';

async function http<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : null,
    credentials: 'include',
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { const j = await res.json(); msg = j.error ?? j.message ?? msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}
const m = <T,>(mockFn: () => Promise<T>, method: string, path: string, body?: unknown) =>
  USE_MOCKS ? mockFn() : http<T>(method, path, body);
const enc = encodeURIComponent;

export const api = {
  getSeller: () => m<Seller>(() => mock.getSeller(), 'GET', '/api/seller'),
  updateRules: (rules: SellerRules) => m<Seller>(() => mock.putRules(rules), 'PUT', '/api/seller/rules', rules),
  parseCatalog: (raw_text: string) => m<{ services: ServiceDraft[]; flags: Flag[] }>(() => mock.parseCatalog(raw_text), 'POST', '/api/catalog/parse', { raw_text }),
  publishCatalog: (services: ServiceDraft[]) => m<Service[]>(() => mock.publishCatalog(services), 'POST', '/api/catalog/publish', { services }),
  listServices: () => m<Service[]>(() => mock.listServices(), 'GET', '/api/services'),
  getPublicStore: (slug: string) => m<PublicStore>(() => mock.getPublic(slug), 'GET', `/api/public/${enc(slug)}`),
  requestQuote: (slug: string, b: { service_id: string; client_name: string; client_email: string; brief: string; source: Source }) =>
    m<Quote>(() => mock.postPublicQuote(slug, b), 'POST', `/api/public/${enc(slug)}/quotes`, b),
  listQuotes: () => m<Quote[]>(() => mock.listQuotes(), 'GET', '/api/quotes'),
  getQuote: (id: string, refresh = false) => m<QuoteDetail>(() => mock.getQuote(id, refresh), 'GET', `/api/quotes/${enc(id)}${refresh ? '?refresh=1' : ''}`),
  createDepositOrder: (id: string) => m<{ order_id: string }>(() => mock.createDepositOrder(id), 'POST', `/api/quotes/${enc(id)}/deposit/order`),
  captureDeposit: (id: string, order_id: string) => m<Quote>(() => mock.captureDeposit(id, order_id), 'POST', `/api/quotes/${enc(id)}/deposit/capture`, { order_id }),
  deliver: (id: string) => m<QuoteDetail>(() => mock.deliver(id), 'POST', `/api/quotes/${enc(id)}/deliver`),
  postReply: (id: string, text: string, from: 'client' | 'seller') =>
    m<{ reply: Reply; agent_run: AgentRun | null }>(() => mock.postReply(id, { text, from }), 'POST', `/api/quotes/${enc(id)}/replies`, { text, from }),
  runCollections: (id: string) => m<AgentRun>(() => mock.runCollectionsEp(id), 'POST', `/api/quotes/${enc(id)}/collections/run`),
  listProposals: (status?: Proposal['status']) => m<Proposal[]>(() => mock.listProposals(status), 'GET', `/api/proposals${status ? `?status=${enc(status)}` : ''}`),
  approveProposal: (id: string, draft_message: string) => m<Proposal>(() => mock.approveProposal(id, draft_message), 'POST', `/api/proposals/${enc(id)}/approve`, { draft_message }),
  rejectProposal: (id: string) => m<Proposal>(() => mock.rejectProposal(id), 'POST', `/api/proposals/${enc(id)}/reject`),
  listEvents: (actor?: AgentEvent['actor']) => m<AgentEvent[]>(() => mock.listEvents(actor), 'GET', `/api/events${actor ? `?actor=${enc(actor)}` : ''}`),
  getStats: () => m<Stats>(() => mock.getStats(), 'GET', '/api/stats'),
  agentChat: (slug: string, messages: ChatMsg[]) =>
    m<{ messages: ChatMsg[]; tool_calls: ToolTrace[]; quote: Quote | null }>(() => mock.agentChat(slug, messages), 'POST', '/api/agent-sim/chat', { slug, messages }),
  paypalConfig: () => m<{ client_id: string; env: 'sandbox' }>(() => mock.paypalConfig(), 'GET', '/api/paypal/config'),
  resetDemo: () => m<{ ok: true }>(() => mock.reset(), 'POST', '/api/demo/reset'),
};
