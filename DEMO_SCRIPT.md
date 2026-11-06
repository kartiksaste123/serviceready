# ServiceReady — demo video script (≤ 3:00)

**Target length:** 2:45–2:55  
**Upload:** YouTube, **public**, no copyrighted music. AI voiceover is fine.  
**On-screen rule:** PayPal and AI must be impossible to miss — say the words, show the UI, show the sandbox popup.

**Prep before record**

1. Live site: https://serviceready.onrender.com (`VITE_USE_MOCKS=false` on Render).
2. Storefront ready: `/s/maya-rao-studio`.
3. Sandbox buyer logged out of PayPal so the login popup is visible on camera.
4. Seller desk: open `/login` → **Continue as demo** (or demo credentials in README), then `/app`.
5. Browser zoom ~110%. Hide bookmarks bar. Cut any spinner longer than ~1s in edit.

**Sandbox buyer (show email on screen; password only if Devpost needs it — prefer README cut):**

`sb-flkqr53721283@personal.example.com`

---

## Script

### 0:00–0:20 — Problem + who it’s for

**On screen:** Landing page. Zoom on headline / “Try the demo storefront”. Optional lower-third: `ServiceReady · PayPal AI Hackathon 2026`.

**Say:**  
“Solo freelancers start work on trust and chase invoices for weeks. ServiceReady’s unique angle: **paste a rate card** and get an **agent-bookable storefront** where amounts AI assistants **cannot tamper with**. **PayPal** takes the deposit before work — client claims are never trusted over PayPal evidence.”

**Cut to:** Landing CTA **Judge demo · 3 min** → storefront `/s/maya-rao-studio?judge=1` → **Send booking request**.

---

### 0:20–0:45 — AI: catalog / services (or jump to storefront AI)

**Preferred (faster):** Already-published Maya Rao Studio storefront with services listed.

**On screen:** `/s/maya-rao-studio`. Open the **AI assistant** panel. Label overlay: `AI · xAI/Grok storefront agent`.

**Say:**  
“Here’s a live demo seller. I’m asking the **AI storefront agent** — powered by **Grok** on the server — for a logo package.”

**Type (or paste) into chat:**  
`Hi — I need a logo / brand package. I'm Sam, sam@example.com`

**On screen:** Show assistant reply + **tool traces** (`list_services` / `request_quote`). Click through to the quote page.

**Say:**  
“The agent lists services, creates a quote, and hands me a PayPal deposit link — no fake checkout.”

*(If you also show catalog parse: 10s of pasting a messy rate card into Import → “AI extracts services” → publish. Keep under 0:45 total.)*

---

### 0:45–1:20 — PayPal Orders v2 deposit (must show sandbox popup)

**On screen:** Quote page `/q/...`. PayPal **JS SDK v6** button (caption shows `SDK v6`). Overlay: `PayPal Orders v2 · JS SDK v6 · sandbox`. For a Full Brand Kit ($600 deposit) the page says **Authorize** — PayPal holds the funds until work starts.

**Say:**  
“Before any work starts, I pay a deposit with **PayPal Orders v2** — real sandbox, not a mock. Venmo and Pay Later show up when the buyer is eligible.”

**Do:** Click PayPal button → sandbox popup → log in as sandbox buyer → approve.

**On screen:** Popup clearly branded PayPal. After approve, quote status **Deposit paid** + capture / order id in timeline if shown.

**Say:**  
“Approved. Small deposits are captured; big ones are **authorized** — PayPal holds the money and I capture it when I start work, or void it if the job is cancelled. Status flips only from **PayPal** evidence.”

**Optional (5s):** desk → **Start work · capture $600** → timeline shows `paypal.authorizations.capture`.

---

**Optional (5s):** on the quote page pick a **15% tip** — “the tip becomes its own line on the PayPal invoice.”

### 1:20–1:50 — Deliver + PayPal Invoicing v2

**On screen:** `/login` → Continue as demo → seller desk `/app` → open the booking → **Mark delivered & invoice balance**. Overlay: `PayPal Invoicing v2`.

**Say:**  
“As the seller, I mark the work delivered. ServiceReady creates and sends a real **PayPal invoice** for the remaining balance.”

**Do:** Show the final-bill breakdown in the confirm dialog (balance + tip), then the invoice link / id. Optionally open the sandbox invoice page briefly.

---

### 1:50–2:25 — AI collections draft + human approve + pay invoice

