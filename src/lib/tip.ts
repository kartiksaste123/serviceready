/** Final-bill tip rules (client-chosen, human input only — agents can never set a tip). */
export const TIP_PRESETS_PCT = [0, 10, 15, 20] as const;
/** Cap a tip at 50% of the service total so typos ($5000 instead of $50) can't go out. */
export const MAX_TIP_PCT = 50;

export function tipFromPct(total_cents: number, pct: number): number {
  return Math.round((total_cents * pct) / 100);
}

export function tipError(total_cents: number, tip_cents: number): string | null {
  if (!Number.isSafeInteger(tip_cents) || tip_cents < 0) return "Tip must be a positive amount.";
  if (tip_cents > tipFromPct(total_cents, MAX_TIP_PCT))
    return `Tips are capped at ${MAX_TIP_PCT}% of the service total.`;
  return null;
}

/** Balance invoice lines: remaining balance plus an optional tip line. */
export function finalBill(balance_cents: number, tip_cents: number) {
  const lines = [{ label: "Balance", amount_cents: balance_cents }];
  if (tip_cents > 0) lines.push({ label: "Tip — thank you", amount_cents: tip_cents });
  return { lines, total_cents: balance_cents + tip_cents };
}
