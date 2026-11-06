/**
 * Hard money guardrails: AI / outside agents never set amounts.
 * Prices, deposits and totals only ever come from the seller's published catalog.
 * Any tool call that tries to pass a money field is rejected (and audited) — never silently ignored.
 */
const MONEY_KEY =
  /^(amount|amounts|amount_cents|amount_usd|price|prices|price_cents|price_usd|unit_price|total|total_cents|total_usd|deposit|deposit_cents|deposit_usd|deposit_pct|deposit_percent|balance|balance_cents|balance_usd|discount|discount_pct|discount_cents|value|cost|cost_cents|rate|fee|fees|override_price|custom_price|currency_value)$/i;

/** Returns dotted paths of money-like keys found anywhere in tool args. */
export function findPriceOverrides(args: unknown, path = ""): string[] {
  if (!args || typeof args !== "object") return [];
  const hits: string[] = [];
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    const p = path ? `${path}.${k}` : k;
    if (MONEY_KEY.test(k) && v !== undefined && v !== null && v !== "") hits.push(p);
    if (v && typeof v === "object") hits.push(...findPriceOverrides(v, p));
  }
  return hits;
}

export const GUARDRAIL_MESSAGE =
  "Guardrail: AI agents can't set prices or amounts. Totals and deposits come only from the seller's published catalog — remove the money fields and call again.";
