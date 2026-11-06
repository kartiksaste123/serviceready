// @vitest-environment node
/** Cancellation policy engine, final-bill tip rules and tamper-proof fingerprints. */
import { describe, expect, it } from "vitest";
import {
  decideCancel,
  describeCancelPolicy,
  DEFAULT_CANCEL_POLICY,
  cancelPolicyErrors,
} from "../lib/cancel-policy";
import { finalBill, tipError, tipFromPct } from "../lib/tip";
import { orderFingerprint, quoteMathErrors, quoteSig, safeEqualHex } from "../server/fingerprint";
import { findPriceOverrides } from "../lib/guardrails";

const H = 36e5;
const now = Date.parse("2026-11-06T12:00:00Z");
const base = {
  policy: { free_cancel_hours: 48, late_cancel_keep_pct: 50, no_show_keep_pct: 100 },
  deposit_cents: 600_00,
  now,
};

describe("cancellation policy engine", () => {
  it("voids a held deposit inside the free window", () => {
    const d = decideCancel({
      ...base,
      reason: "client_cancel",
      deposit_state: "held",
      deposit_paid_at: new Date(now - 5 * H).toISOString(),
    });
    expect(d).toMatchObject({
      rule: "free_cancel_window",
      action: "void",
      keep_cents: 0,
      release_cents: 600_00,
    });
  });
  it("partially captures a held deposit on a late cancel", () => {
    const d = decideCancel({
      ...base,
      reason: "client_cancel",
      deposit_state: "held",
      deposit_paid_at: new Date(now - 72 * H).toISOString(),
    });
    expect(d).toMatchObject({
      rule: "late_cancel",
      action: "capture_partial",
      keep_cents: 300_00,
      release_cents: 300_00,
    });
  });
  it("treats any cancel after work started as late, even inside the window", () => {
    const d = decideCancel({
      ...base,
      reason: "client_cancel",
      deposit_state: "captured",
      deposit_paid_at: new Date(now - 1 * H).toISOString(),
      work_started: true,
    });
    expect(d).toMatchObject({ rule: "late_cancel", action: "refund_partial", keep_cents: 300_00 });
  });
  it("keeps the whole deposit on a no-show and releases everything on seller cancel", () => {
    const ns = decideCancel({ ...base, reason: "no_show", deposit_state: "captured" });
    expect(ns).toMatchObject({ rule: "no_show", action: "keep_full", keep_cents: 600_00 });
    const nsHeld = decideCancel({ ...base, reason: "no_show", deposit_state: "held" });
    expect(nsHeld.action).toBe("capture_full");
    const sc = decideCancel({ ...base, reason: "seller_cancel", deposit_state: "captured" });
    expect(sc).toMatchObject({
      rule: "seller_cancel_full_release",
      action: "refund_full",
      release_cents: 600_00,
    });
  });
  it("just cancels an unpaid quote", () => {
    expect(decideCancel({ ...base, reason: "no_show", deposit_state: "none" }).action).toBe(
      "cancel_only",
    );
  });
  it("describes the policy deterministically and validates fields", () => {
    expect(describeCancelPolicy(DEFAULT_CANCEL_POLICY)).toMatch(/48h.*50%.*no-show keeps 100%/);
    expect(
      cancelPolicyErrors({
        free_cancel_hours: -1,
        late_cancel_keep_pct: 101,
        no_show_keep_pct: 1.5,
      }),
    ).toHaveProperty("free_cancel_hours");
  });
});

describe("final bill tip", () => {
  it("adds a tip line and caps oversized tips", () => {
    expect(finalBill(900_00, 135_00)).toEqual({
      lines: [
        { label: "Balance", amount_cents: 900_00 },
        { label: "Tip — thank you", amount_cents: 135_00 },
      ],
      total_cents: 1035_00,
    });
    expect(tipFromPct(1350_00, 15)).toBe(202_50);
    expect(tipError(1350_00, 100_00)).toBeNull();
    expect(tipError(1350_00, 900_00)).toMatch(/capped/);
    expect(tipError(1350_00, -1)).toBeTruthy();
  });
  it("agents can never set a tip or refund amount", () => {
    expect(findPriceOverrides({ quote_id: "q", tip_pct: 20 })).toEqual(["tip_pct"]);
    expect(findPriceOverrides({ quote_id: "q", keep_pct: 0 })).toEqual(["keep_pct"]);
  });
});

describe("tamper-proofing", () => {
  const q = {
    id: "q1",
    service_id: "s1",
    total_cents: 1350_00,
    deposit_cents: 675_00,
    balance_cents: 675_00,
    line_items: [{ label: "Brand kit", amount_cents: 1350_00 }],
  };
  it("breaks the quote signature when the deposit is edited to $1", () => {
    const sig = quoteSig(q);
    expect(safeEqualHex(sig, quoteSig({ ...q }))).toBe(true);
    const tampered = { ...q, deposit_cents: 100, balance_cents: 1349_00 };
    expect(safeEqualHex(sig, quoteSig(tampered))).toBe(false);
    expect(quoteMathErrors({ ...q, deposit_cents: 100 })).toContain("deposit + balance ≠ total");
  });
  it("order fingerprint changes with amount, currency or intent", () => {
    const f = {
      quote_id: "q1",
      kind: "deposit" as const,
      amount_cents: 675_00,
      currency: "USD",
      intent: "AUTHORIZE" as const,
    };
    const fp = orderFingerprint(f);
    expect(safeEqualHex(fp, orderFingerprint({ ...f }))).toBe(true);
    expect(safeEqualHex(fp, orderFingerprint({ ...f, amount_cents: 100 }))).toBe(false);
    expect(safeEqualHex(fp, orderFingerprint({ ...f, currency: "EUR" }))).toBe(false);
    expect(safeEqualHex(fp, orderFingerprint({ ...f, intent: "CAPTURE" }))).toBe(false);
  });
});
