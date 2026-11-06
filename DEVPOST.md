# ServiceReady — Devpost paste-ready fields

Copy each section into the matching Devpost form field. Deadline: **Thu 12 Nov 2026, 12:00 PM PT** (Fri 13 Nov, 1:30 AM IST).

---

## Project name

ServiceReady

---

## Tagline (≤60 characters)

Paste a rate card → agent storefront agents can't alter

_(56 characters)_

Alternate options if the form rejects punctuation:

- Rate card in; agent-bookable PayPal storefront out _(52)_
- PayPal evidence first; AI books within spend limits _(51)_
- Agent storefronts with PayPal deposits before work _(51)_

---

## Elevator pitch / description

Paste the Markdown below into the Devpost **Description** field.

### The problem

Solo freelancers lose hours chasing invoices and start work on trust. Clients ghost after a vague “yes,” deposits never land, and “I already paid” emails have no source of truth. AI booking agents make it worse if they can invent prices.

**Unique angle:** paste a messy rate card → get an **agent-bookable storefront** where catalog amounts are **HMAC-signed** and **agents cannot invent or tamper with prices**. Deposits are real PayPal sandbox Orders; **PayPal evidence beats client claims**; outside agents only mint deposit links inside a **revocable spend-limited mandate**.

### What it does

1. **AI catalog parse** — Paste a messy rate card. A server-side **xAI/Grok** (OpenAI-compatible) model extracts services, prices, and deposit rules with validation guardrails — that becomes the only source of truth for amounts.
2. **Public storefront + AI agent chat** — Buyers (or other agents) talk to the storefront assistant on `/s/maya-rao-studio`. It lists services, requests quotes, and returns a PayPal deposit link — with tool traces in the UI.
3. **PayPal Orders v2 deposit (JS SDK v6)** — Before work starts, the buyer approves a deposit with the **PayPal JS SDK v6** button (v5 fallback). Small deposits are captured; deposits ≥ $500 use **intent=AUTHORIZE**: PayPal holds the funds, the seller captures on **Start work**, and cancelling before then **voids** the hold (client never charged). Status changes only from PayPal evidence.
4. **Deliver → PayPal Invoicing v2 balance** — Seller marks delivered; ServiceReady creates and sends a real **PayPal invoice** for the remaining balance.
5. **AI collections via PayPal Agent Toolkit, human approves** — “Run payment check” calls official `@paypal/agent-toolkit` (`get_invoice` / `get_order`) with tool traces in the audit trail, then drafts reminder copy. A human approves before `send_invoice_reminder`. Cancel & refund uses Agent Toolkit `create_refund`.
6. **MCP payment mandates** — Outside agents must `create_payment_mandate` (spend limit + revocable key) before `create_deposit_link`. Over-limit or revoked keys are rejected. Returning clients can save PayPal to a mandate with **Vault v3** (`save_paypal_for_mandate` → `pay_deposit_with_saved_paypal`), still capped and revocable.
7. **Hard money guardrails** — any agent or LLM tool call that tries to pass a price/amount/deposit is rejected and written to the audit trail. Amounts come only from the catalog.
8. **Cancellation / no-show policy engine** — the seller sets three numbers (free-cancel window hours, % of deposit kept on a late cancel, % kept on a no-show). Every cancel runs through one deterministic function; held deposits are **voided** or **partially captured** (`final_capture` releases the rest), captured deposits are **fully or partially refunded** via Agent Toolkit `create_refund`. The timeline shows which rule fired, and storefront / MCP agents can only quote the policy from structured fields (`get_cancellation_policy`).
9. **Final bill with tip** — clients add a tip (10/15/20% or custom, capped at 50%) on their quote page; the **PayPal Invoicing v2** final bill carries the balance and a separate tip line.
10. **Visible tamper-proofing** — quote amounts are HMAC-signed when priced from the catalog; each PayPal order stores a fingerprint (quote id + amount + currency + intent) that is recomputed from PayPal's own order before capture. "Make it $1" fails four ways — try it on `/judges`.
11. **Collections risk score** — deterministic (days overdue × amount × pay history × ignored reminders) → warm / firm / final tone that the collections agent drafts with; shown in an **AG Grid** desk and a highest-risk-first collections list.

