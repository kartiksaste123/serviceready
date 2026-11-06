# ServiceReady

**Agent-ready storefront for freelancers** — AI assistants can discover services, request a quote, and collect a **PayPal deposit before work starts**. After delivery, ServiceReady creates a real **PayPal invoice** for the balance and follows up with human-approved reminders. Client claims are never trusted over PayPal evidence.

Built for the [PayPal AI Hackathon 2026](https://paypalaihackathon.devpost.com/).

- **Live demo:** https://serviceready-frontend.lovable.app
- **Demo seller storefront:** `/s/maya-rao-studio`
- **License:** MIT

## Judge path (~3 minutes)

1. Open the live demo → **Try the demo storefront** (`/s/maya-rao-studio`).
2. Ask the assistant for a logo / brand package, or pick a service and request a quote (use any name + email).
3. On the quote page, click **Pay deposit with PayPal**.
4. Log in with the **sandbox buyer** below and approve the payment (real PayPal sandbox popup).
5. Open the seller workspace (`/app`) → open the booking → **Mark delivered & invoice balance**.
6. Open the PayPal invoice link (or use "Check payment") and pay it as the same sandbox buyer.
7. Run a payment check — status flips to paid from PayPal evidence.

### Sandbox buyer (PayPal Developer → Sandbox accounts)

| Field | Value |
|-------|-------|
| Email | `sb-ivgi153178596@personal.example.com` |
| Password | `e;W?lu4V` |
| Type | Personal (IN) |

> Sellers use the sandbox business account attached to the REST app. Never use production credentials.

### Judge mode banner

When `VITE_USE_MOCKS=false`, the app shows a **Judge mode** banner with the 4-step path and the sandbox buyer email (password stays in this README).

## What uses PayPal

| Flow | API | Code |
|------|-----|------|
| Deposit | Orders v2 create + capture + JS SDK Buttons | `src/server/paypal.ts`, `src/components/PayPalDepositButton.tsx` |
| Balance | Invoicing v2 create + send + get (+ remind on approval) | `src/server/live.ts` → `deliver` / `refreshInvoiceStatus` / `approveProposal` |
| Config | Public sandbox `client_id` | `GET /api/paypal/config` |

Secrets (`PAYPAL_CLIENT_SECRET`) live **only** in server env — never `VITE_*`.

## Persistence

Supabase Postgres (`sellers`, `services`, `quotes`, `payments`, `agent_events`, `proposals`, `replies`, `webhook_events`). Demo RLS is open for the hackathon so judges share one seeded seller (`maya-rao-studio`).

## AI status (honest)

Rate-card parse, storefront assistant, and collections drafts currently use **deterministic heuristics** on the server (same shapes as the mock). Wiring a real LLM + PayPal Agent Toolkit is the next MUST-FIX for Stage Two scoring — see `DEVPOST_GAP_MAP.md`.

## Local run

```bash
bun install
cp .env.example .env.local   # fill PayPal + Supabase (see LOVABLE_ENV.md)
bun run dev                  # loads .env.local into the server
```

- Mock UI only: `bun run dev:mock` (or `VITE_USE_MOCKS=true`)
- Typecheck: `bun run typecheck`
- Unit tests (always mock): `bun run test`
- PayPal sandbox smoke ($1 create order): `bun run smoke:paypal` → prints `{"order_id","status"}` only

## Environment

See `.env.example` and `LOVABLE_ENV.md`. Required for live mode:

- `VITE_USE_MOCKS=false`
- `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` (server)
- `SUPABASE_URL` / `SUPABASE_ANON_KEY` (and matching `VITE_*` for the client)
- `VITE_PAYPAL_SANDBOX_BUYER_EMAIL` (banner)

## Architecture

```
Browser (TanStack Start)
  └─ api.ts  →  /api/*  (TanStack server handlers + Nitro catch-all)
        ├─ src/server/live.ts     Supabase persistence + booking state machine
        └─ src/server/paypal.ts   Sandbox Orders + Invoicing
```

## What's new during the hackathon

- Real PayPal sandbox Orders create/capture with JS SDK buttons
- Real PayPal Invoicing for the balance after delivery
- Supabase persistence so deposits survive across browsers
- Judge mode banner + sandbox buyer credentials for Devpost test access
- MIT license

## Scripts

| Script | Purpose |
|--------|---------|
| `bun run dev` | Live sandbox + Supabase (needs `.env.local`) |
| `bun run dev:mock` | localStorage mock demo |
| `bun run smoke:paypal` | Create a $1.00 sandbox order |
| `bun run test` | 39 unit tests against mocks |
| `bun run build` | Production build (Nitro / Cloudflare) |
