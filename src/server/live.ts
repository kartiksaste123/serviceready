/**
 * Supabase-backed live API used by /api/* routes when VITE_USE_MOCKS=false.
 * PayPal Orders + Invoicing are real sandbox calls; AI endpoints reuse
 * deterministic heuristics until an LLM key is wired (see LOVABLE_ENV.md).
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
import { publicOrigin } from "./env";
import { HttpError } from "./http";
import * as paypal from "./paypal";

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
    },
  };
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
  };
}
function mapQuote(r: QuoteRow): Quote {
  const line_items = Array.isArray(r.line_items)
    ? (r.line_items as Quote["line_items"])
    : [];
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
    ...(r.paypal_invoice_id ? { paypal_invoice_id: r.paypal_invoice_id } : {}),
    ...(r.invoice_url ? { invoice_url: r.invoice_url } : {}),
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

async function pushEvent(
  partial: {
    quote_id: string | null;
    seller_id?: string | null;
    actor: AgentEvent["actor"];
    kind: AgentEvent["kind"];
    tool?: string | null;
    input?: unknown;
    output?: unknown;
    text?: string | null;
  },
): Promise<AgentEvent> {
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
    db().from("agent_events").select("*").eq("quote_id", id).order("created_at", { ascending: true }),
    db().from("replies").select("*").eq("quote_id", id).order("created_at", { ascending: true }),
    db().from("proposals").select("*").eq("quote_id", id).order("created_at", { ascending: true }),
  ]);
  if (eventsRes.error) throw new HttpError(eventsRes.error.message, 500);
  if (repliesRes.error) throw new HttpError(repliesRes.error.message, 500);
  if (proposalsRes.error) throw new HttpError(proposalsRes.error.message, 500);
  return {
    quote: mapQuote(q),
    payments,
    events: (eventsRes.data as EventRow[]).map(mapEvent),
    replies: (repliesRes.data as ReplyRow[]).map(mapReply),
    proposals: (proposalsRes.data as ProposalRow[]).map(mapProposal),
  };
}

export async function getSeller(): Promise<Seller> {
  return mapSeller(await demoSeller());
}

export async function putRules(rules: SellerRules): Promise<Seller> {
  const errs = rulesErrors(rules);
  const first = Object.values(errs).find(Boolean);
  if (first) throw new HttpError(String(first), 400);
  const seller = await demoSeller();
  const { data, error } = await db()
    .from("sellers")
    .update({
      default_deposit_pct: rules.default_deposit_pct,
      reminder_tone: rules.reminder_tone,
      max_reminders: rules.max_reminders,
      wait_days_before_nudge: rules.wait_days_before_nudge,
      updated_at: new Date().toISOString(),
    })
    .eq("id", seller.id)
    .select("*")
    .single();
  if (error) throw new HttpError(error.message, 500);
  return mapSeller(data as SellerRow);
}

export async function listServices(): Promise<Service[]> {
  const seller = await demoSeller();
  const { data, error } = await db()
    .from("services")
    .select("*")
    .eq("seller_id", seller.id)
    .order("created_at", { ascending: true });
  if (error) throw new HttpError(error.message, 500);
  return (data as ServiceRow[]).map(mapService);
}

export async function getPublic(slug: string, request?: Request): Promise<PublicStore> {
  const seller = await requireSeller(slug);
  const { data, error } = await db()
    .from("services")
    .select("*")
    .eq("seller_id", seller.id)
    .eq("status", "published")
    .order("created_at", { ascending: true });
  if (error) throw new HttpError(error.message, 500);
  const origin = publicOrigin(request);
  return {
    seller: { name: seller.name, slug: seller.slug, tagline: seller.tagline },
    services: (data as ServiceRow[]).map(mapService),
    agent: {
      mcp_url: `${origin}/mcp/${seller.slug}`,
      webmcp_tools: WEBMCP_TOOLS,
    },
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
    })
    .select("*")
    .single();
  if (error) throw new HttpError(error.message, 500);
  const quote = inserted as QuoteRow;
  const approval_url = `${publicOrigin(request)}/q/${quote.id}`;
  const { data: updated, error: uErr } = await db()
    .from("quotes")
    .update({ approval_url })
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

export async function listQuotes(): Promise<Quote[]> {
  const seller = await demoSeller();
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
    await refreshInvoiceStatus(id);
  }
  return detail(id);
}

export async function paypalConfig() {
  return paypal.getPublicClientId();
}

export async function createDepositOrder(id: string): Promise<{ order_id: string }> {
  const q = await getQuoteRow(id);
  if (q.status === "cancelled") throw new HttpError("This quote was cancelled", 400);
  if (q.status !== "quoted") throw new HttpError("The deposit for this quote is already paid", 400);
  if (q.deposit_cents <= 0) throw new HttpError("This quote has no deposit to pay", 400);

  const pays = await paymentsFor(id);
  const open = pays.find((p) => p.kind === "deposit" && p.status === "CREATED" && p.paypal_order_id);
  if (open?.paypal_order_id) return { order_id: open.paypal_order_id };

  const order = await paypal.createOrder({
    amountCents: q.deposit_cents,
    customId: q.id,
    description: `Deposit — ${q.service_title}`,
    requestId: `deposit-${q.id}`,
  });

  const { error } = await db().from("payments").insert({
    quote_id: q.id,
    kind: "deposit",
    amount_cents: q.deposit_cents,
    status: "CREATED",
    paypal_order_id: order.id,
  });
  if (error) throw new HttpError(error.message, 500);

  await pushEvent({
    quote_id: q.id,
    seller_id: q.seller_id,
    actor: "system",
    kind: "tool_call",
    tool: "paypal.orders.create",
    input: { amount: q.deposit_cents / 100, currency: "USD", intent: "CAPTURE" },
    output: { id: order.id, status: order.status },
  });

  return { order_id: order.id };
}

export async function captureDeposit(id: string, order_id: string): Promise<Quote> {
  const q = await getQuoteRow(id);
  const pays = await paymentsFor(id);
  const p = pays.find((x) => x.kind === "deposit" && x.paypal_order_id === order_id);
  if (!p) throw new HttpError("PayPal order not found for this quote", 404);
  if (p.status === "COMPLETED") return mapQuote(q);
  if (q.status !== "quoted") {
    throw new HttpError(
      q.status === "cancelled" ? "This quote was cancelled" : "Deposit already handled",
      400,
    );
  }

  const captured = await paypal.captureOrder(order_id);
  if (captured.status !== "COMPLETED") {
    throw new HttpError(`PayPal capture status is ${captured.status}`, 502);
  }
  if (captured.customId && captured.customId !== id) {
    throw new HttpError("PayPal order does not match this quote", 400);
  }
  if (
    captured.amountCents !== undefined &&
    captured.amountCents !== q.deposit_cents
  ) {
    throw new HttpError("Captured amount does not match deposit", 400);
  }

  const now = new Date().toISOString();
  const { error: pErr } = await db()
    .from("payments")
    .update({
      status: "COMPLETED",
      paypal_capture_id: captured.captureId ?? null,
      updated_at: now,
    })
    .eq("id", p.id);
  if (pErr) throw new HttpError(pErr.message, 500);

  const { data: updated, error: qErr } = await db()
    .from("quotes")
    .update({ status: "deposit_paid", updated_at: now })
    .eq("id", id)
    .select("*")
    .single();
  if (qErr) throw new HttpError(qErr.message, 500);

  await pushEvent({
    quote_id: id,
    seller_id: q.seller_id,
    actor: "paypal",
    kind: "webhook",
    tool: "PAYMENT.CAPTURE.COMPLETED",
    output: {
      order_id,
      capture_id: captured.captureId,
      amount: q.deposit_cents / 100,
    },
    text: "Deposit captured — work can start",
  });

  return mapQuote(updated as QuoteRow);
}

export async function deliver(id: string): Promise<QuoteDetail> {
  const q = await getQuoteRow(id);
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

  await pushEvent({
    quote_id: id,
    seller_id: q.seller_id,
    actor: "seller",
    kind: "approval",
    text: "Marked delivered",
  });

  const now = new Date().toISOString();
  if (q.balance_cents <= 0) {
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

  const inv = await paypal.createAndSendInvoice({
    amountCents: q.balance_cents,
    recipientEmail: q.client_email,
    recipientName: q.client_name,
    itemName: `${q.service_title} — balance`,
    note: `Balance due for ${q.service_title}. Quote ${q.id}.`,
    invoiceNumber: `SR-${q.id.replace(/-/g, "").slice(0, 12).toUpperCase()}`,
  });

  const { error: pErr } = await db().from("payments").insert({
    quote_id: id,
    kind: "balance",
    amount_cents: q.balance_cents,
    status: "UNPAID",
    paypal_invoice_id: inv.invoiceId,
    invoice_url: inv.href ?? null,
  });
  if (pErr) throw new HttpError(pErr.message, 500);

  await db()
    .from("quotes")
    .update({ status: "balance_invoiced", updated_at: now })
    .eq("id", id);

  await pushEvent({
    quote_id: id,
    seller_id: q.seller_id,
    actor: "seller_agent",
    kind: "tool_call",
    tool: "paypal.create_and_send_invoice",
    input: { amount: q.balance_cents / 100, recipient: q.client_email },
    output: { invoice_id: inv.invoiceId, status: inv.status },
    text: `Balance invoice for ${money(q.balance_cents)} sent to ${q.client_email}`,
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
    await db().from("proposals").insert({
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

export async function cancelQuote(id: string): Promise<QuoteDetail> {
  const q = await getQuoteRow(id);
  if (q.status !== "quoted") {
    throw new HttpError(
      "Only quotes without a paid deposit can be cancelled. Refund the deposit in PayPal first.",
      400,
    );
  }
  const now = new Date().toISOString();
  await db().from("quotes").update({ status: "cancelled", updated_at: now }).eq("id", id);
  const pays = await paymentsFor(id);
  for (const p of pays) {
    if (p.status === "CREATED") {
      await db().from("payments").update({ status: "VOIDED", updated_at: now }).eq("id", p.id);
    }
  }
  await pushEvent({
    quote_id: id,
    seller_id: q.seller_id,
    actor: "seller",
    kind: "approval",
    text: "Quote cancelled",
  });
  return detail(id);
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

export async function runCollections(id: string, trigger?: string): Promise<AgentRun> {
  const q = await getQuoteRow(id);
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
    // Refresh from PayPal first
    try {
      if (bal.paypal_invoice_id) {
        const inv = await paypal.getInvoice(bal.paypal_invoice_id);
        await log({
          quote_id: id,
          seller_id: q.seller_id,
          actor: "collections_agent",
          kind: "tool_call",
          tool: "paypal.get_invoice",
          input: { id: bal.paypal_invoice_id },
          output: { status: inv.status },
        });
        if (["PAID", "MARKED_AS_PAID", "PAYMENT_COMPLETED"].includes(inv.status)) {
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
    const draft = claimsPaid
      ? `Hi ${first}, thank you! I just checked and PayPal still shows the ${money(bal.amount_cents)} invoice as open on my side — sometimes the payment doesn't complete the last step. Here's the link again: ${bal.invoice_url}\n\nNo rush at all!\n\n— Maya`
      : `Hi ${first}, hope you're enjoying the new ${q.service_title.toLowerCase()}! Just a gentle reminder that the ${money(bal.amount_cents)} balance is open whenever you're ready: ${bal.invoice_url}\n\nThanks so much, Maya`;

    summary = claimsPaid
      ? "Client claims paid but PayPal still shows open — propose a gentle nudge with the invoice link."
      : "Balance still unpaid — propose a friendly reminder.";
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

export async function listProposals(status?: string): Promise<Proposal[]> {
  const seller = await demoSeller();
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

export async function approveProposal(id: string, draft_message: string): Promise<Proposal> {
  const { data: prop, error } = await db()
    .from("proposals")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new HttpError(error.message, 500);
  if (!prop) throw new HttpError("Proposal not found", 404);
  const p = prop as ProposalRow;
  if (p.status !== "pending") throw new HttpError("Proposal is no longer pending", 400);

  const q = await getQuoteRow(p.quote_id);
  const pays = await paymentsFor(p.quote_id);
  const bal = pays.find((x) => x.kind === "balance");

  // If reminder + invoice id, call PayPal remind
  if (p.action === "send_reminder" && bal?.paypal_invoice_id) {
    try {
      await paypal.remindInvoice(bal.paypal_invoice_id, "Reminder from ServiceReady", draft_message);
      await pushEvent({
        quote_id: p.quote_id,
        seller_id: q.seller_id,
        actor: "seller",
        kind: "approval",
        tool: "paypal.invoicing.remind",
        input: { invoice_id: bal.paypal_invoice_id },
        text: "Reminder approved and sent via PayPal",
      });
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

export async function rejectProposal(id: string): Promise<Proposal> {
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

export async function listEvents(actor?: string): Promise<AgentEvent[]> {
  const seller = await demoSeller();
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

export async function getStats(): Promise<Stats> {
  const quotes = await listQuotes();
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

  for (const q of quotes) {
    by_status[q.status] = (by_status[q.status] ?? 0) + 1;
    const pays = await paymentsFor(q.id);
    const dep = pays.find((p) => p.kind === "deposit" && p.status === "COMPLETED");
    if (dep) deposits_collected_cents += dep.amount_cents;
    const bal = pays.find((p) => p.kind === "balance");
    if (bal?.status === "PAID") paid_cents += bal.amount_cents + (dep?.amount_cents ?? 0);
    else if (q.status === "paid") paid_cents += q.total_cents;
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
      });
    }
  }

  return {
    deposits_collected_cents,
    outstanding_cents,
    paid_cents,
    avg_days_to_pay: null,
    by_status,
    owed_by_client: owed_by_client.sort((a, b) => b.days_since_invoice - a.days_since_invoice),
  };
}

/** Heuristic catalog parse (same spirit as mock) — LLM swap later. */
export async function parseCatalog(raw_text: string): Promise<{
  services: ServiceDraft[];
  flags: Flag[];
}> {
  const text = (raw_text ?? "").trim();
  if (!text) throw new HttpError("Paste a rate card first", 400);
  const seller = await demoSeller();
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
    const title = chunk
      .replace(/\$[\d,.]+k?/gi, "")
      .replace(/\d{1,3}\s*%/g, "")
      .replace(/\d+\s*(?:day|days|d)\b/gi, "")
      .replace(/[-–—:]+/g, " ")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 80) || `Service ${++i}`;
    let price = 0;
    if (moneyMatch) {
      price = Math.round(parseFloat(moneyMatch[1]!.replace(/,/g, "")) * (moneyMatch[2] ? 1000 : 1) * 100);
    }
    const tmp_id = `tmp_${Date.now().toString(36)}_${i++}`;
    const deposit_pct = pct ? Math.min(100, parseInt(pct[1]!, 10)) : seller.default_deposit_pct;
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

