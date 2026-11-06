# ServiceReady: PayPal AI Hackathon 2026 gap map

_Written Fri 6 Nov 2026, 12:40 IST. Deadline: **Thu 12 Nov 2026, 12:00 PM PT (Fri 13 Nov, 1:30 AM IST)**._
Sources: paypalaihackathon.devpost.com (home, /rules, /details/faqs, /updates), the PayPal Community Blog hackathon post, and developer.paypal.com/ai-tools/toolkit.

---

## 1. What Devpost requires (from the official pages)

### Submission checklist (Rules §4, plus the "Submission checklist" update from 5 Nov)
| # | Requirement | Exact wording / notes |
|---|---|---|
| R1 | Uses PayPal **and** AI in a meaningful way | "integrates the PayPal developer platform (using the free sandbox environment) along with an AI tool, model, or platform". "Any AI tool works, **as long as PayPal integration is central**." |
| R2 | Working build that judges can run | A hosted demo URL **or** full setup/run instructions in the repo. "A design mockup, static prototype, or **non-functional demo does not meet this requirement**." It must "function as depicted in the video and/or text description". |
| R3 | Public repo (GitHub/GitLab/Bitbucket) | Must contain "all necessary source code, assets, and instructions". Must be open source, with the **license file detectable in the repo About section**. The update also says it needs a README. |
| R4 | Text description | Features and functionality. Existing projects must "explain how their Project was significantly updated during the Submission Period" (1 Oct to 12 Nov). |
| R5 | Tools disclosure | "identify which tools (model or AI service) were used and explain how". |
| R6 | Demo video | **Under 3 minutes**, public on **YouTube**, shows the product working on its target device, no third-party trademarks or copyrighted music without permission. |
| R7 | Test access | If anything is private, give login credentials, sandbox buyer login, and keys/instructions. Keep the demo **free and working until judging ends (15 Dec 2026)**. |
| R8 | Sponsor tools | Tick them on the form if you're going for a sponsor prize. |
| R9 | Secrets | From the "Two weeks to go" update: "Hide your API keys. Use environment variables, never commit secrets." |
| R10 | English | All materials in English. |

### Judging
- **Stage One (pass/fail):** the review team checks for a working build, a public repo with an OSS license, a public video under 3 minutes, and that the project "reasonably applies the required APIs/SDKs". Judges may also use automated AI-driven analysis.
- **Stage Two: five criteria, weighted equally (20% each).** Ties are broken in this order:
  1. **Technological Implementation:** how thoroughly and skilfully the project uses the PayPal Developer Platform and the AI tools. Is it a working, non-trivial implementation?
  2. **Design:** a complete, coherent product, "not just a technical proof of concept".
  3. **Potential Impact:** a credible, specific real problem for a real audience, and the demo actually solves it.
  4. **Innovation/Idea:** novel, and different from existing concepts.
  5. **Presentation:** the video shows the product working end to end. The pitch covers the problem, who it's for, and why it matters.
- Tips from the updates: "Make PayPal and AI impossible to miss. Name both in your description, 'Built With', and video, and show them working." Open the video with the problem and the audience. Cut loading screens. An AI voiceover is fine. Upload early because processing takes hours. Submit early to get an eligibility check (that window ended 5 Nov, but you can still edit until the deadline).

### Prizes (these are categories, not tracks; there are no tracks)
- Grand prizes: $12k / $8k / $5k.
- Honorable mentions ($5k each): Most Creative, Most Impactful, **Best Demo Delivery**, **Best Use of PayPal + AI**, **Best Use of Agentic Commerce**.
- Sponsor prizes: AG Grid ($5k/$2k/$1k), APIMatic ($1k + subscription), Bryntum ($1k), Channel3 ($1.5k), **Render** (credits). One project can win at most 1 Grand or 1 Honorable Mention, plus 1 Sponsor prize.
- Sponsor tools: AG Grid, APIMatic, Astropods, Bryntum, Channel3, Elastic, KERNEL, Postman, Render, Zapier.
- Judges are mostly PayPal DevRel and engineering (Jo Franchetti, Eddie Jaoude, Marco Podien, Karthik Ravi, Himraj Singh, Nathaniel Olson), plus the sponsor judges. They will spot a fake PayPal flow immediately.

