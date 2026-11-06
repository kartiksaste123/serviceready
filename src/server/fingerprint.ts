/**
 * Visible tamper-proofing for money (server-only).
 *
 * 1. `quoteSig` — HMAC over a quote's amounts, written when the quote is priced from the catalog.
 *    Any later edit to total/deposit/balance (e.g. someone PATCHing the row to "$1") breaks it.
 * 2. `orderFingerprint` — HMAC over quote id + kind + amount + currency + intent, stored with the
 *    PayPal order. Before capture/authorize we re-read the order from PayPal, recompute the
 *    fingerprint from PayPal's own numbers and reject any mismatch.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

function signingKey(): string {
  const env = typeof process !== "undefined" ? process.env : {};
  return (
    env["QUOTE_SIGNING_SECRET"]?.trim() ||
    // Server-only secret that already exists on Render; never sent to the browser.
    (env["PAYPAL_CLIENT_SECRET"]?.trim()
      ? `sr-quote:${env["PAYPAL_CLIENT_SECRET"]!.trim()}`
      : "") ||
    "serviceready-dev-signing-key"
  );
}

const hmac = (msg: string) => createHmac("sha256", signingKey()).update(msg).digest("hex");

export function safeEqualHex(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export interface PricedQuote {
  id: string;
  service_id: string;
  total_cents: number;
  deposit_cents: number;
  balance_cents: number;
  line_items: unknown;
}

const lineSum = (li: unknown) =>
  Array.isArray(li)
    ? li.reduce((n, x) => n + (Number((x as { amount_cents?: number })?.amount_cents) || 0), 0)
    : NaN;

export function quoteSig(q: PricedQuote): string {
  return hmac(
    `quote|v1|${q.id}|${q.service_id}|${q.total_cents}|${q.deposit_cents}|${q.balance_cents}|USD|${lineSum(q.line_items)}`,
  );
}

/** Arithmetic invariants every quote must satisfy before money moves. */
export function quoteMathErrors(q: PricedQuote): string[] {
  const e: string[] = [];
  const ints = [q.total_cents, q.deposit_cents, q.balance_cents];
  if (ints.some((n) => !Number.isSafeInteger(n) || n < 0))
    e.push("amounts must be non-negative cents");
  if (q.deposit_cents + q.balance_cents !== q.total_cents) e.push("deposit + balance ≠ total");
  if (lineSum(q.line_items) !== q.total_cents) e.push("line items ≠ total");
  return e;
}

export interface OrderFacts {
  quote_id: string;
  kind: "deposit" | "balance";
  amount_cents: number;
  currency: string;
  intent: "CAPTURE" | "AUTHORIZE";
}

export function orderFingerprint(f: OrderFacts): string {
  return hmac(
    `order|v1|${f.quote_id}|${f.kind}|${f.amount_cents}|${f.currency.toUpperCase()}|${f.intent}`,
  );
}

export type TamperCheck = { check: string; ok: boolean; detail: string };
