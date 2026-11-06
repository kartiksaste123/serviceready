/**
 * Supabase-backed live API used by /api/* routes when VITE_USE_MOCKS=false.
 * PayPal Orders + Invoicing are real sandbox calls.
 * AI endpoints (catalog parse, storefront agent, collections drafts) call an
 * OpenAI-compatible LLM when OPENAI_API_KEY is set; otherwise they fall back
 * to deterministic heuristics so tests stay green without a key.
 */
import type {
  AgentEvent,
  AgentRun,
  ChatMsg,
  Flag,
  Payment,
  Proposal,
  PublicStore,
  Quote,
  QuoteDetail,
  QuoteStatus,
  Reply,
  Seller,
  SellerRules,
  Service,
  ServiceDraft,
  Source,
  Stats,
  ToolTrace,
} from "../lib/types";
import {
  catalogErrors,
  depositOf,
  draftErrors,
  isEmail,
  quoteRequestErrors,
  rulesErrors,
} from "../lib/validation";
import { money, money0 } from "../lib/format";
import { db } from "./db";
import { authorizeMinDepositCents, paypalWebhookId, publicOrigin } from "./env";
import { depositIntentFor, type DepositIntent } from "../lib/deposit-policy";
import { HttpError } from "./http";
import * as paypal from "./paypal";
import {
  toolkitGetInvoice,
  toolkitGetOrder,
  toolkitCreateRefund,
  toolkitSendInvoiceReminder,
} from "./paypal-toolkit";
import { chatJson, hasLlm, llmDisclosure, LlmError } from "./llm";
import { findPriceOverrides, GUARDRAIL_MESSAGE } from "../lib/guardrails";
import { collectionsRisk, historyFor, TONE_GUIDE } from "../lib/risk";
import {
  CANCEL_REASONS,
  decideCancel,
  describeCancelPolicy,
  normalizePolicy,
  policyForAgents,
  type CancelPolicy,
  type CancelReason,
  type DepositState,
} from "../lib/cancel-policy";
import { finalBill, tipError, tipFromPct, MAX_TIP_PCT } from "../lib/tip";
import {
  orderFingerprint,
  quoteMathErrors,
  quoteSig,
  safeEqualHex,
  type TamperCheck,
} from "./fingerprint";
import { z } from "zod";

const DEMO_SLUG = "maya-rao-studio";
const WEBMCP_TOOLS = ["list_services", "get_service", "request_quote", "get_quote_status"];

type SellerRow = {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  email: string;
  currency: string;
  default_deposit_pct: number;
  reminder_tone: SellerRules["reminder_tone"];
  max_reminders: number;
  wait_days_before_nudge: number;
  auth_user_id?: string | null;
  free_cancel_hours?: number | null;
  late_cancel_keep_pct?: number | null;
  no_show_keep_pct?: number | null;
};
type ServiceRow = {
  id: string;
  seller_id: string;
  title: string;
  description: string;
  deliverables: string[] | unknown;
  price_cents: number;
  deposit_pct: number;
  lead_time_days: number;
  status: "published" | "draft";
  image_url?: string | null;
};
type QuoteRow = {
  id: string;
  seller_id: string;
  service_id: string;
  service_title: string;
  client_name: string;
  client_email: string;
  brief: string;
  scope_summary: string;
  line_items: { label: string; amount_cents: number }[] | unknown;
  total_cents: number;
  deposit_cents: number;
  balance_cents: number;
  status: QuoteStatus;
  source: Source;
  approval_url: string;
  created_at: string;
  updated_at: string;
  tip_cents?: number | null;
  cancel_policy?: Partial<CancelPolicy> | null;
  deposit_paid_at?: string | null;
  work_started_at?: string | null;
  price_sig?: string | null;
};
type PaymentRow = {
  id: string;
  quote_id: string;
  kind: "deposit" | "balance";
  amount_cents: number;
  status: string;
  paypal_order_id: string | null;
  paypal_capture_id: string | null;
  paypal_invoice_id: string | null;
  invoice_url: string | null;
  updated_at: string;
  intent?: string | null;
  paypal_authorization_id?: string | null;
  fingerprint?: string | null;
  kept_cents?: number | null;
  refunded_cents?: number | null;
};
type EventRow = {
  id: string;
  quote_id: string | null;
  seller_id: string | null;
  actor: AgentEvent["actor"];
  kind: AgentEvent["kind"];
  tool: string | null;
  input: unknown;
  output: unknown;
  text: string | null;
  created_at: string;
};
type ProposalRow = {
  id: string;
  quote_id: string;
  client_name: string;
  action: Proposal["action"];
  reason: string;
  evidence: string;
  draft_message: string;
  status: Proposal["status"];
  created_at: string;
};
type ReplyRow = {
  id: string;
  quote_id: string;
  from_party: "client" | "seller";
  text: string;
  created_at: string;
};

function mapSeller(r: SellerRow): Seller {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    tagline: r.tagline,
    email: r.email,
    currency: "USD",
    rules: {
      default_deposit_pct: r.default_deposit_pct,
      reminder_tone: r.reminder_tone,
      max_reminders: r.max_reminders,
      wait_days_before_nudge: r.wait_days_before_nudge,
      cancel_policy: sellerPolicy(r),
    },
  };
}
function sellerPolicy(r: SellerRow): CancelPolicy {
  return normalizePolicy({
    ...(r.free_cancel_hours != null ? { free_cancel_hours: r.free_cancel_hours } : {}),
    ...(r.late_cancel_keep_pct != null ? { late_cancel_keep_pct: r.late_cancel_keep_pct } : {}),
    ...(r.no_show_keep_pct != null ? { no_show_keep_pct: r.no_show_keep_pct } : {}),
  });
}
function quoteIntegrity(r: QuoteRow): "signed" | "unsigned" | "tampered" {
  if (quoteMathErrors(r).length) return "tampered";
  if (!r.price_sig) return "unsigned";
  return safeEqualHex(r.price_sig, quoteSig(r)) ? "signed" : "tampered";
}
function mapService(r: ServiceRow): Service {
  const deliverables = Array.isArray(r.deliverables)
    ? (r.deliverables as string[])
    : typeof r.deliverables === "string"
      ? ([r.deliverables] as string[])
      : [];
  return {
    id: r.id,
    title: r.title,
    description: r.description ?? "",
    deliverables,
    price_cents: r.price_cents,
    deposit_pct: r.deposit_pct,
    lead_time_days: r.lead_time_days,
    status: r.status,
    image_url: r.image_url ?? null,
  };
}
function mapQuote(r: QuoteRow): Quote {
  const line_items = Array.isArray(r.line_items) ? (r.line_items as Quote["line_items"]) : [];
  return {
    id: r.id,
    service_id: r.service_id,
    service_title: r.service_title,
    client_name: r.client_name,
    client_email: r.client_email,
    brief: r.brief ?? "",
    scope_summary: r.scope_summary ?? "",
    line_items,
    total_cents: r.total_cents,
    deposit_cents: r.deposit_cents,
    balance_cents: r.balance_cents,
    status: r.status,
    source: r.source,
    approval_url: r.approval_url,
    created_at: r.created_at,
    updated_at: r.updated_at,
    deposit_intent: depositIntentFor(r.deposit_cents, authorizeMinDepositCents()),
    tip_cents: r.tip_cents ?? 0,
    cancel_policy: normalizePolicy(r.cancel_policy ?? null),
    deposit_paid_at: r.deposit_paid_at ?? null,
    work_started_at: r.work_started_at ?? null,
    integrity: quoteIntegrity(r),
  };
}
function mapPayment(r: PaymentRow): Payment {
  return {
    id: r.id,
    kind: r.kind,
    amount_cents: r.amount_cents,
    status: r.status,
    ...(r.paypal_order_id ? { paypal_order_id: r.paypal_order_id } : {}),
    ...(r.paypal_capture_id ? { paypal_capture_id: r.paypal_capture_id } : {}),
    ...(r.paypal_authorization_id ? { paypal_authorization_id: r.paypal_authorization_id } : {}),
    ...(r.kind === "deposit"
      ? { intent: (r.intent === "AUTHORIZE" ? "AUTHORIZE" : "CAPTURE") as DepositIntent }
      : {}),
    ...(r.paypal_invoice_id ? { paypal_invoice_id: r.paypal_invoice_id } : {}),
    ...(r.invoice_url ? { invoice_url: r.invoice_url } : {}),
    ...(r.fingerprint ? { fingerprint_short: r.fingerprint.slice(0, 12) } : {}),
    ...(r.kept_cents != null ? { kept_cents: r.kept_cents } : {}),
    ...(r.refunded_cents != null ? { refunded_cents: r.refunded_cents } : {}),
    updated_at: r.updated_at,
  };
}
function mapEvent(r: EventRow): AgentEvent {
  return {
    id: r.id,
    quote_id: r.quote_id,
    actor: r.actor,
    kind: r.kind,
    ...(r.tool ? { tool: r.tool } : {}),
    ...(r.input !== null && r.input !== undefined ? { input: r.input } : {}),
    ...(r.output !== null && r.output !== undefined ? { output: r.output } : {}),
    ...(r.text ? { text: r.text } : {}),
    created_at: r.created_at,
  };
}
function mapProposal(r: ProposalRow): Proposal {
  return {
    id: r.id,
    quote_id: r.quote_id,
    client_name: r.client_name,
    action: r.action,
    reason: r.reason,
    evidence: r.evidence,
    draft_message: r.draft_message,
    status: r.status,
    created_at: r.created_at,
  };
}
function mapReply(r: ReplyRow): Reply {
  return {
    id: r.id,
    quote_id: r.quote_id,
    from: r.from_party,
    text: r.text,
    created_at: r.created_at,
  };
}

async function requireSeller(slug = DEMO_SLUG): Promise<SellerRow> {
  const { data, error } = await db().from("sellers").select("*").eq("slug", slug).maybeSingle();
  if (error) throw new HttpError(error.message, 500);
  if (!data) throw new HttpError("Seller not found", 404);
  return data as SellerRow;
}

async function demoSeller(): Promise<SellerRow> {
  return requireSeller(DEMO_SLUG);
}

function bearerToken(request?: Request): string | null {
  const h = request?.headers.get("authorization") ?? request?.headers.get("Authorization") ?? "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || null;
}

async function userIdFromRequest(request?: Request): Promise<string> {
  const token = bearerToken(request);
  if (!token) throw new HttpError("Sign in to open your seller desk", 401);
  const { data, error } = await db().auth.getUser(token);
  if (error || !data.user) throw new HttpError("Your session expired — sign in again", 401);
  return data.user.id;
}

/** Resolve the authenticated seller (desk APIs). Public /s /q /mcp stay slug-based. */
export async function sellerFromRequest(request?: Request): Promise<SellerRow> {
  const uid = await userIdFromRequest(request);
  const { data, error } = await db()
    .from("sellers")
    .select("*")
    .eq("auth_user_id", uid)
    .maybeSingle();
  if (error) throw new HttpError(error.message, 500);
  if (!data) {
    throw new HttpError("No seller workspace for this account — finish setup first", 404);
  }
  return data as SellerRow;
}

async function assertOwnsQuote(
  request: Request | undefined,
  quoteId: string,
): Promise<{
  seller: SellerRow;
  quote: QuoteRow;
}> {
  const seller = await sellerFromRequest(request);
  const quote = await getQuoteRow(quoteId);
  if (quote.seller_id !== seller.id) throw new HttpError("Booking not found", 404);
  return { seller, quote };
}

function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "studio";
}

/** After sign-up: create a seller row for this auth user, or return the existing one. */
export async function bootstrapSeller(
  request: Request,
  body: { name?: string; tagline?: string } = {},
): Promise<Seller> {
  invalidateCatalogCache();
  const token = bearerToken(request);
  if (!token) throw new HttpError("Sign in to open your seller desk", 401);
  const { data: authData, error: authErr } = await db().auth.getUser(token);
  if (authErr || !authData.user) throw new HttpError("Your session expired — sign in again", 401);
  const user = authData.user;

  const existing = await db().from("sellers").select("*").eq("auth_user_id", user.id).maybeSingle();
  if (existing.error) throw new HttpError(existing.error.message, 500);
  if (existing.data) return mapSeller(existing.data as SellerRow);

  const metaName =
    typeof user.user_metadata?.["full_name"] === "string"
      ? String(user.user_metadata["full_name"]).trim()
      : "";
  const name = (body.name?.trim() || metaName || user.email?.split("@")[0] || "My studio").slice(
    0,
    80,
  );
  const tagline = (body.tagline?.trim() || "Agent-ready services with PayPal deposits.").slice(
    0,
    160,
  );
  const email = (user.email || `${user.id}@sellers.local`).toLowerCase();

  let slug = slugify(name);
  for (let i = 0; i < 8; i++) {
    const candidate = i === 0 ? slug : `${slug}-${Math.random().toString(36).slice(2, 6)}`;
    const { data, error } = await db()
      .from("sellers")
      .insert({
        slug: candidate,
        name,
        tagline,
        email,
        auth_user_id: user.id,
        default_deposit_pct: 30,
        reminder_tone: "friendly",
        max_reminders: 3,
        wait_days_before_nudge: 3,
      })
      .select("*")
      .maybeSingle();
    if (!error && data) return mapSeller(data as SellerRow);
    if (error && !/duplicate|unique/i.test(error.message)) {
      throw new HttpError(error.message, 500);
    }
  }
  throw new HttpError("Could not create a unique storefront slug — try another name", 400);
}

async function pushEvent(partial: {
  quote_id: string | null;
  seller_id?: string | null;
  actor: AgentEvent["actor"];
  kind: AgentEvent["kind"];
  tool?: string | null;
  input?: unknown;
  output?: unknown;
  text?: string | null;
}): Promise<AgentEvent> {
  const { data, error } = await db()
    .from("agent_events")
    .insert({
      quote_id: partial.quote_id,
      seller_id: partial.seller_id ?? null,
      actor: partial.actor,
      kind: partial.kind,
      tool: partial.tool ?? null,
      input: partial.input ?? null,
      output: partial.output ?? null,
      text: partial.text ?? null,
    })
    .select("*")
    .single();
  if (error) throw new HttpError(error.message, 500);
  return mapEvent(data as EventRow);
}

/** Audit a blocked money-override attempt on the timeline (seller-level when no quote). */
export async function logGuardrailBlock(opts: {
  slug: string;
  tool: string;
  fields: string[];
  actor: "client_agent" | "seller_agent";
  quote_id?: string | null;
}): Promise<void> {
  try {
    const sellerId = await getSellerIdBySlug(opts.slug);
    await pushEvent({
      quote_id: opts.quote_id ?? null,
      seller_id: sellerId,
      actor: opts.actor,
      kind: "decision",
      tool: "guardrail.price_override_blocked",
      input: { tool: opts.tool, fields: opts.fields },
      output: { blocked: true },
      text: `Blocked ${opts.tool}: agent tried to set ${opts.fields.join(", ")} — amounts come only from the catalog`,
    });
  } catch {
    /* audit is best-effort; the block itself already happened */
  }
}

async function getQuoteRow(id: string): Promise<QuoteRow> {
  const { data, error } = await db().from("quotes").select("*").eq("id", id).maybeSingle();
  if (error) throw new HttpError(error.message, 500);
  if (!data) throw new HttpError("Quote not found", 404);
  return data as QuoteRow;
}

async function paymentsFor(quoteId: string): Promise<Payment[]> {
  const { data, error } = await db()
    .from("payments")
    .select("*")
    .eq("quote_id", quoteId)
    .order("created_at", { ascending: true });
  if (error) throw new HttpError(error.message, 500);
  return (data as PaymentRow[]).map(mapPayment);
}

async function detail(id: string): Promise<QuoteDetail> {
  const q = await getQuoteRow(id);
  const [payments, eventsRes, repliesRes, proposalsRes] = await Promise.all([
    paymentsFor(id),
    db()
      .from("agent_events")
      .select("*")
      .eq("quote_id", id)
      .order("created_at", { ascending: true }),
    db().from("replies").select("*").eq("quote_id", id).order("created_at", { ascending: true }),
    db().from("proposals").select("*").eq("quote_id", id).order("created_at", { ascending: true }),
  ]);
  if (eventsRes.error) throw new HttpError(eventsRes.error.message, 500);
  if (repliesRes.error) throw new HttpError(repliesRes.error.message, 500);
  if (proposalsRes.error) throw new HttpError(proposalsRes.error.message, 500);
  const quote = mapQuote(q);
  const depPay = [...payments].reverse().find((p) => p.kind === "deposit" && p.status !== "VOIDED");
  if (depPay?.intent && q.status !== "quoted") quote.deposit_intent = depPay.intent;
  return {
    quote,
    payments,
    events: (eventsRes.data as EventRow[]).map(mapEvent),
    replies: (repliesRes.data as ReplyRow[]).map(mapReply),
    proposals: (proposalsRes.data as ProposalRow[]).map(mapProposal),
  };
}

export async function getSeller(request?: Request): Promise<Seller> {
  return mapSeller(await sellerFromRequest(request));
}

/** Resolve seller id by public slug (MCP mandates). */
export async function getSellerIdBySlug(slug: string): Promise<string> {
  const hit = catalogCache.get(slug);
  if (hit && Date.now() - hit.at < CATALOG_TTL_MS) return hit.seller.id;
  const { data, error } = await db().from("sellers").select("id").eq("slug", slug).maybeSingle();
  if (error) throw new HttpError(error.message, 500);
  if (!data) throw new HttpError(`Unknown storefront: ${slug}`, 404);
  return (data as { id: string }).id;
}

