/**
 * Deterministic cancellation / no-show policy engine (shared by server, mock backend and UI).
 * No model is involved: the seller sets three numbers, every cancel runs through `decideCancel`,
 * and the timeline records which rule fired. Agents may only *quote* the policy from these fields.
 */
export interface CancelPolicy {
  /** Client may cancel for free within this many hours of paying the deposit (and before work starts). */
  free_cancel_hours: number;
  /** % of the deposit the seller keeps on a late client cancel (after the window or once work started). */
  late_cancel_keep_pct: number;
  /** % of the deposit the seller keeps when the client no-shows / goes unreachable. */
  no_show_keep_pct: number;
}

export const DEFAULT_CANCEL_POLICY: CancelPolicy = {
  free_cancel_hours: 48,
  late_cancel_keep_pct: 50,
  no_show_keep_pct: 100,
};

export type CancelReason = "client_cancel" | "no_show" | "seller_cancel";
export const CANCEL_REASONS: CancelReason[] = ["client_cancel", "no_show", "seller_cancel"];

export type CancelRule =
  "unpaid_quote" | "seller_cancel_full_release" | "free_cancel_window" | "late_cancel" | "no_show";

export type DepositState = "none" | "held" | "captured";

/** What PayPal call the decision maps to. */
export type CancelAction =
  | "cancel_only" // nothing paid
  | "void" // held → release everything
  | "capture_full" // held → keep everything
  | "capture_partial" // held → capture kept part (final_capture releases the rest)
  | "refund_full" // captured → give everything back
  | "refund_partial" // captured → give part back
  | "keep_full"; // captured → keep everything, no PayPal call

export interface CancelDecision {
  rule: CancelRule;
  action: CancelAction;
  keep_cents: number;
  release_cents: number;
  keep_pct: number;
  explanation: string;
}

const clampInt = (n: unknown, lo: number, hi: number, dflt: number) => {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : dflt;
  return Math.min(hi, Math.max(lo, v));
};

export function normalizePolicy(p?: Partial<CancelPolicy> | null): CancelPolicy {
  return {
    free_cancel_hours: clampInt(
      p?.free_cancel_hours,
      0,
      720,
      DEFAULT_CANCEL_POLICY.free_cancel_hours,
    ),
    late_cancel_keep_pct: clampInt(
      p?.late_cancel_keep_pct,
      0,
      100,
      DEFAULT_CANCEL_POLICY.late_cancel_keep_pct,
    ),
    no_show_keep_pct: clampInt(p?.no_show_keep_pct, 0, 100, DEFAULT_CANCEL_POLICY.no_show_keep_pct),
  };
}

export function cancelPolicyErrors(p: CancelPolicy): Partial<Record<keyof CancelPolicy, string>> {
  const e: Partial<Record<keyof CancelPolicy, string>> = {};
  const int = (v: number) => Number.isFinite(v) && Number.isInteger(v);
  if (!int(p.free_cancel_hours) || p.free_cancel_hours < 0 || p.free_cancel_hours > 720)
    e.free_cancel_hours = "Use whole hours from 0 to 720.";
  if (!int(p.late_cancel_keep_pct) || p.late_cancel_keep_pct < 0 || p.late_cancel_keep_pct > 100)
    e.late_cancel_keep_pct = "Use a whole % from 0 to 100.";
  if (!int(p.no_show_keep_pct) || p.no_show_keep_pct < 0 || p.no_show_keep_pct > 100)
    e.no_show_keep_pct = "Use a whole % from 0 to 100.";
  return e;
}

