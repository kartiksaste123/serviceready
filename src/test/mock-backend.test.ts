import { beforeEach, describe, expect, it } from "vitest";
import * as mock from "@/lib/mock";
import { draftErrors, quoteRequestErrors, rulesErrors } from "@/lib/validation";

const SLUG = "maya-rao-studio";
const newQuote = () =>
  mock.postPublicQuote(SLUG, {
    service_id: "svc_logo",
    client_name: "Test Client",
    client_email: "test@example.com",
    brief: "A logo for my new bakery please",
    source: "web",
  });

beforeEach(() => {
  window.localStorage.clear();
  mock.__resetForTests();
});

describe("quote → deposit → deliver → balance lifecycle", () => {
  it("runs the full happy path with consistent money and stats", async () => {
    const q = await newQuote();
    expect(q.status).toBe("quoted");
    expect(q.deposit_cents + q.balance_cents).toBe(q.total_cents);
    const before = await mock.getStats();

    const { order_id } = await mock.createDepositOrder(q.id);
    const again = await mock.createDepositOrder(q.id);
    expect(again.order_id).toBe(order_id); // idempotent retry, no duplicate orders
    const paid = await mock.captureDeposit(q.id, order_id);
    expect(paid.status).toBe("deposit_paid");
    // double capture is a no-op, not a second payment
    await mock.captureDeposit(q.id, order_id);
    const d1 = await mock.getQuote(q.id);
    expect(d1.payments.filter((p) => p.kind === "deposit")).toHaveLength(1);
    expect((await mock.getStats()).deposits_collected_cents).toBe(
      before.deposits_collected_cents + q.deposit_cents,
    );

    const d2 = await mock.deliver(q.id);
    expect(d2.quote.status).toBe("balance_invoiced");
    await expect(mock.deliver(q.id)).rejects.toThrow();
    const s2 = await mock.getStats();
    expect(s2.owed_by_client.some((o) => o.quote_id === q.id)).toBe(true);

    const d3 = await mock.simulateBalancePaid(q.id);
    expect(d3.quote.status).toBe("paid");
    expect(d3.payments.find((p) => p.kind === "balance")?.status).toBe("PAID");
    expect(d3.proposals.find((p) => p.status === "pending")?.action).toBe("thank_and_close");
    const s3 = await mock.getStats();
    expect(s3.owed_by_client.some((o) => o.quote_id === q.id)).toBe(false);
    expect(s3.outstanding_cents).toBe(s2.outstanding_cents - q.balance_cents);
  });

  it("blocks invalid transitions", async () => {
    const q = await newQuote();
    await expect(mock.deliver(q.id)).rejects.toThrow(/deposit/i);
    await expect(mock.captureDeposit(q.id, "bogus")).rejects.toThrow();
    await mock.cancelQuote(q.id);
    await expect(mock.createDepositOrder(q.id)).rejects.toThrow(/cancelled/i);
    await expect(mock.cancelQuote("q_priya")).rejects.toThrow();
  });

  it("validates public quote requests server-side", async () => {
    await expect(
      mock.postPublicQuote(SLUG, {
        service_id: "svc_logo",
        client_name: "",
        client_email: "x",
        brief: "",
        source: "web",
      }),
    ).rejects.toThrow();
    await expect(
      mock.postPublicQuote("nope", {
        service_id: "svc_logo",
        client_name: "A",
        client_email: "a@b.co",
        brief: "long enough brief",
        source: "web",
      }),
    ).rejects.toThrow(/not found/i);
  });

  it("refreshing PayPal status does not reset invoice age", async () => {
    const before = (await mock.getStats()).owed_by_client.find((o) => o.quote_id === "q_hannah")!;
    await mock.getQuote("q_hannah", true);
    const after = (await mock.getStats()).owed_by_client.find((o) => o.quote_id === "q_hannah")!;
    expect(after.days_since_invoice).toBe(before.days_since_invoice);
    expect(after.days_since_invoice).toBeGreaterThan(0);
  });
});