### PayPal tools to show off
- **Orders v2** (create/capture) with the **JS SDK Buttons** (sandbox).
- **Invoicing v2** (create, send, remind, cancel, QR code).
- **Webhooks** (`CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, `INVOICING.INVOICE.PAID`) with signature verification.
- **PayPal Agent Toolkit** (`@paypal/agent-toolkit`; the `ai-sdk` export works with the Vercel AI SDK). It covers orders, invoices, subscriptions, shipment, transactions, and disputes.
- **PayPal MCP server** (`npx @paypal/mcp --tools=all`, `PAYPAL_ENVIRONMENT=SANDBOX`).
- The DevRel build-session recording (bit.ly/paypalai26recue) also links the Postman collection and example code.

---

## 2. What the code actually does today (`/workspace/serviceready`)

| Area | Reality | Evidence |
|---|---|---|
| Backend | **There is none.** It's a frontend-only TanStack Start app on Nitro/Cloudflare. `src/server.ts` only does SSR error handling. | `src/lib/api.ts` calls `mock.ts` unless `VITE_USE_MOCKS==='false'`, and then points at an external `VITE_API_BASE_URL` that doesn't exist. |
| PayPal | **100% simulated** by default. `paypalConfig()` returns `client_id: "sb-mock-client-id"`. Orders, captures, invoices, webhooks, and the "Simulate balance payment" button are all localStorage. | `src/lib/mock.ts:782-910, 1309` |
| PayPal SDK seam | A real-mode `SdkCheckout` exists and looks correct (loads `paypal.com/sdk/js`, createOrder goes to the server, capture runs only in `onApprove`). It has never been run against a real server. | `src/components/PayPalDepositButton.tsx` |
| AI rate-card parsing | **Regex/split heuristics, not an LLM.** | `mock.ts:544 parseCatalog` splits on `| \n ;` and regex-matches `+N%` |
| AI storefront agent | **Regex intent matching** with fake tool traces (`list_services`, ...). The UI already calls it a "simulated assistant". | `mock.ts:1233 agentChat` |
| AI collections/follow-ups | Template text plus rules (tone and grace window). No model. | `mock.ts` (runCollections, proposals) |
| MCP / WebMCP | The UI shows `.../mcp/{slug}` and config snippets, but **no MCP server exists**. The README says so explicitly. | `app.connect.tsx`, `s.$slug.tsx:193-226`, README |
| Auth / persistence | No auth. Data is per-browser localStorage. | README |
| Repo | Local git only (2 commits, both 6 Nov 2026), **no remote, no LICENSE**. README is still the Lovable boilerplate plus ops notes. | `git remote -v` is empty |
| Quality | 39 tests, lint, typecheck, and browser smoke. Mock lifecycle logic is solid (idempotency, state machine, grace window). | `BUGFIX_REPORT.md` |
| Env | `.env.example` only has `VITE_USE_MOCKS` / `VITE_API_BASE_URL`. No server secrets are defined. | |

**Bottom line:** as it stands, the live site would probably **fail Stage One**. Both PayPal and AI are simulated, and the README admits it. That looks like the "non-functional demo" the rules exclude. The good news is that the product design, state machine, UI seams, and tests are strong, so the work is mostly backend wiring.

---

## 3. Prioritised gap list

### MUST-FIX (eligibility / Stage One)
1. **Real PayPal sandbox backend (Orders v2).** Add server routes, using TanStack Start server routes in the same repo (e.g. `src/routes/api/...`) or Supabase Edge Functions:
   - `GET /api/paypal/config` returns the public sandbox client_id.
   - `POST /api/quotes/:id/deposit/order` calls `POST /v2/checkout/orders` (intent CAPTURE, amount = deposit, `custom_id`=quote id, `PayPal-Request-Id` for idempotency).
   - `POST /api/quotes/:id/deposit/capture` calls `POST /v2/checkout/orders/{id}/capture`, checks `COMPLETED` and that amount/currency match, then stores the capture id.
   - OAuth `client_credentials` token cached on the server. Secrets `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` live **only** in server env, never in `VITE_*`.
   - Flip the published site to `VITE_USE_MOCKS=false` (or make a "Live sandbox" mode the default). Keep mocks only for tests.
2. **Real PayPal Invoicing v2 for the balance.** On deliver: `POST /v2/invoicing/invoices` then `/send`. "Check payment" reads `GET /v2/invoicing/invoices/{id}`. Reminders go through `/remind` after human approval. Remove or relabel the "Simulate balance payment" button (`app.quotes.$id.tsx`) and let the judge pay the real sandbox invoice link with a sandbox buyer account.
3. **Real AI calls (LLM), not regex.** Replace `parseCatalog`, `agentChat`, and the collections draft generation with server-side LLM calls (structured JSON output / function calling). Keep the existing validation (`src/lib/validation.ts`) as a guardrail on model output. The key goes in server env only.
4. **Persistence that judges can share:** Supabase Postgres (sellers, services, quotes, orders, invoices, proposals, events). Without it, a judge's deposit disappears in another browser and webhooks have nowhere to write. Add RLS. The demo seller can be a seeded public demo account, or thin auth via Supabase magic link plus a "Use demo seller" button.
5. **Public GitHub repo:** push all source, add an **MIT `LICENSE`** at the root (so GitHub shows it in About), and keep `.env*`, `.wrangler`, `.output`, and `node_modules` out. Set the About description, topics (`paypal`, `ai`, `agentic-commerce`, `mcp`), and website URL. Commits must clearly fall within Oct 1 to Nov 12. Avoid force-pushing (see the Lovable warning in AGENTS.md).
6. **Real README** (replace the Lovable boilerplate): problem and audience, a 30-second judge path, the live URL, the **sandbox buyer test login** (create one in the PayPal Developer Dashboard under Sandbox accounts), an architecture diagram, the PayPal APIs used (with links to code), the AI model and how it's used, local run steps, an env var table, and a "what's new during the hackathon" section.
7. **YouTube video, under 3 minutes, public.** Show the real sandbox PayPal popup, the real capture, and the invoice paid by the sandbox buyer. Upload by around 10 Nov because processing is slow.
8. **Devpost submission form:** description, Built With (PayPal Orders v2, PayPal Invoicing, PayPal JS SDK, PayPal Agent Toolkit/MCP, the LLM, Supabase, plus any sponsor tool), demo URL, repo URL, video, test credentials, and sponsor tools ticked. Submit a draft early and edit until the deadline.
9. **Remove the "simulated" disclaimers** in the README, the `s.$slug.tsx` AgentBadge, `app.connect.tsx`, and the checkout dialog copy once these flows are real. Do not claim anything that isn't real.

### SHOULD-FIX (to win)
**Technological Implementation**
- **Webhooks** route `POST /api/paypal/webhook`: verify with `POST /v1/notifications/verify-webhook-signature`. Handle `PAYMENT.CAPTURE.COMPLETED` and `INVOICING.INVOICE.PAID` so they flip quote state and drive the existing thank-you proposal flow. This replaces the demo button with genuine reconciliation.
- **Agent Toolkit or MCP is central to the agent story.** Use `@paypal/agent-toolkit/ai-sdk` with the Vercel AI SDK on the server for the collections agent. Give it read tools (invoice get/list, order get) plus a gated `sendReminder`/`create invoice` that runs **only after human approval** in `app.approvals.tsx`. Show the real tool-call trace in `EventTimeline`/`ProposalCard`.
- **Ship the MCP endpoint that the UI already advertises:** `/mcp/:slug` (Streamable HTTP) with `list_services`, `get_service`, `request_quote`, `get_quote_status`, and `create_deposit_link` (which returns the PayPal approve URL). This means Claude/ChatGPT can book and pay for a freelancer through PayPal, which makes a strong **Agentic Commerce** case. Optionally register WebMCP `navigator.modelContext` tools on the storefront.
- Keep the 39 tests. Add server tests with mocked PayPal HTTP plus one sandbox integration smoke script (`scripts/paypal-sandbox-smoke.mjs`).
- Refunds/disputes are optional extras: "Cancel booking" calls `POST /v2/payments/captures/{id}/refund` on the deposit.

**Design**
- One coherent story from the landing page to paid. Add a "Judge mode" banner on the live site with the 4-step path and the sandbox buyer credentials (copy buttons).
- Use PayPal-branded smart buttons (the real SDK) instead of a custom mint button, and show a PayPal order/invoice id link in the timeline.

**Potential Impact**
- Put a specific persona and numbers on the landing page and README (for example, solo designers losing X hours a month chasing invoices, late payment stats). Show the "deposit before work" plus "AI chasers, human approves" loop cutting days-to-paid, with the dashboard metric backed by real data.

**Innovation**
- Pitch it as "agent-ready storefront for freelancers". Any AI agent (MCP/WebMCP) can discover services, quote, and pay a PayPal deposit, and the seller's agent collects the balance with human-in-the-loop approvals and PayPal as the source of truth ("client claims are never trusted over PayPal evidence"). Make that last line a headline feature.

**Presentation**
- Video script (about 2:45): problem (0:00-0:20), import a rate card with the LLM (0:20-0:45), an AI agent books via MCP or the storefront assistant (0:45-1:15), real PayPal sandbox deposit popup (1:15-1:40), deliver and send a real PayPal invoice (1:40-2:00), the agent proposes a reminder, a human approves, and the invoice is paid by the sandbox buyer, triggering the webhook and thank-you (2:00-2:35), architecture card naming PayPal + AI (2:35-2:45). Use an AI voiceover, no copyrighted music, and cut the loading screens.

**Sponsor prize (cheap win)**
- Host the backend on **Render** (Web Service) to be eligible for Best Use of Render. Optionally, **Postman**: publish a collection for the ServiceReady API and PayPal calls. An AG Grid upgrade of `BookingsGrid.tsx` is a larger lift with a bigger prize ($5k), so do it only if time allows.

---

## 4. Recommended PayPal sandbox path (what judges click)

**Stack:** keep the Lovable frontend. Backend is TanStack Start server routes or a small Node service (on Render) using Supabase Postgres, PayPal REST (sandbox), the PayPal Agent Toolkit (`ai-sdk`), and an LLM via the Vercel AI SDK.

**APIs:**
1. OAuth2 `POST /v1/oauth2/token` (client credentials, cached).
2. Orders v2: create and capture, with the JS SDK Buttons on `/q/:id`. This is the deposit.
3. Invoicing v2: create, send, get, remind. This is the balance after delivery.
4. Webhooks with signature verification. These handle reconciliation.
5. The Agent Toolkit gives the collections agent PayPal tools (get/list invoices, send reminder) behind human approval. The ServiceReady MCP server exposes booking and deposit-link tools to outside agents.

**Judge click path (about 3 minutes, no setup):**
1. Landing → "Try as demo seller". Paste a messy rate card → **LLM** extracts services and flags issues → Publish.
2. Open the public storefront `/s/hannah` → ask the **AI assistant** "I need a logo, I'm Sam, sam@x.com" → it calls `request_quote` → quote link.
3. On `/q/:id`, click the **PayPal button** → sandbox popup → log in with the sandbox buyer from the README → approve → server capture → status "Deposit paid" (with the PayPal capture id shown).
4. Seller workspace → booking → "Mark delivered" → a **real PayPal invoice** is created and sent (with a link to the sandbox invoice).
5. "Run payment check" → the agent reads the invoice via the Agent Toolkit → proposes a reminder → the human edits and approves → PayPal `/remind` is sent.
6. Pay the invoice as the sandbox buyer → **webhook** → auto-reconciled → thank-you proposal → paid metrics update.
7. Optional: Connect page → add `/mcp/hannah` to Claude → "book Hannah's logo package" → it returns the PayPal approve link (Agentic Commerce).

**What's needed from Kartik:** PayPal Developer sandbox app credentials (client id + secret) and a sandbox buyer account, an LLM API key, Supabase project access, a GitHub account for the public repo, plus a YouTube upload and the Devpost submission (both done by him or with his approval).

---

## 5. Suggested order of work (6 days)
| Day | Work |
|---|---|
| 6-7 Nov | Supabase schema, PayPal OAuth, Orders create/capture, live sandbox deposit end to end. |
| 8 Nov | Invoicing create/send/get/remind and the webhook route. Remove the simulate button from the live path. |
| 9 Nov | LLM rate-card parse, storefront agent, collections agent with the Agent Toolkit and approval gating. |
| 10 Nov | MCP endpoint, judge-mode banner, copy cleanup, tests. Public GitHub repo with LICENSE and README. |
| 11 Nov | Record and upload the video. Submit the Devpost draft. |
| 12 Nov (before 12:00 PT / 1:30 AM IST on 13 Nov) | Final smoke on the published URL and final submit. |
