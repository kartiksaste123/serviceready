/**
 * Deterministic collections risk score (no AI): days overdue × amount × client pay history.
 * Same function runs on the desk (grid/collections) and in the collections agent, so the
 * tone hint the agent drafts with is exactly what the seller sees.
 */
import type { Quote } from "./types";

export type RiskBand = "low" | "medium" | "high";
export type ReminderTone = "warm" | "firm" | "final";

export interface ClientHistory {
  /** Other bookings this client paid in full. */
  paid: number;
  /** Other bookings with a balance invoice still open > 14 days. */
  overdue_elsewhere: number;
  /** Other bookings cancelled. */
  cancelled: number;
}

export interface CollectionsRisk {
  score: number; // 0–100
  band: RiskBand;
  tone: ReminderTone;
  factors: string[];
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function collectionsRisk(input: {
  outstanding_cents: number;
  days_overdue: number;
  history?: ClientHistory | null | undefined;
  reminders_sent?: number | undefined;
}): CollectionsRisk {
  const days = Math.max(0, input.days_overdue);
  const factors: string[] = [];

  // Overdue: up to 45 pts, saturating at 30 days.
  const overduePts = clamp(days / 30, 0, 1) * 45;
  if (days >= 14) factors.push(`${days} days overdue`);
  else if (days >= 7) factors.push(`${days} days since invoice`);

  // Amount: up to 25 pts, saturating at $2,000 outstanding.
  const amountPts = clamp(input.outstanding_cents / 2000_00, 0, 1) * 25;
  if (input.outstanding_cents >= 1000_00) factors.push("large balance");

  // History: up to 20 pts. Unknown clients get a small prior; repeat payers earn credit.
  let historyPts = 6;
  const h = input.history;
  if (h) {
    const total = h.paid + h.overdue_elsewhere + h.cancelled;
    if (total > 0) {
      const bad = (h.overdue_elsewhere + h.cancelled * 0.5) / total;
      historyPts = clamp(bad * 20 - Math.min(h.paid, 3) * 2, 0, 20);
      if (h.paid > 0 && bad === 0) factors.push(`paid ${h.paid} earlier booking${h.paid > 1 ? "s" : ""}`);
      if (h.overdue_elsewhere > 0) factors.push("overdue on another booking");
    } else {
      factors.push("first booking");
    }
  }

  // Ignored reminders: up to 10 pts.
  const reminders = input.reminders_sent ?? 0;
  const reminderPts = clamp(reminders * 4, 0, 10);
  if (reminders > 0) factors.push(`${reminders} reminder${reminders > 1 ? "s" : ""} sent`);

  const score = Math.round(clamp(overduePts + amountPts + historyPts + reminderPts, 0, 100));
  const band: RiskBand = score >= 60 ? "high" : score >= 30 ? "medium" : "low";
  let tone: ReminderTone = band === "high" ? "final" : band === "medium" ? "firm" : "warm";
  if (reminders >= 2 && tone === "warm") tone = "firm";
  return { score, band, tone, factors };
}

/** Days since the balance invoice went out (quote moves to balance_invoiced at send time). */
export function daysOverdue(q: Pick<Quote, "status" | "updated_at">, now = Date.now()): number {
  if (q.status !== "balance_invoiced") return 0;
  return Math.max(0, Math.floor((now - new Date(q.updated_at).getTime()) / 864e5));
}

/** Pay history for a client email across the seller's other bookings. */
export function historyFor(
  quotes: Array<Pick<Quote, "id" | "client_email" | "status" | "updated_at">>,
  email: string,
  excludeId?: string,
  now = Date.now(),
): ClientHistory {
  const mine = quotes.filter(
    (q) => q.id !== excludeId && q.client_email.toLowerCase() === email.toLowerCase(),
  );
  return {
    paid: mine.filter((q) => q.status === "paid").length,
    overdue_elsewhere: mine.filter((q) => q.status === "balance_invoiced" && daysOverdue(q, now) > 14)
      .length,
    cancelled: mine.filter((q) => q.status === "cancelled").length,
  };
}

/** Risk for an invoiced booking, or null when nothing is owed yet. */
export function riskForQuote(
  q: Quote,
  all: Quote[],
  now = Date.now(),
): CollectionsRisk | null {
  if (q.status !== "balance_invoiced" || q.balance_cents <= 0) return null;
  return collectionsRisk({
    outstanding_cents: q.balance_cents,
    days_overdue: daysOverdue(q, now),
    history: historyFor(all, q.client_email, q.id, now),
  });
}

export const TONE_GUIDE: Record<ReminderTone, string> = {
  warm: "warm and friendly — assume good intent, light touch",
  firm: "polite but firm — clear amount, clear ask, mention the invoice is overdue",
  final: "final notice — courteous, direct, state next steps if unpaid; no threats",
};
