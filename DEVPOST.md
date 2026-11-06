# ServiceReady — Devpost paste-ready fields

Copy each section into the matching Devpost form field. Deadline: **Thu 12 Nov 2026, 12:00 PM PT** (Fri 13 Nov, 1:30 AM IST).

---

## Project name

ServiceReady

---

## Tagline (≤60 characters)

PayPal evidence first; AI books within spend limits

_(51 characters)_

Alternate options if the form rejects punctuation:

- Agent storefronts with PayPal deposits before work _(51)_
- Freelancer storefront: AI quotes, PayPal deposits _(49)_

---

## Elevator pitch / description

Paste the Markdown below into the Devpost **Description** field.

### The problem

Solo freelancers lose hours chasing invoices and start work on trust. Clients ghost after a vague “yes,” deposits never land, and “I already paid” emails have no source of truth. ServiceReady is a **deposit-before-work merchant storefront**: AI quotes from your catalog (never invents prices), **PayPal evidence beats client claims**, and outside agents can only mint deposit links inside a **revocable spend-limited mandate**.

### What it does

1. **AI catalog parse** — Paste a messy rate card. A server-side **xAI/Grok** (OpenAI-compatible) model extracts services, prices, and deposit rules with validation guardrails.
2. **Public storefront + AI agent chat** — Buyers (or other agents) talk to the storefront assistant on `/s/maya-rao-studio`. It lists services, requests quotes, and returns a PayPal deposit link — with tool traces in the UI.
3. **PayPal Orders v2 deposit** — Before work starts, the buyer pays a deposit via the **PayPal JS SDK Buttons** against the sandbox. Server creates and captures the order (`Orders v2`); capture id is stored; status becomes deposit-paid only from PayPal evidence.
4. **Deliver → PayPal Invoicing v2 balance** — Seller marks delivered; ServiceReady creates and sends a real **PayPal invoice** for the remaining balance.
5. **AI collections via PayPal Agent Toolkit, human approves** — “Run payment check” calls official `@paypal/agent-toolkit` (`get_invoice` / `get_order`) with tool traces in the audit trail, then drafts reminder copy. A human approves before `send_invoice_reminder`. Cancel & refund uses Agent Toolkit `create_refund`.
6. **MCP payment mandates** — Outside agents must `create_payment_mandate` (spend limit + revocable key) before `create_deposit_link`. Over-limit or revoked keys are rejected.

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
| Deposit | **Orders v2** create + capture + **JS SDK Buttons** | Money before work |
| Balance | **Invoicing v2** create, send, get | Post-delivery balance |
| Collections / refund | **@paypal/agent-toolkit** (`get_invoice`, `get_order`, `send_invoice_reminder`, `create_refund`) | Official toolkit tool traces; human gate on send |
| Agentic commerce | MCP payment **mandate** (spend limit + revoke) | Agent cannot mint deposit links beyond budget |
| Reconciliation | **Webhooks** + `verify-webhook-signature` | Status flips only after re-reading PayPal |
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
- PayPal Orders v2
- PayPal Invoicing v2
- PayPal Payments v2 (refunds)
- PayPal JavaScript SDK (Smart Buttons)
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

`PayPal Agent Toolkit, PayPal Orders v2, PayPal Invoicing v2, PayPal Webhooks, PayPal Payments refunds, xAI Grok, MCP mandates, Supabase, Render, TanStack Start, TypeScript, Bun`

Sponsor tools: tick **Render** (live demo is a Render web service — Best Use of Render). Prefer **Best Use of Agentic Commerce** / **Best Use of PayPal + AI** for the mandate + toolkit story.

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
- **Guardrails:** JSON-shaped outputs validated in `src/lib/validation.ts`; PayPal money movement never delegated to the model.

---

## Submission checklist (self)

- [ ] Description pasted (names **PayPal** and **AI**/Grok)
- [ ] Built With lists PayPal Orders + Invoicing + LLM
- [ ] Demo URL live and matches the video
- [ ] Repo public + MIT visible
- [ ] Sandbox buyer credentials in Devpost test-access field
- [ ] YouTube video &lt; 3 min, public (from `DEMO_SCRIPT.md`)
- [ ] No secrets in repo or screenshots
