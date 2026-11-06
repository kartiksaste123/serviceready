import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import {
  ArrowUpRight,
  Bot,
  CheckCircle2,
  ClipboardCopy,
  Loader2,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { api, USE_MOCKS } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { Wordmark } from "@/components/kit";
import { SANDBOX_BUYER_EMAIL, SANDBOX_BUYER_PASSWORD } from "@/components/JudgeMode";

const ORIGIN = "https://serviceready.onrender.com";
const SLUG = "maya-rao-studio";
const MCP_URL = `${ORIGIN}/mcp/${SLUG}`;
const REPO = "https://github.com/kartiksaste123/serviceready";

export const Route = createFileRoute("/judges")({
  head: () => ({
    meta: [
      { title: "Judges — ServiceReady" },
      {
        name: "description",
        content:
          "3-minute judge path: storefront AI, PayPal deposit, final bill, cancel policy, MCP.",
      },
      { property: "og:title", content: "ServiceReady — judge path" },
      { property: "og:type", content: "website" },
    ],
  }),
  component: JudgesPage,
});

const STEPS: Array<{ title: string; body: string; to: string; cta: string }> = [
  {
    title: "Book with the storefront AI",
    body: "Ask for a logo or brand kit with any name + email. Watch the tool trace: list_services → request_quote. Ask “what's your cancellation policy?” — the answer comes from structured fields, not the model.",
    to: `/s/${SLUG}?judge=1`,
    cta: "Open storefront",
  },
  {
    title: "Pay or authorize the deposit",
    body: "PayPal JS SDK v6 popup with the sandbox buyer below (Venmo / Pay Later appear when eligible). ≥ $500 deposits are AUTHORIZED (held); smaller ones are captured. Amounts are HMAC-signed and the order fingerprint is re-checked against PayPal before capture.",
    to: `/s/${SLUG}?judge=1`,
    cta: "Storefront",
  },
  {
    title: "Add a tip, then deliver",
    body: "On the quote page pick 10/15/20% for the final bill. Seller desk: Start work · capture → Mark delivered → PayPal invoice with a separate tip line.",
    to: "/login?demo=1&next=/app",
    cta: "Seller desk",
  },
  {
    title: "Cancel with the policy engine",
    body: "On any paid booking choose Cancel booking… → client cancel / no-show / seller cancel. The dialog previews which rule fires; PayPal void, partial capture or refund follows, and the timeline records the rule.",
    to: "/login?demo=1&next=/app",
    cta: "Bookings",
  },
  {
    title: "Pay the invoice → Check PayPal",
    body: "Pay as the sandbox buyer. The signed webhook flips it to paid; if a webhook is late, “Check PayPal” re-reads the order / invoice.",
    to: "/login?demo=1&next=/app",
    cta: "Seller desk",
  },
];

const CLAUDE_CODE = `claude mcp add --transport http serviceready ${MCP_URL}`;
const CLAUDE_JSON = `{
  "mcpServers": {
    "serviceready": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "${MCP_URL}"]
    }
  }
}`;
const CURL = `curl -s ${MCP_URL} -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_cancellation_policy","arguments":{}}}'`;
const PROMPT = `Use the serviceready MCP: create_payment_mandate with spend_limit_usd 800, list_services, request_quote for the brand kit (name Sam, sam@example.com), then create_deposit_link with the mandate_key. Then try request_quote again with deposit_usd: 1.`;

function JudgesPage() {
  const [quoteId, setQuoteId] = useState("");
  const tamper = useMutation({ mutationFn: () => api.tamperDemo(quoteId.trim() || undefined) });
  return (
    <div className="min-h-[100dvh] bg-muted">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between px-4 sm:px-6 lg:px-10">
          <Link to="/" aria-label="ServiceReady home">
            <Wordmark />
          </Link>
          <a href={REPO} target="_blank" rel="noreferrer" className="text-sm text-link">
            GitHub repo
          </a>
        </div>
      </header>
      <main className="mx-auto max-w-[1440px] space-y-4 px-4 py-4 sm:px-6 lg:px-10">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
          <section className="glass-card flex flex-col justify-between p-5 sm:p-6">
            <div>
              <p className="text-sm font-medium text-muted-foreground">PayPal AI Hackathon 2026</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
                Judge path · about 3 minutes
              </h1>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground sm:text-base">
                Unique angle: paste a rate card → agent-bookable storefront where catalog amounts
                are HMAC-signed and agents cannot invent or tamper with prices. AI books inside a
                spend mandate; PayPal holds or captures the deposit; a deterministic policy decides
                refunds.
              </p>
            </div>
            <div>
              <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border text-sm sm:grid-cols-4">
                {[
                  ["5", "guided steps"],
                  ["Orders v2", "capture + authorize"],
                  ["Invoicing v2", "final bill + tip"],
                  ["MCP", "AI booking tools"],
                ].map(([k, v]) => (
                  <div key={k} className="bg-card px-4 py-3">
                    <dt className="font-semibold">{k}</dt>
                    <dd className="text-xs text-muted-foreground">{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-5 flex flex-wrap gap-2">
                <a href={`/s/${SLUG}?judge=1`} className="btn-mint btn-sm">
                  Live storefront <ArrowUpRight className="size-3.5" aria-hidden="true" />
                </a>
                <a href="/login?demo=1&next=/app" className="btn-glass btn-sm">
                  Seller desk (demo login)
                </a>
                <a
                  href={`${REPO}/blob/master/DEMO_SCRIPT.md`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-glass btn-sm"
                >
                  Demo script
                </a>
                <a href="/api/health" target="_blank" rel="noreferrer" className="btn-glass btn-sm">
                  /api/health
                </a>
                <a
                  href="/.well-known/agent-card.json"
                  target="_blank"
                  rel="noreferrer"
                  className="btn-glass btn-sm"
                >
                  agent-card.json
                </a>
                <a href="/llms.txt" target="_blank" rel="noreferrer" className="btn-glass btn-sm">
                  llms.txt
                </a>
              </div>
            </div>
          </section>
          <section className="glass-card flex flex-col p-5" aria-labelledby="creds-h">
            <h2 id="creds-h" className="font-semibold">
              Credentials (sandbox only)
            </h2>
            <div className="mt-3 space-y-2 text-sm">
              <p className="text-xs font-semibold text-muted-foreground">PayPal sandbox buyer</p>
              <Copy label="Email" value={SANDBOX_BUYER_EMAIL} />
              <Copy label="Password" value={SANDBOX_BUYER_PASSWORD} />
              <p className="pt-2 text-xs font-semibold text-muted-foreground">Seller desk</p>
              <Copy label="Email" value="demo@serviceready.app" />
              <Copy label="Password" value="DemoJudge2026!" />
              <p className="text-xs text-muted-foreground">
                Tip: use the buyer email as the client email so the PayPal invoice reaches that
                sandbox inbox.
              </p>
            </div>
          </section>
        </div>

        <section aria-labelledby="steps-h">
          <h2 id="steps-h" className="mb-3 font-semibold">
            One-click steps
          </h2>
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map((s, i) => (
              <li key={s.title} className="glass-card flex flex-col p-4 text-sm">
                <span className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  {i + 1}
                </span>
                <p className="mt-3 font-semibold">{s.title}</p>
                <p className="mt-1 flex-1 text-muted-foreground">{s.body}</p>
                <a href={s.to} className="mt-3 text-xs font-semibold text-link">
                  {s.cta} →
                </a>
              </li>
            ))}
          </ol>
        </section>

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <section className="glass-card p-5" aria-labelledby="mcp-h">
            <h2 id="mcp-h" className="flex items-center gap-2 font-semibold">
              <Bot className="size-4" aria-hidden="true" />
              Book from Claude (MCP)
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Streamable HTTP MCP at <code className="font-mono">{MCP_URL}</code>. In Claude.ai /
              Desktop: Settings → Connectors → Add custom connector → paste the URL. Or:
            </p>
            <div className="mt-3 grid gap-3">
              <Snippet label="Claude Code" code={CLAUDE_CODE} />
              <Snippet label="claude_desktop_config.json" code={CLAUDE_JSON} />
              <Snippet label="Prompt to paste" code={PROMPT} />
              <Snippet label="curl" code={CURL} />
            </div>
            {USE_MOCKS && (
              <p className="mt-2 text-xs text-muted-foreground">
                Local mock mode — MCP runs on the live deploy.
              </p>
            )}
          </section>

          <div className="space-y-5">
            <section className="glass-card p-5" aria-labelledby="tamper-h">
              <h2 id="tamper-h" className="flex items-center gap-2 font-semibold">
                <ShieldCheck className="size-4" aria-hidden="true" />
                Try to make it $1
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Runs the real server checks: agent money fields, a tampered quote row, a PayPal
                order with a different amount, and an oversized tip. Nothing is written.
              </p>
              <label htmlFor="tq" className="mt-3 block text-xs font-medium text-muted-foreground">
                Optional: a live quote id to verify its signature
              </label>
              <input
                id="tq"
                className="field mt-1 font-mono text-xs"
                placeholder="quote uuid from /q/…"
                value={quoteId}
                onChange={(e) => setQuoteId(e.target.value)}
              />
              <button
                type="button"
                className="btn-mint btn-sm mt-3 w-full"
                disabled={tamper.isPending}
                onClick={() => tamper.mutate()}
              >
                {tamper.isPending && (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                )}
                Run tamper test
              </button>
              {tamper.data && (
                <ul className="mt-3 space-y-2 text-sm" aria-live="polite">
                  {tamper.data.checks.map((c) => (
                    <li key={c.check} className="flex gap-2">
                      {c.ok ? (
                        <CheckCircle2
                          className="mt-0.5 size-4 shrink-0 text-success"
                          aria-hidden="true"
                        />
                      ) : (
                        <XCircle
                          className="mt-0.5 size-4 shrink-0 text-danger"
                          aria-hidden="true"
                        />
                      )}
                      <span>
                        <span className="font-medium">{c.check}</span>
                        <span className="block text-xs text-muted-foreground">
                          {c.ok ? "Blocked · " : ""}
                          {c.detail}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {tamper.isError && (
                <p className="mt-2 text-sm text-danger">
                  {tamper.error instanceof Error ? tamper.error.message : "Tamper test failed"}
                </p>
              )}
            </section>
            <section className="glass-card p-5 text-sm" aria-labelledby="beats-h">
              <h2 id="beats-h" className="font-semibold">
                What to look for
              </h2>
              <ul className="mt-2 grid gap-x-6 gap-y-1.5 text-muted-foreground sm:grid-cols-2 lg:grid-cols-1">
                <li>Paste rate card → agent storefront (amounts agents can&apos;t tamper with)</li>
                <li>PayPal Orders v2 CAPTURE + AUTHORIZE, JS SDK v6</li>
                <li>Venmo / Pay Later when the sandbox buyer is eligible</li>
                <li>Invoicing v2 final bill with tip line</li>
                <li>Dispute evidence pack + sandbox Payouts tip-out on paid bookings</li>
                <li>Cancel policy → void / partial capture / refund</li>
                <li>Agent Toolkit · signed webhooks · Check PayPal</li>
                <li>MCP mandates, Vault, /.well-known/agent-card.json + /llms.txt</li>
              </ul>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}

function Copy({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="min-w-0">
        <span className="text-muted-foreground">{label}: </span>
        <code className="break-all font-mono text-xs">{value}</code>
      </span>
      <button
        type="button"
        onClick={() => void copyText(value, `${label} copied`)}
        className="flex shrink-0 items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-xs hover:bg-card"
        aria-label={`Copy ${label.toLowerCase()}`}
      >
        <ClipboardCopy className="size-3" aria-hidden="true" />
        Copy
      </button>
    </div>
  );
}

function Snippet({ label, code }: { label: string; code: string }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground">{label}</span>
        <button
          type="button"
          onClick={() => void copyText(code, `${label} copied`)}
          className="flex items-center gap-1 text-xs text-link"
        >
          <ClipboardCopy className="size-3" aria-hidden="true" />
          Copy
        </button>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3 font-mono text-[11px] leading-relaxed">
        {code}
      </pre>
    </div>
  );
}