describe("collections agent & approvals", () => {
  it("never piles up duplicate pending proposals for one booking", async () => {
    await mock.runCollectionsEp("q_hannah");
    await mock.runCollectionsEp("q_hannah");
    const pending = (await mock.listProposals("pending")).filter((p) => p.quote_id === "q_hannah");
    expect(pending).toHaveLength(1);
  });

  it("respects the grace window and reminder limit", async () => {
    // q_elena's invoice is 4 days old; with a 7-day grace window it should wait.
    const s = await mock.getSeller();
    await mock.putRules({ ...s.rules, wait_days_before_nudge: 7 });
    expect((await mock.runCollectionsEp("q_elena")).proposal?.action).toBe("wait");
    await mock.putRules({ ...s.rules, wait_days_before_nudge: 1, max_reminders: 1 });
    const r1 = await mock.runCollectionsEp("q_elena");
    expect(r1.proposal?.action).toBe("send_reminder");
    await mock.approveProposal(r1.proposal!.id, r1.proposal!.draft_message);
    expect((await mock.runCollectionsEp("q_elena")).proposal?.action).toBe("escalate");
  });

  it("treats a client 'already paid' claim against PayPal evidence", async () => {
    const r = await mock.postReply("q_elena", {
      text: "I already paid this yesterday",
      from: "client",
    });
    expect(r.agent_run?.proposal?.action).toBe("send_reminder");
    expect(r.agent_run?.proposal?.evidence).toMatch(/UNPAID/);
  });

  it("doesn't run collections when there's nothing to collect", async () => {
    const r = await mock.postReply("q_jordan", { text: "When can you start?", from: "client" });
    expect(r.agent_run).toBeNull();
    await expect(mock.postReply("q_jordan", { text: "   ", from: "client" })).rejects.toThrow();
  });

  it("can't approve or reject a proposal twice", async () => {
    await mock.approveProposal("prop_hannah", "Hi Hannah, here is the link again.");
    await expect(mock.approveProposal("prop_hannah", "again")).rejects.toThrow(/already/i);
    await expect(mock.rejectProposal("prop_hannah")).rejects.toThrow(/already/i);
  });

  it("'wait' approval sends no message", async () => {
    const s = await mock.getSeller();
    await mock.putRules({ ...s.rules, wait_days_before_nudge: 30 });
    const r = await mock.runCollectionsEp("q_elena");
    const p = await mock.approveProposal(r.proposal!.id, r.proposal!.draft_message);
    expect(p.status).toBe("approved");
    const d = await mock.getQuote("q_elena");
    expect(d.events.some((e) => e.tool === "send_email" && e.created_at >= p.created_at)).toBe(
      false,
    );
  });
});

describe("catalog", () => {
  it("parses the example rate card and flags modifiers and typos", async () => {
    const r = await mock.parseCatalog(
      "logo 450 (2 rounds) | brand kit w/ logo+colors+fonts 1200, half upfront, 2wks | social templates x10 - 15, 5 days | rush +30% | website landing pg 900 2wks",
    );
    const titles = r.services.map((s) => s.title);
    expect(titles).toEqual([
      "Logo",
      "Brand kit",
      "Social templates",
      "Rush surcharge",
      "Website landing page",
    ]);
    expect(r.services[1]?.deposit_pct).toBe(50);
    expect(r.services[1]?.lead_time_days).toBe(14);
    expect(r.services[2]?.price_cents).toBe(1500);
    expect(r.flags.some((f) => f.tmp_id === r.services[3]?.tmp_id && f.severity === "error")).toBe(
      true,
    );
    expect(
      r.flags.some((f) => f.tmp_id === r.services[2]?.tmp_id && f.field === "price_cents"),
    ).toBe(true);
  });

  it("refuses to publish invalid drafts and upserts by title", async () => {
    await expect(
      mock.publishCatalog([
        {
          tmp_id: "t",
          title: "X",
          description: "",
          deliverables: [],
          price_cents: 0,
          deposit_pct: 50,
          lead_time_days: 5,
        },
      ]),
    ).rejects.toThrow();
    const before = (await mock.listServices()).length;
    await mock.publishCatalog([
      {
        tmp_id: "t",
        title: "logo design",
        description: "Updated",
        deliverables: [],
        price_cents: 50000,
        deposit_pct: 50,
        lead_time_days: 7,
      },
    ]);
    const after = await mock.listServices();
    expect(after).toHaveLength(before);
    expect(after.find((s) => s.id === "svc_logo")?.price_cents).toBe(50000);
  });
});

