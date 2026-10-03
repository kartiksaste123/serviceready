import * as mock from './mock';
import type {
  AgentEvent, AgentRun, ChatMsg, Flag, Proposal, PublicStore, Quote, QuoteDetail, Reply,
  Seller, SellerRules, Service, ServiceDraft, Source, Stats, ToolTrace,
} from './types';

export const USE_MOCKS = import.meta.env['VITE_USE_MOCKS'] !== 'false';

export interface AuthUser {
  id: string;
  email: string;
  is_demo: boolean;
}

export interface AuthSession {
  user: AuthUser;
  seller: Seller;
}

export interface AuthChallenge {
  challenge_id: string;
  purpose: 'verify' | 'login' | 'reset';
  email_hint: string;
}

export interface ClientErrorPayload {
  message: string;
  stack?: string;
  url: string;
  user_agent?: string;
  boundary?: string;
}

export interface StudioLlmMessage {
  role: 'system' | 'developer' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
}
export interface StudioLlmTool {
  type: 'function';
  function: { name: string; description?: string; parameters: Record<string, unknown>; strict?: boolean };
}
export interface StudioLlmRequest {
  messages: StudioLlmMessage[];
  tools?: StudioLlmTool[];
  tool_choice?: 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } };
}
export interface StudioLlmResponse {
  id: string;
  created: number;
  model: string;
  choices: {
    message: {
      content: string | null;
      refusal?: string | null;
      tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
    };
  }[];
}

async function http<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : null,
    credentials: 'include',
    ...(signal ? { signal } : {}),
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

let mockAuthUser: AuthUser | null = {
  id: 'user_demo',
  email: 'demo@serviceready.local',
  is_demo: true,
};
let mockAuthEmail = 'demo@serviceready.local';
let mockAuthChallenge: AuthChallenge = {
  challenge_id: 'mock',
  purpose: 'login',
  email_hint: 'de***@serviceready.local',
};

async function mockAuthSession(): Promise<AuthSession | null> {
  if (!mockAuthUser) return null;
  return { user: mockAuthUser, seller: await mock.getSeller() };
}

async function me(): Promise<AuthSession | null> {
  if (USE_MOCKS) return mockAuthSession();
  const response = await fetch('/api/auth/me', { credentials: 'include' });
  if (response.status === 401) return null;
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json() as { error?: string };
      message = body.error ?? message;
    } catch {
    }
    throw new Error(message);
  }
  return response.json() as Promise<AuthSession>;
}

async function mockChallenge(
  purpose: AuthChallenge['purpose'],
  email: string,
): Promise<AuthChallenge> {
  mockAuthEmail = email.trim().toLowerCase();
  const [local, domain] = mockAuthEmail.split('@');
  mockAuthChallenge = {
    challenge_id: 'mock',
    purpose,
    email_hint: `${(local ?? '').slice(0, 2)}***@${domain ?? ''}`,
  };
  return mockAuthChallenge;
}

export function safeRedirect(value: unknown): string | null {
  if (typeof value !== 'string' || value.startsWith('//') || value.includes('\\')) return null;
  const path = value.split(/[?#]/, 1)[0] ?? '';
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (decodedPath.includes('\\') || decodedPath.split('/').some((segment) => segment === '.' || segment === '..')) {
    return null;
  }
  if (
    path !== '/app' &&
    !path.startsWith('/app/') &&
    path !== '/onboard' &&
    !path.startsWith('/onboard/')
  ) return null;
  return value;
}

export function reportClientError(payload: ClientErrorPayload): void {
  if (USE_MOCKS) return;
  try {
    void fetch('/api/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'omit',
      keepalive: true
    }).catch(() => undefined);
  } catch {
  }
}

export const api = {
  auth: {
    me,
    signup: (input: { studio_name: string; email: string; password: string }) =>
      m(
        () => mockChallenge('verify', input.email),
        'POST',
        '/api/auth/signup',
        input,
      ),
    login: (input: { email: string; password: string }) =>
      m(
        () => mockChallenge('login', input.email),
        'POST',
        '/api/auth/login',
        input,
      ),
    verify: async (input: { challenge_id: string; code: string; new_password?: string }) => {
      if (!USE_MOCKS) return http<AuthSession>('POST', '/api/auth/verify', input);
      if (input.code !== '123456') throw new Error("That code isn't right.");
      mockAuthUser = {
        id: 'mock_user',
        email: mockAuthEmail,
        is_demo: false,
      };
      return (await mockAuthSession()) as AuthSession;
    },
    resend: (input: { challenge_id: string }) =>
      m(
        async () => mockAuthChallenge,
        'POST',
        '/api/auth/resend',
        input,
      ),
    forgot: (input: { email: string }) =>
      m(
        () => mockChallenge('reset', input.email),
        'POST',
        '/api/auth/forgot',
        input,
      ),
    demo: async () => {
      if (!USE_MOCKS) return http<AuthSession>('POST', '/api/auth/demo');
      mockAuthUser = {
        id: 'user_demo',
        email: 'demo@serviceready.local',
        is_demo: true,
      };
      mockAuthEmail = mockAuthUser.email;
      return (await mockAuthSession()) as AuthSession;
    },
    logout: async () => {
      if (!USE_MOCKS) return http<{ ok: true }>('POST', '/api/auth/logout');
      mockAuthUser = null;
      return { ok: true as const };
    },
  },
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
  studioLlm: (request: StudioLlmRequest, signal?: AbortSignal) =>
    http<StudioLlmResponse>('POST', '/api/studio/llm', request, signal),
  paypalConfig: () => m<{ client_id: string; env: 'sandbox' }>(() => mock.paypalConfig(), 'GET', '/api/paypal/config'),
  resetDemo: () => m<{ ok: true }>(() => mock.reset(), 'POST', '/api/demo/reset'),
};
