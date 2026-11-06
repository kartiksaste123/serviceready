// @vitest-environment node
/**
 * Unhappy-path server tests: forged webhook signatures, duplicate deliveries,
 * AI price overrides, and deterministic risk/intent policy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* ---------- tiny in-memory Supabase stand-in ---------- */
type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
function resetTables() {
  for (const k of Object.keys(tables)) delete tables[k];
  tables["webhook_events"] = [];
  tables["payments"] = [];
  tables["quotes"] = [];
  tables["agent_events"] = [];
}
function query(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let op: "select" | "insert" | "update" = "select";
  let payload: Row | null = null;
  const rows = () => (tables[table] ??= []).filter((r) => filters.every((f) => f(r)));
  const exec = () => {
    if (op === "insert") {
      const t = (tables[table] ??= []);
      if (
        table === "webhook_events" &&
        t.some((r) => r["paypal_transmission_id"] === payload!["paypal_transmission_id"])
      ) {
        return { data: null, error: { message: "duplicate key value violates unique constraint" } };
      }
      const row = { id: `row_${t.length + 1}`, created_at: new Date().toISOString(), ...payload };
      t.push(row);
      return { data: row, error: null };
    }
    if (op === "update") {
      for (const r of rows()) Object.assign(r, payload);
      return { data: rows(), error: null };
    }
    return { data: rows(), error: null };
  };
  const b: Record<string, unknown> = {
    select: () => b,
    insert: (p: Row) => ((op = "insert"), (payload = p), b),
    update: (p: Row) => ((op = "update"), (payload = p), b),
    eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
    order: () => b,
    limit: () => b,
    maybeSingle: async () => {
      const r = exec();
      return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
    },
    single: async () => {
      const r = exec();
      return { data: Array.isArray(r.data) ? r.data[0] : r.data, error: r.error };
    },
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(exec()).then(res, rej),
  };
  return b;
}
vi.mock("../server/db", () => ({ db: () => ({ from: (t: string) => query(t) }) }));

const verifyWebhookSignature = vi.fn<() => Promise<string>>();
const getOrder = vi.fn();
vi.mock("../server/paypal", async (orig) => {
  const real = await orig<typeof import("../server/paypal")>();
  return {
    ...real,
    verifyWebhookSignature: (...a: unknown[]) => verifyWebhookSignature(...(a as [])),
    getOrder: (...a: unknown[]) => getOrder(...a),
  };
});

const live = await import("../server/live");
const { findPriceOverrides } = await import("../lib/guardrails");
const { collectionsRisk } = await import("../lib/risk");
const { depositIntentFor } = await import("../lib/deposit-policy");

const SIG_HEADERS = {
  "paypal-transmission-id": "tx-1",
  "paypal-transmission-sig": "forged",
  "paypal-transmission-time": new Date().toISOString(),
  "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT",
  "paypal-auth-algo": "SHA256withRSA",
};
const event = (id = "WH-1") =>
  JSON.stringify({ id, event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: "ORDER-1" } });
