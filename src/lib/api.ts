import * as mock from "./mock";
import { getAccessToken } from "./supabase";
import type {
  AgentEvent,
  AgentRun,
  ChatMsg,
  Flag,
  Proposal,
  PublicStore,
  Quote,
  QuoteDetail,
  Reply,
  Seller,
  SellerRules,
  Service,
  ServiceDraft,
  Source,
  Stats,
  ToolTrace,
} from "./types";
import type { CancelReason } from "./cancel-policy";

export const USE_MOCKS = import.meta.env["VITE_USE_MOCKS"] !== "false";
// Optional absolute origin for an external backend. Defaults to same-origin (Render serves UI + /api).
const API_BASE = String(import.meta.env["VITE_API_BASE_URL"] ?? "").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function http<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const token = await getAccessToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : null,
      credentials: "include",
      signal: AbortSignal.timeout(path.includes("/image") ? 120_000 : 45_000),
    });
  } catch {
    throw new ApiError("Network error — check your connection and try again", 0);
  }
  if (!res.ok) {
    let msg =
      res.status === 401
        ? "Your session expired — sign in again"
        : res.status >= 500
          ? "The server had a problem — try again in a moment"
          : `${res.status} ${res.statusText}`;
    try {
      const j = (await res.json()) as { error?: string; message?: string };
      msg = typeof j.error === "string" ? j.error : typeof j.message === "string" ? j.message : msg;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(msg, res.status);
  }
  // 204 / empty bodies are valid for some write endpoints.
  const text = await res.text();
  return (text ? JSON.parse(text) : ({} as T)) as T;
}
const m = <T>(mockFn: () => Promise<T>, method: string, path: string, body?: unknown) =>
  USE_MOCKS ? mockFn() : http<T>(method, path, body);
const enc = encodeURIComponent;

export type PayPalPublicConfig = {
  client_id: string;
  env: "sandbox" | "live";
  sdk?: { v6: boolean; legacy: boolean };
  deposit_authorize_min_usd?: number;
};
let paypalConfigPromise: Promise<PayPalPublicConfig> | null = null;

