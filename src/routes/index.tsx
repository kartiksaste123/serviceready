import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Bot,
  Check,
  CircleDollarSign,
  FileCheck2,
  LockKeyhole,
  MessageSquareText,
  ReceiptText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Wordmark } from "@/components/kit";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ServiceReady — Get booked by AI agents and paid before you start" },
      {
        name: "description",
        content:
          "Deposit-before-work merchant storefront: AI quotes from your catalog, PayPal takes the deposit first, and PayPal evidence beats client claims.",
      },
      {
        property: "og:title",
        content: "ServiceReady — Get booked by AI agents and paid before you start",
      },
      {
        property: "og:description",
        content:
          "Agent-ready services, deposits before work, and human-approved payment follow-up.",
      },
      { property: "og:type", content: "website" },
      {
        property: "og:image",
        content: "https://serviceready.onrender.com/images/hero.webp",
      },
      { name: "twitter:card", content: "summary_large_image" },
      {
        name: "twitter:image",
        content: "https://serviceready.onrender.com/images/hero.webp",
      },
    ],
  }),
  component: Home,
});

const tools = [
  "PayPal Agent Toolkit",
  "PayPal Orders v2",
  "PayPal Invoicing",
  "PayPal Webhooks",
  "MCP mandates",
  "xAI Grok",
  "Render",
];
const steps = [
  {
    n: "01",
    icon: Sparkles,
    title: "Paste your messy rate card",
    text: "ServiceReady turns it into clear service packages and flags prices that need your review.",
  },
  {
    n: "02",
    icon: Bot,
    title: "Let AI assistants book you",
    text: "Claude, ChatGPT and browser assistants can discover your services, prepare a quote and send the client to pay.",
  },
  {
    n: "03",
    icon: CircleDollarSign,
    title: "Collect a deposit first",
    text: "The booking is confirmed only after the client pays the PayPal deposit you set.",
  },
  {
    n: "04",
    icon: FileCheck2,
    title: "Deliver, invoice and follow up",
    text: "Send the balance invoice at delivery. Follow-ups check PayPal first and wait for your approval.",
  },
];