export async function putRules(rules: SellerRules, request?: Request): Promise<Seller> {
  const errs = rulesErrors(rules);
  const first = Object.values(errs).find(Boolean);
  if (first) throw new HttpError(String(first), 400);
  const seller = await sellerFromRequest(request);
  const { data, error } = await db()
    .from("sellers")
    .update({
      default_deposit_pct: rules.default_deposit_pct,
      reminder_tone: rules.reminder_tone,
      max_reminders: rules.max_reminders,
      wait_days_before_nudge: rules.wait_days_before_nudge,
      ...(rules.cancel_policy
        ? {
            free_cancel_hours: rules.cancel_policy.free_cancel_hours,
            late_cancel_keep_pct: rules.cancel_policy.late_cancel_keep_pct,
            no_show_keep_pct: rules.cancel_policy.no_show_keep_pct,
          }
        : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", seller.id)
    .select("*")
    .single();
  if (error) throw new HttpError(error.message, 500);
  return mapSeller(data as SellerRow);
}

export async function listServices(request?: Request): Promise<Service[]> {
  const seller = await sellerFromRequest(request);
  const { data, error } = await db()
    .from("services")
    .select("*")
    .eq("seller_id", seller.id)
    .order("created_at", { ascending: true });
  if (error) throw new HttpError(error.message, 500);
  return (data as ServiceRow[]).map(mapService);
}

/**
 * In-memory seller catalog cache (per Render instance). Storefront, MCP list_services and the
 * agent chat all read the same published catalog, so a short TTL keeps those sub-second.
 * Invalidated on any catalog write (publish, cover image, reset, bootstrap).
 */
const CATALOG_TTL_MS = 30_000;
const catalogCache = new Map<
  string,
  { at: number; seller: SellerRow; services: Service[]; inflight?: undefined }
>();
const catalogInflight = new Map<string, Promise<{ seller: SellerRow; services: Service[] }>>();

export function invalidateCatalogCache(slug?: string): void {
  if (slug) catalogCache.delete(slug);
  else catalogCache.clear();
}

async function publishedCatalog(slug: string): Promise<{ seller: SellerRow; services: Service[] }> {
  const hit = catalogCache.get(slug);
  if (hit && Date.now() - hit.at < CATALOG_TTL_MS) return hit;
  const pending = catalogInflight.get(slug);
  if (pending) return pending;
  const p = (async () => {
    const seller = await requireSeller(slug);
    const { data, error } = await db()
      .from("services")
      .select("*")
      .eq("seller_id", seller.id)
      .eq("status", "published")
      .order("created_at", { ascending: true });
    if (error) throw new HttpError(error.message, 500);
    const entry = { at: Date.now(), seller, services: (data as ServiceRow[]).map(mapService) };
    catalogCache.set(slug, entry);
    return entry;
  })().finally(() => catalogInflight.delete(slug));
  catalogInflight.set(slug, p);
  return p;
}

export async function getPublic(slug: string, request?: Request): Promise<PublicStore> {
  const { seller, services } = await publishedCatalog(slug);
  const origin = publicOrigin(request);
  return {
    seller: { name: seller.name, slug: seller.slug, tagline: seller.tagline },
    services: services.map((s) => ({ ...s, deliverables: [...s.deliverables] })),
    agent: {
      mcp_url: `${origin}/mcp/${seller.slug}`,
      webmcp_tools: WEBMCP_TOOLS,
    },
    cancel_policy: policyForAgents(sellerPolicy(seller)),
  };
}

export async function postPublicQuote(
  slug: string,
  b: {
    service_id: string;
    client_name: string;
    client_email: string;
    brief: string;
    source: Source;
  },
  request?: Request,
): Promise<Quote> {
  const qErrs = quoteRequestErrors(b);
  const qFirst = Object.values(qErrs).find(Boolean);
  if (qFirst) throw new HttpError(String(qFirst), 400);
  const seller = await requireSeller(slug);
  const { data: svc, error: sErr } = await db()
    .from("services")
    .select("*")
    .eq("id", b.service_id)
    .eq("seller_id", seller.id)
    .eq("status", "published")
    .maybeSingle();
  if (sErr) throw new HttpError(sErr.message, 500);
  if (!svc) throw new HttpError("Service not found", 404);
  const service = mapService(svc as ServiceRow);
  const deposit_cents = depositOf(service.price_cents, service.deposit_pct);
  const balance_cents = service.price_cents - deposit_cents;
  const line_items = [{ label: service.title, amount_cents: service.price_cents }];
  const scope_summary = `${service.title} for ${b.client_name}${
    service.deliverables.length ? `: ${service.deliverables.join(", ")}` : ""
  }. Delivered in ~${service.lead_time_days} days by ${seller.name}.`;

  // Insert quote first without approval_url, then patch with id-based URL
  const { data: inserted, error } = await db()
    .from("quotes")
    .insert({
      seller_id: seller.id,
      service_id: service.id,
      service_title: service.title,
      client_name: b.client_name.trim(),
      client_email: b.client_email.trim().toLowerCase(),
      brief: (b.brief ?? "").trim(),
      scope_summary,
      line_items,
      total_cents: service.price_cents,
      deposit_cents,
      balance_cents,
      status: "quoted",
      source: b.source,
      approval_url: "",
      cancel_policy: sellerPolicy(seller),
    })
    .select("*")
    .single();
  if (error) throw new HttpError(error.message, 500);
  const quote = inserted as QuoteRow;
  const approval_url = `${publicOrigin(request)}/q/${quote.id}`;
  // Sign the catalog-derived amounts; any later edit to the row breaks this HMAC.
  const price_sig = quoteSig(quote);
  const { data: updated, error: uErr } = await db()
    .from("quotes")
    .update({ approval_url, price_sig })
    .eq("id", quote.id)
    .select("*")
    .single();
  if (uErr) throw new HttpError(uErr.message, 500);

  await pushEvent({
    quote_id: quote.id,
    seller_id: seller.id,
    actor: "system",
    kind: "message",
    text: `Quote created for ${b.client_name} via ${b.source}`,
  });
  return mapQuote(updated as QuoteRow);
}

export async function listQuotes(request?: Request): Promise<Quote[]> {
  const seller = await sellerFromRequest(request);
  const { data, error } = await db()
    .from("quotes")
    .select("*")
    .eq("seller_id", seller.id)
    .order("updated_at", { ascending: false });
  if (error) throw new HttpError(error.message, 500);
  return (data as QuoteRow[]).map(mapQuote);
}

export async function getQuote(id: string, refresh = false): Promise<QuoteDetail> {
  if (refresh) {
    await reconcileDeposit(id);
    await refreshInvoiceStatus(id);
  }
  return detail(id);
}

export async function paypalConfig() {
  const cfg = await paypal.getPublicClientId();
  return {
    ...cfg,
    sdk: { v6: true, legacy: true },
    deposit_authorize_min_usd: authorizeMinDepositCents() / 100,
  };
}

/** Browser-safe PayPal JS SDK v6 client token (cached ~10 min per instance). */
let sdkTokenCache: { token: string; exp: number; host: string } | null = null;
export async function paypalClientToken(request?: Request) {
  const host = new URL(publicOrigin(request)).host;
  if (sdkTokenCache && sdkTokenCache.host === host && sdkTokenCache.exp > Date.now() + 120_000) {
    return {
      client_token: sdkTokenCache.token,
      expires_at: new Date(sdkTokenCache.exp).toISOString(),
    };
  }
  const t = await paypal.createSdkClientToken([host]);
  sdkTokenCache = { token: t.client_token, exp: Date.now() + t.expires_in * 1000, host };
  return { client_token: t.client_token, expires_at: new Date(sdkTokenCache.exp).toISOString() };
}

/* ---------- tamper-proofing (src/server/fingerprint.ts) ---------- */

async function tamperBlocked(q: QuoteRow, step: string, problems: string[]): Promise<never> {
  await pushEvent({
    quote_id: q.id,
    seller_id: q.seller_id,
    actor: "system",
    kind: "decision",
    tool: "guardrail.tamper_blocked",
    input: { step },
    output: { blocked: true, problems },
    text: `Blocked ${step}: ${problems.join("; ")}`,
  }).catch(() => undefined);
  throw new HttpError(`Tamper check failed — ${problems.join("; ")}. No money was moved.`, 409);
}

/**
 * Re-price + signature check before any PayPal money call. Signed quotes must match their HMAC;
 * legacy unsigned quotes are re-priced from the live catalog and then signed (trust on first use).
 */
async function assertQuoteIntegrity(q: QuoteRow, step: string): Promise<void> {
  const problems = quoteMathErrors(q);
  if (q.price_sig) {
    if (!safeEqualHex(q.price_sig, quoteSig(q)))
      problems.push("quote amounts don't match their signature");
  } else {
    const { data: svc } = await db()
      .from("services")
      .select("price_cents,deposit_pct")
      .eq("id", q.service_id)
      .maybeSingle();
    const s = svc as { price_cents: number; deposit_pct: number } | null;
    if (
      s &&
      s.price_cents === q.total_cents &&
      depositOf(s.price_cents, s.deposit_pct) !== q.deposit_cents
    ) {
      problems.push(
        `deposit ${money(q.deposit_cents)} ≠ catalog deposit ${money(depositOf(s.price_cents, s.deposit_pct))}`,
      );
    }
    if (!problems.length) {
      q.price_sig = quoteSig(q);
      await db().from("quotes").update({ price_sig: q.price_sig }).eq("id", q.id);
    }
  }
  if (problems.length) await tamperBlocked(q, step, problems);
}

/** Re-read the order from PayPal and compare its fingerprint with the one stored at create time. */
async function verifyOrderBeforeMoney(
  q: QuoteRow,
  p: Payment,
  order_id: string,
  intent: DepositIntent,
  step: string,
): Promise<void> {
  await assertQuoteIntegrity(q, step);
  const expected = orderFingerprint({
    quote_id: q.id,
    kind: "deposit",
    amount_cents: q.deposit_cents,
    currency: "USD",
    intent,
  });
  const problems: string[] = [];
  const { data: row } = await db()
    .from("payments")
    .select("fingerprint")
    .eq("id", p.id)
    .maybeSingle();
  const stored = (row as { fingerprint?: string | null } | null)?.fingerprint ?? null;
  if (stored && !safeEqualHex(stored, expected))
    problems.push("stored order fingerprint ≠ signed quote");
  const o = await paypal.getOrder(order_id).catch(() => null);
  if (o) {
    if (o.customId && o.customId !== q.id)
      problems.push("PayPal order belongs to a different quote");
    if (o.amountCents !== undefined) {
      const fromPayPal = orderFingerprint({
        quote_id: o.customId ?? q.id,
        kind: "deposit",
        amount_cents: o.amountCents,
        currency: o.currency ?? "USD",
        intent: o.intent ?? intent,
      });
      if (!safeEqualHex(fromPayPal, expected)) {
        problems.push(
          `PayPal order is ${money(o.amountCents)} ${o.currency ?? "USD"} ${o.intent ?? ""}`.trim() +
            `, signed deposit is ${money(q.deposit_cents)} USD ${intent}`,
        );
      }
    }
  }
  if (problems.length) await tamperBlocked(q, step, problems);
  await pushEvent({
    quote_id: q.id,
    seller_id: q.seller_id,
    actor: "system",
    kind: "decision",
    tool: "guardrail.fingerprint_verified",
    input: { step, order_id },
    output: {
      quote_signature: "ok",
      order_fingerprint: stored ? "match" : "recomputed",
      paypal_amount: o?.amountCents !== undefined ? o.amountCents / 100 : null,
    },
    text: `Order fingerprint verified against PayPal before ${step.replace("paypal.", "")}`,
  });
}

/**
 * GET/POST /api/judges/tamper-demo — shows the three money locks rejecting "make it $1".
 * Pure checks on a synthetic quote (nothing is written); optionally verifies a real quote's signature.
 */
export async function tamperDemo(
  quoteId?: string,
): Promise<{ checks: TamperCheck[]; quote?: unknown }> {
  const checks: TamperCheck[] = [];
  // 1. Agent tries to pass an amount.
  const agentArgs = {
    service_id: "svc_brand_kit",
    client_email: "judge@example.com",
    deposit_usd: 1,
  };
  const fields = findPriceOverrides(agentArgs);
  checks.push({
    check: "MCP/agent passes deposit_usd: 1",
    ok: fields.length > 0,
    detail: fields.length ? `Rejected before any tool runs (${fields.join(", ")})` : "NOT blocked",
  });
  // 2. Someone edits the quote row to a $1 deposit.
  const signed = {
    id: "demo-quote",
    service_id: "svc_brand_kit",
    total_cents: 1350_00,
    deposit_cents: 675_00,
    balance_cents: 675_00,
    line_items: [{ label: "Brand kit", amount_cents: 1350_00 }],
  };
  const sig = quoteSig(signed);
  const tampered = { ...signed, deposit_cents: 1_00, balance_cents: 1349_00 };
  const sigOk = safeEqualHex(sig, quoteSig(tampered));
  checks.push({
    check: "Quote row edited to a $1.00 deposit",
    ok: !sigOk,
    detail: !sigOk
      ? "HMAC signature over the catalog amounts no longer verifies → order creation blocked (409)"
      : "NOT blocked",
  });
  // 3. PayPal order amount differs from what we signed.
  const expected = orderFingerprint({
    quote_id: signed.id,
    kind: "deposit",
    amount_cents: signed.deposit_cents,
    currency: "USD",
    intent: "AUTHORIZE",
  });
  const fromPayPal = orderFingerprint({
    quote_id: signed.id,
    kind: "deposit",
    amount_cents: 1_00,
    currency: "USD",
    intent: "AUTHORIZE",
  });
  const fpOk = safeEqualHex(expected, fromPayPal);
  checks.push({
    check: "PayPal order shows $1.00 instead of $675.00",
    ok: !fpOk,
    detail: !fpOk
      ? `Order fingerprint ${expected.slice(0, 10)}… ≠ ${fromPayPal.slice(0, 10)}… → capture/authorize rejected`
      : "NOT blocked",
  });
  // 4. Client tries a tip over the cap.
  const tipErr = tipError(1350_00, tipFromPct(1350_00, 90));
  checks.push({
    check: "Client adds a 90% tip",
    ok: !!tipErr,
    detail: tipErr ?? "NOT blocked",
  });
  let quote: unknown;
  if (quoteId) {
    try {
      const r = await getQuoteRow(quoteId);
      const integrity = quoteIntegrity(r);
      quote = {
        id: r.id,
        integrity,
        total: money(r.total_cents),
        deposit: money(r.deposit_cents),
      };
      checks.push({
        check: `Live quote ${r.id.slice(0, 8)}… signature`,
        ok: integrity !== "tampered",
        detail:
          integrity === "signed"
            ? "HMAC verifies — amounts are exactly what the catalog priced"
            : integrity === "unsigned"
              ? "Legacy quote — re-priced from the catalog and signed on first payment"
              : "Signature mismatch — payments on this quote are blocked",
      });
    } catch {
      /* unknown quote id: just skip the live check */
    }
  }
  return { checks, ...(quote ? { quote } : {}) };
}

/** Public: client picks a tip for the final bill (before the balance invoice is sent). */
export async function setTip(
  id: string,
  body: { tip_cents?: unknown; tip_pct?: unknown },
): Promise<QuoteDetail> {
  const q = await getQuoteRow(id);
  if (!["quoted", "deposit_paid", "delivered"].includes(q.status)) {
    throw new HttpError(
      q.status === "cancelled"
        ? "This booking was cancelled"
        : "The final bill was already sent — add a tip on the PayPal invoice instead",
      400,
    );
  }
  let tip: number;
  if (typeof body.tip_pct === "number") {
    if (!Number.isFinite(body.tip_pct) || body.tip_pct < 0 || body.tip_pct > MAX_TIP_PCT) {
      throw new HttpError(`Tip % must be between 0 and ${MAX_TIP_PCT}`, 400);
    }
    tip = tipFromPct(q.total_cents, body.tip_pct);
  } else if (typeof body.tip_cents === "number") {
    tip = Math.round(body.tip_cents);
  } else {
    throw new HttpError("Send tip_cents or tip_pct", 400);
  }
  const err = tipError(q.total_cents, tip);
  if (err) throw new HttpError(err, 400);
  await db()
    .from("quotes")
    .update({ tip_cents: tip, updated_at: new Date().toISOString() })
    .eq("id", id);
  await pushEvent({
    quote_id: id,
    seller_id: q.seller_id,
    actor: "client",
    kind: "decision",
    tool: "final_bill.tip",
    input: typeof body.tip_pct === "number" ? { tip_pct: body.tip_pct } : { tip_cents: tip },
    output: { tip: tip / 100, final_bill: finalBill(q.balance_cents, tip).total_cents / 100 },
    text: tip > 0 ? `Client added a ${money(tip)} tip to the final bill` : "Client removed the tip",
  });
  return detail(id);
}

export type DisputeEvidencePack = {
  generated_at: string;
  purpose: string;
  booking: {
    quote_id: string;
    status: string;
    service_title: string;
    client_name: string;
    client_email: string;
    total_cents: number;
    deposit_cents: number;
    balance_cents: number;
    tip_cents: number;
    deposit_intent?: string;
    integrity?: string;
    created_at: string;
    deposit_paid_at?: string | null;
    work_started_at?: string | null;
  };
  paypal: {
    order_ids: string[];
    capture_ids: string[];
    authorization_ids: string[];
    invoice_ids: string[];
    invoice_urls: string[];
    fingerprint_shorts: string[];
  };
  payments: Payment[];
  timeline: Array<{
    at: string;
    actor: string;
    kind: string;
    tool?: string;
    text?: string;
    input?: unknown;
    output?: unknown;
  }>;
  markdown: string;
};

/** Seller/judges evidence pack for a PayPal dispute — JSON + Markdown from the booking record. */
export async function disputeEvidence(
  id: string,
  request?: Request,
): Promise<DisputeEvidencePack> {
  if (request) await assertOwnsQuote(request, id);
  const d = await detail(id);
  const q = d.quote;
  const order_ids = [...new Set(d.payments.map((p) => p.paypal_order_id).filter(Boolean))] as string[];
  const capture_ids = [...new Set(d.payments.map((p) => p.paypal_capture_id).filter(Boolean))] as string[];
  const authorization_ids = [
    ...new Set(d.payments.map((p) => p.paypal_authorization_id).filter(Boolean)),
  ] as string[];
  const invoice_ids = [...new Set(d.payments.map((p) => p.paypal_invoice_id).filter(Boolean))] as string[];
  const invoice_urls = [...new Set(d.payments.map((p) => p.invoice_url).filter(Boolean))] as string[];
  const fingerprint_shorts = [
    ...new Set(d.payments.map((p) => p.fingerprint_short).filter(Boolean)),
  ] as string[];
  const timeline = d.events.map((e) => ({
    at: e.created_at,
    actor: e.actor,
    kind: e.kind,
    ...(e.tool ? { tool: e.tool } : {}),
    ...(e.text ? { text: e.text } : {}),
    ...(e.input !== undefined ? { input: e.input } : {}),
    ...(e.output !== undefined ? { output: e.output } : {}),
  }));
  const lines = [
    `# ServiceReady dispute evidence — booking ${q.id}`,
    ``,
    `Generated: ${new Date().toISOString()}`,
    `Purpose: Answer a PayPal CUSTOMER.DISPUTE with catalog-priced amounts, PayPal ids, HMAC fingerprints, and the audit timeline.`,
    ``,
    `## Booking`,
    `- Service: ${q.service_title}`,
    `- Client: ${q.client_name} <${q.client_email}>`,
    `- Status: ${q.status}`,
    `- Total: ${money(q.total_cents)} · Deposit: ${money(q.deposit_cents)} · Balance: ${money(q.balance_cents)} · Tip: ${money(q.tip_cents ?? 0)}`,
    `- Deposit intent: ${q.deposit_intent ?? "CAPTURE"}`,
    `- Integrity: ${q.integrity ?? "unsigned"}`,
    `- Created: ${q.created_at}`,
    `- Deposit paid at: ${q.deposit_paid_at ?? "—"}`,
    `- Work started at: ${q.work_started_at ?? "—"}`,
    ``,
    `## PayPal identifiers`,
    `- Order ids: ${order_ids.join(", ") || "—"}`,
    `- Capture ids: ${capture_ids.join(", ") || "—"}`,
    `- Authorization ids: ${authorization_ids.join(", ") || "—"}`,
    `- Invoice ids: ${invoice_ids.join(", ") || "—"}`,
    `- Invoice URLs: ${invoice_urls.join(", ") || "—"}`,
    `- Order fingerprint prefixes (HMAC quote+amount+currency+intent): ${fingerprint_shorts.join(", ") || "—"}`,
    ``,
    `## Payments`,
  ];
  for (const p of d.payments) {
    lines.push(
      `- ${p.kind} · ${p.status} · ${money(p.amount_cents)}` +
        (p.paypal_order_id ? ` · order ${p.paypal_order_id}` : "") +
        (p.paypal_capture_id ? ` · capture ${p.paypal_capture_id}` : "") +
        (p.paypal_authorization_id ? ` · auth ${p.paypal_authorization_id}` : "") +
        (p.paypal_invoice_id ? ` · invoice ${p.paypal_invoice_id}` : "") +
        (p.fingerprint_short ? ` · fp ${p.fingerprint_short}…` : ""),
    );
  }
  lines.push("", "## Audit timeline");
  for (const e of timeline) {
    lines.push(
      `- ${e.at} · ${e.actor}/${e.kind}${e.tool ? ` · ${e.tool}` : ""}${e.text ? ` — ${e.text}` : ""}`,
    );
  }
  lines.push(
    "",
    "## Notes for PayPal disputes",
    "- Amounts were priced from the published catalog and HMAC-signed; capture/authorize re-checks the order fingerprint against PayPal.",
    "- Agents cannot set prices; money guardrails reject overrides into the audit log.",
    "- Status changes only after PayPal evidence (webhooks or Check PayPal re-read).",
  );
  return {
    generated_at: new Date().toISOString(),
    purpose: "paypal_dispute_evidence",
    booking: {
      quote_id: q.id,
      status: q.status,
      service_title: q.service_title,
      client_name: q.client_name,
      client_email: q.client_email,
      total_cents: q.total_cents,
      deposit_cents: q.deposit_cents,
      balance_cents: q.balance_cents,
      tip_cents: q.tip_cents ?? 0,
      ...(q.deposit_intent ? { deposit_intent: q.deposit_intent } : {}),
      ...(q.integrity ? { integrity: q.integrity } : {}),
      created_at: q.created_at,
      deposit_paid_at: q.deposit_paid_at ?? null,
      work_started_at: q.work_started_at ?? null,
    },
    paypal: {
      order_ids,
      capture_ids,
      authorization_ids,
      invoice_ids,
      invoice_urls,
      fingerprint_shorts,
    },
    payments: d.payments,
    timeline,
    markdown: lines.join("\n"),
  };
}

/**
 * Sandbox Payouts — tip out a contractor from the seller's PayPal balance after a booking is paid.
 * Some sandbox merchant countries return PAYOUT_NOT_AVAILABLE; we surface that clearly.
 */
export async function payoutContractor(
  id: string,
  body: { receiver_email?: unknown; amount_cents?: unknown; note?: unknown },
  request?: Request,
): Promise<{
  ok: boolean;
  batch_id?: string;
  batch_status?: string;
  payout_item_id?: string;
  amount_cents?: number;
  receiver_email?: string;
  deferred?: boolean;
  message: string;
}> {
  const { quote: q, seller } = await assertOwnsQuote(request, id);
  if (q.status !== "paid") {
    throw new HttpError("Contractor tip-out is available after the booking is paid in full", 400);
  }
  const receiver = typeof body.receiver_email === "string" ? body.receiver_email.trim() : "";
  if (!receiver || !isEmail(receiver)) {
    throw new HttpError("receiver_email must be a valid PayPal (sandbox) email", 400);
  }
  const amountCents =
    typeof body.amount_cents === "number" && Number.isFinite(body.amount_cents)
      ? Math.round(body.amount_cents)
      : Math.min(q.deposit_cents, 500); // default: small tip-out, max $5 demo
  if (amountCents < 100 || amountCents > q.total_cents) {
    throw new HttpError("amount_cents must be between $1.00 and the booking total", 400);
  }
  const note =
    typeof body.note === "string" && body.note.trim()
      ? body.note.trim().slice(0, 200)
      : `ServiceReady tip-out for booking ${q.id.slice(0, 8)} (${q.service_title})`;
  const senderBatchId = `sr-payout-${q.id.slice(0, 8)}-${Date.now()}`;
  try {
    const r = await paypal.createPayout({
      amountCents,
      receiverEmail: receiver,
      note,
      emailSubject: `Tip-out from ${seller.name}`,
      senderBatchId,
      senderItemId: `quote-${q.id.slice(0, 12)}`,
      requestId: senderBatchId,
    });
    await pushEvent({
      quote_id: id,
      seller_id: q.seller_id,
      actor: "seller",
      kind: "tool_call",
      tool: "paypal.payouts.create",
      input: { receiver_email: receiver, amount_cents: amountCents },
      output: {
        batch_id: r.batchId,
        batch_status: r.batchStatus,
        payout_item_id: r.payoutItemId ?? null,
      },
      text: `PayPal Payouts batch ${r.batchId || "(pending)"} · ${money(amountCents)} → ${receiver}`,
    });
    return {
      ok: true,
      batch_id: r.batchId,
      batch_status: r.batchStatus,
      ...(r.payoutItemId ? { payout_item_id: r.payoutItemId } : {}),
      amount_cents: amountCents,
      receiver_email: receiver,
      message: `Payout submitted (${r.batchStatus}). Sandbox may take a moment to credit ${receiver}.`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "PayPal Payouts failed";
    const deferred = /PAYOUT_NOT_AVAILABLE|not allowed to send this payout|PERMISSION_DENIED|not.*enabled/i.test(
      msg,
    );
    await pushEvent({
      quote_id: id,
      seller_id: q.seller_id,
      actor: "seller",
      kind: "tool_call",
      tool: "paypal.payouts.create",
      input: { receiver_email: receiver, amount_cents: amountCents },
      output: { error: msg, deferred },
      text: deferred
        ? `PayPal Payouts unavailable for this sandbox merchant (${msg}) — code path is live; enable Payouts on a US sandbox business account to demo money movement.`
        : `PayPal Payouts failed: ${msg}`,
    }).catch(() => undefined);
    if (deferred) {
      return {
        ok: false,
        deferred: true,
        amount_cents: amountCents,
        receiver_email: receiver,
        message: `Sandbox merchant cannot send Payouts (${msg}). The /v1/payments/payouts code path is wired; use a Payouts-enabled US sandbox business app to move funds.`,
      };
    }
    throw e instanceof HttpError ? e : new HttpError(msg, 502);
  }
}

/**
 * "Check PayPal" fallback: if a webhook was missed, re-read open deposit orders from PayPal and
 * finish the capture/authorization server-side. Idempotent; PayPal is the source of truth.
 */
async function reconcileDeposit(id: string): Promise<void> {
  const q = await getQuoteRow(id);
  if (q.status !== "quoted") return;
  const pays = await paymentsFor(id);
  const open = pays.filter(
    (p) => p.kind === "deposit" && p.status === "CREATED" && p.paypal_order_id,
  );
  for (const p of open) {
    const o = await paypal.getOrder(p.paypal_order_id!).catch(() => null);
    if (!o) continue;
    await pushEvent({
      quote_id: id,
      seller_id: q.seller_id,
      actor: "paypal",
      kind: "tool_call",
      tool: "paypal.orders.get",
      input: { id: p.paypal_order_id, reason: "Check PayPal (webhook fallback)" },
      output: { status: o.status },
    });
    if (o.status === "APPROVED") {
      await captureDeposit(id, p.paypal_order_id!);
      return;
    }
    if (o.status === "COMPLETED") {
      const fresh = await getQuoteRow(id);
      if (fresh.status !== "quoted") return;
      if (o.authorizationId && !o.captureId) {
        await markDepositAuthorized(
          fresh,
          p.id,
          p.paypal_order_id!,
          o.authorizationId,
          "authorize_api",
        );
      } else {
        await markDepositPaid(fresh, p.id, p.paypal_order_id!, o.captureId, "capture_api");
      }
      return;
    }
  }
}

export async function createDepositOrder(
  id: string,
  request?: Request,
): Promise<{ order_id: string; approve_url?: string; quote_url: string; intent: DepositIntent }> {
  const q = await getQuoteRow(id);
  if (q.status === "cancelled") throw new HttpError("This quote was cancelled", 400);
  if (q.status !== "quoted") throw new HttpError("The deposit for this quote is already paid", 400);
  if (q.deposit_cents <= 0) throw new HttpError("This quote has no deposit to pay", 400);
  // Tamper-proofing: re-price from the catalog + verify the signed amounts before PayPal is called.
  await assertQuoteIntegrity(q, "paypal.orders.create");
  const origin = publicOrigin(request);
  const quote_url = `${origin}/q/${q.id}`;

  const intent = depositIntentFor(q.deposit_cents, authorizeMinDepositCents());
  const pays = await paymentsFor(id);
  // Retire open orders minted under a different intent (policy changed) so the SDK intent matches.
  for (const p of pays) {
    if (p.kind === "deposit" && p.status === "CREATED" && (p.intent ?? "CAPTURE") !== intent) {
      await db()
        .from("payments")
        .update({ status: "VOIDED", updated_at: new Date().toISOString() })
        .eq("id", p.id);
    }
  }
  const open = pays.find(
    (p) =>
      p.kind === "deposit" &&
      p.status === "CREATED" &&
      p.paypal_order_id &&
      (p.intent ?? "CAPTURE") === intent,
  );
  if (open?.paypal_order_id) {
    let approve_url: string | undefined;
    try {
      const o = await paypal.getOrder(open.paypal_order_id);
      approve_url = o.approveUrl;
    } catch {
      /* the JS SDK button still works with just the order id */
    }
    return {
      order_id: open.paypal_order_id,
      quote_url,
      intent,
      ...(approve_url ? { approve_url } : {}),
    };
  }

  const { data: sellerRow } = await db()
    .from("sellers")
    .select("name")
    .eq("id", q.seller_id)
    .maybeSingle();
  const order = await paypal.createOrder({
    amountCents: q.deposit_cents,
    customId: q.id,
    description: `Deposit — ${q.service_title}`,
    requestId: intent === "CAPTURE" ? `deposit-${q.id}` : `deposit-${q.id}-authorize`,
    intent,
    returnUrl: `${quote_url}?paypal=return`,
    cancelUrl: `${quote_url}?paypal=cancel`,
    ...(sellerRow?.name ? { brandName: String(sellerRow.name) } : {}),
  });

  const { error } = await db()
    .from("payments")
    .insert({
      quote_id: q.id,
      kind: "deposit",
      amount_cents: q.deposit_cents,
      status: "CREATED",
      paypal_order_id: order.id,
      intent,
      fingerprint: orderFingerprint({
        quote_id: q.id,
        kind: "deposit",
        amount_cents: q.deposit_cents,
        currency: "USD",
        intent,
      }),
    });
  if (error) throw new HttpError(error.message, 500);

  await pushEvent({
    quote_id: q.id,
    seller_id: q.seller_id,
    actor: "system",
    kind: "tool_call",
    tool: "paypal.orders.create",
    input: { amount: q.deposit_cents / 100, currency: "USD", intent, priced_from: "signed quote" },
    output: {
      id: order.id,
      status: order.status,
      fingerprint: "stored (HMAC: quote+amount+currency+intent)",
    },
    text:
      intent === "AUTHORIZE"
        ? `Deposit order created with intent=AUTHORIZE — funds are held on approval and captured when work starts`
        : null,
  });

  return {
    order_id: order.id,
    quote_url,
    intent,
    ...(order.approveUrl ? { approve_url: order.approveUrl } : {}),
  };
}

/** Flip a deposit to paid once PayPal has confirmed the capture. Idempotent. */
async function markDepositPaid(
  q: QuoteRow,
  paymentId: string,
  order_id: string,
  captureId: string | undefined,
  via: "capture_api" | "webhook",
): Promise<Quote> {
  const now = new Date().toISOString();
  const { error: pErr } = await db()
    .from("payments")
    .update({
      status: "COMPLETED",
      updated_at: now,
      // Only set when known — a concurrent webhook with undefined must not wipe a prior id.
      ...(captureId ? { paypal_capture_id: captureId } : {}),
    })
    .eq("id", paymentId);
  if (pErr) throw new HttpError(pErr.message, 500);

  const { data: updated, error: qErr } = await db()
    .from("quotes")
    .update({ status: "deposit_paid", updated_at: now, deposit_paid_at: q.deposit_paid_at ?? now })
    .eq("id", q.id)
    .select("*")
    .single();
  if (qErr) throw new HttpError(qErr.message, 500);

  await pushEvent({
    quote_id: q.id,
    seller_id: q.seller_id,
    actor: "paypal",
    kind: "webhook",
    tool: "PAYMENT.CAPTURE.COMPLETED",
    output: {
      order_id,
      capture_id: captureId,
      amount: q.deposit_cents / 100,
      verified_via: via,
    },
    text: "Deposit captured — work can start",
  });

  return mapQuote(updated as QuoteRow);
}

/** Buyer approved an intent=AUTHORIZE deposit: hold funds, flip quote to deposit_paid (held). Idempotent. */
async function markDepositAuthorized(
  q: QuoteRow,
  paymentId: string,
  order_id: string,
  authorizationId: string,
  via: "authorize_api" | "webhook",
  expiresAt?: string,
): Promise<Quote> {
  const now = new Date().toISOString();
  const { error: pErr } = await db()
    .from("payments")
    .update({ status: "AUTHORIZED", paypal_authorization_id: authorizationId, updated_at: now })
    .eq("id", paymentId);
  if (pErr) throw new HttpError(pErr.message, 500);
  const { data: updated, error: qErr } = await db()
    .from("quotes")
    .update({ status: "deposit_paid", updated_at: now, deposit_paid_at: q.deposit_paid_at ?? now })
    .eq("id", q.id)
    .select("*")
    .single();
  if (qErr) throw new HttpError(qErr.message, 500);
  await pushEvent({
    quote_id: q.id,
    seller_id: q.seller_id,
    actor: "paypal",
    kind: "webhook",
    tool: "PAYMENT.AUTHORIZATION.CREATED",
    output: {
      order_id,
      authorization_id: authorizationId,
      amount: q.deposit_cents / 100,
      verified_via: via,
      ...(expiresAt ? { expires_at: expiresAt } : {}),
    },
    text: "Deposit authorized — PayPal is holding the funds; captured when work starts",
  });
  return mapQuote(updated as QuoteRow);
}

async function authorizeDeposit(q: QuoteRow, p: Payment, order_id: string): Promise<Quote> {
  await verifyOrderBeforeMoney(q, p, order_id, "AUTHORIZE", "paypal.orders.authorize");
  let res: Awaited<ReturnType<typeof paypal.authorizeOrder>>;
  try {
    res = await paypal.authorizeOrder(order_id, `authorize-${order_id}`);
  } catch (e) {
    const o = await paypal.getOrder(order_id).catch(() => null);
    if (o?.authorizationId) {
      const fresh = await getQuoteRow(q.id);
      if (fresh.status !== "quoted") return mapQuote(fresh);
      return markDepositAuthorized(q, p.id, order_id, o.authorizationId, "authorize_api");
    }
    throw e;
  }
  if (!res.authorizationId || (res.authorizationStatus && res.authorizationStatus !== "CREATED")) {
    throw new HttpError(
      `PayPal authorization status is ${res.authorizationStatus ?? res.status}`,
      502,
    );
  }
  if (res.customId && res.customId !== q.id) {
    throw new HttpError("PayPal order does not match this quote", 400);
  }
  if (res.amountCents !== undefined && res.amountCents !== q.deposit_cents) {
    throw new HttpError("Authorized amount does not match deposit", 400);
  }
  await pushEvent({
    quote_id: q.id,
    seller_id: q.seller_id,
    actor: "system",
    kind: "tool_call",
    tool: "paypal.orders.authorize",
    input: { order_id },
    output: { authorization_id: res.authorizationId, status: res.authorizationStatus },
  });
  return markDepositAuthorized(
    q,
    p.id,
    order_id,
    res.authorizationId,
    "authorize_api",
    res.expiresAt,
  );
}

/**
 * Capture a held (AUTHORIZED) deposit — the seller starts work. Idempotent.
 * Called explicitly ("Start work") or automatically before the balance invoice.
 */
async function captureHeldDepositRow(
  q: QuoteRow,
  reason: "start_work" | "deliver",
): Promise<boolean> {
  const pays = await paymentsFor(q.id);
  const dep = pays.find((p) => p.kind === "deposit" && p.status === "AUTHORIZED");
  if (!dep?.paypal_authorization_id) return false;
  if (dep.paypal_order_id) {
    await verifyOrderBeforeMoney(
      q,
      dep,
      dep.paypal_order_id,
      "AUTHORIZE",
      "paypal.authorizations.capture",
    );
  }
  const cap = await paypal.captureAuthorization({
    authorizationId: dep.paypal_authorization_id,
    requestId: `capture-auth-${dep.paypal_authorization_id}`,
  });
  if (cap.status !== "COMPLETED" && cap.status !== "PENDING") {
    throw new HttpError(`PayPal authorization capture status is ${cap.status}`, 502);
  }
  const now = new Date().toISOString();
  await db()
    .from("payments")
    .update({ status: "COMPLETED", paypal_capture_id: cap.id, updated_at: now })
    .eq("id", dep.id);
  await pushEvent({
    quote_id: q.id,
    seller_id: q.seller_id,
    actor: "paypal",
    kind: "tool_call",
    tool: "paypal.authorizations.capture",
    input: { authorization_id: dep.paypal_authorization_id, final_capture: true },
    output: { capture_id: cap.id, status: cap.status, amount: q.deposit_cents / 100 },
    text:
      reason === "start_work"
        ? "Work started — held deposit captured on PayPal"
        : "Held deposit captured on PayPal before the balance invoice",
  });
  return true;
}

export async function startWork(id: string, request?: Request): Promise<QuoteDetail> {
  const { quote: q } = await assertOwnsQuote(request, id);
  if (q.status !== "deposit_paid") {
    throw new HttpError(
      q.status === "quoted" ? "The client hasn't approved the deposit yet" : "Work already started",
      400,
    );
  }
  const captured = await captureHeldDepositRow(q, "start_work");
  if (!q.work_started_at) {
    await db().from("quotes").update({ work_started_at: new Date().toISOString() }).eq("id", id);
  }
  if (!captured) {
    await pushEvent({
      quote_id: id,
      seller_id: q.seller_id,
      actor: "system",
      kind: "decision",
      text: "Deposit was already captured — nothing held to capture",
    });
  }
  return detail(id);
}

/**
 * Returning client with a Vault-saved PayPal (via mandate): merchant-initiated deposit capture.
 * Amount always comes from the quote (catalog), never from the caller.
 */
export async function payDepositWithVault(id: string, vaultId: string): Promise<Quote> {
  const q = await getQuoteRow(id);
  if (q.status !== "quoted") throw new HttpError("Deposit already handled or quote cancelled", 400);
  if (q.deposit_cents <= 0) throw new HttpError("This quote has no deposit to pay", 400);
  await assertQuoteIntegrity(q, "paypal.orders.create(vault_id)");
  const order = await paypal.createVaultedCaptureOrder({
    amountCents: q.deposit_cents,
    customId: q.id,
    description: `Deposit — ${q.service_title}`,
    vaultId,
    requestId: `deposit-vault-${q.id}`,
  });
  let captureId = order.captureId;
  if (order.status === "APPROVED" || order.status === "CREATED") {
    const c = await paypal.captureOrder(order.id, `capture-${order.id}`);
    if (c.status !== "COMPLETED") throw new HttpError(`PayPal capture status is ${c.status}`, 502);
    captureId = c.captureId;
  } else if (order.status !== "COMPLETED") {
    throw new HttpError(`PayPal vaulted order status is ${order.status}`, 502);
  }
  if (order.amountCents !== undefined && order.amountCents !== q.deposit_cents) {
    throw new HttpError("Captured amount does not match deposit", 400);
  }
  const { data: pay, error } = await db()
    .from("payments")
    .insert({
      quote_id: q.id,
      kind: "deposit",
      amount_cents: q.deposit_cents,
      status: "CREATED",
      paypal_order_id: order.id,
      intent: "CAPTURE",
      fingerprint: orderFingerprint({
        quote_id: q.id,
        kind: "deposit",
        amount_cents: q.deposit_cents,
        currency: "USD",
        intent: "CAPTURE",
      }),
    })
    .select("id")
    .single();
  if (error) throw new HttpError(error.message, 500);
  await pushEvent({
    quote_id: q.id,
    seller_id: q.seller_id,
    actor: "client_agent",
    kind: "tool_call",
    tool: "paypal.orders.create(vault_id)",
    input: { amount: q.deposit_cents / 100, payment_source: "paypal.vault_id", intent: "CAPTURE" },
    output: { id: order.id, status: order.status, capture_id: captureId },
    text: "Returning client paid the deposit with PayPal saved in Vault (inside the mandate limit)",
  });
  return markDepositPaid(q, (pay as { id: string }).id, order.id, captureId, "capture_api");
}

export async function captureDeposit(id: string, order_id: string): Promise<Quote> {
  const q = await getQuoteRow(id);
  const pays = await paymentsFor(id);
  const p = pays.find((x) => x.kind === "deposit" && x.paypal_order_id === order_id);
  if (!p) throw new HttpError("PayPal order not found for this quote", 404);
  if (p.status === "COMPLETED" || p.status === "AUTHORIZED") return mapQuote(q);
  if (p.intent === "AUTHORIZE") {
    if (q.status !== "quoted") {
      throw new HttpError(
        q.status === "cancelled" ? "This quote was cancelled" : "Deposit already handled",
        400,
      );
    }
    return authorizeDeposit(q, p, order_id);
  }
  if (q.status !== "quoted") {
    throw new HttpError(
      q.status === "cancelled" ? "This quote was cancelled" : "Deposit already handled",
      400,
    );
  }

  await verifyOrderBeforeMoney(q, p, order_id, "CAPTURE", "paypal.orders.capture");
  let captured: Awaited<ReturnType<typeof paypal.captureOrder>>;
  try {
    captured = await paypal.captureOrder(order_id, `capture-${order_id}`);
  } catch (e) {
    // A webhook (or another tab) may have captured it first — re-read PayPal before failing.
    const o = await paypal.getOrder(order_id).catch(() => null);
    if (o?.status === "COMPLETED") {
      const fresh = await getQuoteRow(id);
      if (fresh.status !== "quoted") return mapQuote(fresh);
      return markDepositPaid(q, p.id, order_id, o.captureId, "capture_api");
    }
    throw e;
  }
  if (captured.status !== "COMPLETED") {
    throw new HttpError(`PayPal capture status is ${captured.status}`, 502);
  }
  if (captured.customId && captured.customId !== id) {
    throw new HttpError("PayPal order does not match this quote", 400);
  }
  if (captured.amountCents !== undefined && captured.amountCents !== q.deposit_cents) {
    throw new HttpError("Captured amount does not match deposit", 400);
  }

  return markDepositPaid(q, p.id, order_id, captured.captureId, "capture_api");
}

type WebhookEvent = {
  id?: string;
  event_type?: string;
  resource_type?: string;
  summary?: string;
  resource?: Record<string, unknown> & {
    id?: string;
    status?: string;
    custom_id?: string;
    invoice?: { id?: string };
    supplementary_data?: { related_ids?: { order_id?: string } };
  };
};

/**
 * POST /api/paypal/webhook — PayPal is the source of truth.
 * 1. Verify the signature with PayPal when PAYPAL_WEBHOOK_ID is set (rejects forgeries).
 * 2. Either way, never trust the payload: re-read the order / invoice from the PayPal API before changing state.
 * 3. Idempotent on PayPal-Transmission-Id via webhook_events.
 */
export async function handlePaypalWebhook(request: Request): Promise<{
  ok: true;
  event_type: string;
  verification: "signature" | "api_reverify";
  handled: string;
  duplicate?: boolean;
}> {
  const raw = await request.text();
  let event: WebhookEvent;
  try {
    event = JSON.parse(raw) as WebhookEvent;
  } catch {
    throw new HttpError("Invalid webhook JSON", 400);
  }
  const event_type = String(event.event_type ?? "");
  if (!event_type) throw new HttpError("Missing event_type", 400);

  const webhookId = paypalWebhookId();
  let verification: "signature" | "api_reverify" = "api_reverify";
  if (webhookId) {
    const required = [
      "paypal-transmission-id",
      "paypal-transmission-sig",
      "paypal-transmission-time",
      "paypal-cert-url",
      "paypal-auth-algo",
    ];
    if (required.some((h) => !request.headers.get(h))) {
      throw new HttpError("Missing PayPal webhook signature headers", 401);
    }
    const status = await paypal
      .verifyWebhookSignature({ webhookId, headers: request.headers, event })
      .catch(() => "FAILURE");
    if (status !== "SUCCESS") {
      throw new HttpError("PayPal webhook signature verification failed", 401);
    }
    verification = "signature";
  }

  const transmissionId =
    request.headers.get("paypal-transmission-id") ?? (event.id ? `event:${event.id}` : null);
  if (transmissionId) {
    const { error } = await db()
      .from("webhook_events")
      .insert({
        paypal_transmission_id: transmissionId,
        event_type,
        payload: event as unknown as Record<string, unknown>,
      });
    if (error && /duplicate|unique/i.test(error.message)) {
      return { ok: true, event_type, verification, handled: "duplicate", duplicate: true };
    }
  }

  let handled = "ignored";
  const r = event.resource ?? {};
  try {
    if (
      event_type === "CHECKOUT.ORDER.APPROVED" ||
      event_type === "PAYMENT.CAPTURE.COMPLETED" ||
      event_type === "PAYMENT.AUTHORIZATION.CREATED"
    ) {
      const orderId =
        event_type === "CHECKOUT.ORDER.APPROVED"
          ? r.id
          : r.supplementary_data?.related_ids?.order_id;
      if (orderId) {
        const { data: pay } = await db()
          .from("payments")
          .select("*")
          .eq("paypal_order_id", orderId)
          .maybeSingle();
        const payStatus = (pay as PaymentRow | null)?.status;
        if (pay && payStatus === "AUTHORIZED" && event_type === "PAYMENT.CAPTURE.COMPLETED") {
          // Held deposit captured outside the desk (e.g. PayPal dashboard) — re-read and sync.
          const payment = pay as PaymentRow;
          const order = await paypal.getOrder(orderId);
          if (order.captureId) {
            await db()
              .from("payments")
              .update({
                status: "COMPLETED",
                paypal_capture_id: order.captureId,
                updated_at: new Date().toISOString(),
              })
              .eq("id", payment.id);
            handled = "held_deposit_captured";
          } else {
            handled = "authorization_still_held";
          }
        } else if (pay && payStatus !== "COMPLETED" && payStatus !== "AUTHORIZED") {
          const payment = pay as PaymentRow;
          const q = await getQuoteRow(payment.quote_id);
          if (q.status === "quoted") {
            const order = await paypal.getOrder(orderId);
            if (order.customId && order.customId !== q.id) {
              handled = "order_mismatch";
            } else if (order.status === "APPROVED") {
              await captureDeposit(q.id, orderId);
              handled =
                payment.intent === "AUTHORIZE"
                  ? "authorized_from_webhook"
                  : "captured_from_webhook";
            } else if (order.status === "COMPLETED" && order.authorizationId && !order.captureId) {
              await markDepositAuthorized(q, payment.id, orderId, order.authorizationId, "webhook");
              handled = "deposit_marked_authorized";
            } else if (order.status === "COMPLETED") {
              const captureFromEvent =
                event_type === "PAYMENT.CAPTURE.COMPLETED" && typeof r.id === "string"
                  ? r.id
                  : undefined;
              await markDepositPaid(
                q,
                payment.id,
                orderId,
                order.captureId ?? captureFromEvent,
                "webhook",
              );
              handled = "deposit_marked_paid";
            } else {
              handled = `order_status_${order.status}`;
            }
          } else {
            handled = "already_handled";
          }
        } else {
          handled = pay ? `already_${String(payStatus).toLowerCase()}` : "unknown_order";
        }
      }
    } else if (event_type.startsWith("INVOICING.INVOICE.")) {
      const invoiceId = r.invoice?.id ?? r.id;
      if (invoiceId) {
        const { data: pay } = await db()
          .from("payments")
          .select("*")
          .eq("paypal_invoice_id", invoiceId)
          .maybeSingle();
        if (pay) {
          // refreshInvoiceStatus re-reads the invoice from PayPal — the payload alone never marks paid.
          await refreshInvoiceStatus((pay as PaymentRow).quote_id);
          handled = "invoice_refreshed";
        } else {
          handled = "unknown_invoice";
        }
      }
    }
  } finally {
    if (transmissionId) {
      await db()
        .from("webhook_events")
        .update({ processed_at: new Date().toISOString() })
        .eq("paypal_transmission_id", transmissionId);
    }
  }

  return { ok: true, event_type, verification, handled };
}

export async function deliver(id: string, request?: Request): Promise<QuoteDetail> {
  const { quote: q } = await assertOwnsQuote(request, id);
  if (q.status !== "deposit_paid" && q.status !== "delivered") {
    throw new HttpError(
      q.status === "quoted"
        ? "The client hasn't paid the deposit yet"
        : "This booking has already been invoiced",
      400,
    );
  }
  const pays = await paymentsFor(id);
  if (pays.some((p) => p.kind === "balance")) {
    throw new HttpError("A balance invoice already exists for this booking", 400);
  }
  // AUTHORIZE deposits: never invoice the balance while the deposit is still only held.
  await captureHeldDepositRow(q, "deliver");

  // Log "Marked delivered" only once the bill actually goes out (or the booking closes);
  // a PayPal failure must not leave a phantom delivered event on the timeline.
  const markDelivered = () =>
    pushEvent({
      quote_id: id,
      seller_id: q.seller_id,
      actor: "seller",
      kind: "approval",
      text: "Marked delivered",
    });

  const now = new Date().toISOString();
  const tip = q.tip_cents ?? 0;
  const bill = finalBill(q.balance_cents, tip);
  if (bill.total_cents <= 0) {
    await markDelivered();
    await db().from("quotes").update({ status: "paid", updated_at: now }).eq("id", id);
    await pushEvent({
      quote_id: id,
      seller_id: q.seller_id,
      actor: "system",
      kind: "decision",
      text: "Deposit covered the full price — no balance invoice needed. Booking closed.",
    });
    return detail(id);
  }

  const { data: sellerRow } = await db()
    .from("sellers")
    .select("name")
    .eq("id", q.seller_id)
    .maybeSingle();
  const invoiceNumber = `SR-${q.id.replace(/-/g, "").slice(0, 12).toUpperCase()}`;
  const inv = await paypal.createAndSendInvoice({
    ...(sellerRow?.name ? { businessName: String(sellerRow.name) } : {}),
    // Balance line + tip line; if the deposit covered the price, the tip is the only line.
    amountCents: q.balance_cents > 0 ? q.balance_cents : tip,
    recipientEmail: q.client_email,
    recipientName: q.client_name,
    itemName: q.balance_cents > 0 ? `${q.service_title} — balance` : "Tip — thank you",
    extraItems:
      tip > 0 && q.balance_cents > 0 ? [{ name: "Tip — thank you", amountCents: tip }] : [],
    allowTip: true,
    note: `Final bill for ${q.service_title}. Quote ${q.id}.${tip > 0 ? ` Includes your ${money(tip)} tip — thank you!` : ""}`,
    invoiceNumber,
    requestId: `invoice-${invoiceNumber}`,
  });
  await markDelivered();

  const { error: pErr } = await db()
    .from("payments")
    .insert({
      quote_id: id,
      kind: "balance",
      amount_cents: bill.total_cents,
      status: "UNPAID",
      paypal_invoice_id: inv.invoiceId,
      invoice_url: inv.href ?? null,
    });
  if (pErr) throw new HttpError(pErr.message, 500);

  await db().from("quotes").update({ status: "balance_invoiced", updated_at: now }).eq("id", id);

  await pushEvent({
    quote_id: id,
    seller_id: q.seller_id,
    actor: "seller_agent",
    kind: "tool_call",
    tool: "paypal.create_and_send_invoice",
    input: {
      lines: bill.lines.map((l) => ({ label: l.label, amount: l.amount_cents / 100 })),
      amount: bill.total_cents / 100,
      recipient: q.client_email,
      allow_tip: inv.allowTip,
    },
    output: { invoice_id: inv.invoiceId, status: inv.status, invoice_url: inv.href ?? null },
    text:
      tip > 0
        ? `Final bill ${money(bill.total_cents)} (balance ${money(q.balance_cents)} + tip ${money(tip)}) sent to ${q.client_email}`
        : `Balance invoice for ${money(q.balance_cents)} sent to ${q.client_email}`,
  });

  return detail(id);
}

/** Refresh balance invoice status from PayPal; mark paid when PAID/MARKED_AS_PAID/PAYMENT_PENDING→PAID. */
export async function refreshInvoiceStatus(id: string): Promise<QuoteDetail> {
  const q = await getQuoteRow(id);
  const pays = await paymentsFor(id);
  const bal = pays.find((p) => p.kind === "balance" && p.paypal_invoice_id);
  if (!bal?.paypal_invoice_id) {
    await pushEvent({
      quote_id: id,
      seller_id: q.seller_id,
      actor: "system",
      kind: "decision",
      text: "Checked PayPal — no balance invoice on this booking yet",
    });
    return detail(id);
  }

  const inv = await paypal.getInvoice(bal.paypal_invoice_id);
  await pushEvent({
    quote_id: id,
    seller_id: q.seller_id,
    actor: "paypal",
    kind: "tool_call",
    tool: "paypal.get_invoice",
    input: { id: bal.paypal_invoice_id },
    output: { status: inv.status },
  });

  const paidStatuses = new Set(["PAID", "MARKED_AS_PAID", "PAYMENT_COMPLETED"]);
  if (paidStatuses.has(inv.status) && bal.status !== "PAID") {
    const now = new Date().toISOString();
    await db()
      .from("payments")
      .update({
        status: "PAID",
        updated_at: now,
        ...(inv.href ? { invoice_url: inv.href } : {}),
      })
      .eq("id", bal.id);
    await db().from("quotes").update({ status: "paid", updated_at: now }).eq("id", id);
    await pushEvent({
      quote_id: id,
      seller_id: q.seller_id,
      actor: "paypal",
      kind: "webhook",
      tool: "INVOICING.INVOICE.PAID",
      output: { invoice_id: bal.paypal_invoice_id, amount: bal.amount_cents / 100 },
      text: "Balance paid in full",
    });
    // Propose thank-you
    await db()
      .from("proposals")
      .insert({
        quote_id: id,
        client_name: q.client_name,
        action: "thank_and_close",
        reason: "PayPal reports the invoice as paid",
        evidence: `Invoice ${bal.paypal_invoice_id} status ${inv.status}`,
        draft_message: `Hi ${q.client_name.split(" ")[0] ?? q.client_name}, thanks so much for settling the balance on ${q.service_title}! It was a pleasure working with you.\n\n— Maya`,
        status: "pending",
      });
  } else if (inv.href && inv.href !== bal.invoice_url) {
    await db().from("payments").update({ invoice_url: inv.href }).eq("id", bal.id);
  }

  return detail(id);
}

export async function cancelQuote(
  id: string,
  request?: Request,
  body: { reason?: unknown } = {},
): Promise<QuoteDetail> {
  const { quote: q } = await assertOwnsQuote(request, id);
  const reason: CancelReason = CANCEL_REASONS.includes(body.reason as CancelReason)
    ? (body.reason as CancelReason)
    : "client_cancel";
  if (!["quoted", "deposit_paid", "delivered"].includes(q.status)) {
    throw new HttpError(
      q.status === "balance_invoiced" || q.status === "paid"
        ? "Cancel is only available before the final bill is sent. Refund the balance in PayPal if needed."
        : "This booking is already cancelled.",
      400,
    );
  }
  const pays = await paymentsFor(id);
  const deposit =
    pays.find(
      (p) => p.kind === "deposit" && (p.status === "COMPLETED" || p.status === "AUTHORIZED"),
    ) ?? null;
  const now = new Date().toISOString();
  const policy = normalizePolicy(q.cancel_policy ?? null);
  const deposit_state: DepositState = !deposit
    ? "none"
    : deposit.status === "AUTHORIZED"
      ? "held"
      : "captured";
  const work_started =
    !!q.work_started_at ||
    q.status === "delivered" ||
    (deposit?.intent === "AUTHORIZE" && deposit.status === "COMPLETED");
  const decision = decideCancel({
    policy,
    reason,
    deposit_cents: deposit?.amount_cents ?? 0,
    deposit_state,
    deposit_paid_at: q.deposit_paid_at ?? deposit?.updated_at ?? null,
    work_started,
  });

  await pushEvent({
    quote_id: id,
    seller_id: q.seller_id,
    actor: "system",
    kind: "decision",
    tool: `cancel_policy.${decision.rule}`,
    input: { reason, deposit_state, work_started, policy },
    output: {
      action: decision.action,
      keep: decision.keep_cents / 100,
      release: decision.release_cents / 100,
    },
    text: `Policy rule fired: ${decision.rule.replace(/_/g, " ")} — ${decision.explanation}`,
  });

  const voidOpenOrders = async () => {
    for (const p of pays) {
      if (p.status === "CREATED") {
        await db().from("payments").update({ status: "VOIDED", updated_at: now }).eq("id", p.id);
      }
    }
  };
  const closeQuote = async (tool: string, text: string, output?: unknown) => {
    await db().from("quotes").update({ status: "cancelled", updated_at: now }).eq("id", id);
    await pushEvent({
      quote_id: id,
      seller_id: q.seller_id,
      actor: "seller",
      kind: "approval",
      tool,
      ...(output ? { output } : {}),
      text,
    });
    return detail(id);
  };

  if (decision.action === "cancel_only" || !deposit) {
    await voidOpenOrders();
    return closeQuote("booking.cancel", "Quote cancelled");
  }

  const dep = deposit;
  // ---- Held deposit: void, or capture the kept share (final_capture releases the rest).
  if (decision.action === "void" && dep.paypal_authorization_id) {
    await paypal.voidAuthorization(
      dep.paypal_authorization_id,
      `void-${dep.paypal_authorization_id}`,
    );
    await db()
      .from("payments")
      .update({
        status: "VOIDED",
        kept_cents: 0,
        refunded_cents: dep.amount_cents,
        updated_at: now,
      })
      .eq("id", dep.id);
    await pushEvent({
      quote_id: id,
      seller_id: q.seller_id,
      actor: "paypal",
      kind: "tool_call",
      tool: "paypal.authorizations.void",
      input: { authorization_id: dep.paypal_authorization_id },
      output: { status: "VOIDED" },
      text: "Held deposit voided on PayPal — the client was never charged",
    });
    return closeQuote("booking.cancel_void", "Booking cancelled — held deposit released");
  }
  if (
    (decision.action === "capture_full" || decision.action === "capture_partial") &&
    dep.paypal_authorization_id
  ) {
    if (dep.paypal_order_id) {
      await verifyOrderBeforeMoney(
        q,
        dep,
        dep.paypal_order_id,
        "AUTHORIZE",
        "paypal.authorizations.capture",
      );
    }
    const cap = await paypal.captureAuthorization({
      authorizationId: dep.paypal_authorization_id,
      requestId: `cancel-capture-${dep.paypal_authorization_id}`,
      finalCapture: true,
      ...(decision.action === "capture_partial" ? { amountCents: decision.keep_cents } : {}),
      noteToPayer: `Cancellation fee per ${q.service_title} booking policy`,
    });
    await db()
      .from("payments")
      .update({
        status: decision.action === "capture_full" ? "COMPLETED" : "PARTIALLY_CAPTURED",
        paypal_capture_id: cap.id,
        kept_cents: decision.keep_cents,
        refunded_cents: decision.release_cents,
        updated_at: now,
      })
      .eq("id", dep.id);
    await pushEvent({
      quote_id: id,
      seller_id: q.seller_id,
      actor: "paypal",
      kind: "tool_call",
      tool: "paypal.authorizations.capture",
      input: {
        authorization_id: dep.paypal_authorization_id,
        amount: decision.keep_cents / 100,
        final_capture: true,
      },
      output: { capture_id: cap.id, status: cap.status },
      text:
        decision.release_cents > 0
          ? `Captured ${money(decision.keep_cents)} cancellation fee; PayPal released the remaining ${money(decision.release_cents)}`
          : `Captured the full ${money(decision.keep_cents)} hold per policy`,
    });
    return closeQuote(
      "booking.cancel_policy_capture",
      `Booking cancelled — ${decision.explanation}`,
      {
        kept: decision.keep_cents / 100,
        released: decision.release_cents / 100,
      },
    );
  }

  // ---- Captured deposit: refund all / part, or keep it.
  if (decision.action === "keep_full") {
    await db()
      .from("payments")
      .update({ kept_cents: dep.amount_cents, refunded_cents: 0, updated_at: now })
      .eq("id", dep.id);
    return closeQuote("booking.cancel_keep", `Booking cancelled — ${decision.explanation}`, {
      kept: dep.amount_cents / 100,
    });
  }
  // Recover capture id if a prior capture/webhook race wiped it from the payment row.
  let captureId = dep.paypal_capture_id ?? null;
  if (!captureId && dep.paypal_order_id) {
    const order = await paypal.getOrder(dep.paypal_order_id).catch(() => null);
    if (order?.captureId) {
      captureId = order.captureId;
      await db()
        .from("payments")
        .update({ paypal_capture_id: captureId, updated_at: now })
        .eq("id", dep.id);
      await pushEvent({
        quote_id: id,
        seller_id: q.seller_id,
        actor: "system",
        kind: "decision",
        tool: "paypal.capture_id.recovered",
        input: { order_id: dep.paypal_order_id },
        output: { capture_id: captureId },
        text: "Recovered PayPal capture id from the order before refund",
      });
    }
  }
  if (!captureId) {
    throw new HttpError("No PayPal capture on this deposit to refund", 400);
  }
  const partial = decision.action === "refund_partial";
  const refundCents = decision.release_cents;
  let refundId: string | undefined;
  let refundStatus: string | undefined;
  let toolkitTrace: Awaited<ReturnType<typeof toolkitCreateRefund>>["trace"] | null = null;
  const note = partial
    ? `ServiceReady booking ${id} cancelled — ${money(refundCents)} refunded per cancellation policy`
    : `ServiceReady booking ${id} cancelled — deposit refunded`;
  try {
    const r = await toolkitCreateRefund({
      captureId,
      noteToPayer: note,
      ...(partial ? { amountCents: refundCents } : {}),
    });
    refundId = r.refundId;
    refundStatus = r.status;
    toolkitTrace = r.trace;
  } catch {
    const r = await paypal.refundCapture({
      captureId,
      requestId: `refund-${id}-${captureId}-${refundCents}`,
      noteToPayer: note,
      ...(partial ? { amountCents: refundCents } : {}),
    });
    refundId = r.id;
    refundStatus = r.status;
    await pushEvent({
      quote_id: id,
      seller_id: q.seller_id,
      actor: "paypal",
      kind: "tool_call",
      tool: "paypal.payments.refund",
      input: { capture_id: captureId, amount: refundCents / 100 },
      output: { refund_id: r.id, status: r.status },
      text: `${partial ? `Refunded ${money(refundCents)}` : "Deposit refunded"} via Payments v2 (${r.status})`,
    });
  }
  if (toolkitTrace) {
    await pushEvent({
      quote_id: id,
      seller_id: q.seller_id,
      actor: "paypal",
      kind: "tool_call",
      tool: toolkitTrace.tool,
      input: toolkitTrace.input,
      output: toolkitTrace.output,
      text: `${partial ? `Refunded ${money(refundCents)}` : "Deposit refunded"} via PayPal Agent Toolkit create_refund (${refundStatus ?? "ok"})`,
    });
  }
  await db()
    .from("payments")
    .update({
      status: partial ? "PARTIALLY_REFUNDED" : "REFUNDED",
      kept_cents: decision.keep_cents,
      refunded_cents: refundCents,
      updated_at: now,
    })
    .eq("id", dep.id);
  return closeQuote(
    partial ? "booking.cancel_partial_refund" : "booking.cancel_refund",
    partial
      ? `Booking cancelled — ${decision.explanation}`
      : "Booking cancelled — deposit refunded on PayPal evidence",
    {
      refund_id: refundId,
      capture_id: captureId,
      status: refundStatus,
      refunded: refundCents / 100,
    },
  );
}

export async function postReply(
  id: string,
  body: { text: string; from: "client" | "seller" },
): Promise<{ reply: Reply; agent_run: AgentRun | null }> {
  const text = (body.text ?? "").trim();
  if (!text) throw new HttpError("Message cannot be empty", 400);
  if (text.length > 4000) throw new HttpError("Message is too long", 400);
  await getQuoteRow(id);
  const { data, error } = await db()
    .from("replies")
    .insert({ quote_id: id, from_party: body.from, text })
    .select("*")
    .single();
  if (error) throw new HttpError(error.message, 500);
  const reply = mapReply(data as ReplyRow);
  // Lightweight: if client claims paid, run a collections check
  let agent_run: AgentRun | null = null;
  if (body.from === "client" && /paid|payment|sent|transferred/i.test(text)) {
    agent_run = await runCollections(id, text);
  }
  return { reply, agent_run };
}

export async function runCollections(
  id: string,
  trigger?: string,
  request?: Request,
): Promise<AgentRun> {
  const q = bearerToken(request)
    ? (await assertOwnsQuote(request, id)).quote
    : await getQuoteRow(id);
  const pays = await paymentsFor(id);
  const bal = pays.find((p) => p.kind === "balance");
  const steps: AgentEvent[] = [];
  let proposal: Proposal | null = null;
  let summary: string;

  const log = async (partial: Parameters<typeof pushEvent>[0]) => {
    const e = await pushEvent(partial);
    steps.push(e);
    return e;
  };

  if (q.status === "cancelled") {
    summary = "This booking is cancelled — nothing to collect.";
    await log({
      quote_id: id,
      seller_id: q.seller_id,
      actor: "collections_agent",
      kind: "decision",
      text: summary,
    });
  } else if (!bal) {
    summary = "No balance invoice yet. Mark the work delivered to send one.";
    await log({
      quote_id: id,
      seller_id: q.seller_id,
      actor: "collections_agent",
      kind: "decision",
      text: summary,
    });
  } else if (bal.status === "PAID" || q.status === "paid") {
    summary = "Invoice is paid. Propose a thank-you.";
    await log({
      quote_id: id,
      seller_id: q.seller_id,
      actor: "collections_agent",
      kind: "decision",
      text: summary,
    });
    const { data } = await db()
      .from("proposals")
      .insert({
        quote_id: id,
        client_name: q.client_name,
        action: "thank_and_close",
        reason: "Balance is paid",
        evidence: `Payment ${bal.id} status ${bal.status}`,
        draft_message: `Hi ${q.client_name.split(" ")[0] ?? q.client_name}, thanks for paying the balance on ${q.service_title}!\n\n— Maya`,
        status: "pending",
      })
      .select("*")
      .single();
    if (data) proposal = mapProposal(data as ProposalRow);
  } else {
    // Refresh from PayPal via official Agent Toolkit (visible tool traces).
    try {
      if (bal.paypal_invoice_id) {
        let status = "UNKNOWN";
        try {
          const inv = await toolkitGetInvoice(bal.paypal_invoice_id);
          status = inv.status;
          await log({
            quote_id: id,
            seller_id: q.seller_id,
            actor: "collections_agent",
            kind: "tool_call",
            tool: inv.trace.tool,
            input: inv.trace.input,
            output: inv.trace.output,
            text: `PayPal Agent Toolkit get_invoice → ${status}`,
          });
        } catch (toolkitErr) {
          const inv = await paypal.getInvoice(bal.paypal_invoice_id);
          status = inv.status;
          await log({
            quote_id: id,
            seller_id: q.seller_id,
            actor: "collections_agent",
            kind: "tool_call",
            tool: "paypal.get_invoice",
            input: { id: bal.paypal_invoice_id },
            output: { status: inv.status, fallback: true },
            text: `PayPal get_invoice fallback → ${status}`,
          });
          void toolkitErr;
        }
        // Also confirm any deposit order still matches PayPal evidence.
        const dep = pays.find((p) => p.kind === "deposit" && p.paypal_order_id);
        if (dep?.paypal_order_id) {
          try {
            const ord = await toolkitGetOrder(dep.paypal_order_id);
            await log({
              quote_id: id,
              seller_id: q.seller_id,
              actor: "collections_agent",
              kind: "tool_call",
              tool: ord.trace.tool,
              input: ord.trace.input,
              output: ord.trace.output,
              text: `PayPal Agent Toolkit get_order → ${ord.status}`,
            });
          } catch {
            /* non-fatal */
          }
        }
        if (["PAID", "MARKED_AS_PAID", "PAYMENT_COMPLETED"].includes(status)) {
          await refreshInvoiceStatus(id);
          return runCollections(id, trigger);
        }
      }
    } catch (e) {
      await log({
        quote_id: id,
        seller_id: q.seller_id,
        actor: "collections_agent",
        kind: "decision",
        text: `Could not refresh PayPal invoice: ${e instanceof Error ? e.message : "error"}`,
      });
    }

    const claimsPaid = !!trigger && /paid|payment|sent|transferred/i.test(trigger);
    const first = q.client_name.split(" ")[0] ?? q.client_name;
    const sellerRes = await db().from("sellers").select("*").eq("id", q.seller_id).maybeSingle();
    if (sellerRes.error) throw new HttpError(sellerRes.error.message, 500);
    const sellerRow = (sellerRes.data as SellerRow | null) ?? (await demoSeller());
    const tone = sellerRow.reminder_tone;
    // Deterministic risk → tone hint (warm / firm / final). Seller rules stay the base voice.
    const [{ data: clientQuotes }, { count: remindersSent }] = await Promise.all([
      db()
        .from("quotes")
        .select("id, client_email, status, updated_at")
        .eq("seller_id", q.seller_id)
        .ilike("client_email", q.client_email),
      db()
        .from("proposals")
        .select("id", { count: "exact", head: true })
        .eq("quote_id", id)
        .eq("action", "send_reminder")
        .eq("status", "executed"),
    ]);
    const daysOver = Math.max(
      0,
      Math.floor((Date.now() - new Date(bal.updated_at).getTime()) / 864e5),
    );
    const risk = collectionsRisk({
      outstanding_cents: bal.amount_cents,
      days_overdue: daysOver,
      history: historyFor(
        (clientQuotes ?? []) as Array<Pick<Quote, "id" | "client_email" | "status" | "updated_at">>,
        q.client_email,
        id,
      ),
      reminders_sent: remindersSent ?? 0,
    });
    await log({
      quote_id: id,
      seller_id: q.seller_id,
      actor: "collections_agent",
      kind: "tool_call",
      tool: "collections.risk_score",
      input: {
        outstanding: bal.amount_cents / 100,
        days_overdue: daysOver,
        reminders_sent: remindersSent ?? 0,
      },
      output: risk,
      text: `Risk ${risk.score}/100 (${risk.band}) → ${risk.tone} reminder tone${risk.factors.length ? ` · ${risk.factors.join(", ")}` : ""}`,
    });
    const toneLine =
      risk.tone === "final"
        ? "This is a final reminder for"
        : risk.tone === "firm"
          ? "A quick note that the invoice is now overdue for"
          : "Just a gentle reminder about";
    let draft = claimsPaid
      ? `Hi ${first}, thank you! I just checked and PayPal still shows the ${money(bal.amount_cents)} invoice as open on my side — sometimes the payment doesn't complete the last step. Here's the link again: ${bal.invoice_url}\n\nNo rush at all!\n\n— Maya`
      : risk.tone === "warm"
        ? `Hi ${first}, hope you're enjoying the new ${q.service_title.toLowerCase()}! Just a gentle reminder that the ${money(bal.amount_cents)} balance is open whenever you're ready: ${bal.invoice_url}\n\nThanks so much, Maya`
        : `Hi ${first}, ${toneLine.charAt(0).toLowerCase()}${toneLine.slice(1)} the ${money(bal.amount_cents)} balance on ${q.service_title} (sent ${daysOver} day${daysOver === 1 ? "" : "s"} ago). You can pay it here: ${bal.invoice_url}\n\n${risk.tone === "final" ? "Please settle it this week, or reply if something's holding it up so we can sort it out." : "Could you take care of it in the next few days?"}\n\nThanks, Maya`;
    summary = claimsPaid
      ? "Client claims paid but PayPal still shows open — propose a gentle nudge with the invoice link."
      : `Balance still unpaid — propose a ${risk.tone} reminder (risk ${risk.score}/100).`;

    if (hasLlm()) {
      try {
        const ReminderSchema = z.object({
          draft_message: z.string().min(20).max(2000),
          summary: z.string().min(8).max(280),
        });
        const llmDraft = await chatJson(
          [
            {
              role: "system",
              content: `You draft a short client email for a freelance collections agent.
Base voice: ${tone}. Risk-based tone for this reminder: ${risk.tone} — ${TONE_GUIDE[risk.tone]} (risk ${risk.score}/100). Seller signs as Maya. PayPal is the source of truth — never trust client payment claims over an unpaid invoice.
Return JSON: {"draft_message":"...","summary":"one-line agent decision for the human approver"}.
Include the invoice URL verbatim. Keep under 1200 characters. No subject line.`,
            },
            {
              role: "user",
              content: JSON.stringify({
                client_first: first,
                service_title: q.service_title,
                amount: money(bal.amount_cents),
                invoice_url: bal.invoice_url,
                paypal_invoice_id: bal.paypal_invoice_id,
                invoice_status: bal.status,
                client_said: trigger ?? null,
                claims_paid_but_paypal_open: claimsPaid,
              }),
            },
          ],
          ReminderSchema,
          { temperature: 0.4 },
        );
        draft = llmDraft.draft_message.trim();
        if (!bal.invoice_url || draft.includes(bal.invoice_url ?? "")) {
          // ok
        } else if (bal.invoice_url) {
          draft = `${draft.trim()}\n\nInvoice: ${bal.invoice_url}`;
        }
        summary = llmDraft.summary.trim();
        const disc = llmDisclosure();
        await log({
          quote_id: id,
          seller_id: q.seller_id,
          actor: "collections_agent",
          kind: "tool_call",
          tool: "llm.draft_reminder",
          input: {
            tone,
            risk_tone: risk.tone,
            risk_score: risk.score,
            claims_paid_but_paypal_open: claimsPaid,
          },
          output: { provider: disc?.provider, model: disc?.model, chars: draft.length },
        });
      } catch {
        // keep heuristic draft
      }
    }

    await log({
      quote_id: id,
      seller_id: q.seller_id,
      actor: "collections_agent",
      kind: "decision",
      text: summary,
    });
    const { data } = await db()
      .from("proposals")
      .insert({
        quote_id: id,
        client_name: q.client_name,
        action: "send_reminder",
        reason: summary,
        evidence: claimsPaid
          ? `Client said: "${trigger}" — PayPal still UNPAID`
          : `Invoice ${bal.paypal_invoice_id} status ${bal.status}`,
        draft_message: draft,
        status: "pending",
      })
      .select("*")
      .single();
    if (data) proposal = mapProposal(data as ProposalRow);
  }

  return {
    id: `run_${id}_${Date.now().toString(36)}`,
    quote_id: id,
    summary,
    steps,
    proposal,
  };
}

export async function listProposals(status?: string, request?: Request): Promise<Proposal[]> {
  const seller = await sellerFromRequest(request);
  // Join via quotes belonging to seller
  const { data: quotes, error: qErr } = await db()
    .from("quotes")
    .select("id")
    .eq("seller_id", seller.id);
  if (qErr) throw new HttpError(qErr.message, 500);
  const ids = (quotes ?? []).map((q: { id: string }) => q.id);
  if (!ids.length) return [];
  let query = db().from("proposals").select("*").in("quote_id", ids).order("created_at", {
    ascending: false,
  });
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw new HttpError(error.message, 500);
  return (data as ProposalRow[]).map(mapProposal);
}

export async function approveProposal(
  id: string,
  draft_message: string,
  request?: Request,
): Promise<Proposal> {
  const { data: prop, error } = await db().from("proposals").select("*").eq("id", id).maybeSingle();
  if (error) throw new HttpError(error.message, 500);
  if (!prop) throw new HttpError("Proposal not found", 404);
  const p = prop as ProposalRow;
  if (p.status !== "pending") throw new HttpError("Proposal is no longer pending", 400);

  const { quote: q } = await assertOwnsQuote(request, p.quote_id);
  const pays = await paymentsFor(p.quote_id);
  const bal = pays.find((x) => x.kind === "balance");

  // Human gate: only after approval do we call Agent Toolkit send_invoice_reminder.
  if (p.action === "send_reminder" && bal?.paypal_invoice_id) {
    try {
      let reminded = false;
      try {
        const trace = await toolkitSendInvoiceReminder({
          invoiceId: bal.paypal_invoice_id,
          subject: "Reminder from ServiceReady",
          note: draft_message,
        });
        await pushEvent({
          quote_id: p.quote_id,
          seller_id: q.seller_id,
          actor: "seller",
          kind: "approval",
          tool: trace.tool,
          input: trace.input,
          output: trace.output,
          text: "Reminder approved — sent via PayPal Agent Toolkit send_invoice_reminder",
        });
        reminded = true;
      } catch {
        await paypal.remindInvoice(
          bal.paypal_invoice_id,
          "Reminder from ServiceReady",
          draft_message,
          `remind-${p.id}`,
        );
        await pushEvent({
          quote_id: p.quote_id,
          seller_id: q.seller_id,
          actor: "seller",
          kind: "approval",
          tool: "paypal.invoicing.remind",
          input: { invoice_id: bal.paypal_invoice_id, fallback: true },
          text: "Reminder approved and sent via PayPal Invoicing remind (fallback)",
        });
        reminded = true;
      }
      void reminded;
    } catch (e) {
      await db()
        .from("proposals")
        .update({ status: "failed", draft_message, updated_at: new Date().toISOString() })
        .eq("id", id);
      throw e;
    }
  } else {
    await pushEvent({
      quote_id: p.quote_id,
      seller_id: q.seller_id,
      actor: "seller",
      kind: "approval",
      text: `Approved: ${p.action}`,
    });
  }

  const { data: updated, error: uErr } = await db()
    .from("proposals")
    .update({
      status: "executed",
      draft_message,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();
  if (uErr) throw new HttpError(uErr.message, 500);
  return mapProposal(updated as ProposalRow);
}

export async function rejectProposal(id: string, request?: Request): Promise<Proposal> {
  const { data: prop, error: pErr } = await db()
    .from("proposals")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (pErr) throw new HttpError(pErr.message, 500);
  if (!prop) throw new HttpError("Proposal not found", 404);
  await assertOwnsQuote(request, (prop as ProposalRow).quote_id);

  const { data, error } = await db()
    .from("proposals")
    .update({ status: "rejected", updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw new HttpError(error.message, 500);
  if (!data) throw new HttpError("Proposal not found", 404);
  return mapProposal(data as ProposalRow);
}

export async function listEvents(actor?: string, request?: Request): Promise<AgentEvent[]> {
  const seller = await sellerFromRequest(request);
  let query = db()
    .from("agent_events")
    .select("*")
    .eq("seller_id", seller.id)
    .order("created_at", { ascending: false })
    .limit(200);
  // Also include events with null seller_id linked to seller quotes — keep simple: seller_id match OR quote in seller quotes
  if (actor) query = query.eq("actor", actor);
  const { data, error } = await query;
  if (error) throw new HttpError(error.message, 500);
  // Merge quote-linked events without seller_id
  const { data: quotes } = await db().from("quotes").select("id").eq("seller_id", seller.id);
  const qids = (quotes ?? []).map((q: { id: string }) => q.id);
  let extra: EventRow[] = [];
  if (qids.length) {
    let q2 = db()
      .from("agent_events")
      .select("*")
      .in("quote_id", qids)
      .is("seller_id", null)
      .order("created_at", { ascending: false })
      .limit(200);
    if (actor) q2 = q2.eq("actor", actor);
    const { data: d2 } = await q2;
    extra = (d2 as EventRow[]) ?? [];
  }
  const all = [...((data as EventRow[]) ?? []), ...extra];
  const seen = new Set<string>();
  const merged: AgentEvent[] = [];
  for (const e of all.sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    merged.push(mapEvent(e));
  }
  return merged.slice(0, 200);
}

/** GET /api/health — what the live deploy is actually wired to (never returns secrets). */
export async function health() {
  const out: Record<string, unknown> = { ok: true, time: new Date().toISOString() };
  try {
    const cfg = await paypal.getPublicClientId();
    out["paypal"] = {
      configured: true,
      env: cfg.env,
      webhook_signature_verification: Boolean(paypalWebhookId()),
    };
  } catch {
    out["paypal"] = { configured: false };
    out["ok"] = false;
  }
  const disc = llmDisclosure();
  out["ai"] = disc
    ? { configured: true, ...disc }
    : { configured: false, mode: "heuristic fallback" };
  try {
    const { error } = await db().from("sellers").select("id").eq("slug", DEMO_SLUG).maybeSingle();
    out["supabase"] = { configured: true, reachable: !error };
    if (error) out["ok"] = false;
  } catch {
    out["supabase"] = { configured: false };
    out["ok"] = false;
  }
  out["mcp"] = { endpoint: `/mcp/${DEMO_SLUG}`, transport: "streamable-http (JSON-RPC 2.0)" };
  out["features"] = {
    deposit_intents: ["CAPTURE", "AUTHORIZE"],
    deposit_authorize_min_usd: authorizeMinDepositCents() / 100,
    paypal_js_sdk: "v6 (v5 Buttons fallback)",
    vault_returning_client: "mandate-bound PayPal Vault v3 (MCP save_paypal_for_mandate)",
    money_guardrails: "agents cannot set amounts (rejected + audited)",
    collections_risk: "deterministic score → warm/firm/final tone",
    catalog_cache_ttl_ms: CATALOG_TTL_MS,
    cancel_policy_engine:
      "deterministic free-window / late-cancel / no-show → void, partial capture or refund",
    final_bill_tip: "client tip line on the Invoicing v2 final bill (+ allow_tip)",
    tamper_proofing:
      "HMAC-signed quote amounts + order fingerprint re-checked against PayPal before capture",
    idempotency: "PayPal-Request-Id on every money write",
    webhook_fallback: "Check PayPal re-reads open orders/invoices",
    venmo_paylater: "JS SDK enable-funding=venmo,paylater (eligible buyers)",
    dispute_evidence: "GET /api/quotes/:id/evidence → JSON + Markdown pack",
    payouts: "POST /api/quotes/:id/payout → PayPal Payouts sandbox tip-out",
    agent_discovery: "/.well-known/agent-card.json + /llms.txt",
  };
  return out;
}

export async function getStats(request?: Request): Promise<Stats> {
  const quotes = await listQuotes(request);
  const by_status = {
    quoted: 0,
    deposit_paid: 0,
    delivered: 0,
    balance_invoiced: 0,
    paid: 0,
    cancelled: 0,
  } as Record<QuoteStatus, number>;
  let deposits_collected_cents = 0;
  let outstanding_cents = 0;
  let paid_cents = 0;
  const owed_by_client: Stats["owed_by_client"] = [];
  const daysToPay: number[] = [];

  // One payments query for the whole desk instead of one per booking.
  const payByQuote = new Map<string, Payment[]>();
  if (quotes.length) {
    const { data: payRows, error: payErr } = await db()
      .from("payments")
      .select("*")
      .in(
        "quote_id",
        quotes.map((q) => q.id),
      )
      .order("created_at", { ascending: true });
    if (payErr) throw new HttpError(payErr.message, 500);
    for (const r of (payRows ?? []) as PaymentRow[]) {
      const list = payByQuote.get(r.quote_id) ?? [];
      list.push(mapPayment(r));
      payByQuote.set(r.quote_id, list);
    }
  }
  for (const q of quotes) {
    by_status[q.status] = (by_status[q.status] ?? 0) + 1;
    const pays = payByQuote.get(q.id) ?? [];
    const dep = pays.find((p) => p.kind === "deposit" && p.status === "COMPLETED");
    if (dep) deposits_collected_cents += dep.amount_cents;
    const bal = pays.find((p) => p.kind === "balance");
    if (bal?.status === "PAID") {
      paid_cents += bal.amount_cents + (dep?.amount_cents ?? 0);
      const d = (new Date(bal.updated_at).getTime() - new Date(q.created_at).getTime()) / 864e5;
      if (Number.isFinite(d) && d >= 0) daysToPay.push(d);
    } else if (q.status === "paid") paid_cents += q.total_cents;
    if (bal && bal.status !== "PAID" && q.status === "balance_invoiced") {
      outstanding_cents += bal.amount_cents;
      const days = Math.max(
        0,
        Math.floor((Date.now() - new Date(bal.updated_at).getTime()) / 864e5),
      );
      owed_by_client.push({
        client_name: q.client_name,
        quote_id: q.id,
        outstanding_cents: bal.amount_cents,
        days_since_invoice: days,
        risk: collectionsRisk({
          outstanding_cents: bal.amount_cents,
          days_overdue: days,
          history: historyFor(quotes, q.client_email, q.id),
        }),
      });
    }
  }

  return {
    deposits_collected_cents,
    outstanding_cents,
    paid_cents,
    avg_days_to_pay: daysToPay.length
      ? Math.round((daysToPay.reduce((a, b) => a + b, 0) / daysToPay.length) * 10) / 10
      : null,
    by_status,
    owed_by_client: owed_by_client.sort((a, b) => b.days_since_invoice - a.days_since_invoice),
  };
}

/** Heuristic catalog parse — used when no LLM key is set, or as LLM fallback. */
function parseCatalogHeuristic(
  raw_text: string,
  default_deposit_pct: number,
): { services: ServiceDraft[]; flags: Flag[] } {
  const text = (raw_text ?? "").trim();
  const chunks = text
    .split(/\n+|[|;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const services: ServiceDraft[] = [];
  const flags: Flag[] = [];
  let i = 0;
  for (const chunk of chunks) {
    const moneyMatch = chunk.match(/\$?\s*([\d,]+(?:\.\d{1,2})?)\s*(k)?/i);
    const pct = chunk.match(/(\d{1,3})\s*%/);
    const days = chunk.match(/(\d+)\s*(?:day|days|d)\b/i);
    if (!moneyMatch && !/[a-zA-Z]{3,}/.test(chunk)) continue;
    const title =
      chunk
        .replace(/\$[\d,.]+k?/gi, "")
        .replace(/\d{1,3}\s*%/g, "")
        .replace(/\d+\s*(?:day|days|d)\b/gi, "")
        .replace(/[-–—:]+/g, " ")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 80) || `Service ${++i}`;
    let price = 0;
    if (moneyMatch) {
      price = Math.round(
        parseFloat(moneyMatch[1]!.replace(/,/g, "")) * (moneyMatch[2] ? 1000 : 1) * 100,
      );
    }
    const tmp_id = `tmp_${Date.now().toString(36)}_${i++}`;
    const deposit_pct = pct ? Math.min(100, parseInt(pct[1]!, 10)) : default_deposit_pct;
    services.push({
      tmp_id,
      title,
      description: chunk.slice(0, 280),
      deliverables: [],
      price_cents: price,
      deposit_pct,
      lead_time_days: days ? parseInt(days[1]!, 10) : 7,
    });
    if (price <= 0) {
      flags.push({
        tmp_id,
        field: "price_cents",
        severity: "error",
        message: "Could not find a price — set one before publishing",
      });
    }
  }
  for (const e of catalogErrors(services)) flags.push(e);
  if (!services.length) {
    flags.push({
      tmp_id: "tmp",
      field: "raw_text",
      severity: "error",
      message: "Couldn't extract any services — try one service per line with a price",
    });
  }
  return { services, flags };
}

const CatalogLlmSchema = z.object({
  services: z.array(
    z.object({
      title: z.string(),
      description: z.string().optional().default(""),
      deliverables: z.array(z.string()).optional().default([]),
      price_usd: z.number().optional(),
      price_cents: z.number().int().optional(),
      deposit_pct: z.number().int().optional(),
      lead_time_days: z.number().int().nullable().optional(),
    }),
  ),
  notes: z.array(z.string()).optional().default([]),
});

export async function parseCatalog(
  raw_text: string,
  request?: Request,
): Promise<{
  services: ServiceDraft[];
  flags: Flag[];
}> {
  const text = (raw_text ?? "").trim();
  if (!text) throw new HttpError("Paste a rate card first", 400);
  let defaultDeposit = 30;
  try {
    if (bearerToken(request)) {
      defaultDeposit = (await sellerFromRequest(request)).default_deposit_pct;
    }
  } catch {
    /* public parse path keeps 30% default */
  }

  if (hasLlm()) {
    try {
      const parsed = await chatJson(
        [
          {
            role: "system",
            content: `You extract freelance service offerings from messy rate cards.
Return JSON: {"services":[{"title","description","deliverables":[],"price_usd" OR "price_cents","deposit_pct","lead_time_days"}],"notes":[]}
Rules:
- One service per distinct offering. Titles ≤80 chars. Descriptions ≤280 chars.
- Prefer price_usd as a number (e.g. 1200 for $1,200). price_cents is also fine.
- deposit_pct is 1-100 integer; default ${defaultDeposit} if unspecified.
- lead_time_days integer days; default 7 if unspecified.
- deliverables: short bullet strings (≤12).
- notes: human-readable warnings (missing price, ambiguous lines).
Return JSON only.`,
          },
          { role: "user", content: text.slice(0, 8000) },
        ],
        CatalogLlmSchema,
        { temperature: 0.1 },
      );

      const services: ServiceDraft[] = [];
      const flags: Flag[] = [];
      let i = 0;
      for (const s of parsed.services) {
        const tmp_id = `tmp_${Date.now().toString(36)}_${i++}`;
        let price_cents = 0;
        if (typeof s.price_cents === "number" && Number.isFinite(s.price_cents)) {
          price_cents = Math.round(s.price_cents);
        } else if (typeof s.price_usd === "number" && Number.isFinite(s.price_usd)) {
          price_cents = Math.round(s.price_usd * 100);
        }
        const deposit_pct =
          typeof s.deposit_pct === "number" && s.deposit_pct >= 1 && s.deposit_pct <= 100
            ? s.deposit_pct
            : defaultDeposit;
        const lead =
          typeof s.lead_time_days === "number" && s.lead_time_days > 0 ? s.lead_time_days : 7;
        services.push({
          tmp_id,
          title: (s.title || `Service ${i}`).trim().slice(0, 80),
          description: (s.description ?? "").trim().slice(0, 280),
          deliverables: (s.deliverables ?? [])
            .map((d) => d.trim())
            .filter(Boolean)
            .slice(0, 12),
          price_cents,
          deposit_pct,
          lead_time_days: lead,
        });
        if (price_cents <= 0) {
          flags.push({
            tmp_id,
            field: "price_cents",
            severity: "error",
            message: "Could not find a price — set one before publishing",
          });
        }
      }
      for (const note of parsed.notes ?? []) {
        flags.push({
          tmp_id: services[0]?.tmp_id ?? "tmp",
          field: "raw_text",
          severity: "warning",
          message: note.slice(0, 200),
        });
      }
      for (const e of catalogErrors(services)) flags.push(e);
      if (!services.length) {
        flags.push({
          tmp_id: "tmp",
          field: "raw_text",
          severity: "error",
          message: "Couldn't extract any services — try one service per line with a price",
        });
      }
      return { services, flags };
    } catch (e) {
      // Fall through to heuristics on any LLM failure
      if (!(e instanceof LlmError)) {
        // still fall back
      }
    }
  }

  return parseCatalogHeuristic(text, defaultDeposit);
}

export async function publishCatalog(
  services: ServiceDraft[],
  request?: Request,
): Promise<Service[]> {
  invalidateCatalogCache();
  for (const d of services) {
    const errs = draftErrors(d);
    if (errs.length) throw new HttpError(errs[0]!.message, 400);
  }
  const seller = await sellerFromRequest(request);
  // Soft-archive existing published by setting draft, then insert new published
  await db()
    .from("services")
    .update({ status: "draft", updated_at: new Date().toISOString() })
    .eq("seller_id", seller.id)
    .eq("status", "published");

  const rows = services.map((d) => ({
    seller_id: seller.id,
    title: d.title.trim(),
    description: (d.description ?? "").trim(),
    deliverables: (d.deliverables ?? []).map((x) => x.trim()).filter(Boolean),
    price_cents: d.price_cents,
    deposit_pct: d.deposit_pct,
    lead_time_days: d.lead_time_days ?? 7,
    status: "published" as const,
    image_url: d.image_url?.trim() || null,
  }));
  const { data, error } = await db().from("services").insert(rows).select("*");
  if (error) throw new HttpError(error.message, 500);
  invalidateCatalogCache();
  return (data as ServiceRow[]).map(mapService);
}

const AGENT_TOOLS = [
  "get_service",
  "request_quote",
  "get_quote_status",
  "get_cancellation_policy",
] as const;
type AgentTool = (typeof AGENT_TOOLS)[number];

const AgentPlanSchema = z.object({
  reply: z.string(),
  actions: z
    .array(
      z
        .object({
          // Lenient: models sometimes write "request_quote(...)" or obsolete "list_services".
          // Unknown tools are dropped below — never fail the whole plan (that caused quote loops).
          tool: z.string().transform(
            (t) =>
              t
                .trim()
                .match(/^[a-z_]+/i)?.[0]
                ?.toLowerCase() ?? "",
          ),
          service_id: z.string().optional(),
          quote_id: z.string().optional(),
          client_name: z.string().optional(),
          client_email: z.string().optional(),
          brief: z.string().optional(),
        })
        // keep unknown keys so the money guardrail can see (and reject) price overrides
        .passthrough(),
    )
    .default([])
    .transform((actions) =>
      actions.filter((a): a is typeof a & { tool: AgentTool } =>
        (AGENT_TOOLS as readonly string[]).includes(a.tool),
      ),
    ),
});

/** Deterministic client-facing quote summary — amounts copied from the catalog-built quote, never the model. */
function quoteReply(created: Quote, svc: Service, sellerName: string): string {
  const held = created.deposit_intent === "AUTHORIZE";
  return `I've requested a quote for **${svc.title}** from ${sellerName}.\n\n- Total: **${money(created.total_cents)}**\n- Deposit due now: **${money(created.deposit_cents)}** (${svc.deposit_pct}%)${held ? " — PayPal holds it and it's only captured when work starts" : ""}\n- Balance on delivery: ${money(created.balance_cents)}\n- Turnaround: ~${svc.lead_time_days} days\n- Quote reference: **${created.id}**\n- Cancellation: ${describeCancelPolicy(created.cancel_policy ?? normalizePolicy(null))}\n\nPay the deposit with PayPal using the button below to confirm.`;
}


/** Resolve a catalog service by id, exact title, or distinctive title words (models often pass the title). */
function resolveCatalogService(
  services: Service[],
  serviceIdOrTitle: string | undefined | null,
): Service | undefined {
  const raw = (serviceIdOrTitle ?? "").trim();
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  return (
    services.find((s) => s.id === raw) ??
    services.find((s) => s.title.toLowerCase() === lower) ??
    services.find((s) => s.title.toLowerCase().includes(lower) || lower.includes(s.title.toLowerCase())) ??
    services.find((s) =>
      s.title
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 3)
        .some((w) => lower.includes(w)),
    )
  );
}

/** Pull name / email / matched service / brief from the whole conversation (not just the last turn). */
function extractBookingIntent(
  messages: ChatMsg[],
  services: Service[],
): {
  email?: string;
  name?: string;
  service?: Service;
  brief: string;
  complete: boolean;
} {
  const blob = messages.map((m) => m.content).join("\n");
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const emailMatch = blob.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const email = emailMatch?.[0]?.trim();
  const nameMatch =
    blob.match(/(?:i'?m|i am|my name is|name\s*[:\-])\s*([A-Z][A-Za-z0-9.'\-]+(?:\s+[A-Z][A-Za-z0-9.'\-]+)?)/i) ??
    lastUser.match(/^([A-Z][A-Za-z0-9.'\-]+(?:\s+[A-Z][A-Za-z0-9.'\-]+)?)\s*[\/|,]/) ??
    lastUser.match(/^([A-Z][A-Za-z0-9.'\-]+(?:\s+[A-Z][A-Za-z0-9.'\-]+)?)\s+[A-Z0-9._%+-]+@/i);
  let name = nameMatch?.[1]?.trim();
  if (name && email && name.toLowerCase() === email.toLowerCase()) name = undefined;
  if (!name && email) name = email.split("@")[0];

  const hay = blob.toLowerCase();
  // Prefer longer / more specific title matches so "WhatsApp Stories" beats "WhatsApp Reels".
  const ranked = [...services]
    .map((s) => {
      const title = s.title.toLowerCase();
      const words = title.split(/[^a-z0-9]+/).filter((w) => w.length > 3);
      const hit = title.length > 3 && hay.includes(title)
        ? title.length + 20
        : words.filter((w) => hay.includes(w)).reduce((n, w) => n + w.length, 0);
      return { s, hit };
    })
    .filter((x) => x.hit > 0)
    .sort((a, b) => b.hit - a.hit);
  const service = ranked[0]?.s;
  const brief = (lastUser || blob).slice(0, 500);
  const complete = Boolean(service && email && isEmail(email) && (name || email));
  return {
    ...(email ? { email } : {}),
    ...(name ? { name } : {}),
    ...(service ? { service } : {}),
    brief,
    complete,
  };
}

const POLICY_Q = /\b(cancel|cancellation|refund|no[- ]?show|reschedul|policy|money back)/i;
function policyReply(store: PublicStore): string {
  const p = store.cancel_policy;
  return p
    ? `**${store.seller.name} cancellation policy** (enforced automatically on PayPal):\n\n- Free cancellation within **${p.free_cancel_hours}h** of paying the deposit, before work starts\n- Later cancellation: **${p.late_cancel_keep_pct}%** of the deposit is kept\n- No-show: **${p.no_show_keep_pct}%** of the deposit is kept\n- If the seller cancels, the deposit is always fully released\n\nHeld deposits are voided or partially captured; paid deposits are refunded via PayPal.`
    : "This seller hasn't published a cancellation policy yet.";
}

/** Deterministic storefront agent — used when no LLM key is set. */
export type AgentEngine =
  { kind: "llm"; provider: string; model: string } | { kind: "heuristic"; reason: string };
type AgentChatResult = {
  messages: ChatMsg[];
  tool_calls: ToolTrace[];
  quote: Quote | null;
  engine: AgentEngine;
};

async function agentChatHeuristic(
  slug: string,
  messages: ChatMsg[],
  reason = "no model key configured",
): Promise<AgentChatResult> {
  const store = await getPublic(slug);
  const last = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const tool_calls: ToolTrace[] = [];
  const intent = extractBookingIntent(messages, store.services);
  const firstTurn = messages.filter((m) => m.role === "user").length <= 1;
  const browsing = /\b(what (services|do you offer)|list|catalog|packages|options)\b/i.test(last);

  if (firstTurn || browsing || !intent.service) {
    tool_calls.push({
      tool: "list_services",
      input: { slug },
      output: store.services.map((s) => ({ id: s.id, title: s.title, price_cents: s.price_cents })),
    });
  }

  let quote: Quote | null = null;
  let reply: string;

  if (POLICY_Q.test(last) && !intent.email) {
    tool_calls.push({
      tool: "get_cancellation_policy",
      input: {},
      output: store.cancel_policy ?? null,
    });
    return {
      messages: [...messages, { role: "assistant", content: policyReply(store) }],
      tool_calls,
      quote,
      engine: { kind: "heuristic", reason },
    };
  }
  if (intent.complete && intent.service && intent.email) {
    const created = await postPublicQuote(slug, {
      service_id: intent.service.id,
      client_name: (intent.name ?? intent.email.split("@")[0]!).slice(0, 100),
      client_email: intent.email,
      brief: intent.brief,
      source: "agent_sim",
    });
    tool_calls.push({
      tool: "request_quote",
      input: {
        service_id: intent.service.id,
        client_email: intent.email,
        client_name: intent.name ?? intent.email.split("@")[0],
      },
      output: { quote_id: created.id, deposit_cents: created.deposit_cents },
    });
    quote = created;
    reply = quoteReply(created, intent.service, store.seller.name);
  } else if (intent.service) {
    const match = intent.service;
    tool_calls.push({
      tool: "get_service",
      input: { id: match.id },
      output: match,
    });
    reply = `**${match.title}** — ${money0(match.price_cents)}, ${match.deposit_pct}% deposit, ~${match.lead_time_days} days.\n\n${match.description}${
      match.deliverables.length
        ? `\n\nIncludes:\n${match.deliverables.map((d) => `- ${d}`).join("\n")}`
        : ""
    }\n\nWant me to request a quote? Share your name and email.`;
  } else {
    reply = `${store.seller.name} offers:\n${store.services
      .map((s) => `- **${s.title}** — ${money0(s.price_cents)} (${s.deposit_pct}% deposit)`)
      .join("\n")}\n\nTell me which you need, plus your name and email, and I'll request a quote.`;
  }

  return {
    messages: [...messages, { role: "assistant", content: reply }],
    tool_calls,
    quote,
    engine: { kind: "heuristic", reason },
  };
}

export async function agentChat(
  slug: string,
  messages: ChatMsg[],
  request?: Request,
): Promise<AgentChatResult> {
  if (!hasLlm()) return agentChatHeuristic(slug, messages);

  try {
    const store = await getPublic(slug);
    const catalog = store.services.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      price_cents: s.price_cents,
      deposit_pct: s.deposit_pct,
      lead_time_days: s.lead_time_days,
      deliverables: s.deliverables,
    }));
    const history = messages
      .slice(-6)
      .map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 1200)}`)
      .join("\n");

    // One model round-trip: the model plans tool calls + writes the reply; the server executes the
    // tools and writes any money-bearing text deterministically from real results.
    const plan = await chatJson(
      [
        {
          role: "system",
          content: `Storefront assistant for ${store.seller.name} (${store.seller.tagline}). Deposits are paid with PayPal.
The CATALOG JSON is already injected below — do NOT call list_services (it is not a tool).
Tools (put intended calls in "actions"; the server runs them):
- get_service — fields: service_id (catalog id OR exact title)
- request_quote — fields: service_id, client_name, client_email, brief  ← REQUIRED once you have all four
- get_quote_status — fields: quote_id
- get_cancellation_policy — no fields (cancel / refund / no-show questions)
Action shape: {"tool":"request_quote","service_id":"<catalog id or exact title>","client_name":"...","client_email":"...","brief":"..."}
HARD RULE: If the conversation already has (1) a matching catalog service, (2) a client name, (3) a valid email, and (4) what they need, you MUST put request_quote in actions this turn. Do not ask clarifying questions. Do not list the catalog again. brief = their need in their words.
Never invent or set prices/amounts (the server rejects money fields). Never claim payment succeeded.
When still missing name or email, ask once for the missing field only. Be concise markdown.
Return JSON only: {"reply":"...","actions":[...]}`,
        },
        {
          role: "user",
          content: `CATALOG:\n${JSON.stringify(catalog)}\n\nCANCELLATION POLICY (structured, read-only): ${JSON.stringify(store.cancel_policy ?? null)}\n\nCONVERSATION:\n${history || "(empty)"}`,
        },
      ],
      AgentPlanSchema,
      { temperature: 0.2, timeoutMs: 20_000 },
    );

    const tool_calls: ToolTrace[] = [];
    let quote: Quote | null = null;
    let quoteSvc: Service | null = null;
    const intent = extractBookingIntent(messages, store.services);
    const userTurns = messages.filter((m) => m.role === "user").length;
    const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const browsing = /\b(what (services|do you offer)|list|catalog|packages|options)\b/i.test(
      lastUser,
    );

    // Only surface list_services when browsing / first turn — never every reply (looks like a loop).
    if (userTurns <= 1 || browsing) {
      tool_calls.push({
        tool: "list_services",
        input: { slug, cached: true },
        output: catalog.map((s) => ({ id: s.id, title: s.title, price_cents: s.price_cents })),
      });
    }

    // Money guardrail + dedupe (at most one request_quote per turn).
    const actions: typeof plan.actions = [];
    let quoteRequested = false;
    for (const action of plan.actions) {
      if ((action.tool as string) === "list_services") continue;
      if (action.tool === "get_cancellation_policy") {
        if (!actions.some((a) => a.tool === "get_cancellation_policy")) actions.push(action);
        continue;
      }
      const { tool: _tool, ...rest } = action;
      void _tool;
      const fields = findPriceOverrides(rest);
      if (fields.length) {
        tool_calls.push({
          tool: action.tool,
          input: rest,
          output: { blocked: true, reason: GUARDRAIL_MESSAGE, fields },
        });
        void logGuardrailBlock({ slug, tool: action.tool, fields, actor: "client_agent" });
        continue;
      }
      if (action.tool === "request_quote") {
        if (quoteRequested) continue;
        quoteRequested = true;
      }
      actions.push(action);
    }

    // Deterministic fallback: if the model forgot request_quote but we already have
    // service + name + email (+ brief), mint the quote anyway so the chat cannot loop.
    if (!quoteRequested && intent.complete && intent.service && intent.email) {
      actions.push({
        tool: "request_quote",
        service_id: intent.service.id,
        client_name: intent.name ?? intent.email.split("@")[0],
        client_email: intent.email,
        brief: intent.brief,
      });
      quoteRequested = true;
    }

    // Independent tools run in parallel.
    const results = await Promise.all(
      actions.map(async (action): Promise<ToolTrace> => {
        if (action.tool === "get_cancellation_policy") {
          return {
            tool: "get_cancellation_policy",
            input: {},
            output: store.cancel_policy ?? null,
          };
        }
        if (action.tool === "get_service") {
          const svc = resolveCatalogService(store.services, action.service_id);
          return {
            tool: "get_service",
            input: { id: action.service_id },
            output: svc ?? { error: "not_found" },
          };
        }
        if (action.tool === "request_quote") {
          const svc =
            resolveCatalogService(store.services, action.service_id) ??
            intent.service ??
            undefined;
          const email = (action.client_email ?? intent.email ?? "").trim();
          const name =
            (action.client_name ?? intent.name ?? "").trim() || email.split("@")[0] || "Client";
          if (!svc || !isEmail(email)) {
            return {
              tool: "request_quote",
              input: { service_id: action.service_id, client_email: email },
              output: {
                error: "need published service_id (or title) and valid client_email",
                resolved_service: svc?.title ?? null,
              },
            };
          }
          const created = await postPublicQuote(
            slug,
            {
              service_id: svc.id,
              client_name: name.slice(0, 100),
              client_email: email,
              brief: (action.brief ?? intent.brief ?? messages.at(-1)?.content ?? "").slice(0, 500),
              source: "agent_sim",
            },
            request,
          );
          quote = created;
          quoteSvc = svc;
          return {
            tool: "request_quote",
            input: { service_id: svc.id, client_email: email, client_name: name },
            output: {
              quote_id: created.id,
              service: svc.title,
              total: money(created.total_cents),
              deposit_due_now: money(created.deposit_cents),
              deposit_intent: created.deposit_intent ?? "CAPTURE",
              balance_on_delivery: money(created.balance_cents),
              turnaround_days: svc.lead_time_days,
              priced_from: "catalog",
            },
          };
        }
        // get_quote_status
        if (!action.quote_id) {
          return { tool: "get_quote_status", input: {}, output: { error: "quote_id required" } };
        }
        try {
          const d = await getQuote(action.quote_id);
          return {
            tool: "get_quote_status",
            input: { quote_id: action.quote_id },
            output: {
              id: d.quote.id,
              status: d.quote.status,
              deposit_cents: d.quote.deposit_cents,
              balance_cents: d.quote.balance_cents,
            },
          };
        } catch (err) {
          return {
            tool: "get_quote_status",
            input: { quote_id: action.quote_id },
            output: { error: err instanceof Error ? err.message : "error" },
          };
        }
      }),
    );
    tool_calls.push(...results);

    let reply = plan.reply?.trim() || "How can I help you pick a service?";
    const q = quote as Quote | null;
    const qs = quoteSvc as Service | null;
    if (q && qs) {
      reply = quoteReply(q, qs, store.seller.name);
    } else {
      const status = results.find((t) => t.tool === "get_quote_status")?.output as
        | {
            id?: string;
            status?: string;
            deposit_cents?: number;
            balance_cents?: number;
            error?: string;
          }
        | undefined;
      if (results.some((t) => t.tool === "get_cancellation_policy")) {
        // Policy wording is deterministic — never the model's paraphrase.
        reply = policyReply(store);
      } else if (status?.id && status.status) {
        reply = `Quote **${status.id}** is **${status.status.replace(/_/g, " ")}** (deposit ${money(status.deposit_cents ?? 0)}, balance ${money(status.balance_cents ?? 0)}). Status only changes on PayPal evidence.`;
      }
    }
    const disc = llmDisclosure();
    return {
      messages: [...messages, { role: "assistant", content: reply }],
      tool_calls,
      quote,
      engine: { kind: "llm", provider: disc?.provider ?? "LLM", model: disc?.model ?? "" },
    };
  } catch (e) {
    console.error("[agent] LLM path failed, using heuristics:", e instanceof Error ? e.message : e);
    return agentChatHeuristic(slug, messages, "model call failed — deterministic fallback");
  }
}

async function uploadCoverBytes(
  bytes: Uint8Array,
  contentType: string,
  pathHint: string,
): Promise<string> {
  const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
  const path = `${pathHint.replace(/[^a-zA-Z0-9/_-]+/g, "-").slice(0, 80)}.${ext}`;
  const { error } = await db().storage.from("service-covers").upload(path, bytes, {
    contentType,
    upsert: true,
  });
  if (error) throw new HttpError(`Could not save image: ${error.message}`, 500);
  const { data } = db().storage.from("service-covers").getPublicUrl(path);
  return data.publicUrl;
}

function parseDataUrl(dataUrl: string): { bytes: Uint8Array; contentType: string } {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/i);
  if (!m) throw new HttpError("Invalid image data", 400);
  const contentType = m[1]!.toLowerCase();
  if (!contentType.startsWith("image/")) throw new HttpError("File must be an image", 400);
  const raw = Buffer.from(m[2]!, "base64");
  if (raw.byteLength > 5_000_000) throw new HttpError("Image must be under 5 MB", 400);
  return { bytes: new Uint8Array(raw), contentType };
}

type CoverBrief = { title: string; description: string; deliverables: string[] };

/** Map a service to a concrete, on-topic visual subject for its cover. */
function coverSubject(b: CoverBrief): { subject: string; avoid: string } {
  const hay = `${b.title} ${b.description} ${b.deliverables.join(" ")}`.toLowerCase();
  const has = (...k: string[]) =>
    k.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`).test(hay));
  if (has("logo", "logomark", "monogram", "wordmark"))
    return {
      subject:
        "a logo design presentation: a clean abstract geometric logo mark shown on a branded business card, a sketchbook with pencil logo iterations and a laptop showing vector logo grid construction, on a tidy designer desk",
      avoid: "people's faces, food, landscapes, random products",
    };
  if (
    has(
      "social media",
      "instagram",
      "tiktok",
      "social pack",
      "posts",
      "carousel",
      "reels",
      "linkedin post",
    )
  )
    return {
      subject:
        "a social media content pack: a grid of colourful, cohesive Instagram-style post tiles and story frames displayed on two smartphones and a tablet, flat-lay on a pastel desk",
      avoid: "printed logos of real social networks, landscapes, unrelated objects",
    };
  if (
    has(
      "landing page",
      "website",
      "web design",
      "web page",
      "webflow",
      "wordpress",
      "ui",
      "ux",
      "figma",
      "framer",
    )
  )
    return {
      subject:
        "a modern website / landing page UI mockup with a hero section, feature cards and a call-to-action button, shown on a laptop and a phone side by side, with a Figma-like wireframe layer softly visible",
      avoid: "people, nature scenes, physical products unrelated to the web",
    };
  if (
    has("brand kit", "brand identity", "branding", "brand guide", "style guide", "visual identity")
  )
    return {
      subject:
        "a brand identity kit flat-lay: colour swatch cards, typography specimen sheet, stationery (business cards, letterhead, envelope), a tote bag and packaging all in one cohesive palette",
      avoid: "people, food, landscapes",
    };
  if (has("pitch deck", "presentation", "slides", "deck", "keynote", "investor"))
    return {
      subject:
        "a polished pitch deck: presentation slides with charts and clean layouts shown on a large monitor and laptop in a bright meeting room, printed slide thumbnails on the table",
      avoid: "crowds, landscapes, unrelated products",
    };
  if (has("mobile app", "ios", "android", "app design", "app development"))
    return {
      subject:
        "a mobile app UI shown across three floating smartphone screens with onboarding, dashboard and checkout views",
      avoid: "people, landscapes",
    };
  if (has("video", "video editing", "youtube", "motion", "animation", "reel"))
    return {
      subject:
        "a video editing workstation: timeline with clips and colour grading panels on a wide monitor, camera and headphones on the desk",
      avoid: "real brand logos, landscapes",
    };
  if (has("photo", "photography", "headshot", "product shoot"))
    return {
      subject:
        "a professional photography setup: camera on tripod, softbox lighting and a styled product on a seamless backdrop",
      avoid: "text, unrelated scenes",
    };
  if (has("copywriting", "blog", "content writing", "article", "newsletter", "seo", "copy"))
    return {
      subject:
        "a content writing workspace: laptop with a neatly formatted article draft, notebook with outline, coffee, sticky notes with headline ideas",
      avoid: "people's faces, landscapes",
    };
  if (has("illustration", "drawing", "character", "icon"))
    return {
      subject:
        "an illustrator's desk with a drawing tablet showing colourful vector illustrations and an icon set, printed art proofs around it",
      avoid: "photographs of people, landscapes",
    };
  if (has("packaging", "label", "print", "flyer", "poster", "brochure"))
    return {
      subject:
        "printed design collateral mockups: flyers, poster and packaging boxes arranged on a studio table",
      avoid: "people, landscapes",
    };
  if (has("marketing", "ads", "campaign", "ppc", "email"))
    return {
      subject:
        "a digital marketing dashboard with campaign charts on a laptop, ad creatives and email layouts shown on surrounding screens",
      avoid: "people, landscapes",
    };
  return {
    subject: `a realistic editorial photo that literally shows the "${b.title}" service — either the professional delivering it in a real setting or its finished result / deliverables, chosen to match the description above`,
    avoid: "unrelated subjects, generic office stock photos, abstract wallpaper",
  };
}

export function buildCoverPrompt(b: CoverBrief): string {
  const { subject, avoid } = coverSubject(b);
  const desc = b.description.replace(/\s+/g, " ").trim().slice(0, 320);
  const deliv = b.deliverables.slice(0, 8).join(", ");
  return [
    `Professional portfolio cover photo for a freelancer's service card titled "${b.title}".`,
    desc ? `The service: ${desc}.` : "",
    deliv ? `Deliverables the client receives: ${deliv}.` : "",
    `Show ${subject}.`,
    `The image must clearly depict this specific service and its deliverables so a buyer instantly understands what they get.`,
    `Style: high-end product/mockup photography, soft natural studio light, shallow depth of field, modern neutral background with subtle teal accents, crisp detail, premium marketplace look, 16:9 landscape composition with the subject centred.`,
    `No readable text, no captions, no watermarks, no real brand logos (abstract placeholder marks only).`,
    `Avoid: ${avoid}, cartoonish clip-art, distorted hands, cluttered collage, stock-photo handshakes.`,
  ]
    .filter(Boolean)
    .join(" ");
}

async function xaiImageOnce(key: string, model: string, prompt: string, timeoutMs: number) {
  const body: Record<string, unknown> = {
    model,
    prompt,
    n: 1,
    aspect_ratio: "16:9",
    resolution: "1k",
    response_format: "b64_json",
  };
  if (model === "grok-imagine-image-2.0") body["quality"] = "medium";
  const res = await fetch("https://api.x.ai/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    const err = new HttpError(`Image generation failed (${res.status}): ${t.slice(0, 200)}`, 502);
    (err as HttpError & { retryable?: boolean }).retryable =
      res.status >= 500 || res.status === 429;
    throw err;
  }
  const j = (await res.json()) as { data?: { b64_json?: string; url?: string }[] };
  const item = j.data?.[0];
  if (item?.b64_json) return new Uint8Array(Buffer.from(item.b64_json, "base64"));
  if (item?.url) {
    const img = await fetch(item.url, { signal: AbortSignal.timeout(60_000) });
    if (!img.ok) throw new HttpError("Could not download generated image", 502);
    return new Uint8Array(await img.arrayBuffer());
  }
  throw new HttpError("Image generation returned no image", 502);
}

/** Primary: grok-imagine-image-2.0 (150s). On timeout/5xx/429 retry once with the faster grok-imagine-image (90s). */
async function generateCoverWithGrok(brief: CoverBrief): Promise<Uint8Array> {
  const key = (typeof process !== "undefined" ? process.env?.["XAI_API_KEY"] : undefined)?.trim();
  if (!key) throw new HttpError("Image generation needs XAI_API_KEY on the server", 503);
  const prompt = buildCoverPrompt(brief);
  const started = Date.now();
  try {
    return await xaiImageOnce(key, "grok-imagine-image-2.0", prompt, 150_000);
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    const retryable =
      name === "TimeoutError" ||
      name === "AbortError" ||
      (e as { retryable?: boolean })?.retryable === true ||
      !(e instanceof HttpError);
    console.warn(
      `[cover] primary model failed after ${Date.now() - started}ms (${name}): ${e instanceof Error ? e.message : e}`,
    );
    if (!retryable) throw e;
    try {
      return await xaiImageOnce(key, "grok-imagine-image", prompt, 90_000);
    } catch (e2) {
      const n2 = e2 instanceof Error ? e2.name : "";
      if (n2 === "TimeoutError" || n2 === "AbortError")
        throw new HttpError(
          "The image model is busy right now — please try Generate again in a minute",
          504,
        );
      throw e2;
    }
  }
}

/** Upload or AI-generate a service cover; optionally persist onto an existing service row. */
export async function setServiceImage(
  request: Request,
  body: {
    title?: string;
    description?: string;
    deliverables?: string[];
    data_url?: string;
    mode?: "upload" | "generate" | "clear";
    service_id?: string;
  },
): Promise<{ image_url: string; service?: Service }> {
  invalidateCatalogCache();
  const seller = await sellerFromRequest(request);
  if (body.mode === "clear") {
    if (!body.service_id) return { image_url: "" };
    const { data, error } = await db()
      .from("services")
      .update({ image_url: null, updated_at: new Date().toISOString() })
      .eq("id", body.service_id)
      .eq("seller_id", seller.id)
      .select("*")
      .maybeSingle();
    if (error) throw new HttpError(error.message, 500);
    if (!data) throw new HttpError("Service not found", 404);
    invalidateCatalogCache();
    return { image_url: "", service: mapService(data as ServiceRow) };
  }
  const mode = body.mode === "generate" ? "generate" : "upload";
  let bytes: Uint8Array;
  let contentType = "image/jpeg";
  if (mode === "generate") {
    // Prefer the saved service row (authoritative title/description/deliverables) when we have one.
    let title = (body.title ?? "").trim();
    let description = (body.description ?? "").trim();
    let deliverables = Array.isArray(body.deliverables)
      ? body.deliverables.map((x) => String(x).trim()).filter(Boolean)
      : [];
    if (body.service_id) {
      const { data: row } = await db()
        .from("services")
        .select("*")
        .eq("id", body.service_id)
        .eq("seller_id", seller.id)
        .maybeSingle();
      if (row) {
        const svc = mapService(row as ServiceRow);
        title = title || svc.title;
        description = description || svc.description || "";
        if (!deliverables.length) deliverables = [...svc.deliverables];
      }
    }
    bytes = await generateCoverWithGrok({ title: title || "Service", description, deliverables });
  } else {
    if (!body.data_url) throw new HttpError("Choose an image to upload", 400);
    const parsed = parseDataUrl(body.data_url);
    bytes = parsed.bytes;
    contentType = parsed.contentType;
  }
  const hint = `${seller.id}/${body.service_id || crypto.randomUUID()}-${Date.now()}`;
  const image_url = await uploadCoverBytes(bytes, contentType, hint);

  if (body.service_id) {
    const { data: existing, error: e1 } = await db()
      .from("services")
      .select("*")
      .eq("id", body.service_id)
      .eq("seller_id", seller.id)
      .maybeSingle();
    if (e1) throw new HttpError(e1.message, 500);
    if (!existing) throw new HttpError("Service not found", 404);
    const { data, error } = await db()
      .from("services")
      .update({ image_url, updated_at: new Date().toISOString() })
      .eq("id", body.service_id)
      .eq("seller_id", seller.id)
      .select("*")
      .single();
    if (error) throw new HttpError(error.message, 500);
    invalidateCatalogCache();
    return { image_url, service: mapService(data as ServiceRow) };
  }
  invalidateCatalogCache();
  return { image_url };
}

export async function resetDemo(request?: Request): Promise<{ ok: true }> {
  invalidateCatalogCache();
  const seller = await sellerFromRequest(request);
  if (seller.slug !== DEMO_SLUG) {
    throw new HttpError("Reset demo is only available on the shared judge workspace", 403);
  }
  const { data: quotes } = await db().from("quotes").select("id").eq("seller_id", seller.id);
  const ids = (quotes ?? []).map((q: { id: string }) => q.id);
  if (ids.length) {
    await db().from("payments").delete().in("quote_id", ids);
    await db().from("replies").delete().in("quote_id", ids);
    await db().from("proposals").delete().in("quote_id", ids);
    await db().from("agent_events").delete().in("quote_id", ids);
    await db().from("quotes").delete().in("id", ids);
  }
  await db().from("agent_events").delete().eq("seller_id", seller.id);
  return { ok: true };
}