export const api = {
  getSeller: () => m<Seller>(() => mock.getSeller(), "GET", "/api/seller"),
  updateRules: (rules: SellerRules) =>
    m<Seller>(() => mock.putRules(rules), "PUT", "/api/seller/rules", rules),
  parseCatalog: (raw_text: string) =>
    m<{ services: ServiceDraft[]; flags: Flag[] }>(
      () => mock.parseCatalog(raw_text),
      "POST",
      "/api/catalog/parse",
      { raw_text },
    ),
  publishCatalog: (services: ServiceDraft[]) =>
    m<Service[]>(() => mock.publishCatalog(services), "POST", "/api/catalog/publish", { services }),
  listServices: () => m<Service[]>(() => mock.listServices(), "GET", "/api/services"),
  getPublicStore: (slug: string) =>
    m<PublicStore>(() => mock.getPublic(slug), "GET", `/api/public/${enc(slug)}`),
  requestQuote: (
    slug: string,
    b: {
      service_id: string;
      client_name: string;
      client_email: string;
      brief: string;
      source: Source;
    },
  ) => m<Quote>(() => mock.postPublicQuote(slug, b), "POST", `/api/public/${enc(slug)}/quotes`, b),
  listQuotes: () => m<Quote[]>(() => mock.listQuotes(), "GET", "/api/quotes"),
  getQuote: (id: string, refresh = false) =>
    m<QuoteDetail>(
      () => mock.getQuote(id, refresh),
      "GET",
      `/api/quotes/${enc(id)}${refresh ? "?refresh=1" : ""}`,
    ),
  createDepositOrder: (id: string) =>
    m<{ order_id: string; intent?: "CAPTURE" | "AUTHORIZE" }>(
      () => mock.createDepositOrder(id),
      "POST",
      `/api/quotes/${enc(id)}/deposit/order`,
    ),
  captureDeposit: (id: string, order_id: string) =>
    m<Quote>(
      () => mock.captureDeposit(id, order_id),
      "POST",
      `/api/quotes/${enc(id)}/deposit/capture`,
      { order_id },
    ),
  cancelQuote: (id: string, reason: CancelReason = "client_cancel") =>
    m<QuoteDetail>(() => mock.cancelQuote(id, reason), "POST", `/api/quotes/${enc(id)}/cancel`, {
      reason,
    }),
  /** Client-chosen tip on the final bill (amount or % of the total). */
  setTip: (id: string, b: { tip_cents?: number; tip_pct?: number }) =>
    m<QuoteDetail>(() => mock.setTip(id, b), "POST", `/api/quotes/${enc(id)}/tip`, b),
  tamperDemo: (quote_id?: string) =>
    m<{ checks: { check: string; ok: boolean; detail: string }[]; quote?: unknown }>(
      () => mock.tamperDemo(),
      "GET",
      `/api/judges/tamper-demo${quote_id ? `?quote_id=${enc(quote_id)}` : ""}`,
    ),
  /** Demo/sandbox only: simulates the INVOICING.INVOICE.PAID webhook. Real mode relies on PayPal webhooks. */
  simulateBalancePaid: (id: string) =>
    m<QuoteDetail>(
      () => mock.simulateBalancePaid(id),
      "POST",
      `/api/demo/quotes/${enc(id)}/pay-balance`,
    ),
  /** AUTHORIZE deposits: capture the held funds when the seller starts work. */
  startWork: (id: string) =>
    m<QuoteDetail>(() => mock.getQuote(id), "POST", `/api/quotes/${enc(id)}/start-work`),
  deliver: (id: string) =>
    m<QuoteDetail>(() => mock.deliver(id), "POST", `/api/quotes/${enc(id)}/deliver`),
  refreshInvoice: (id: string) =>
    m<QuoteDetail>(() => mock.getQuote(id, true), "GET", `/api/quotes/${enc(id)}/invoice`),
  postReply: (id: string, text: string, from: "client" | "seller") =>
    m<{ reply: Reply; agent_run: AgentRun | null }>(
      () => mock.postReply(id, { text, from }),
      "POST",
      `/api/quotes/${enc(id)}/replies`,
      { text, from },
    ),
  runCollections: (id: string) =>
    m<AgentRun>(() => mock.runCollectionsEp(id), "POST", `/api/quotes/${enc(id)}/collections/run`),
  listProposals: (status?: string) =>
    m<Proposal[]>(
      () => mock.listProposals(status),
      "GET",
      `/api/proposals${status ? `?status=${enc(status)}` : ""}`,
    ),
  approveProposal: (id: string, draft_message: string) =>
    m<Proposal>(
      () => mock.approveProposal(id, draft_message),
      "POST",
      `/api/proposals/${enc(id)}/approve`,
      { draft_message },
    ),
  rejectProposal: (id: string) =>
    m<Proposal>(() => mock.rejectProposal(id), "POST", `/api/proposals/${enc(id)}/reject`),
  listEvents: (actor?: string) =>
    m<AgentEvent[]>(
      () => mock.listEvents(actor),
      "GET",
      `/api/events${actor ? `?actor=${enc(actor)}` : ""}`,
    ),
  getStats: () => m<Stats>(() => mock.getStats(), "GET", "/api/stats"),
  agentChat: (slug: string, messages: ChatMsg[]) =>
    m<{
      messages: ChatMsg[];
      tool_calls: ToolTrace[];
      quote: Quote | null;
      engine?:
        { kind: "llm"; provider: string; model: string } | { kind: "heuristic"; reason: string };
    }>(() => mock.agentChat(slug, messages), "POST", "/api/agent/chat", { slug, messages }),
  /** Cached for the session — prefetched on storefront/quote pages so PayPal renders instantly. */
  paypalConfig: () => {
    paypalConfigPromise ??= m<PayPalPublicConfig>(
      () => mock.paypalConfig(),
      "GET",
      "/api/paypal/config",
    ).catch((e) => {
      paypalConfigPromise = null;
      throw e;
    });
    return paypalConfigPromise;
  },
  /** Browser-safe client token for PayPal JS SDK v6. */
  paypalClientToken: () =>
    http<{ client_token: string; expires_at: string }>("GET", "/api/paypal/client-token"),
  bootstrapSeller: (b?: { name?: string; tagline?: string }) =>
    m<Seller>(() => mock.getSeller(), "POST", "/api/seller/bootstrap", b ?? {}),
  setServiceImage: (b: {
    mode: "upload" | "generate" | "clear";
    title?: string;
    description?: string;
    data_url?: string;
    service_id?: string;
  }) =>
    m<{ image_url: string; service?: Service }>(
      async () => {
        if (b.mode === "upload" && b.data_url) return { image_url: b.data_url };
        const t = (b.title ?? "Service").toLowerCase();
        const fallback = t.includes("brand")
          ? "/images/service-brand.webp"
          : t.includes("landing")
            ? "/images/service-landing.webp"
            : t.includes("pitch")
              ? "/images/service-pitch.webp"
              : "/images/service-brand.webp";
        return { image_url: fallback };
      },
      "POST",
      "/api/services/image",
      b,
    ),
  resetDemo: () => m<{ ok: true }>(() => mock.reset(), "POST", "/api/demo/reset"),
};