function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link to="/" aria-label="ServiceReady home">
            <Wordmark />
          </Link>
          <nav className="hidden items-center gap-7 text-sm md:flex">
            <a href="#how" className="text-muted-foreground hover:text-foreground">
              How it works
            </a>
            <a href="#proof" className="text-muted-foreground hover:text-foreground">
              Why now
            </a>
            <a href="#control" className="text-muted-foreground hover:text-foreground">
              Your control
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <Link to="/login" className="btn-glass btn-sm hidden sm:inline-flex">
              Sign in
            </Link>
            <Link to="/onboard" className="btn-mint btn-sm">
              <span className="sm:hidden">Get started</span>
              <span className="hidden sm:inline">Make my services bookable</span>{" "}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </header>
      <main id="main">
        <section className="border-b border-border">
          <div className="mx-auto grid max-w-7xl items-start gap-8 px-4 py-8 sm:gap-10 sm:px-8 sm:py-10 lg:grid-cols-[1.03fr_.97fr] lg:gap-12 lg:py-14">
            <div>
              <p className="eyebrow">Deposit-before-work merchant storefront</p>
              <h1 className="mt-3 max-w-3xl text-[1.85rem] font-semibold leading-[1.08] sm:text-5xl lg:text-6xl">
                Get booked by AI agents. Get paid before you start.
              </h1>
              <p className="mt-4 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
                Agent-ready storefront with PayPal deposits before work.{" "}
                <span className="font-medium text-foreground">
                  PayPal evidence beats client claims
                </span>
                — AI never sets your prices, and every reminder stays human-approved.
              </p>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <Link
                  to="/s/$slug"
                  params={{ slug: "maya-rao-studio" }}
                  search={{ judge: "1" }}
                  className="btn-mint w-full sm:w-auto"
                >
                  Judge demo · 3 min <ArrowRight className="size-4" />
                </Link>
                <Link to="/onboard" className="btn-glass w-full sm:w-auto">
                  Import your rate card
                </Link>
                <Link
                  to="/login"
                  search={{ demo: "1", next: "/app" }}
                  className="btn-glass w-full sm:w-auto"
                >
                  Open demo workspace
                </Link>
              </div>
              <a href="/judges" className="mt-3 inline-block text-sm text-link">
                Judges: step-by-step path, Claude MCP snippet &amp; “make it $1” tamper test →
              </a>
              <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                <ShieldCheck className="size-4" />
                Demo signs you into Maya Rao Studio — create your own account anytime.
              </p>
            </div>
            <div className="relative">
              <img
                src="/images/hero.webp"
                alt="ServiceReady — AI agents booking freelancers with PayPal deposits"
                className="aspect-[16/11] max-h-[360px] w-full rounded-2xl object-cover"
                width={960}
                height={600}
                loading="eager"
              />
              <div className="absolute bottom-4 left-4 right-4">
                <BookingProof />
              </div>
            </div>
          </div>
        </section>
        <section className="border-b border-border bg-muted">
          <div className="mx-auto max-w-7xl px-5 py-7 sm:px-8">
            <p className="text-center text-xs font-semibold uppercase text-muted-foreground">
              Built on
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-x-8 gap-y-3 text-sm font-semibold">
              {tools.map((x) => (
                <span key={x}>{x}</span>
              ))}
            </div>
          </div>
        </section>
        <section id="how" className="mx-auto max-w-7xl px-5 py-14 sm:px-8 sm:py-16">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
            <div className="min-w-0 flex-1">
              <p className="eyebrow">How it works</p>
              <h2 className="mt-3 text-2xl font-semibold sm:text-5xl">
                From loose notes to a paid booking.
              </h2>
            </div>
            <p className="max-w-md text-lg text-muted-foreground sm:pb-1 sm:text-right">
              The assistant handles the repetitive steps. You keep the decisions.
            </p>
          </div>
          <div className="mt-8 grid gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-2 lg:grid-cols-4">
            {steps.map((s) => (
              <article key={s.n} className="bg-card p-6">
                <div className="flex items-center justify-between">
                  <span className="icon-tile">
                    <s.icon className="size-4" />
                  </span>
                  <span className="text-xs font-semibold text-muted-foreground">{s.n}</span>
                </div>
                <h3 className="mt-5 text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{s.text}</p>
              </article>
            ))}
          </div>
        </section>
        <section id="proof" className="border-y border-border bg-muted">
          <div className="mx-auto grid max-w-7xl gap-8 px-5 py-14 sm:px-8 sm:py-16 lg:grid-cols-[.8fr_1.2fr]">
            <div>
              <p className="eyebrow">Why now</p>
              <h2 className="mt-3 text-2xl font-semibold sm:text-4xl">Less chasing. More trust.</h2>
              <p className="mt-4 leading-7 text-muted-foreground">
                Freelancers lose hours chasing invoices and start work on trust. Industry surveys
                (e.g. FreshBooks / Intuit small-business reports) routinely find a large share of
                invoices paid late — illustrative framing, not ServiceReady traction. Meanwhile
                clients ask AI assistants who to hire.
              </p>
            </div>
            <div className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
              {[
                ["$0", "work starts before PayPal confirms the deposit", "Deposit-before-work"],
                ["0", "reminders sent without your approval", "Human gate on every send"],
                ["MCP", "mandates with spend limits + revoke", "Agentic commerce guardrails"],
              ].map(([v, c, s]) => (
                <article key={v} className="bg-card p-6">
                  <div className="text-4xl font-semibold tabular-nums">{v}</div>
                  <p className="mt-3 text-sm leading-6">{c}</p>
                  <p className="mt-4 text-xs text-muted-foreground">{s}</p>
                </article>
              ))}
            </div>
          </div>
          <div className="mx-auto max-w-7xl px-5 pb-14 sm:px-8 sm:pb-16">
            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              <img
                src="/images/paypal-success.webp"
                alt="PayPal deposit paid confirmation for a ServiceReady booking"
                className="aspect-[21/9] max-h-[280px] w-full object-cover"
                width={1200}
                height={514}
                loading="lazy"
              />
              <div className="border-t border-border px-5 py-4 sm:px-6">
                <p className="text-sm font-semibold">Deposit collected before work starts</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Clients pay through PayPal. The booking only confirms after the deposit lands.
                </p>
              </div>
            </div>
          </div>
        </section>
        <section id="control" className="mx-auto max-w-7xl px-5 py-14 sm:px-8 sm:py-16">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
            <div className="min-w-0 flex-1">
              <p className="eyebrow">Human-in-the-loop by design</p>
              <h2 className="mt-3 text-2xl font-semibold sm:text-4xl">
                Automation without giving up control.
              </h2>
            </div>
            <p className="max-w-md leading-7 text-muted-foreground sm:pb-1 sm:text-right">
              ServiceReady prepares the work and shows its evidence. The important decisions stay
              with you.
            </p>
          </div>
          <ul className="mt-8 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2">
            {[
              [
                LockKeyhole,
                "AI never sets your prices",
                "Suspicious prices are flagged for review instead of silently published.",
              ],
              [
                CircleDollarSign,
                "Agents never pay on a client's behalf",
                "The client completes payment directly through PayPal.",
              ],
              [
                Check,
                "Every PayPal write needs approval",
                "You approve messages and money-moving actions before they happen.",
              ],
              [
                ReceiptText,
                "A complete activity record",
                "See what the assistant checked, drafted and sent.",
              ],
            ].map(([Icon, title, text]) => {
              const I = Icon as typeof LockKeyhole;
              return (
                <li key={String(title)} className="flex gap-4 bg-card p-5">
                  <span className="icon-tile">
                    <I className="size-4" />
                  </span>
                  <div>
                    <h3 className="font-semibold">{String(title)}</h3>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{String(text)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
        <section className="border-y border-border bg-muted">
          <div className="mx-auto max-w-3xl px-5 py-14 text-center sm:px-8 sm:py-16">
            <MessageSquareText className="mx-auto size-7" />
            <h2 className="mt-5 text-2xl font-semibold sm:text-4xl">
              Make your services ready for the next client.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
              Paste the rate card you already have. Review the result before anything is published.
            </p>
            <Link to="/onboard" className="btn-mint mt-6">
              Import your rate card <ArrowRight className="size-4" />
            </Link>
          </div>
        </section>
      </main>
      <footer>
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <Wordmark />
          <p>Built for independent service businesses.</p>
          <div className="flex gap-5">
            <a href="#how" className="hover:text-foreground">
              How it works
            </a>
            <Link to="/login" search={{ next: "/app" }} className="hover:text-foreground">
              Seller console
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function BookingProof() {
  return (
    <div className="rounded-xl border border-border bg-card/95 p-3.5 shadow-lg backdrop-blur-md sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">Maya Rao Studio</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            Brand identity sprint · Nina Park
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-success-bg px-2.5 py-1 text-xs font-semibold text-success">
          <Check className="size-3.5" />
          Deposit paid
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-muted px-3 py-2.5">
          <p className="text-[11px] text-muted-foreground">Deposit received</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums">$300</p>
        </div>
        <div className="rounded-lg bg-muted px-3 py-2.5">
          <p className="text-[11px] text-muted-foreground">Balance invoiced</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums">$300</p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-bg px-2.5 py-1 text-xs font-semibold text-warning">
          <span className="size-1.5 rounded-full bg-warning" />
          Awaiting approval
        </span>
        <Link to="/login" search={{ demo: "1", next: "/app/approvals" }} className="text-xs font-semibold hover:underline sm:text-sm">
          Review message →
        </Link>
      </div>
    </div>
  );
}