### Live demo (judges)

- **App:** https://serviceready.onrender.com  
- **Storefront:** https://serviceready.onrender.com/s/maya-rao-studio  
- **Repo (MIT):** https://github.com/kartiksaste123/serviceready  
- **Sandbox buyer** (PayPal Developer → Sandbox accounts):

| Field | Value |
|-------|-------|
| Email | `sb-flkqr53721283@personal.example.com` |
| Password | `PcS5.(%K` |
| Type | Personal (US) |

**Judge page:** https://serviceready.onrender.com/judges (one-click steps, copyable sandbox creds, Claude MCP snippet, tamper test)

**3-minute path:** open storefront → ask AI for a logo/brand package → pay deposit with PayPal sandbox → seller **Mark delivered & invoice balance** → pay the PayPal invoice as the same sandbox buyer → run payment check (status flips from PayPal evidence).

### How AI is used

| Surface | Model | What it does |
|---------|-------|----------------|
| Catalog parse | xAI/Grok (or OpenAI-compatible) via `POST /api/catalog/parse` | Extracts structured services from messy rate-card text |
| Storefront agent | Same LLM via `POST /api/agent/chat` | Conversational booking with tool traces (`list_services`, `get_service`, `request_quote`, `get_quote_status`) |
| Collections drafts | Same LLM + **@paypal/agent-toolkit** via `POST /api/quotes/:id/collections/run` | Toolkit reads invoice/order; LLM drafts copy; **human approval** before `send_invoice_reminder` |
| Outside agents | Any MCP client via `/mcp/maya-rao-studio` | `create_payment_mandate` → `create_deposit_link(mandate_key)` (spend limit + revoke) |

Keys live only in **server** env (`XAI_API_KEY` / `OPENAI_API_KEY`). Without a key, endpoints fall back to heuristics so tests stay green — the live demo is wired for real LLM when the key is set.

### How PayPal is used

| Flow | API | Role |
|------|-----|------|
| Deposit | **Orders v2** CAPTURE, or **AUTHORIZE** → Payments v2 authorization capture / void | Money before work; held funds for large jobs |
| Checkout | **PayPal JS SDK v6** (`<paypal-button>`, one-time payment session), v5 Buttons fallback with `enable-funding=venmo,paylater` | Buyer approval (Venmo / Pay Later when eligible) |
| Returning client | **Vault v3** setup token → payment token → `vault_id` order (inside mandate) | No-popup rebooking |
| Balance | **Invoicing v2** create, send, get | Post-delivery balance |
| Collections / refund | **@paypal/agent-toolkit** (`get_invoice`, `get_order`, `send_invoice_reminder`, `create_refund`) | Official toolkit tool traces; human gate on send |
| Agentic commerce | MCP payment **mandate** (spend limit + revoke) | Agent cannot mint deposit links beyond budget |
| Reconciliation | **Webhooks** + `verify-webhook-signature`, plus a **Check PayPal** poll fallback | Status flips only after re-reading PayPal |
| Cancellation policy | Payments v2 authorization **void** / **partial capture**, Agent Toolkit **create_refund** (full or partial) | Deterministic rule → PayPal action |
| Final bill | **Invoicing v2** balance + tip line (`allow_tip`) | Tips on the real invoice |
| Idempotency | `PayPal-Request-Id` on every money write | Safe retries, no double charges |
| Disputes | Evidence pack `GET /api/quotes/:id/evidence` (JSON + Markdown) | Order / capture / auth / invoice ids, HMAC fingerprint, audit timeline |
| Payouts | **Payouts API** `POST /api/quotes/:id/payout` (sandbox tip-out) | Contractor tip-out after paid; some sandbox merchant countries return `PAYOUT_NOT_AVAILABLE` — code path is live |
| Agent discovery | `/.well-known/agent-card.json`, `/llms.txt` | MCP URL, tools, auth notes for agents |
| Config | `GET /api/paypal/config` | Public sandbox `client_id` only |

