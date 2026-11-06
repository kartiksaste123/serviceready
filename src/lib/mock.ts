// In-memory mock backend implementing every /api endpoint with strict state
// transitions. State is persisted to localStorage (browser only) so the demo
// survives reloads, new tabs and full-page navigations (e.g. storefront → quote
// link → seller console) — otherwise every reload silently wiped new quotes.
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
  Stats,
  ToolTrace,
  Source,
} from "./types";
import {
  catalogErrors,
  depositOf,
  draftErrors,
  isEmail,
  LIMITS,
  quoteRequestErrors,
  rulesErrors,
} from "./validation";
import { money, money0 } from "./format";

const IS_TEST = import.meta.env.MODE === "test";
const wait = (ms = 250 + Math.random() * 300) =>
  new Promise((r) => setTimeout(r, IS_TEST ? 0 : ms));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
let seq = 1000;
const uid = (p: string) => `${p}_${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const DAY = 864e5;
const ago = (days: number, hours = 0) =>
  new Date(Date.now() - days * DAY - hours * 36e5).toISOString();
const now = () => new Date().toISOString();
const PUBLIC_ORIGIN = "https://serviceready.app";
const WEBMCP_TOOLS = ["list_services", "get_service", "request_quote", "get_quote_status"];
const STORAGE_KEY = "serviceready.demo.v2";

interface DB {
  version: 2;
  seller: Seller;
  services: Service[];
  quotes: Quote[];
  payments: Record<string, Payment[]>;
  events: AgentEvent[];
  proposals: Proposal[];
  replies: Reply[];
}

// ---------- persistence ----------
const hasStorage = () => {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
};
function load(): DB {
  if (hasStorage()) {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as DB;
        if (
          parsed?.version === 2 &&
          parsed.seller &&
          Array.isArray(parsed.services) &&
          Array.isArray(parsed.quotes) &&
          parsed.payments &&
          Array.isArray(parsed.events) &&
          Array.isArray(parsed.proposals) &&
          Array.isArray(parsed.replies)
        )
          return parsed;
      }
    } catch {
      /* corrupted storage → fall back to seed */
    }
  }
  return seed();
}
let _db: DB | null = null;
const D = (): DB => (_db ??= load());
function save() {
  if (!hasStorage() || !_db) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(_db));
  } catch {
    /* quota / private mode */
  }
}
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY) _db = load();
  });
}
/** Test helper: drop in-memory + persisted state. */
export function __resetForTests() {
  _db = seed();
  save();
}

// ---------- seed ----------
function seed(): DB {
  const seller: Seller = {
    id: "sel_maya",
    slug: "maya-rao-studio",
    name: "Maya Rao Studio",
    tagline: "Brand identities for independent businesses — logos, kits and launch pages.",
    email: "hello@mayarao.studio",
    currency: "USD",
    rules: {
      default_deposit_pct: 50,
      reminder_tone: "friendly",
      max_reminders: 3,
      wait_days_before_nudge: 3,
    },
  };
  const services: Service[] = [
    {
      id: "svc_logo",
      title: "Logo design",
      description: "A custom wordmark or symbol with two revision rounds.",
      deliverables: ["Primary logo", "Mono version", "SVG + PNG files", "2 revision rounds"],
      price_cents: 45000,
      deposit_pct: 50,
      lead_time_days: 7,
      status: "published",
    },
    {
      id: "svc_kit",
      title: "Brand identity kit",
      description: "Logo, colour palette, type pairing and a one-page brand guide.",
      deliverables: ["Logo suite", "Colour palette", "Font pairing", "Brand guide PDF"],
      price_cents: 120000,
      deposit_pct: 50,
      lead_time_days: 14,
      status: "published",
    },
    {
      id: "svc_social",
      title: "Social media template pack",
      description: "Ten on-brand editable templates for posts and stories.",
      deliverables: ["10 templates", "Canva + Figma files", "Usage notes"],
      price_cents: 30000,
      deposit_pct: 30,
      lead_time_days: 5,
      status: "published",
    },
    {
      id: "svc_landing",
      title: "Landing page design",
      description: "A conversion-focused single page design, handoff ready.",
      deliverables: ["Desktop + mobile design", "Figma handoff", "1 revision round"],
      price_cents: 90000,
      deposit_pct: 40,
      lead_time_days: 14,
      status: "published",
    },
  ];
  const d: DB = {
    version: 2,
    seller,
    services,
    quotes: [],
    payments: {},
    events: [],
    proposals: [],
    replies: [],
  };
  const rows: [string, string, string, Source, QuoteStatus, number, string][] = [
    [
      "q_jordan",
      "svc_kit",
      "Jordan Lee",
      "web",
      "quoted",
      1,
      "Rebrand for my coffee cart, warm and friendly.",
    ],
    [
      "q_priya",
      "svc_logo",
      "Priya Shah",
      "mcp",
      "deposit_paid",
      4,
      "Logo for a yoga studio called Still Point.",
    ],
    [
      "q_tomas",
      "svc_landing",
      "Tomás Ortega",
      "webmcp",
      "delivered",
      12,
      "Landing page for a bike repair app launch.",
    ],
    [
      "q_hannah",
      "svc_kit",
      "Hannah Brooks",
      "agent_sim",
      "balance_invoiced",
      20,
      "Identity kit for a ceramics shop, earthy palette.",
    ],
    [
      "q_kofi",
      "svc_social",
      "Kofi Mensah",
      "web",
      "paid",
      30,
      "Instagram templates for my food truck.",
    ],
    [
      "q_elena",
      "svc_logo",
      "Elena Rossi",
      "mcp",
      "balance_invoiced",
      10,
      "Logo for an Italian language tutoring service.",
    ],
    ["q_sam", "svc_landing", "Sam Carter", "web", "cancelled", 25, "Landing page for a podcast."],
    [
      "q_aiko",
      "svc_social",
      "Aiko Tanaka",
      "webmcp",
      "paid",
      18,
      "Story templates for a plant shop.",
    ],
  ];
  for (const [id, sid, name, source, status, days, brief] of rows) {
    const s = services.find((x) => x.id === sid)!;
    const q = buildQuote(
      d.seller,
      id,
      s,
      name,
      `${(name.split(" ")[0] ?? "").toLowerCase()}@example.com`,
      brief,
      source,
      ago(days),
    );
    q.status = status;
    const pays: Payment[] = [];
    const created: AgentEvent[] = [
      source === "web"
        ? ev(
            id,
            "client",
            "message",
            { text: `Quote requested via storefront: ${brief}` },
            ago(days),
          )
        : ev(
            id,
            "client_agent",
            "tool_call",
            {
              tool: "request_quote",
              input: { service_id: sid, client_name: name, brief },
              output: { quote_id: id, total_cents: q.total_cents },
            },
            ago(days),
          ),
    ];
    if (status !== "quoted" && status !== "cancelled") {
      const order = `5O${rand(15)}`;
      const cap = `3C${rand(15)}`;
      pays.push({
        id: uid("pay"),
        kind: "deposit",
        amount_cents: q.deposit_cents,
        status: "COMPLETED",
        paypal_order_id: order,
        paypal_capture_id: cap,
        updated_at: ago(days - 1),
      });
      created.push(
        ev(
          id,
          "paypal",
          "webhook",
          {
            tool: "PAYMENT.CAPTURE.COMPLETED",
            output: {
              order_id: order,
              capture_id: cap,
              amount: q.deposit_cents / 100,
              status: "COMPLETED",
            },
            text: "Deposit captured — work can start",
          },
          ago(days - 1),
        ),
      );
    }
    if (status === "delivered")
      created.push(
        ev(
          id,
          "seller",
          "approval",
          { text: "Work delivered — balance invoice not sent yet" },
          ago(days - 10),
        ),
      );
    if (status === "balance_invoiced" || status === "paid") {
      const inv = `INV2-${rand(4)}-${rand(4)}-${rand(4)}-${rand(4)}`;
      pays.push({
        id: uid("pay"),
        kind: "balance",
        amount_cents: q.balance_cents,
        status: status === "paid" ? "PAID" : "UNPAID",
        paypal_invoice_id: inv,
        invoice_url: invoiceUrl(inv),
        updated_at: status === "paid" ? ago(days - 9) : ago(days - 6),
      });
      created.push(ev(id, "seller", "approval", { text: "Marked delivered" }, ago(days - 6)));
      created.push(
        ev(
          id,
          "seller_agent",
          "tool_call",
          {
            tool: "paypal.create_and_send_invoice",
            input: { amount: q.balance_cents / 100, recipient: q.client_email },
            output: { invoice_id: inv, status: "SENT" },
          },
          ago(days - 6),
        ),
      );
      if (status === "paid")
        created.push(
          ev(
            id,
            "paypal",
            "webhook",
            {
              tool: "INVOICING.INVOICE.PAID",
              output: { invoice_id: inv },
              text: "Balance paid in full",
            },
            ago(days - 9),
          ),
        );
    }
    if (status === "cancelled")
      created.push(
        ev(
          id,
          "seller",
          "approval",
          { text: "Quote cancelled — client chose another provider" },
          ago(days - 2),
        ),
      );
    q.updated_at = created.reduce((m, e) => (e.created_at > m ? e.created_at : m), q.created_at);
    d.quotes.push(q);
    d.payments[id] = pays;
    d.events.push(...created);
  }
  // Pending proposal: client says already paid, PayPal says UNPAID.
  const hq = d.quotes.find((q) => q.id === "q_hannah")!;
  const inv = d.payments["q_hannah"]!.find((p) => p.kind === "balance")!;
  const claim = "Hi Maya! I already paid the invoice yesterday, should be there 🙂";
  d.replies.push({
    id: uid("rep"),
    quote_id: hq.id,
    from: "client",
    text: claim,
    created_at: ago(0, 3),
  });
  d.events.push(
    ev(hq.id, "client", "message", { text: claim }, ago(0, 3)),
    ev(
      hq.id,
      "collections_agent",
      "tool_call",
      {
        tool: "paypal.get_invoice",
        input: { invoice_id: inv.paypal_invoice_id },
        output: { status: "UNPAID", amount_due: hq.balance_cents / 100, last_payment: null },
      },
      ago(0, 2.9),
    ),
    ev(
      hq.id,
      "collections_agent",
      "decision",
      {
        text: "Client claims payment but PayPal shows UNPAID. Proposed a friendly reminder with the invoice link.",
      },
      ago(0, 2.9),
    ),
  );
  hq.updated_at = ago(0, 2.9);
  d.proposals.push({
    id: "prop_hannah",
    quote_id: hq.id,
    client_name: hq.client_name,
    action: "send_reminder",
    reason:
      "Client says they already paid, but PayPal still reports the invoice as UNPAID. A gentle nudge with the link usually resolves a missed step.",
    evidence: `PayPal invoice ${inv.paypal_invoice_id} status: UNPAID, checked 3h ago`,
    draft_message: `Hi Hannah, thanks so much! I just checked and PayPal still shows the balance invoice as open on my side — sometimes the payment doesn't go through the last step. Here's the link again in case it helps: ${inv.invoice_url}\n\nNo rush at all, and thank you again! — Maya`,
    status: "pending",
    created_at: ago(0, 2.9),
  });
  return d;
}

// ---------- helpers ----------
function rand(n: number) {
  return Array.from(
    { length: n },
    () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)],
  ).join("");
}
const invoiceUrl = (inv: string) => `https://www.sandbox.paypal.com/invoice/p/#${inv}`;
function ev(
  quote_id: string | null,
  actor: AgentEvent["actor"],
  kind: AgentEvent["kind"],
  rest: Partial<AgentEvent>,
  at = now(),
): AgentEvent {
  return { id: uid("evt"), quote_id, actor, kind, created_at: at, ...rest };
}
const signOff = () => D().seller.name.split(" ")[0] ?? D().seller.name;
function buildQuote(
  seller: Seller,
  id: string,
  s: Service,
  client_name: string,
  client_email: string,
  brief: string,
  source: Source,
  at = now(),
): Quote {
  const deposit = depositOf(s.price_cents, s.deposit_pct);
  return {
    id,
    service_id: s.id,
    service_title: s.title,
    client_name,
    client_email,
    brief,
    scope_summary: `${s.title} for ${client_name}${s.deliverables.length ? `: ${s.deliverables.join(", ")}` : ""}. Delivered in ~${s.lead_time_days} days by ${seller.name}.`,
    line_items: [{ label: s.title, amount_cents: s.price_cents }],
    total_cents: s.price_cents,
    deposit_cents: deposit,
    balance_cents: s.price_cents - deposit,
    status: "quoted",
    source,
    approval_url: `/q/${id}`,
    created_at: at,
    updated_at: at,
  };
}
function getQ(id: string) {
  const q = D().quotes.find((x) => x.id === id);
  if (!q) throw new Error("Quote not found");
  return q;
}
const touch = (q: Quote) => {
  q.updated_at = now();
};
function detail(id: string): QuoteDetail {
  const db = D();
  return clone({
    quote: getQ(id),
    payments: db.payments[id] ?? [],
    events: db.events
      .filter((e) => e.quote_id === id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    replies: db.replies
      .filter((r) => r.quote_id === id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    proposals: db.proposals
      .filter((p) => p.quote_id === id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at)),
  });
}
/** Close out any pending proposals for a quote that a newer fact made stale. */
function supersede(quote_id: string, why: string) {
  const db = D();
  for (const p of db.proposals) {
    if (p.quote_id === quote_id && p.status === "pending") {
      p.status = "rejected";
      db.events.push(
        ev(quote_id, "system", "decision", { text: `Dismissed suggestion "${p.action}": ${why}` }),
      );
    }
  }
}
const balanceOf = (id: string) => (D().payments[id] ?? []).find((p) => p.kind === "balance");
const daysSince = (iso: string) => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / DAY));
const remindersSent = (id: string) =>
  D().proposals.filter(
    (p) =>
      p.quote_id === id &&
      p.status === "executed" &&
      (p.action === "send_reminder" || p.action === "escalate"),
  ).length;