export async function publishCatalog(services: ServiceDraft[]): Promise<Service[]> {
  for (const d of services) {
    const errs = draftErrors(d);
    if (errs.length) throw new HttpError(errs[0]!.message, 400);
  }
  const seller = await demoSeller();
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
  }));
  const { data, error } = await db().from("services").insert(rows).select("*");
  if (error) throw new HttpError(error.message, 500);
  return (data as ServiceRow[]).map(mapService);
}

export async function agentChat(
  slug: string,
  messages: ChatMsg[],
): Promise<{ messages: ChatMsg[]; tool_calls: ToolTrace[]; quote: Quote | null }> {
  const store = await getPublic(slug);
  const last = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const tool_calls: ToolTrace[] = [];
  const lower = last.toLowerCase();

  tool_calls.push({
    tool: "list_services",
    input: { slug },
    output: store.services.map((s) => ({ id: s.id, title: s.title, price_cents: s.price_cents })),
  });

  const match =
    store.services.find((s) => lower.includes(s.title.toLowerCase().split(" ")[0]!)) ??
    store.services.find((s) =>
      s.title
        .toLowerCase()
        .split(/\s+/)
        .some((w) => w.length > 3 && lower.includes(w)),
    ) ??
    (/(logo|brand|identity)/i.test(last)
      ? store.services.find((s) => /brand|logo|identity/i.test(s.title))
      : undefined) ??
    (/(landing|page|web)/i.test(last)
      ? store.services.find((s) => /landing|page/i.test(s.title))
      : undefined) ??
    (/(deck|pitch)/i.test(last)
      ? store.services.find((s) => /deck|pitch/i.test(s.title))
      : undefined);

  const emailMatch = last.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const nameMatch =
    last.match(/(?:i'?m|i am|my name is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i) ??
    last.match(/\b([A-Z][a-z]+)\b(?=.*,|\s+and\b)/);

  let quote: Quote | null = null;
  let reply: string;

  if (match && emailMatch && isEmail(emailMatch[0]!)) {
    const client_name = nameMatch?.[1] ?? emailMatch[0]!.split("@")[0]!;
    const created = await postPublicQuote(slug, {
      service_id: match.id,
      client_name,
      client_email: emailMatch[0]!,
      brief: last.slice(0, 500),
      source: "agent_sim",
    });
    tool_calls.push({
      tool: "request_quote",
      input: { service_id: match.id, client_email: emailMatch[0] },
      output: { quote_id: created.id, deposit_cents: created.deposit_cents },
    });
    quote = created;
    reply = `I've requested a quote for **${match.title}** from ${store.seller.name}.\n\n- Total: ${money(created.total_cents)}\n- Deposit due now: ${money(created.deposit_cents)} (${match.deposit_pct}%)\n- Balance on delivery: ${money(created.balance_cents)}\n- Turnaround: ~${match.lead_time_days} days\n- Quote reference: ${created.id}\n\nPay the deposit with PayPal on the quote page to confirm.`;
  } else if (match) {
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
  };
}

export async function resetDemo(): Promise<{ ok: true }> {
  const seller = await demoSeller();
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
