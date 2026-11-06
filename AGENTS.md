# ServiceReady agent notes

> Deployed on **Render** (`https://serviceready.onrender.com`), branch `master`.
> Default story for judges: live PayPal sandbox + Supabase + Grok — not Lovable or Fly.

- All data access goes through `src/lib/api.ts`; it uses `src/lib/mock.ts` unless `VITE_USE_MOCKS === 'false'`.
- PayPal Agent Toolkit lives in `src/server/paypal-toolkit.ts` (collections, refund, approved remind).
- MCP payment mandates live in `src/server/mandates.ts` (spend limit + revocable key for `create_deposit_link`).
- `PayPalDepositButton`, `BookingsGrid`, `CollectionsStudio` are swap-in seams; keep their props stable.
- Frontend presentation uses only semantic light-mode tokens from `src/styles.css`.
- Deposit intent policy: `src/lib/deposit-policy.ts` (AUTHORIZE ≥ `DEPOSIT_AUTHORIZE_MIN_USD`, default $500); payments rows carry `intent` + `paypal_authorization_id`.
- Money guardrails: `src/lib/guardrails.ts` — never let agent/LLM args set amounts.
- Collections risk: `src/lib/risk.ts` (shared by desk UI and collections agent).
- Seller catalog reads are cached in `live.ts` (`publishedCatalog`); call `invalidateCatalogCache()` after any services/seller write.
- Cancellation / no-show policy: `src/lib/cancel-policy.ts` (`decideCancel` is the only place refund/keep math lives). Policy columns on `sellers`; snapshot in `quotes.cancel_policy`. `cancelQuote(id, req, { reason })` maps the decision to PayPal void / partial capture / refund.
- Final-bill tip: `src/lib/tip.ts`; `POST /api/quotes/:id/tip` (client, pre-invoice); `deliver` adds a tip line to the Invoicing v2 bill.
- Tamper-proofing: `src/server/fingerprint.ts` — `quotes.price_sig` (HMAC of amounts) and `payments.fingerprint` (HMAC of quote+kind+amount+currency+intent), verified against PayPal's order in `verifyOrderBeforeMoney` before any capture/authorize. Never write amounts without re-signing.
- Every PayPal money write must send `PayPal-Request-Id` (deterministic per operation).
