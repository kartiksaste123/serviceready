# ServiceReady

![Unit tests](https://img.shields.io/badge/vitest-66%20passing-brightgreen)
![PayPal](https://img.shields.io/badge/PayPal-sandbox%20live-003087)
![License](https://img.shields.io/badge/license-MIT-blue)

**Deposit-before-work merchant storefront** — AI assistants discover services, request a quote, and collect a **PayPal deposit before work starts**. **PayPal evidence beats client claims.** AI never sets amounts (catalog prices only). After delivery, a real **PayPal invoice** covers the balance; reminders are drafted by AI and **human-approved**. Outside agents use MCP with a **revocable spend-limited payment mandate** before `create_deposit_link`.

Built for the [PayPal AI Hackathon 2026](https://paypalaihackathon.devpost.com/).

- **Live demo:** https://serviceready.onrender.com
- **Demo seller storefront:** https://serviceready.onrender.com/s/maya-rao-studio
- **MCP server (for Claude / ChatGPT / Cursor):** `https://serviceready.onrender.com/mcp/maya-rao-studio`
- **Deploy health:** https://serviceready.onrender.com/api/health
- **Judge page (steps, sandbox creds, Claude MCP snippet, tamper test):** https://serviceready.onrender.com/judges
- **License:** MIT

## Judge path (~3 minutes)

1. Open the live demo → **Judge demo · 3 min** (lands on `/s/maya-rao-studio?judge=1` with a one-click booking request). A small dismissible **Judge path** chip (bottom-left) has the 4 steps and copy buttons for the sandbox buyer.
2. Ask the assistant for a logo / brand package, or pick a service and request a quote (use any name + email).
3. On the quote page, click the **PayPal** button (JS SDK v6). Deposits ≥ $500 are **authorized** (PayPal holds the funds); smaller deposits are captured immediately.
4. Log in with the **sandbox buyer** below and approve the payment (real PayPal sandbox popup).
5. Open **Sign in** → **Continue as demo** (or use the demo credentials below) → seller desk → open the booking → (held deposits: **Start work · capture**) → **Mark delivered & invoice balance**.
6. Open the PayPal invoice link and pay it as the same sandbox buyer.
7. PayPal sends `INVOICING.INVOICE.PAID` to our webhook → status flips to paid (or press **Check PayPal** — it re-reads open orders and the invoice from PayPal if a webhook was missed).
8. Optional: on the quote page add a **tip** (10/15/20% or custom) before delivery — it becomes its own line on the PayPal final-bill invoice. On any paid booking, **Cancel booking…** → client cancel / no-show / seller cancel previews which **policy rule** fires, then PayPal void / partial capture / refund runs.
9. Optional: `/judges` → **Run tamper test** shows "make it $1" being blocked four ways.

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
| Deposit (small) | Orders v2 `intent=CAPTURE` create + capture | `src/server/paypal.ts`, `captureDeposit` |
| Deposit (≥ $500) | Orders v2 `intent=AUTHORIZE` → `/authorize` on approval → Payments v2 `authorizations/{id}/capture` on **Start work** (or automatically before the balance invoice) → `authorizations/{id}/void` on cancel | `authorizeDeposit`, `startWork`, `cancelQuote` |
| Checkout UI | **PayPal JS SDK v6** (`/web-sdk/v6/core`, `createInstance({clientId})`, `<paypal-button>`, one-time payment session). Falls back to v5 Buttons (namespaced per intent) if v6 can't initialise | `src/components/PayPalDepositButton.tsx` |
| Returning client | **Vault v3** setup token bound to an MCP mandate → payment token → merchant-initiated deposit with `payment_source.paypal.vault_id` (still capped by mandate) | `src/server/mandates.ts`, `payDepositWithVault` |
| Balance | Invoicing v2 create + send + get | `src/server/live.ts` → `deliver` / `refreshInvoiceStatus` |
| Collections | **@paypal/agent-toolkit** `get_invoice` / `get_order` (tool traces in audit trail); remind only after human approval via `send_invoice_reminder` | `src/server/paypal-toolkit.ts`, `runCollections`, `approveProposal` |
| Cancel + refund | Agent Toolkit `create_refund` (Payments v2 fallback) on deposit capture | `cancelQuote` |
| Reconciliation | **Webhooks** + `verify-webhook-signature`, then re-read PayPal | `POST /api/paypal/webhook` |
| Agentic commerce | MCP: `create_payment_mandate` (spend limit + revocable key) → `create_deposit_link(mandate_key)`; optional `save_paypal_for_mandate` → `pay_deposit_with_saved_paypal` | `src/server/mcp.ts`, `src/server/mandates.ts` |
| Cancellation policy | Seller sets free-cancel window (h), late-cancel keep %, no-show keep %. `decideCancel` picks the rule; held deposits → `authorizations/{id}/void` or partial `authorizations/{id}/capture` (`final_capture` releases the rest); captured deposits → full / partial Agent Toolkit `create_refund`. Policy is snapshotted on each quote; timeline logs `cancel_policy.<rule>`. MCP `get_cancellation_policy` + storefront agent quote it from structured fields only | `src/lib/cancel-policy.ts`, `cancelQuote` |
| Final bill + tip | Client picks a tip on `/q/:id`; Invoicing v2 final bill = balance line + "Tip" line, `configuration.allow_tip` on. Held deposits are captured first (tips are never captured above an authorization) | `src/lib/tip.ts`, `setTip`, `deliver` |
| Tamper-proofing | Quote amounts are **HMAC-signed** at pricing; order creation re-prices + verifies. Each PayPal order stores a **fingerprint** HMAC(quote id + kind + amount + currency + intent); before capture/authorize the order is re-read from PayPal and its fingerprint recomputed — mismatch → 409 + `guardrail.tamper_blocked` | `src/server/fingerprint.ts`, `GET /api/judges/tamper-demo` |
| Idempotency | `PayPal-Request-Id` on order create/capture/authorize, authorization capture/void, refunds, invoice create/send, reminders | `src/server/paypal.ts` |
| Money guardrails | Any agent/LLM tool call carrying a money field (`price`, `amount`, `total`, `deposit*`, `discount`…) is **rejected and audited** (`guardrail.price_override_blocked`). Amounts only come from the published catalog | `src/lib/guardrails.ts`, `mcp.ts`, `agentChat` |
| Config | Public sandbox `client_id` | `GET /api/paypal/config` |

Secrets (`PAYPAL_CLIENT_SECRET`) live **only** in server env — never `VITE_*`.

**AUTHORIZE threshold:** `DEPOSIT_AUTHORIZE_MIN_USD` (default `500`; `0` = always capture). PayPal authorizations have a 3-day honor period and stay capturable up to 29 days — the desk captures on **Start work**, and never sends a balance invoice while the deposit is only held. Webhook `PAYMENT.AUTHORIZATION.CREATED` is handled alongside `CHECKOUT.ORDER.APPROVED`.

**Vault status:** the sandbox app has Vault scopes and `POST /v3/vault/setup-tokens` returns an approval link (verified). The client-approval → payment-token → vaulted-capture leg is implemented but needs a buyer approval to exercise end-to-end; revocable mandate keys stay the primary agent control either way.

## Collections risk score (deterministic)

`src/lib/risk.ts` scores each open balance 0–100 from **days overdue (45) × amount (25) × client pay history (20) × ignored reminders (10)** → band (low/medium/high) → reminder tone **warm / firm / final**. The same function powers the AG Grid **Risk** column, the Collections list (highest risk first) and the collections agent, which logs `collections.risk_score` and drafts with that tone. No AI decides the score.

## Seller desk grid

Desktop bookings use **AG Grid Community** (`ag-grid-react`, `AllCommunityModule`, Quartz theme mapped to our tokens): sortable/resizable columns incl. Risk; row click/Enter opens the booking. Mobile keeps the stacked card list.

## Persistence

Supabase Postgres + Auth (`sellers.auth_user_id`, `services.image_url`, Storage bucket `service-covers`). Demo RLS is open for the hackathon so judges share one seeded seller (`maya-rao-studio`) via the demo login. New accounts get their own seller row on first sign-in.

## AI (server-side LLM)

The live demo uses **xAI Grok** (`grok-4.20-0309-non-reasoning` via `https://api.x.ai/v1`, key `XAI_API_KEY` server-side). Any OpenAI-compatible model works (`OPENAI_API_KEY` + `OPENAI_BASE_URL` + `OPENAI_MODEL`). Outputs are JSON, validated with Zod + `src/lib/validation.ts` guardrails:

| Endpoint | What the model does |
|----------|---------------------|
| `POST /api/catalog/parse` | Extracts services from a messy rate card |
| `POST /api/agent/chat` (alias `/api/agent-sim/chat`) | Storefront assistant: **one** Grok round-trip plans tool calls (`get_service`, `request_quote`, `get_quote_status`); the server runs them in parallel against a cached catalog, and writes any money-bearing reply (total / deposit / balance) deterministically from the real quote — the model never states amounts it computed. Money fields in tool args are rejected. Response includes `engine` so the UI shows which model answered. |
| `POST /api/quotes/:id/collections/run` | Drafts reminder / follow-up copy for human approval |

Without a key (or if the model call fails) the same endpoints fall back to deterministic heuristics, and the chat UI says so. Never put model keys in `VITE_*`.

## MCP server (agentic commerce)

`/mcp/:slug` speaks MCP over Streamable HTTP (stateless JSON-RPC 2.0). Tools: `list_services`, `get_service`, `request_quote`, `get_quote_status`, **`create_payment_mandate`**, **`get_payment_mandate`**, **`revoke_payment_mandate`**, **`get_cancellation_policy`**, **`create_deposit_link`** (requires `mandate_key`; deposit must fit remaining spend), **`save_paypal_for_mandate`** (Vault v3 approval link), **`pay_deposit_with_saved_paypal`**. Money-moving tools reject any price/amount argument. Seller catalog reads are cached in memory (30 s TTL, invalidated on catalog writes) so `tools/list` / `list_services` stay sub-second.

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

- **Cancellation / no-show policy engine** (deterministic) → PayPal void, partial authorization capture, or full/partial refund; rule shown in the timeline
- **Final bill with tip** on PayPal Invoicing v2
- **Tamper-proofing:** HMAC-signed quotes + PayPal order fingerprints, `/judges` tamper test
- **`/judges` page** and a **Check PayPal** webhook fallback on the quote page and desk

- Real PayPal sandbox Orders create/capture with **JS SDK v6** (v5 fallback); **AUTHORIZE → capture on start / void on cancel** for large deposits
- Hard money guardrails, deterministic collections risk score, AG Grid desk, Vault-backed returning-client mandates
- Unhappy-path tests: forged webhook signature, missing headers, duplicate delivery idempotency
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
| `bun run test` | 66 unit tests (mocks + node server tests for webhooks, guardrails, risk, cancel policy, tips, tamper-proofing) |
| `bun run build` | Production build (Nitro; Render sets `NITRO_PRESET=node-server`) |