**On screen:** **Run payment check** / collections run → proposal card with AI-drafted reminder. Overlay: `AI draft · human approves`.

**Say:**  
“The desk is an **AG Grid** with a deterministic **risk score** — days overdue, amount and pay history — that sets the reminder tone: warm, firm or final. Payment check uses the official **PayPal Agent Toolkit** — you can see `get_invoice` in the audit trail. **AI** drafts a reminder; a human approves before **send_invoice_reminder**. PayPal evidence beats client claims.”

**Do:** Approve (or skip send if already showing unpaid invoice) → pay the invoice as the **same sandbox buyer** → **Check payment** / refresh.

**On screen:** Status → paid / reconciled. Thank-you or metrics tick if available.

**Say:**  
“Sandbox buyer pays the **PayPal invoice**. We refresh from PayPal — paid.”

---

### Optional 10s — Cancellation policy (use a second paid booking)

**On screen:** desk → **Cancel booking…** → pick **Client no-show**. Dialog previews “Rule that will fire: no show — you keep $X”. Confirm → timeline shows `cancel_policy.no_show` then `paypal.authorizations.capture` (or `create_refund`).

**Say:**  
“Cancellations follow the seller’s policy — deterministic, not AI. PayPal voids, partially captures or refunds, and the audit trail shows which rule fired.”

### Optional 8s — Tamper test + evidence pack

**On screen:** `/judges` → **Run tamper test** → four green “Blocked” rows. Optional: desk → **Evidence pack** downloads Markdown with PayPal ids + HMAC fingerprint for a dispute.

**Say:**  
“Try to make it a dollar: agent price fields are rejected, the quote is HMAC-signed, and the PayPal order fingerprint is re-checked before capture. For disputes, one click exports the evidence pack.”

### 2:20–2:35 — MCP mandate (10–15s, optional if tight)

**On screen:** Terminal or Connect page — `create_payment_mandate` → `create_deposit_link` with `mandate_key`. Overlay: `Spend limit · revocable`.

**Say:**  
“Outside agents need a **payment mandate** with a spend limit before they can mint a PayPal deposit link. If an agent tries to set its own price, the call is **rejected** and logged. Revoke the key anytime.”

---

### 2:35–2:55 — Architecture card + CTA

**On screen:** Simple full-screen card (Canva/slide or README architecture):

```
ServiceReady
AI (xAI Grok): catalog · agent chat · collections drafts
Agents: MCP mandate → create_deposit_link · Vault rebooking · price-override guardrail
PayPal: Orders v2 capture/authorize · JS SDK v6 (+Venmo/Pay Later) · Invoicing v2 (+tip) · Payouts · Agent Toolkit · signed Webhooks
Rules: cancel/no-show · dispute evidence pack · HMAC-signed amounts · agent-card + llms.txt
Supabase + TanStack Start on Render · MIT
Demo: serviceready.onrender.com
Repo: github.com/kartiksaste123/serviceready
```

**Say:**  
“**AI** books within spend limits; **PayPal Agent Toolkit** proves payment; webhooks reconcile. Judges: live demo, sandbox buyer in README, `/s/maya-rao-studio`. Thanks!”

**End card hold ~3s.** Stop by **2:55** max (hard cap 3:00).

---

## Shot list (edit checklist)

| # | Must appear | Why |
|---|-------------|-----|
| 1 | Words “PayPal” and “AI”/“Grok” in first 20s | Stage Two + tips |
| 2 | Storefront AI chat + tool trace | AI is real |
| 3 | PayPal sandbox popup (login or approve) | PayPal is real |
| 4 | Deposit-paid status after capture | Orders v2 |
| 5 | Deliver → PayPal invoice | Invoicing v2 |
| 6 | AI reminder draft or payment check | AI + HITL |
| 7 | Repo or live URL on end card | Traceability |

## Voice / visuals

- Calm, clear; ~140–150 wpm.
- No stock music with vocals; soft bed OK if licensed or silent.
- Burn in overlays for `AI` and `PayPal` during those beats.
- Do **not** show `.env`, secrets, or full password on a large overlay (email alone is enough on video; password stays in Devpost/README).

## After upload

1. Wait for YouTube processing (can take hours — upload by ~10 Nov).
2. Paste public URL into Devpost + `DEVPOST.md` “Video” row.
3. Re-smoke the live URL so the video still matches the product.