const usd = (c: number) =>
  `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function decideCancel(input: {
  policy: CancelPolicy;
  reason: CancelReason;
  deposit_cents: number;
  deposit_state: DepositState;
  /** ISO time PayPal confirmed the deposit (capture or authorization). */
  deposit_paid_at?: string | null;
  work_started?: boolean;
  now?: number;
}): CancelDecision {
  const p = normalizePolicy(input.policy);
  const dep = Math.max(0, Math.round(input.deposit_cents));
  if (input.deposit_state === "none" || dep === 0) {
    return {
      rule: "unpaid_quote",
      action: "cancel_only",
      keep_cents: 0,
      release_cents: 0,
      keep_pct: 0,
      explanation: "No deposit was taken — the quote is simply cancelled.",
    };
  }
  const held = input.deposit_state === "held";
  const finish = (rule: CancelRule, keep_pct: number, why: string): CancelDecision => {
    const keep_cents = Math.min(dep, Math.round((dep * keep_pct) / 100));
    const release_cents = dep - keep_cents;
    const action: CancelAction =
      keep_cents === 0
        ? held
          ? "void"
          : "refund_full"
        : release_cents === 0
          ? held
            ? "capture_full"
            : "keep_full"
          : held
            ? "capture_partial"
            : "refund_partial";
    const money =
      keep_cents === 0
        ? held
          ? `the ${usd(dep)} hold is voided (client never charged)`
          : `the full ${usd(dep)} deposit is refunded`
        : release_cents === 0
          ? held
            ? `the full ${usd(dep)} hold is captured`
            : `the ${usd(dep)} deposit is kept`
          : held
            ? `${usd(keep_cents)} of the hold is captured and ${usd(release_cents)} released`
            : `${usd(keep_cents)} is kept and ${usd(release_cents)} refunded`;
    return { rule, action, keep_cents, release_cents, keep_pct, explanation: `${why} → ${money}.` };
  };

  if (input.reason === "seller_cancel") {
    return finish("seller_cancel_full_release", 0, "Seller cancelled");
  }
  if (input.reason === "no_show") {
    return finish(
      "no_show",
      p.no_show_keep_pct,
      `Client no-show (policy keeps ${p.no_show_keep_pct}%)`,
    );
  }
  const now = input.now ?? Date.now();
  const paidAt = input.deposit_paid_at ? Date.parse(input.deposit_paid_at) : NaN;
  const hoursSince = Number.isFinite(paidAt) ? (now - paidAt) / 36e5 : Infinity;
  const inWindow = !input.work_started && hoursSince <= p.free_cancel_hours;
  if (inWindow) {
    return finish(
      "free_cancel_window",
      0,
      `Client cancelled ${Math.max(0, Math.floor(hoursSince))}h after paying, inside the ${p.free_cancel_hours}h free window`,
    );
  }
  return finish(
    "late_cancel",
    p.late_cancel_keep_pct,
    input.work_started
      ? `Client cancelled after work started (policy keeps ${p.late_cancel_keep_pct}%)`
      : `Client cancelled after the ${p.free_cancel_hours}h free window (policy keeps ${p.late_cancel_keep_pct}%)`,
  );
}

/** One-line, deterministic policy text — the only wording agents are allowed to use. */
export function describeCancelPolicy(policy: CancelPolicy): string {
  const p = normalizePolicy(policy);
  const free =
    p.free_cancel_hours > 0
      ? `Free cancellation within ${p.free_cancel_hours}h of paying the deposit (before work starts)`
      : "No free-cancellation window";
  const late =
    p.late_cancel_keep_pct === 0
      ? "later cancellations are fully refunded"
      : `after that, ${p.late_cancel_keep_pct}% of the deposit is kept`;
  const ns =
    p.no_show_keep_pct === 0
      ? "no-shows are fully refunded"
      : `no-show keeps ${p.no_show_keep_pct}% of the deposit`;
  return `${free}; ${late}; ${ns}. If the seller cancels, the deposit is always fully released.`;
}

/** Structured form returned to MCP / storefront agents. */
export function policyForAgents(policy: CancelPolicy) {
  const p = normalizePolicy(policy);
  return {
    ...p,
    seller_cancel_keep_pct: 0,
    summary: describeCancelPolicy(p),
    enforced_by: "deterministic server rules + PayPal void/capture/refund — agents can't change it",
  };
}
