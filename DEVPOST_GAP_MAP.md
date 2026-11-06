# ServiceReady: PayPal AI Hackathon 2026 gap map

_Written Fri 6 Nov 2026, 12:40 IST; status refreshed Fri 6 Nov 2026 afternoon IST. Deadline: **Thu 12 Nov 2026, 12:00 PM PT (Fri 13 Nov, 1:30 AM IST)**._
Paste-ready Devpost fields: `DEVPOST.md`. Video script: `DEMO_SCRIPT.md`.
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
| Backend | ✅ TanStack Start `/api/*` server routes + Nitro catch-all | `src/routes/api.*`, `src/server/live.ts` |
| PayPal Orders | ✅ Real sandbox create + capture + JS SDK Buttons | `src/server/paypal.ts`, `PayPalDepositButton.tsx`, `smoke:paypal` |
| PayPal Invoicing | ✅ Create / send / get / remind on approval | `live.ts` deliver / refreshInvoiceStatus / approveProposal |
| PayPal webhooks | ❌ Not verified end-to-end yet | SHOULD-FIX |
| AI rate-card parsing | ✅ LLM when `XAI_API_KEY` / `OPENAI_API_KEY` set; heuristics fallback | `src/server/llm.ts`, `api.catalog.parse` |
| AI storefront agent | ✅ LLM chat + tool traces; heuristics fallback | `api.agent.chat` |
| AI collections | ✅ LLM drafts + human approve | `api.quotes.$id.collections.run` |
| MCP / Agent Toolkit | ❌ UI may advertise; server MCP / `@paypal/agent-toolkit` not shipped | SHOULD-FIX |
| Auth / persistence | ✅ Supabase Postgres (demo RLS open for seeded seller) | `sellers`, `quotes`, `payments`, … |
| Repo | ✅ Public GitHub + MIT `LICENSE` + judge README | https://github.com/kartiksaste123/serviceready |
| Devpost materials | ✅ `DEVPOST.md` + `DEMO_SCRIPT.md` (this refresh) | repo root |
| Live Lovable publish | ⚠️ Code on GitHub; confirm live URL runs `VITE_USE_MOCKS=false` + secrets | https://serviceready-frontend.lovable.app |
| Demo video | ❌ Not recorded / uploaded yet | `DEMO_SCRIPT.md` |
| Quality | ✅ Unit tests + typecheck; PayPal smoke script | `bun run test`, `smoke:paypal` |

**Bottom line:** Stage One blockers in *code* are largely cleared (real PayPal sandbox path, real LLM path, public MIT repo, persistence). Remaining eligibility risk is **ops**: live site must ship with mocks off + secrets, plus a **public YouTube video &lt; 3 min** and the Devpost form filled from `DEVPOST.md`.


## 3. Prioritised gap list

### MUST-FIX (eligibility / Stage One)

- [x] **1. Real PayPal sandbox backend (Orders v2)** — `GET /api/paypal/config`, deposit order + capture routes, OAuth token cache, secrets server-only. Keep mocks for tests.
- [ ] **1b. Published site on live sandbox** — confirm Lovable/prod has `VITE_USE_MOCKS=false` + PayPal + Supabase + LLM secrets (ops; not just GitHub).
- [x] **2. Real PayPal Invoicing v2 for the balance** — create/send/get; remind after human approval. Prefer real invoice link over simulate for the judge path.
- [x] **3. Real AI calls (LLM)** — `src/server/llm.ts` for catalog parse, agent chat, collections drafts; heuristics fallback without key. **Still need key present on the published host.**
- [x] **4. Shared persistence** — Supabase Postgres + seeded demo seller (`maya-rao-studio`).
- [x] **5. Public GitHub repo + MIT LICENSE** — https://github.com/kartiksaste123/serviceready (no force-push; no secrets committed).
- [x] **6. Real README** — judge path, sandbox buyer, PayPal/AI sections, env, architecture, hackathon “what's new”.
- [ ] **7. YouTube video &lt; 3 min, public** — record from `DEMO_SCRIPT.md`; upload by ~10 Nov.
- [ ] **8. Devpost form submitted** — paste from `DEVPOST.md` (description, Built With, demo URL, repo, video, sandbox credentials). Draft early; edit until deadline.
- [ ] **9. Remove leftover “simulated” disclaimers** in UI copy (`AgentBadge`, connect page, checkout) once live mode is confirmed on the published URL. Do not claim MCP/Agent Toolkit until shipped.

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
- [x] Video script written (`DEMO_SCRIPT.md`, ~2:45). Still need to **record + upload**. Beats: problem → AI agent books → PayPal sandbox deposit → deliver + PayPal invoice → AI reminder / pay invoice → architecture card naming PayPal + AI.

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
