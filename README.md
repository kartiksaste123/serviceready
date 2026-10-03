# ServiceReady

Agent-ready service booking with PayPal deposits, balance invoices, and seller-approved collections.

## Setup

Requires Node 20 and the PayPal sandbox client credentials. Set `PAYPAL_CLIENT_ID`,
`PAYPAL_CLIENT_SECRET`, `CLOUDFLARE_ACCOUNT_ID`, and `CLOUDFLARE_API_TOKEN`.
Optional settings: `DATABASE_PATH` (default `./data/dev.db`), `PAYPAL_WEBHOOK_ID`,
`PUBLIC_BASE_URL` (default `http://localhost:8080`), and `AI_GATEWAY` (default
`paypal-hackathon`).

Run `npm install`, `npm run dev`, then open `http://localhost:8080`. The API and
MCP endpoint are served from the same process.