// ---------- endpoints ----------
export async function getSeller() {
  await wait();
  return clone(D().seller);
}
export async function putRules(rules: SellerRules) {
  await wait();
  const errs = Object.values(rulesErrors(rules));
  if (errs.length) throw new Error(errs[0]);
  const db = D();
  db.seller.rules = { ...rules };
  db.events.push(
    ev(null, "seller", "approval", {
      text: `Updated agent rules: ${rules.default_deposit_pct}% deposit, ${rules.reminder_tone} tone, wait ${rules.wait_days_before_nudge}d, max ${rules.max_reminders} reminders`,
    }),
  );
  save();
  return clone(db.seller);
}

const cap = (s: string) => s.replace(/^\w/, (c) => c.toUpperCase());
export async function parseCatalog(
  raw_text: string,
): Promise<{ services: ServiceDraft[]; flags: Flag[] }> {
  await wait(1100);
  if (!raw_text.trim()) throw new Error("Paste a rate card first");
  if (raw_text.length > 10_000)
    throw new Error("That's a lot of text — paste up to 10,000 characters at a time");
  const db = D();
  const parts = raw_text
    .split(/[|\n;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const services: ServiceDraft[] = [];
  const flags: Flag[] = [];
  for (const p of parts) {
    const tmp_id = uid("tmp");
    const pct = p.match(/\+\s*(\d+)\s*%/);
    if (pct) {
      services.push({
        tmp_id,
        title: `${cap(p.replace(/\+.*$/, "").trim())} surcharge`,
        description: `Adds ${pct[1]}% to any service for faster delivery.`,
        deliverables: [],
        price_cents: 0,
        deposit_pct: db.seller.rules.default_deposit_pct,
        lead_time_days: null,
      });
      flags.push({
        tmp_id,
        field: "price_cents",
        severity: "error",
        message: `"${p}" looks like a +${pct[1]}% modifier, not a standalone service. Remove it, or give it a fixed price.`,
      });
      continue;
    }
    const qty = p.match(/\bx\s*(\d+)\b/i);
    const cleaned = p
      .replace(/\bx\s*\d+\b/i, "")
      .replace(/\(\s*\d+\s*rounds?\s*\)/i, "")
      .replace(/\d+\s*(wks?|weeks?|days?|d)\b/gi, "");
    const priceText = cleaned.replace(/\d+\s*%/g, "");
    const explicitPrice = priceText.match(/\$\s*(\d[\d,]*(?:\.\d{1,2})?)\s*(k)?\b/i);
    const nums = [...priceText.matchAll(/\$?\s*(\d[\d,]*(?:\.\d{1,2})?)\s*(k)?\b/gi)].map(
      (m) => Number((m[1] ?? "0").replace(/,/g, "")) * (m[2] ? 1000 : 1),
    );
    const price = explicitPrice
      ? Number(explicitPrice[1]!.replace(/,/g, "")) * (explicitPrice[2] ? 1000 : 1)
      : (nums[0] ?? 0);
    const weeks = p.match(/(\d+)\s*(wks?|weeks?)\b/i);
    const days = p.match(/(\d+)\s*(days?|d)\b/i);
    const rounds = p.match(/\((\d+)\s*rounds?\)/i);
    const title = cap(
      (p.split(/\s\$?\d|\s-\s|\(|,/)[0] ?? p)
        .replace(/\bx\s*\d+\b/i, "")
        .replace(/\bpg\b/i, "page")
        .replace(/\s+w\/.*$/i, "")
        .replace(/\s+with\s.*$/i, "")
        .replace(/[-–:]+$/, "")
        .trim(),
    ).slice(0, LIMITS.title);
    const deliverables: string[] = [];
    const w = p.match(/w\/\s*([^\d,]+)/i);
    if (w)
      deliverables.push(
        ...(w[1] ?? "")
          .split(/\+|&|\band\b/)
          .map((x) => cap(x.trim()))
          .filter(Boolean),
      );
    if (qty) deliverables.push(`${qty[1]} templates`);
    if (rounds) deliverables.push(`${rounds[1]} revision rounds`);
    services.push({
      tmp_id,
      title,
      description: deliverables.length
        ? `${title} including ${deliverables.join(", ").toLowerCase()}.`
        : `${title}, as listed on your rate card.`,
      deliverables,
      price_cents: Math.round(price * 100),
      deposit_pct: /half\s*(up\s*front|upfront|deposit)/i.test(p)
        ? 50
        : db.seller.rules.default_deposit_pct,
      lead_time_days: weeks ? Number(weeks[1]) * 7 : days ? Number(days[1]) : null,
    });
  }
  const prices = services
    .filter((s) => s.price_cents > 0)
    .map((s) => s.price_cents)
    .sort((a, b) => a - b);
  const median = prices[Math.floor(prices.length / 2)] ?? 0;
  for (const s of services) {
    if (s.price_cents > 0 && median && s.price_cents * 10 < median) {
      flags.push({
        tmp_id: s.tmp_id,
        field: "price_cents",
        severity: "warning",
        message: `${money0(s.price_cents)}${s.deliverables[0] ? ` for ${s.deliverables[0]}` : ""} is ${Math.round(median / s.price_cents)}× below your median price — typo?`,
      });
    }
    for (const e of draftErrors(s))
      if (!flags.some((f) => f.tmp_id === e.tmp_id && f.field === e.field)) flags.push(e);
  }
  return { services, flags };
}
export async function publishCatalog(drafts: ServiceDraft[]) {
  await wait(800);
  if (!drafts.length) throw new Error("Nothing to publish");
  const bad = catalogErrors(drafts);
  if (bad.length)
    throw new Error(
      `${bad.length} issue${bad.length === 1 ? "" : "s"} must be fixed before publishing`,
    );
  const db = D();
  const out: Service[] = [];
  let added = 0;
  let updated = 0;
  for (const d of drafts) {
    const fields = {
      title: d.title.trim(),
      description: d.description.trim(),
      deliverables: d.deliverables.map((x) => x.trim()).filter(Boolean),
      image_url: d.image_url ?? null,
      price_cents: d.price_cents,
      deposit_pct: d.deposit_pct,
      lead_time_days: d.lead_time_days ?? 7,
    };
    const existing = db.services.find((s) => s.title.toLowerCase() === fields.title.toLowerCase());
    if (existing) {
      Object.assign(existing, fields, { status: "published" });
      out.push(existing);
      updated++;
    } else {
      const s: Service = { id: uid("svc"), ...fields, status: "published" };
      db.services.push(s);
      out.push(s);
      added++;
    }
  }
  db.events.push(
    ev(null, "seller", "approval", {
      text: `Published catalog: ${added} new, ${updated} updated service${added + updated === 1 ? "" : "s"}`,
    }),
  );
  save();
  return clone(out);
}
export async function listServices() {
  await wait();
  return clone(D().services);
}
export async function getPublic(slug: string): Promise<PublicStore> {
  await wait();
  const db = D();
  if (slug !== db.seller.slug) throw new Error("Storefront not found");
  return clone({
    seller: { name: db.seller.name, slug, tagline: db.seller.tagline },
    services: db.services.filter((s) => s.status === "published"),
    agent: { mcp_url: `${PUBLIC_ORIGIN}/mcp/${slug}`, webmcp_tools: WEBMCP_TOOLS },
  });
}
function createQuote(b: {
  service_id: string;
  client_name: string;
  client_email: string;
  brief: string;
  source: Source;
}) {
  if (!["web", "mcp", "webmcp", "agent_sim"].includes(b.source))
    throw new Error("Invalid booking source");
  const errs = Object.values(quoteRequestErrors(b));
  if (errs.length) throw new Error(errs[0]);
  const db = D();
  const s = db.services.find((x) => x.id === b.service_id && x.status === "published");
  if (!s) throw new Error("This service is no longer available");
  const q = buildQuote(
    db.seller,
    uid("q"),
    s,
    b.client_name.trim(),
    b.client_email.trim().toLowerCase(),
    b.brief.trim(),
    b.source,
  );
  db.quotes.push(q);
  db.payments[q.id] = [];
  db.events.push(
    b.source === "web"
      ? ev(q.id, "client", "message", { text: `Quote requested via storefront: ${q.brief}` })
      : ev(q.id, "client_agent", "tool_call", {
          tool: "request_quote",
          input: b,
          output: { quote_id: q.id, total_cents: q.total_cents },
        }),
  );
  save();
  return q;
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
) {
  await wait();
  if (slug !== D().seller.slug) throw new Error("Storefront not found");
  return clone(createQuote(b));
}
export async function listQuotes() {
  await wait();
  return clone([...D().quotes].sort((a, b) => b.updated_at.localeCompare(a.updated_at)));
}
export async function getQuote(id: string, refresh = false) {
  await wait(refresh ? 700 : undefined);
  getQ(id);
  if (refresh) {
    const db = D();
    const pays = db.payments[id] ?? [];
    if (!pays.length)
      db.events.push(
        ev(id, "system", "decision", { text: "Checked PayPal — no payments on this booking yet" }),
      );
    // Read-only status check: log it, but never rewrite payment timestamps
    // (that used to reset "days since invoice" to 0 on every check).
    for (const p of pays)
      db.events.push(
        ev(id, "paypal", "tool_call", {
          tool: p.kind === "deposit" ? "paypal.get_order" : "paypal.get_invoice",
          input: { id: p.paypal_order_id ?? p.paypal_invoice_id },
          output: { status: p.status },
        }),
      );
    save();
  }
  return detail(id);
}
export async function createDepositOrder(id: string) {
  await wait();
  const db = D();
  const q = getQ(id);
  if (q.status === "cancelled") throw new Error("This quote was cancelled");
  if (q.status !== "quoted") throw new Error("The deposit for this quote is already paid");
  if (q.deposit_cents <= 0) throw new Error("This quote has no deposit to pay");
  const open = (db.payments[id] ?? []).find((p) => p.kind === "deposit" && p.status === "CREATED");
  if (open?.paypal_order_id) return { order_id: open.paypal_order_id }; // idempotent retry
  const order_id = `5O${rand(15)}`;
  (db.payments[id] ??= []).push({
    id: uid("pay"),
    kind: "deposit",
    amount_cents: q.deposit_cents,
    status: "CREATED",
    paypal_order_id: order_id,
    updated_at: now(),
  });
  db.events.push(
    ev(id, "system", "tool_call", {
      tool: "paypal.orders.create",
      input: { amount: q.deposit_cents / 100, currency: "USD", intent: "CAPTURE" },
      output: { id: order_id, status: "CREATED" },
    }),
  );
  save();
  return { order_id };
}
export async function captureDeposit(id: string, order_id: string) {
  await wait(700);
  const db = D();
  const q = getQ(id);
  const p = (db.payments[id] ?? []).find(
    (x) => x.kind === "deposit" && x.paypal_order_id === order_id,
  );
  if (!p) throw new Error("PayPal order not found for this quote");
  if (p.status === "COMPLETED") return clone(q); // idempotent: never double-capture
  if (q.status !== "quoted")
    throw new Error(
      q.status === "cancelled" ? "This quote was cancelled" : "Deposit already handled",
    );
  p.status = "COMPLETED";
  p.paypal_capture_id = `3C${rand(15)}`;
  p.updated_at = now();
  q.status = "deposit_paid";
  touch(q);
  db.events.push(
    ev(id, "paypal", "webhook", {
      tool: "PAYMENT.CAPTURE.COMPLETED",
      output: { order_id, capture_id: p.paypal_capture_id, amount: p.amount_cents / 100 },
      text: "Deposit captured — work can start",
    }),
  );
  save();
  return clone(q);
}
export async function deliver(id: string) {
  await wait(800);
  const db = D();
  const q = getQ(id);
  if (q.status !== "deposit_paid" && q.status !== "delivered")
    throw new Error(
      q.status === "quoted"
        ? "The client hasn't paid the deposit yet"
        : "This booking has already been invoiced",
    );
  if (balanceOf(id)) throw new Error("A balance invoice already exists for this booking");
  db.events.push(ev(id, "seller", "approval", { text: "Marked delivered" }));
  if (q.balance_cents <= 0) {
    q.status = "paid";
    touch(q);
    db.events.push(
      ev(id, "system", "decision", {
        text: "Deposit covered the full price — no balance invoice needed. Booking closed.",
      }),
    );
  } else {
    const inv = `INV2-${rand(4)}-${rand(4)}-${rand(4)}-${rand(4)}`;
    (db.payments[id] ??= []).push({
      id: uid("pay"),
      kind: "balance",
      amount_cents: q.balance_cents,
      status: "UNPAID",
      paypal_invoice_id: inv,
      invoice_url: invoiceUrl(inv),
      updated_at: now(),
    });
    q.status = "balance_invoiced";
    touch(q);
    db.events.push(
      ev(id, "seller_agent", "tool_call", {
        tool: "paypal.create_and_send_invoice",
        input: { amount: q.balance_cents / 100, recipient: q.client_email },
        output: { invoice_id: inv, status: "SENT" },
        text: `Balance invoice for ${money(q.balance_cents)} sent to ${q.client_email}`,
      }),
    );
  }
  save();
  return detail(id);
}
export async function cancelQuote(id: string) {
  await wait();
  const db = D();
  const q = getQ(id);
  const deposit = (db.payments[id] ?? []).find((p) => p.kind === "deposit");
  if (q.status === "quoted") {
    q.status = "cancelled";
    touch(q);
    for (const p of db.payments[id] ?? [])
      if (p.status === "CREATED") {
        p.status = "VOIDED";
        p.updated_at = now();
      }
    supersede(id, "quote cancelled");
    db.events.push(ev(id, "seller", "approval", { text: "Quote cancelled" }));
    save();
    return detail(id);
  }
  if (
    deposit &&
    deposit.status === "COMPLETED" &&
    deposit.paypal_capture_id &&
    (q.status === "deposit_paid" || q.status === "delivered")
  ) {
    const refundId = `REF${rand(12)}`;
    deposit.status = "REFUNDED";
    deposit.updated_at = now();
    q.status = "cancelled";
    touch(q);
    supersede(id, "booking cancelled with deposit refund");
    db.events.push(
      ev(id, "paypal", "tool_call", {
        tool: "paypal.agent_toolkit.create_refund",
        input: { capture_id: deposit.paypal_capture_id },
        output: { refund_id: refundId, status: "COMPLETED" },
        text: "Deposit refunded via PayPal Agent Toolkit create_refund (COMPLETED)",
      }),
    );
    db.events.push(
      ev(id, "seller", "approval", {
        tool: "booking.cancel_refund",
        output: { refund_id: refundId },
        text: "Booking cancelled — deposit refunded on PayPal evidence",
      }),
    );
    save();
    return detail(id);
  }
  throw new Error(
    "This booking cannot be cancelled with an automatic deposit refund in its current state.",
  );
}
/** Demo-only: simulate the client paying the PayPal balance invoice (INVOICING.INVOICE.PAID webhook). */
export async function simulateBalancePaid(id: string) {
  await wait(700);
  const db = D();
  const q = getQ(id);
  const bal = balanceOf(id);
  if (!bal || q.status !== "balance_invoiced")
    throw new Error("There is no open balance invoice on this booking");
  if (bal.status === "PAID") return detail(id);
  bal.status = "PAID";
  bal.updated_at = now();
  q.status = "paid";
  touch(q);
  db.events.push(
    ev(id, "paypal", "webhook", {
      tool: "INVOICING.INVOICE.PAID",
      output: { invoice_id: bal.paypal_invoice_id, amount: bal.amount_cents / 100 },
      text: "Balance paid in full",
    }),
  );
  supersede(id, "PayPal reports the invoice as paid");
  runCollections(id); // proposes the thank-you
  save();
  return detail(id);
}

function reminderDraft(
  q: Quote,
  bal: Payment,
  opts: { claimsPaid: boolean; overdueDays: number; final: boolean },
) {
  const tone = D().seller.rules.reminder_tone;
  const first = q.client_name.split(" ")[0] ?? q.client_name;
  const me = signOff();
  const amt = money(bal.amount_cents);
  if (opts.final)
    return `Hi ${first}, I'm checking in about the ${amt} balance for ${q.service_title}, now ${opts.overdueDays} days since the invoice. Could you let me know when you expect to pay, or if anything is holding it up? Invoice: ${bal.invoice_url}\n\nThanks, ${me}`;
  if (opts.claimsPaid) {
    const open = tone === "firm" ? `Hi ${first},` : `Hi ${first}, thank you!`;
    return `${open} I just checked and PayPal still shows the ${amt} invoice as open on my side — sometimes the payment doesn't complete the last step. Here's the link again: ${bal.invoice_url}${tone === "friendly" ? "\n\nNo rush at all!" : ""}\n\n— ${me}`;
  }
  if (tone === "firm")
    return `Hi ${first}, the ${amt} balance for ${q.service_title} is now ${opts.overdueDays} days past the invoice date. Please pay it here: ${bal.invoice_url}\n\n— ${me}`;
  if (tone === "neutral")
    return `Hi ${first}, a reminder that the ${amt} balance for ${q.service_title} is still open. You can pay it here: ${bal.invoice_url}\n\n— ${me}`;
  return `Hi ${first}, hope you're enjoying the new ${q.service_title.toLowerCase()}! Just a gentle reminder that the ${amt} balance is open whenever you're ready: ${bal.invoice_url}\n\nThanks so much, ${me}`;
}
function runCollections(id: string, trigger?: string): AgentRun {
  const db = D();
  const q = getQ(id);
  const steps: AgentEvent[] = [];
  const bal = balanceOf(id);
  let proposal: Proposal | null = null;
  let summary: string;
  if (q.status === "cancelled") {
    summary = "This booking is cancelled — nothing to collect.";
    steps.push(ev(id, "collections_agent", "decision", { text: summary }));
  } else if (!bal) {
    summary =
      q.status === "quoted"
        ? "Waiting on the deposit — no balance invoice to chase yet."
        : "No balance invoice yet. Mark the work delivered to send one.";
    steps.push(ev(id, "collections_agent", "decision", { text: summary }));
  } else {
    steps.push(
      ev(id, "collections_agent", "tool_call", {
        tool: "paypal.get_invoice",
        input: { invoice_id: bal.paypal_invoice_id },
        output: {
          status: bal.status,
          amount_due: bal.status === "PAID" ? 0 : bal.amount_cents / 100,
        },
      }),
    );
    const evidence = `PayPal invoice ${bal.paypal_invoice_id} status: ${bal.status}, checked just now`;
    const rules = db.seller.rules;
    const first = q.client_name.split(" ")[0] ?? q.client_name;
    if (bal.status === "PAID") {
      const thanked = db.proposals.some(
        (p) =>
          p.quote_id === id &&
          p.action === "thank_and_close" &&
          (p.status === "pending" || p.status === "executed"),
      );
      if (thanked) summary = "PayPal confirms the balance is paid. Nothing left to chase.";
      else {
        supersede(id, "newer PayPal check");
        proposal = mkProp(
          q,
          "thank_and_close",
          "PayPal confirms the balance is paid in full.",
          evidence,
          `Hi ${first}, payment received — thank you! It was a joy working on this. — ${signOff()}`,
        );
        summary = "PayPal confirms PAID. Drafted a thank-you note for your approval.";
      }
    } else {
      const text = trigger ?? "";
      const claimsPaid =
        /\b(paid|sent|transferred|done|settled)\b/i.test(text) &&
        !/\b(not|haven'?t|didn'?t|yet to|will|going to|tomorrow|next week)\b/i.test(text);
      const overdue = daysSince(bal.updated_at);
      const sent = remindersSent(id);
      supersede(id, "replaced by a newer check");
      if (sent >= rules.max_reminders) {
        proposal = mkProp(
          q,
          "escalate",
          `You've already sent ${sent} reminder${sent === 1 ? "" : "s"} (your limit is ${rules.max_reminders}). A personal check-in is the next step.`,
          evidence,
          reminderDraft(q, bal, { claimsPaid, overdueDays: overdue, final: true }),
        );
        summary =
          "Reminder limit reached. Flagged for your attention with a personal check-in draft.";
      } else if (claimsPaid) {
        proposal = mkProp(
          q,
          "send_reminder",
          "Client says they paid, but PayPal still shows the invoice as UNPAID.",
          evidence,
          reminderDraft(q, bal, { claimsPaid, overdueDays: overdue, final: false }),
        );
        summary =
          'Client says "already paid" — PayPal says UNPAID. Drafted a reminder for your approval.';
      } else if (overdue < rules.wait_days_before_nudge) {
        proposal = mkProp(
          q,
          "wait",
          `Invoice was sent ${overdue === 0 ? "today" : `${overdue} day${overdue === 1 ? "" : "s"} ago`} — inside your ${rules.wait_days_before_nudge}-day grace window.`,
          evidence,
          reminderDraft(q, bal, { claimsPaid, overdueDays: overdue, final: false }),
        );
        summary =
          "Invoice still UNPAID but inside your grace window. Suggest waiting (a draft is ready if you'd rather nudge now).";
      } else {
        proposal = mkProp(
          q,
          "send_reminder",
          `Invoice is ${overdue} days old and still UNPAID — past your ${rules.wait_days_before_nudge}-day grace window. Reminder ${sent + 1} of ${rules.max_reminders}.`,
          evidence,
          reminderDraft(q, bal, { claimsPaid, overdueDays: overdue, final: false }),
        );
        summary = `Invoice ${overdue} days old and UNPAID. Drafted reminder ${sent + 1} of ${rules.max_reminders} for your approval.`;
      }
    }
    steps.push(ev(id, "collections_agent", "decision", { text: summary }));
    if (proposal) db.proposals.push(proposal);
  }
  db.events.push(...steps);
  save();
  return clone({ id: uid("run"), quote_id: id, summary, steps, proposal });
}
function mkProp(
  q: Quote,
  action: Proposal["action"],
  reason: string,
  evidence: string,
  draft_message: string,
): Proposal {
  return {
    id: uid("prop"),
    quote_id: q.id,
    client_name: q.client_name,
    action,
    reason,
    evidence,
    draft_message,
    status: "pending",
    created_at: now(),
  };
}
export async function postReply(id: string, b: { text: string; from: "client" | "seller" }) {
  await wait(900);
  const db = D();
  const q = getQ(id);
  const text = b.text.trim();
  if (!text) throw new Error("Write a message first");
  if (text.length > LIMITS.message) throw new Error("Message is too long");
  const reply: Reply = { id: uid("rep"), quote_id: id, from: b.from, text, created_at: now() };
  db.replies.push(reply);
  db.events.push(
    ev(id, "client", "message", {
      text: b.from === "seller" ? `(pasted by seller) ${text}` : text,
    }),
  );
  touch(q);
  // Only bring in the collections agent when there is actually something to collect.
  const agent_run = balanceOf(id) ? runCollections(id, text) : null;
  save();
  return { reply: clone(reply), agent_run };
}
export async function runCollectionsEp(id: string) {
  await wait(1000);
  return runCollections(id);
}
export async function listProposals(status?: string) {
  await wait();
  return clone(
    D()
      .proposals.filter((p) => !status || p.status === status)
      .sort((a, b) => b.created_at.localeCompare(a.created_at)),
  );
}
export async function approveProposal(id: string, draft_message: string) {
  await wait(600);
  const db = D();
  const p = db.proposals.find((x) => x.id === id);
  if (!p) throw new Error("Proposal not found");
  if (p.status !== "pending") throw new Error("This suggestion was already handled");
  const bal = balanceOf(p.quote_id);
  if (p.action === "thank_and_close" && bal?.status !== "PAID")
    throw new Error("PayPal has not confirmed payment. Run a new payment check first.");
  if ((p.action === "send_reminder" || p.action === "escalate") && (!bal || bal.status === "PAID"))
    throw new Error("This invoice is no longer unpaid. Run a new payment check first.");
  if (draft_message.length > LIMITS.message) throw new Error("Message is too long");
  const sends = p.action !== "wait";
  if (sends && !draft_message.trim()) throw new Error("The message can't be empty");
  const q = getQ(p.quote_id);
  p.draft_message = draft_message.trim();
  p.status = sends ? "executed" : "approved";
  db.events.push(
    ev(p.quote_id, "seller", "approval", {
      text: sends
        ? `Approved: ${p.action.replaceAll("_", " ")}`
        : "Agreed to keep waiting — no message sent",
    }),
  );
  if (sends)
    db.events.push(
      ev(p.quote_id, "collections_agent", "message", {
        tool: "send_email",
        input: { to: q.client_email },
        text: p.draft_message,
      }),
    );
  if (p.action === "thank_and_close" && q.status === "balance_invoiced") q.status = "paid";
  touch(q);
  save();
  return clone(p);
}
export async function rejectProposal(id: string) {
  await wait();
  const db = D();
  const p = db.proposals.find((x) => x.id === id);
  if (!p) throw new Error("Proposal not found");
  if (p.status !== "pending") throw new Error("This suggestion was already handled");
  p.status = "rejected";
  db.events.push(
    ev(p.quote_id, "seller", "approval", {
      text: `Declined: ${p.action.replaceAll("_", " ")} — nothing sent`,
    }),
  );
  save();
  return clone(p);
}
export async function listEvents(actor?: string) {
  await wait();
  return clone(
    D()
      .events.filter((e) => !actor || e.actor === actor)
      .sort((a, b) => b.created_at.localeCompare(a.created_at)),
  );
}
export async function getStats(): Promise<Stats> {
  await wait();
  const db = D();
  const all = Object.values(db.payments).flat();
  const by_status: Record<QuoteStatus, number> = {
    quoted: 0,
    deposit_paid: 0,
    delivered: 0,
    balance_invoiced: 0,
    paid: 0,
    cancelled: 0,
  };
  db.quotes.forEach((q) => by_status[q.status]++);
  const owed = db.quotes
    .flatMap((q) => {
      const b = q.status === "balance_invoiced" ? balanceOf(q.id) : undefined;
      if (!b || b.status === "PAID") return [];
      return [
        {
          client_name: q.client_name,
          quote_id: q.id,
          outstanding_cents: b.amount_cents,
          days_since_invoice: daysSince(b.updated_at),
        },
      ];
    })
    .sort((a, b) => b.days_since_invoice - a.days_since_invoice);
  // Average days from balance invoice → PAID, derived from the audit trail.
  const durations = db.quotes
    .filter((q) => q.status === "paid")
    .flatMap((q) => {
      const evs = db.events.filter((e) => e.quote_id === q.id);
      const sent = evs.find((e) => e.tool === "paypal.create_and_send_invoice");
      const paid = evs.find((e) => e.tool === "INVOICING.INVOICE.PAID");
      return sent && paid
        ? [(Date.parse(paid.created_at) - Date.parse(sent.created_at)) / DAY]
        : [];
    });
  return {
    deposits_collected_cents: all
      .filter((p) => p.kind === "deposit" && p.status === "COMPLETED")
      .reduce((s, p) => s + p.amount_cents, 0),
    outstanding_cents: owed.reduce((s, o) => s + o.outstanding_cents, 0),
    paid_cents: db.quotes.filter((q) => q.status === "paid").reduce((s, q) => s + q.total_cents, 0),
    avg_days_to_pay: durations.length
      ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10
      : null,
    by_status,
    owed_by_client: owed,
  };
}

// ---------- simulated client-side agent (storefront chat) ----------
const GENERIC = new Set(["design", "pack", "page", "media", "with", "your", "the"]);
function matchService(services: Service[], text: string) {
  const t = text.toLowerCase();
  let best: { s: Service; score: number } | null = null;
  for (const s of services) {
    const words = s.title
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2 && !GENERIC.has(w));
    const score = words.filter((w) => t.includes(w.replace(/s$/, ""))).length;
    if (score && (!best || score > best.score)) best = { s, score };
  }
  return best?.s ?? null;
}
export async function agentChat(
  slug: string,
  messages: ChatMsg[],
): Promise<{ messages: ChatMsg[]; tool_calls: ToolTrace[]; quote: Quote | null }> {
  await wait(1000);
  const db = D();
  if (slug !== db.seller.slug) throw new Error("Storefront not found");
  const userMsgs = messages.filter((m) => m.role === "user").map((m) => m.content);
  const last = userMsgs[userMsgs.length - 1] ?? "";
  const convo = userMsgs.join("\n");
  const services = db.services.filter((s) => s.status === "published");
  const tool_calls: ToolTrace[] = [];
  const listOut = services.map((s) => ({
    id: s.id,
    title: s.title,
    price_usd: s.price_cents / 100,
    deposit_pct: s.deposit_pct,
    lead_time_days: s.lead_time_days,
  }));
  tool_calls.push({ tool: "list_services", input: { seller: slug }, output: listOut });
  const match = matchService(services, last) ?? matchService(services, convo);
  const wantsQuote = /\b(book|quote|hire|want|need|get|order|buy|interested)\b/i.test(convo);
  const email = [...convo.matchAll(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g)].map((m) => m[0]).pop() ?? null;
  const nameMatch = convo.match(
    /\b(?:my name is|i am|i'm|this is)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/,
  );
  const alreadyQuoted = messages.some(
    (m) => m.role === "assistant" && m.content.includes("Quote reference"),
  );
  let reply: string;
  let quote: Quote | null = null;
  const seller = db.seller.name;
  if (!services.length) {
    reply = `${seller} hasn't published any services yet.`;
  } else if (match && wantsQuote && alreadyQuoted && !/\b(another|new|also)\b/i.test(last)) {
    reply =
      'I\'ve already requested a quote in this conversation — use the button above to review it and pay the deposit. Say "another quote" if you need a new one.';
  } else if (match && wantsQuote && email && isEmail(email)) {
    tool_calls.push({ tool: "get_service", input: { service_id: match.id }, output: { ...match } });
    const brief = userMsgs
      .filter((m) => !/^what services/i.test(m))
      .join(" ")
      .slice(0, LIMITS.brief);
    quote = createQuote({
      service_id: match.id,
      client_name: nameMatch?.[1] ?? email.split("@")[0]!,
      client_email: email,
      brief: brief.length >= 10 ? brief : `${match.title} request via AI assistant`,
      source: "agent_sim",
    });
    tool_calls.push({
      tool: "request_quote",
      input: { service_id: match.id, client_email: email, brief: quote.brief },
      output: {
        quote_id: quote.id,
        total_usd: quote.total_cents / 100,
        deposit_usd: quote.deposit_cents / 100,
        approval_url: quote.approval_url,
      },
    });
    reply = `I've requested a quote for **${match.title}** from ${seller}.\n\n- Total: ${money(quote.total_cents)}\n- Deposit due now: ${money(quote.deposit_cents)} (${match.deposit_pct}%)\n- Balance on delivery: ${money(quote.balance_cents)}\n- Turnaround: ~${match.lead_time_days} days\n- Quote reference: ${quote.id}\n\nI can't pay on your behalf — review the quote and pay the deposit yourself with the button below.`;
  } else if (match && wantsQuote) {
    tool_calls.push({ tool: "get_service", input: { service_id: match.id }, output: { ...match } });
    reply = `**${match.title}** is ${money0(match.price_cents)} with a ${match.deposit_pct}% deposit (${money0(depositOf(match.price_cents, match.deposit_pct))}) and ~${match.lead_time_days}-day turnaround.\n\nWhat email should ${seller} send the quote to?`;
  } else if (match) {
    tool_calls.push({ tool: "get_service", input: { service_id: match.id }, output: { ...match } });
    reply = `**${match.title}** — ${money0(match.price_cents)}, ${match.deposit_pct}% deposit, ~${match.lead_time_days} days.\n\n${match.description}${match.deliverables.length ? `\n\nIncludes:\n${match.deliverables.map((d) => `- ${d}`).join("\n")}` : ""}\n\nWant me to request a quote? Just share your email.`;
  } else {
    reply = `${seller} offers:\n\n${services.map((s) => `- **${s.title}** — ${money0(s.price_cents)}, ${s.deposit_pct}% deposit, ~${s.lead_time_days} days`).join("\n")}\n\nTell me which one you'd like (and your email) and I'll request a quote.`;
  }
  return {
    messages: [...messages, { role: "assistant", content: reply }],
    tool_calls,
    quote: quote ? clone(quote) : null,
  };
}
export async function paypalConfig() {
  await wait(100);
  return { client_id: "sb-mock-client-id", env: "sandbox" as const };
}
export async function reset() {
  await wait();
  _db = seed();
  save();
  return { ok: true as const };
}