describe("agent chat", () => {
  it("asks for an email before creating a quote, then creates one", async () => {
    const r1 = await mock.agentChat(SLUG, [
      { role: "user", content: "I want a logo for my bakery" },
    ]);
    expect(r1.quote).toBeNull();
    const r2 = await mock.agentChat(SLUG, [
      ...r1.messages,
      { role: "user", content: "sure, my name is Sam Lee, sam@bakery.com" },
    ]);
    expect(r2.quote?.service_id).toBe("svc_logo");
    expect(r2.quote?.client_name).toBe("Sam Lee");
    expect(r2.tool_calls.map((t) => t.tool)).toContain("request_quote");
  });
});

describe("persistence", () => {
  it("survives a module reload via localStorage", async () => {
    const q = await newQuote();
    expect(window.localStorage.getItem("serviceready.demo.v2")).toContain(q.id);
  });
});

describe("validation", () => {
  it("rules, drafts and quote requests", () => {
    expect(
      Object.keys(
        rulesErrors({
          default_deposit_pct: NaN,
          max_reminders: -1,
          wait_days_before_nudge: 3,
          reminder_tone: "friendly",
        }),
      ),
    ).toEqual(["default_deposit_pct", "max_reminders"]);
    expect(
      draftErrors({
        tmp_id: "a",
        title: "",
        description: "",
        deliverables: [],
        price_cents: 0,
        deposit_pct: 0,
        lead_time_days: null,
      }),
    ).toHaveLength(4);
    expect(
      quoteRequestErrors({ client_name: "A", client_email: "a@b.co", brief: "Long enough brief" }),
    ).toEqual({});
  });
});

describe("edge-case financial invariants", () => {
  it("closes a 100%-deposit booking without a zero-value invoice", async () => {
    const [s] = await mock.publishCatalog([
      {
        tmp_id: "t",
        title: "Prepaid design audit",
        description: "A concise design review",
        deliverables: ["Review report"],
        price_cents: 10000,
        deposit_pct: 100,
        lead_time_days: 2,
      },
    ]);
    const q = await mock.postPublicQuote(SLUG, {
      service_id: s!.id,
      client_name: "A Client",
      client_email: "a@example.com",
      brief: "Review my project design please",
      source: "web",
    });
    const order = await mock.createDepositOrder(q.id);
    await mock.captureDeposit(q.id, order.order_id);
    const d = await mock.deliver(q.id);
    expect(d.quote.status).toBe("paid");
    expect(d.payments.filter((p) => p.kind === "balance")).toHaveLength(0);
  });
  it("never lets a cancelled order be captured", async () => {
    const q = await newQuote();
    const order = await mock.createDepositOrder(q.id);
    await mock.cancelQuote(q.id);
    await expect(mock.captureDeposit(q.id, order.order_id)).rejects.toThrow(/cancelled/);
  });
  it("keeps original quote prices after changing the service price", async () => {
    const q = await newQuote();
    await mock.publishCatalog([
      {
        tmp_id: "t",
        title: "Logo design",
        description: "Now a bigger package",
        deliverables: [],
        price_cents: 90000,
        deposit_pct: 60,
        lead_time_days: 10,
      },
    ]);
    expect((await mock.getQuote(q.id)).quote.total_cents).toBe(q.total_cents);
  });
  it("doesn't mistake deposit percentages or template quantities for prices", async () => {
    const r = await mock.parseCatalog(
      "logo 50% deposit $450 7 days | social templates x10 $300 5 days",
    );
    expect(r.services.map((s) => s.price_cents)).toEqual([45000, 30000]);
  });
  it("rejects duplicate names within a catalog import", async () => {
    const d = {
      tmp_id: "t",
      title: "Test",
      description: "",
      deliverables: [],
      price_cents: 10000,
      deposit_pct: 50,
      lead_time_days: 7,
    };
    await expect(mock.publishCatalog([d, { ...d, tmp_id: "t2" }])).rejects.toThrow();
  });
});
