# Environment variables (Render live demo)

The live demo runs on **Render** (`srv-dbmonf61egvs73d783g0`, blueprint in `render.yaml`) at https://serviceready.onrender.com. Set secrets in the Render dashboard; never commit them and never put secrets in `VITE_*`.

| Name | Where | Value / notes |
|------|-------|---------------|
| `VITE_USE_MOCKS` | build | **`false`** (live sandbox + Supabase) |
| `NITRO_PRESET` | build | `node-server` |
| `PUBLIC_ORIGIN` | server | `https://serviceready.onrender.com` (quote, MCP and PayPal return links) |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | **server only** | Sandbox REST app |
| `PAYPAL_ENV` | server | `sandbox` |
| `PAYPAL_WEBHOOK_ID` | server | Webhook registered for `https://serviceready.onrender.com/api/paypal/webhook` (signature verification) |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | server | Project `zowgpalngptmtipqcgme` |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | build | Same project (anon key only) |
| `XAI_API_KEY` | **server only** | xAI Grok key |
| `OPENAI_BASE_URL` | server | `https://api.x.ai/v1` |
| `OPENAI_MODEL` | server | `grok-4.20-0309-non-reasoning` (fast, ~2–4 s per agent turn) |
| `VITE_PAYPAL_SANDBOX_BUYER_EMAIL` | build | Sandbox buyer email for the Judge banner (password only in README) |

`OPENAI_API_KEY` takes precedence over `XAI_API_KEY` if both are set.

## Check what the deploy is wired to

`GET /api/health` returns `{ paypal: { env, webhook_signature_verification }, ai: { provider, model }, supabase: { reachable }, mcp }` — never secrets.

## Database

Schema: `supabase/migrations/20261106071343_serviceready_core_schema.sql`. Demo seller + services: `supabase/seed.sql`.

## Local

```bash
cp .env.example .env.local   # fill secrets (gitignored)
bun install
bun run dev                  # live sandbox + Supabase
bun run dev:mock             # localStorage mocks, no keys
bun run smoke:paypal         # creates a $1 sandbox order, prints id + status only
```
