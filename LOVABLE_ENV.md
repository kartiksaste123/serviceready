# Lovable / production environment variables

Set these on the Lovable project (and any Cloudflare / Nitro host) so the **published** demo runs live PayPal sandbox + Supabase instead of mocks.

## Required for Stage One (live sandbox)

| Name | Where | Notes |
|------|--------|-------|
| `VITE_USE_MOCKS` | Frontend | **`false`** |
| `VITE_SUPABASE_URL` | Frontend | `https://zowgpalngptmtipqcgme.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Frontend | Supabase anon (legacy) or publishable key |
| `VITE_PAYPAL_SANDBOX_BUYER_EMAIL` | Frontend | Sandbox personal buyer email (password only in README) |
| `PAYPAL_CLIENT_ID` | **Server only** | Sandbox REST app client id |
| `PAYPAL_CLIENT_SECRET` | **Server only** | Sandbox REST app secret — never `VITE_*` |
| `PAYPAL_ENV` | Server | `sandbox` |
| `SUPABASE_URL` | Server | Same project URL |
| `SUPABASE_ANON_KEY` | Server | Same anon key (demo RLS is open) |

Optional:

| Name | Notes |
|------|--------|
| `VITE_API_BASE_URL` | Leave empty for same-origin `/api/*`. Set if API is hosted elsewhere (e.g. Render). |
| `VITE_PUBLIC_ORIGIN` / `PUBLIC_ORIGIN` | Absolute origin for quote + MCP links |

## Local

1. Copy `.env.example` → `.env.local` and fill secrets (already gitignored).
2. `bun install`
3. `bun run dev`
4. Open `/s/maya-rao-studio`, request a quote, pay deposit with PayPal sandbox buyer.
5. Smoke PayPal only: `bun run smoke:paypal` (prints `{ order_id, status }` only).

## Do not commit

`.env.local`, `.paypal-sandbox-*`, `.supabase-*-key*`, `.supabase-anon-key.txt`
