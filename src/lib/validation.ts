// Shared validation rules used by both the UI and the mock backend so the
// client can never publish/save something the backend would reject.
import type { Flag, SellerRules, ServiceDraft } from "./types";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const isEmail = (v: string) => EMAIL_RE.test(v.trim());

export const LIMITS = {
  title: 80,
  description: 400,
  deliverable: 60,
  maxDeliverables: 12,
  maxPriceCents: 10_000_000, // $100,000
  maxLeadDays: 365,
  name: 100,
  email: 255,
  brief: 2000,
  message: 2000,
} as const;

/** Hard errors that block publishing a draft service. */
export function draftErrors(d: ServiceDraft): Flag[] {
  const out: Flag[] = [];
  const f = (field: string, message: string) =>
    out.push({ tmp_id: d.tmp_id, field, severity: "error", message });
  if (!d.title.trim()) f("title", "Add a service name.");
  else if (d.title.trim().length > LIMITS.title)
    f("title", `Keep the name under ${LIMITS.title} characters.`);
  if (!Number.isSafeInteger(d.price_cents) || d.price_cents <= 0)
    f("price_cents", "Add a price above $0.");
  else if (d.price_cents > LIMITS.maxPriceCents)
    f("price_cents", "Price looks too high — check for an extra zero.");
  if (!Number.isInteger(d.deposit_pct) || d.deposit_pct < 1 || d.deposit_pct > 100)
    f("deposit_pct", "Deposit must be a whole number between 1% and 100%.");
  if (d.lead_time_days == null)
    f("lead_time_days", "Add a turnaround time so assistants can quote reliably.");
  else if (
    !Number.isInteger(d.lead_time_days) ||
    d.lead_time_days < 1 ||
    d.lead_time_days > LIMITS.maxLeadDays
  )
    f("lead_time_days", `Turnaround must be between 1 and ${LIMITS.maxLeadDays} days.`);
  if (
    Number.isFinite(d.price_cents) &&
    Number.isFinite(d.deposit_pct) &&
    d.price_cents > 0 &&
    depositOf(d.price_cents, d.deposit_pct) < 1
  )
    f("deposit_pct", "The deposit must be at least $0.01.");
  if (d.description.length > LIMITS.description)
    f("description", "Keep the description under 400 characters.");
  if (
    d.deliverables.length > LIMITS.maxDeliverables ||
    d.deliverables.some((v) => !v.trim() || v.length > LIMITS.deliverable)
  )
    f("deliverables", "Use up to 12 non-empty deliverables, each under 60 characters.");
  return out;
}

export function rulesErrors(r: SellerRules): Partial<Record<keyof SellerRules, string>> {
  const e: Partial<Record<keyof SellerRules, string>> = {};
  const int = (v: number) => Number.isFinite(v) && Number.isInteger(v);
  if (!int(r.default_deposit_pct) || r.default_deposit_pct < 1 || r.default_deposit_pct > 100)
    e.default_deposit_pct = "Use a whole number from 1 to 100.";
  if (!int(r.max_reminders) || r.max_reminders < 0 || r.max_reminders > 10)
    e.max_reminders = "Use a whole number from 0 to 10.";
  if (
    !int(r.wait_days_before_nudge) ||
    r.wait_days_before_nudge < 0 ||
    r.wait_days_before_nudge > 60
  )
    e.wait_days_before_nudge = "Use a whole number from 0 to 60.";
  if (!["friendly", "neutral", "firm"].includes(r.reminder_tone)) e.reminder_tone = "Pick a tone.";
  return e;
}

export function quoteRequestErrors(b: {
  client_name: string;
  client_email: string;
  brief: string;
}) {
  const e: Partial<Record<"client_name" | "client_email" | "brief", string>> = {};
  if (!b.client_name.trim()) e.client_name = "Enter your name.";
  else if (b.client_name.length > LIMITS.name) e.client_name = "Name is too long.";
  if (!isEmail(b.client_email)) e.client_email = "Enter a valid email address.";
  if (b.brief.trim().length < 10)
    e.brief = "Add a sentence or two about the project (10+ characters).";
  else if (b.brief.length > LIMITS.brief) e.brief = "Brief is too long.";
  return e;
}

export const depositOf = (price_cents: number, pct: number) =>
  Math.round((price_cents * pct) / 100);

/** Validate the full import atomically, including duplicate service names. */
export function catalogErrors(drafts: ServiceDraft[]): Flag[] {
  const counts = new Map<string, number>();
  for (const d of drafts) {
    const key = d.title.trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return drafts.flatMap((d) => [
    ...draftErrors(d),
    ...(d.title.trim() && (counts.get(d.title.trim().toLowerCase()) ?? 0) > 1
      ? [
          {
            tmp_id: d.tmp_id,
            field: "title",
            severity: "error" as const,
            message: "A service with this name appears twice. Use unique names or remove one.",
          },
        ]
      : []),
  ]);
}