const post = (body: string, headers: Record<string, string> = {}) =>
  new Request("https://serviceready.test/api/paypal/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });

beforeEach(() => {
  resetTables();
  verifyWebhookSignature.mockReset();
  getOrder.mockReset();
});
afterEach(() => {
  delete process.env["PAYPAL_WEBHOOK_ID"];
});

describe("PayPal webhook — unhappy paths", () => {
  it("rejects a forged signature with 401 and changes nothing", async () => {
    process.env["PAYPAL_WEBHOOK_ID"] = "WH-ID";
    verifyWebhookSignature.mockResolvedValue("FAILURE");
    await expect(live.handlePaypalWebhook(post(event(), SIG_HEADERS))).rejects.toMatchObject({
      status: 401,
    });
    expect(tables["webhook_events"]).toHaveLength(0);
    expect(getOrder).not.toHaveBeenCalled();
  });

  it("rejects a delivery with missing signature headers when verification is on", async () => {
    process.env["PAYPAL_WEBHOOK_ID"] = "WH-ID";
    await expect(live.handlePaypalWebhook(post(event()))).rejects.toMatchObject({ status: 401 });
    expect(verifyWebhookSignature).not.toHaveBeenCalled();
  });

  it("is idempotent on duplicate deliveries (same transmission id)", async () => {
    process.env["PAYPAL_WEBHOOK_ID"] = "WH-ID";
    verifyWebhookSignature.mockResolvedValue("SUCCESS");
    const first = await live.handlePaypalWebhook(post(event(), SIG_HEADERS));
    expect(first.duplicate).toBeUndefined();
    expect(first.verification).toBe("signature");
    expect(first.handled).toBe("unknown_order");
    const second = await live.handlePaypalWebhook(post(event(), SIG_HEADERS));
    expect(second).toMatchObject({ duplicate: true, handled: "duplicate" });
    expect(tables["webhook_events"]).toHaveLength(1);
  });

  it("dedupes by event id when unsigned, and never trusts the payload", async () => {
    const a = await live.handlePaypalWebhook(post(event("WH-9")));
    const b = await live.handlePaypalWebhook(post(event("WH-9")));
    expect(a.verification).toBe("api_reverify");
    expect(b.duplicate).toBe(true);
  });

  it("rejects invalid JSON and missing event_type", async () => {
    await expect(live.handlePaypalWebhook(post("{nope"))).rejects.toMatchObject({ status: 400 });
    await expect(live.handlePaypalWebhook(post("{}"))).rejects.toMatchObject({ status: 400 });
  });
});

describe("money guardrails", () => {
  it("flags any attempt by an agent to set amounts, including nested", () => {
    expect(findPriceOverrides({ service_id: "s1", client_email: "a@b.co" })).toEqual([]);
    expect(findPriceOverrides({ service_id: "s1", price_usd: 1 })).toEqual(["price_usd"]);
    expect(findPriceOverrides({ quote_id: "q", deposit: { amount: 5 } })).toEqual([
      "deposit",
      "deposit.amount",
    ]);
    expect(findPriceOverrides({ total_cents: 0 })).toEqual(["total_cents"]);
  });
});

describe("collections risk + deposit intent policy", () => {
  it("scores fresh small balances low/warm and old large ones high/final", () => {
    const fresh = collectionsRisk({ outstanding_cents: 300_00, days_overdue: 1 });
    expect(fresh.band).toBe("low");
    expect(fresh.tone).toBe("warm");
    const late = collectionsRisk({
      outstanding_cents: 2500_00,
      days_overdue: 40,
      history: { paid: 0, overdue_elsewhere: 1, cancelled: 0 },
      reminders_sent: 2,
    });
    expect(late.band).toBe("high");
    expect(late.tone).toBe("final");
    expect(late.score).toBeLessThanOrEqual(100);
  });
  it("credits clients who paid before", () => {
    const base = { outstanding_cents: 900_00, days_overdue: 12 };
    const stranger = collectionsRisk({ ...base, history: { paid: 0, overdue_elsewhere: 0, cancelled: 0 } });
    const loyal = collectionsRisk({ ...base, history: { paid: 3, overdue_elsewhere: 0, cancelled: 0 } });
    expect(loyal.score).toBeLessThan(stranger.score);
  });
  it("authorizes large deposits and captures small ones", () => {
    expect(depositIntentFor(135_00)).toBe("CAPTURE");
    expect(depositIntentFor(600_00)).toBe("AUTHORIZE");
    expect(depositIntentFor(600_00, 0)).toBe("CAPTURE");
  });
});

const { quoteSig, orderFingerprint } = await import("../server/fingerprint");
describe("tamper-proofing on the live money path", () => {
  const seedQuote = (patch: Record<string, unknown> = {}) => {
    const q = {
      id: "q-t1",
      seller_id: "sel",
      service_id: "svc",
      service_title: "Brand kit",
      client_name: "Sam",
      client_email: "sam@example.com",
      line_items: [{ label: "Brand kit", amount_cents: 1350_00 }],
      total_cents: 1350_00,
      deposit_cents: 675_00,
      balance_cents: 675_00,
      status: "quoted",
      source: "mcp",
      approval_url: "",
    };
    const row = { ...q, price_sig: quoteSig(q), ...patch };
    tables["quotes"]!.push(row);
    return row;
  };

  it("refuses to create a PayPal order for a quote edited to $1", async () => {
    seedQuote({ deposit_cents: 1_00, balance_cents: 1349_00 });
    await expect(live.createDepositOrder("q-t1")).rejects.toMatchObject({ status: 409 });
    expect(tables["agent_events"]!.some((e) => e["tool"] === "guardrail.tamper_blocked")).toBe(true);
    expect(tables["payments"]).toHaveLength(0);
  });

  it("refuses to capture when PayPal's order amount doesn't match the stored fingerprint", async () => {
    seedQuote();
    tables["payments"]!.push({
      id: "pay-1",
      quote_id: "q-t1",
      kind: "deposit",
      amount_cents: 675_00,
      status: "CREATED",
      paypal_order_id: "ORDER-T",
      intent: "CAPTURE",
      fingerprint: orderFingerprint({
        quote_id: "q-t1",
        kind: "deposit",
        amount_cents: 675_00,
        currency: "USD",
        intent: "CAPTURE",
      }),
    });
    getOrder.mockResolvedValue({
      id: "ORDER-T",
      status: "APPROVED",
      intent: "CAPTURE",
      customId: "q-t1",
      amountCents: 1_00,
      currency: "USD",
    });
    await expect(live.captureDeposit("q-t1", "ORDER-T")).rejects.toMatchObject({ status: 409 });
    const q = tables["quotes"]!.find((r) => r["id"] === "q-t1")!;
    expect(q["status"]).toBe("quoted");
  });

  it("tamper demo reports every lock as blocking", async () => {
    const r = await live.tamperDemo();
    expect(r.checks.length).toBeGreaterThanOrEqual(4);
    expect(r.checks.every((c) => c.ok)).toBe(true);
  });
});
