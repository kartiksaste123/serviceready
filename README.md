# ServiceReady

**Deposit-before-work merchant storefront** — AI assistants discover services, request a quote, and collect a **PayPal deposit before work starts**. **PayPal evidence beats client claims.** AI never sets amounts (catalog prices only). After delivery, a real **PayPal invoice** covers the balance; reminders are drafted by AI and **human-approved**. Outside agents use MCP with a **revocable spend-limited payment mandate** before `create_deposit_link`.

Built for the [PayPal AI Hackathon 2026](https://paypalaihackathon.devpost.com/).

- **Live demo:** https://serviceready.onrender.com
- **Demo seller storefront:** https://serviceready.onrender.com/s/maya-rao-studio
- **MCP server (for Claude / ChatGPT / Cursor):** `https://serviceready.onrender.com/mcp/maya-rao-studio`
- **Deploy health:** https://serviceready.onrender.com/api/health
- **License:** MIT

## Judge path (~3 minutes)

1. Open the live demo → **Try the demo storefront** (`/s/maya-rao-studio`).
2. Ask the assistant for a logo / brand package, or pick a service and request a quote (use any name + email).
3. On the quote page, click **Pay deposit with PayPal**.
4. Log in with the **sandbox buyer** below and approve the payment (real PayPal sandbox popup).
5. Open **Sign in** → **Continue as demo** (or use the demo credentials below) → seller desk → open the booking → **Mark delivered & invoice balance**.
6. Open the PayPal invoice link and pay it as the same sandbox buyer.
7. PayPal sends `INVOICING.INVOICE.PAID` to our webhook → status flips to paid (or press "Check payment" — both re-read the invoice from PayPal).

> Tip: use the sandbox buyer email below as the client email so the PayPal invoice lands in that sandbox inbox.

### Demo seller login (Supabase Auth)

| Field | Value |
|-------|-------|
| Email | `demo@serviceready.app` |
| Password | `DemoJudge2026!` |
| Workspace | Maya Rao Studio (`/s/maya-rao-studio`) |

Or hit **Continue as demo** on `/login`. Real sellers can **Create account** — that opens an empty desk for their own storefront. Public `/s/*`, `/q/*`, and `/mcp/*` stay open without signing in.

### Sandbox buyer (PayPal Developer → Sandbox accounts)

| Field | Value |
|-------|-------|
| Email | `sb-flkqr53721283@personal.example.com` |
| Password | `PcS5.(%K` |
| Type | Personal (US) |

> Sellers use the sandbox business account attached to the REST app. Never use production credentials.

## What uses PayPal

| Flow | API | Code |
|------|-----|------|
| Deposit | Orders v2 create + capture + JS SDK Buttons | `src/server/paypal.ts`, `src/components/PayPalDepositButton.tsx` |
| Balance | Invoicing v2 create + send + get | `src/server/live.ts` → `deliver` / `refreshInvoiceStatus` |
| Collections | **@paypal/agent-toolkit** `get_invoice` / `get_order` (tool traces in audit trail); remind only after human approval via `send_invoice_reminder` | `src/server/paypal-toolkit.ts`, `runCollections`, `approveProposal` |
| Cancel + refund | Agent Toolkit `create_refund` (Payments v2 fallback) on deposit capture | `cancelQuote` |
| Reconciliation | **Webhooks** + `verify-webhook-signature`, then re-read PayPal | `POST /api/paypal/webhook` |
| Agentic commerce | MCP: `create_payment_mandate` (spend limit + revocable key) → `create_deposit_link(mandate_key)` | `src/server/mcp.ts`, `src/server/mandates.ts` |
| Config | Public sandbox `client_id` | `GET /api/paypal/config` |

Secrets (`PAYPAL_CLIENT_SECRET`) live **only** in server env — never `VITE_*`.

## Persistence

Supabase Postgres + Auth (`sellers.auth_user_id`, `services.image_url`, Storage bucket `service-covers`). Demo RLS is open for the hackathon so judges share one seeded seller (`maya-rao-studio`) via the demo login. New accounts get their own seller row on first sign-in.

## AI (server-side LLM)

The live demo uses **xAI Grok** (`grok-4.20-0309-non-reasoning` via `https://api.x.ai/v1`, key `XAI_API_KEY` server-side). Any OpenAI-compatible model works (`OPENAI_API_KEY` + `OPENAI_BASE_URL` + `OPENAI_MODEL`). Outputs are JSON, validated with Zod + `src/lib/validation.ts` guardrails:

| Endpoint | What the model does |
|----------|---------------------|
| `POST /api/catalog/parse` | Extracts services from a messy rate card |
| `POST /api/agent/chat` (alias `/api/agent-sim/chat`) | Storefront assistant: Grok plans tool calls (`list_services`, `get_service`, `request_quote`, `get_quote_status`), the server executes them, then Grok writes the reply from the real tool results. Response includes `engine` so the UI shows which model answered. |
| `POST /api/quotes/:id/collections/run` | Drafts reminder / follow-up copy for human approval |

Without a key (or if the model call fails) the same endpoints fall back to deterministic heuristics, and the chat UI says so. Never put model keys in `VITE_*`.

## MCP server (agentic commerce)

`/mcp/:slug` speaks MCP over Streamable HTTP (stateless JSON-RPC 2.0). Tools: `list_services`, `get_service`, `request_quote`, `get_quote_status`, **`create_payment_mandate`**, **`get_payment_mandate`**, **`revoke_payment_mandate`**, **`create_deposit_link`** (requires `mandate_key`; deposit must fit remaining spend).

```json
{ "mcpServers": { "maya-rao-studio": { "command": "npx", "args": ["-y", "mcp-remote", "https://serviceready.onrender.com/mcp/maya-rao-studio"] } } }
```

Quick check:

```bash
curl -s -X POST https://serviceready.onrender.com/mcp/maya-rao-studio \
  -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

The storefront also registers the same tools with WebMCP-capable browsers (`navigator.modelContext`).

## Local run

```bash
bun install
cp .env.example .env.local   # fill PayPal + Supabase (see ENV.md)
bun run dev                  # loads .env.local into the server
```

- Mock UI only: `bun run dev:mock` (or `VITE_USE_MOCKS=true`)
- Typecheck: `bun run typecheck`
- Unit tests (always mock): `bun run test`
- PayPal sandbox smoke ($1 create order): `bun run smoke:paypal` → prints `{"order_id","status"}` only

## Environment

See `.env.example` and `ENV.md`. Required for live mode:

- `VITE_USE_MOCKS=false`
- `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` (server)
- `SUPABASE_URL` / `SUPABASE_ANON_KEY` (and matching `VITE_*` for the client)
- `XAI_API_KEY` (+ `OPENAI_BASE_URL`, `OPENAI_MODEL`) for Grok
- `PUBLIC_ORIGIN`, `PAYPAL_WEBHOOK_ID`

## Architecture

```
Browser (TanStack Start)
  └─ api.ts  →  /api/*  (TanStack server handlers + Nitro catch-all)
        ├─ src/server/live.ts     Supabase persistence + booking state machine + webhook handler
        ├─ src/server/paypal.ts           Sandbox Orders, Invoicing, refunds, webhook verify
        ├─ src/server/paypal-toolkit.ts   Official @paypal/agent-toolkit (collections + refund + remind)
        ├─ src/server/mandates.ts         MCP spend-limit payment mandates
        ├─ src/server/llm.ts              xAI Grok (OpenAI-compatible) client
        └─ src/server/mcp.ts      MCP server for outside AI agents (/mcp/:slug)
Render (Node, Nitro node-server)  ·  Supabase Postgres (supabase/migrations, supabase/seed.sql)
```

## Deploy

Production is on **Render** (`https://serviceready.onrender.com`), not Lovable. See `LOVABLE_HANDOFF.md` only as a legacy pointer.

## What's new during the hackathon

- Real PayPal sandbox Orders create/capture with JS SDK buttons
- Real PayPal Invoicing for the balance after delivery
- Supabase persistence so deposits survive across browsers
- Signature-verified PayPal webhooks that reconcile deposits and invoices
- MCP server + WebMCP so outside AI agents can book and get a PayPal deposit link
- xAI Grok for rate-card parsing, the storefront agent and collections drafts
- Sandbox buyer credentials documented in README for Devpost test access
- MIT license

## Scripts

| Script | Purpose |
|--------|---------|
| `bun run dev` | Live sandbox + Supabase (needs `.env.local`) |
| `bun run dev:mock` | localStorage mock demo |
| `bun run smoke:paypal` | Create a $1.00 sandbox order |
| `bun run test` | 39 unit tests against mocks |
| `bun run build` | Production build (Nitro; Render sets `NITRO_PRESET=node-server`) |