`PAYPAL_CLIENT_SECRET` never appears in `VITE_*` or the client. Sandbox only for the hackathon.

### Built for

[PayPal AI Hackathon 2026](https://paypalaihackathon.devpost.com/) — PayPal + AI are both central: AI discovers and drafts; PayPal settles and proves payment.

### What's new during the Submission Period (1 Oct – 12 Nov 2026)

This project was significantly rebuilt for the hackathon:

- Real **PayPal sandbox Orders v2** create/capture with JS SDK buttons (replaced mock deposits)
- Real **PayPal Invoicing v2** for the balance after delivery (replaced “simulate balance payment” as the happy path)
- **Supabase Postgres** persistence so judges share one seeded demo seller across browsers
- **Server-side LLM** (xAI/Grok / OpenAI-compatible) for catalog parse, storefront agent chat, and collections drafts
- **PayPal Webhooks** with `verify-webhook-signature`, idempotent on transmission id; every event is re-read from the PayPal API before state changes
- **@paypal/agent-toolkit** wired into collections, refunds, and approved invoice reminders (visible tool traces)
- **MCP payment mandates** (spend limit + revocable key) gating `create_deposit_link`
- **Deposit refund on cancel** via Agent Toolkit `create_refund`
- **AUTHORIZE → capture on start / void on cancel** for deposits ≥ $500
- **PayPal JS SDK v6** checkout (v5 fallback)
- **Vault v3** returning-client mandates (MCP `save_paypal_for_mandate`, `pay_deposit_with_saved_paypal`)
- **Money guardrails** (agent price overrides rejected + audited), **deterministic collections risk score**, **AG Grid** seller desk
- Faster storefront agent: one model round-trip, parallel tools, cached catalog; PayPal config/SDK prefetch
- Unhappy-path tests: forged webhook signatures, duplicate deliveries
- **Cancellation / no-show policy engine** → void / partial capture / partial refund, rule in timeline, `get_cancellation_policy` MCP tool
- **Final bill + tip** line on PayPal Invoicing v2
- **HMAC-signed quotes + PayPal order fingerprints** re-checked before capture; `/judges` tamper test
- **`/judges` page** and **Check PayPal** webhook fallback; `PayPal-Request-Id` on all money writes
- **Venmo / Pay Later** funding enabled on JS SDK buttons (eligible sandbox buyers)
- **Disputes evidence pack** (desk + API) aggregating PayPal ids, HMAC fingerprint, audit timeline
- **PayPal Payouts** sandbox tip-out path (`POST /api/quotes/:id/payout`) — deferred clearly when the sandbox merchant country blocks Payouts
- **Agent discovery:** `/.well-known/agent-card.json` + `/llms.txt`
- **MCP server** (`/mcp/maya-rao-studio`, Streamable HTTP) + WebMCP on the storefront
- Hosted on **Render** (Node web service, blueprint `render.yaml`) — tick Render on the form
- Sandbox buyer credentials in README for Devpost test access
- Public **GitHub** repo with **MIT** license and a judge-ready README

### Architecture (short)

```
Browser (TanStack Start)
  ├─ /api/*            →  live.ts + paypal.ts + paypal-toolkit.ts (@paypal/agent-toolkit) + llm.ts
  ├─ /api/paypal/webhook →  signature-verified PayPal events → re-read → reconcile
  └─ /mcp/:slug         →  mcp.ts + mandates.ts (spend-limit keys → Orders v2 deposit link)
Hosted on Render · Supabase Postgres
```

Code pointers: `src/server/paypal-toolkit.ts`, `src/server/mandates.ts`, `src/server/mcp.ts`, `src/server/paypal.ts`, `src/server/live.ts`.

---

## Built With

Tick / list these on the form (comma-separated or multi-select as the UI allows):

- PayPal Agent Toolkit (@paypal/agent-toolkit)
- PayPal Orders v2 (CAPTURE + AUTHORIZE)
- PayPal Invoicing v2
- PayPal Payments v2 (refunds, authorization capture/void)
- PayPal Payouts (sandbox contractor tip-out)
- PayPal JavaScript SDK v6 (v5 Buttons fallback; Venmo / Pay Later funding)
- PayPal Vault v3 (setup tokens / payment tokens)
- AG Grid Community
- PayPal REST API (sandbox OAuth2 client credentials)
- PayPal Webhooks (signature verification)
- Model Context Protocol (MCP server, Streamable HTTP) + WebMCP
- xAI Grok API (OpenAI-compatible chat completions)
- Supabase (Postgres)
- TanStack Start
- Nitro
- Render
- Vite
- TypeScript
- Bun
- Vitest

**Recommended “Built With” short string for the text box:**

`PayPal Agent Toolkit, PayPal Orders v2 (capture + authorize), PayPal JS SDK v6, PayPal Invoicing v2, PayPal Payments v2, PayPal Vault v3, PayPal Webhooks, xAI Grok, MCP mandates, AG Grid, Supabase, Render, TanStack Start, TypeScript, Bun`

Sponsor tools: tick **Render** and **AG Grid** (desk bookings grid uses AG Grid Community) (live demo is a Render web service — Best Use of Render). Prefer **Best Use of Agentic Commerce** / **Best Use of PayPal + AI** for the mandate + toolkit story.

---

## Demo links

| Field | Value |
|-------|-------|
| Demo / website URL | https://serviceready.onrender.com |
| Demo storefront deep link | https://serviceready.onrender.com/s/maya-rao-studio |
| GitHub repo | https://github.com/kartiksaste123/serviceready |
| License | MIT (root `LICENSE`; detectable in GitHub About) |
| Video | _(upload YouTube URL after recording — see `DEMO_SCRIPT.md`)_ |

---

## Test credentials / judge access

**App access:** storefront `/s/maya-rao-studio` is public. Seller desk: `/login` → **Continue as demo**, or `demo@serviceready.app` / `DemoJudge2026!` (also in README).

**PayPal sandbox buyer** (required to complete deposit + invoice):

- Email: `sb-flkqr53721283@personal.example.com`
- Password: `PcS5.(%K`
- Environment: PayPal **Sandbox** only

Keep the demo free and working through judging (**15 Dec 2026**).

---

## Tools disclosure (AI)

- **Primary model/service:** xAI Grok (`grok-4.20-0309-non-reasoning`) via OpenAI-compatible Chat Completions (`XAI_API_KEY`, `OPENAI_BASE_URL=https://api.x.ai/v1`, `OPENAI_MODEL`).
- **Images:** marketing/storefront visuals generated with OpenArt (and Artlist where noted).
- **Fallback:** OpenAI Chat Completions if `OPENAI_API_KEY` is set instead.
- **Where used:** catalog parse, storefront agent chat (with tool traces), collections reminder drafts (human-in-the-loop).
- **Guardrails:** JSON-shaped outputs validated in `src/lib/validation.ts`; tool calls carrying money fields are rejected + audited (`src/lib/guardrails.ts`); client-facing amounts are written from the catalog quote, not by the model; PayPal money movement never delegated to the model.

---

## Submission checklist (self)

- [ ] Description pasted (names **PayPal** and **AI**/Grok)
- [ ] Built With lists PayPal Orders + Invoicing + LLM
- [ ] Demo URL live and matches the video
- [ ] Repo public + MIT visible
- [ ] Sandbox buyer credentials in Devpost test-access field
- [ ] YouTube video &lt; 3 min, public (from `DEMO_SCRIPT.md`)
- [ ] No secrets in repo or screenshots
