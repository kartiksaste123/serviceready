import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Bot,
  CalendarX2,
  Check,
  CircleDollarSign,
  Gavel,
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
  "PayPal Orders",
  "PayPal Invoicing",
  "PayPal Agent Toolkit",
  "MCP",
  "xAI Grok",
  "Render",
];

const steps = [
  {
    icon: Sparkles,
    title: "Add your services",
    text: "Paste your rate card. We turn it into clear packages with prices and deposits — you review before anything goes live.",
  },
  {
    icon: Bot,
    title: "Clients book you",
    text: "From your booking page, or through Claude, ChatGPT and other AI assistants. Each gets an exact quote.",
  },
  {
    icon: CircleDollarSign,
    title: "Get paid through PayPal",
    text: "A deposit confirms the booking. When the work is done, the final bill goes out automatically.",
  },
];

const features = [
  {
    icon: LockKeyhole,
    title: "AI never sets your prices",
    text: "Quotes come from your price list only. Odd prices are flagged for you to check.",
  },
  {
    icon: ShieldCheck,
    title: "Deposit before work",
    text: "Nothing starts until PayPal confirms the deposit. No more working on trust.",
  },
  {
    icon: MessageSquareText,
    title: "You approve every message",
    text: "Reminders and follow-ups are drafted for you, and only sent when you say yes.",
  },
  {
    icon: Check,
    title: "PayPal is the source of truth",
    text: "“I already paid” is checked against PayPal before anyone gets chased.",
  },
  {
    icon: CalendarX2,
    title: "Fair cancellation rules",
    text: "Set your policy once. Refunds and kept fees are handled automatically.",
  },
  {
    icon: ReceiptText,
    title: "A clear record",
    text: "See every quote, payment and message in one simple timeline.",
  },
];

const container = "mx-auto w-full max-w-6xl px-5 sm:px-8";

function SectionHead({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
      {sub && <p className="mt-4 text-lg leading-8 text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
        <div className={`${container} flex h-16 items-center justify-between`}>
          <Link to="/" aria-label="ServiceReady home">
            <Wordmark />
          </Link>
          <nav className="hidden items-center gap-8 text-sm font-medium md:flex">
            <a href="#how" className="text-muted-foreground hover:text-foreground">
              How it works
            </a>
            <a href="#features" className="text-muted-foreground hover:text-foreground">
              Features
            </a>
            <Link
              to="/s/$slug"
              params={{ slug: "maya-rao-studio" }}
              className="text-muted-foreground hover:text-foreground"
            >
              Live demo
            </Link>
          </nav>
          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              to="/login"
              className="hidden px-2 text-sm font-medium text-muted-foreground hover:text-foreground sm:inline"
            >
              Sign in
            </Link>
            <Link to="/onboard" className="btn-mint btn-sm">
              Get started
            </Link>
          </div>
        </div>
      </header>
      <main id="main">
        <section className="relative overflow-hidden">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 -z-0 h-[520px] bg-gradient-to-b from-accent to-transparent"
          />
          <div className={`${container} relative pb-12 pt-14 text-center sm:pb-16 sm:pt-20`}>
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground shadow-xs">
              <span className="size-1.5 rounded-full bg-brand" aria-hidden="true" />
              Bookings and payments, powered by PayPal + AI
            </span>
            <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl">
              Get booked online. Get paid before you start.
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
              A booking page that clients — and their AI assistants — can use. They pay a PayPal
              deposit up front, and you approve every reminder.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link to="/onboard" className="btn-mint w-full px-6 sm:w-auto">
                Create your storefront <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
              <Link
                to="/s/$slug"
                params={{ slug: "maya-rao-studio" }}
                search={{ judge: "1" }}
                className="btn-glass w-full px-6 sm:w-auto"
              >
                See a live example
              </Link>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              Free to try · No card needed ·{" "}
              <Link
                to="/login"
                search={{ demo: "1", next: "/app" }}
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                Explore the demo dashboard
              </Link>
            </p>
            <div className="relative mx-auto mt-12 max-w-5xl">
              <div className="overflow-hidden rounded-2xl border border-border bg-card p-2 shadow-[0_24px_60px_-24px_rgba(16,24,40,0.25)]">
                <img
                  src="/images/hero.webp"
                  alt="A freelancer's ServiceReady booking with a PayPal deposit paid"
                  className="aspect-[4/3] w-full rounded-xl object-cover sm:aspect-[16/8]"
                  width={960}
                  height={600}
                  loading="eager"
                />
              </div>
              <div className="mx-auto -mt-16 w-[min(92%,380px)] text-left sm:absolute sm:bottom-6 sm:right-6 sm:mt-0">
                <BookingProof />
              </div>
            </div>
          </div>
        </section>

        <section className="border-y border-border bg-muted">
          <div
            className={`${container} flex flex-col items-center gap-4 py-7 sm:flex-row sm:justify-center sm:gap-10`}
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Built on
            </p>
            <div className="flex flex-wrap justify-center gap-x-8 gap-y-2 text-sm font-semibold text-muted-foreground">
              {tools.map((x) => (
                <span key={x}>{x}</span>
              ))}
            </div>
          </div>
        </section>

        <section id="how" className={`${container} scroll-mt-20 py-20 sm:py-24`}>
          <SectionHead
            eyebrow="How it works"
            title="From price list to paid booking in three steps"
            sub="Set it up once. ServiceReady handles the busywork; you keep every decision."
          />
          <ol className="mt-14 grid gap-6 md:grid-cols-3">
            {steps.map((s, i) => (
              <li key={s.title} className="glass-card p-6 sm:p-7">
                <div className="flex items-center gap-3">
                  <span className="icon-tile">
                    <s.icon className="size-4" aria-hidden="true" />
                  </span>
                  <span className="text-sm font-semibold text-muted-foreground">Step {i + 1}</span>
                </div>
                <h3 className="mt-5 text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 leading-7 text-muted-foreground">{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="features" className="scroll-mt-20 border-y border-border bg-muted">
          <div className={`${container} py-20 sm:py-24`}>
            <SectionHead
              eyebrow="Why ServiceReady"
              title="Less chasing. More trust."
              sub="The safety rails a real business needs — built in, not bolted on."
            />
            <ul className="mt-14 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((f) => (
                <li key={f.title}>
                  <span className="icon-tile">
                    <f.icon className="size-4" aria-hidden="true" />
                  </span>
                  <h3 className="mt-4 font-semibold">{f.title}</h3>
                  <p className="mt-1.5 leading-7 text-muted-foreground">{f.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className={`${container} py-20 sm:py-24`}>
          <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
            <div>
              <p className="eyebrow">Real PayPal checkout</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
                Clients pay the way they already trust.
              </h2>
              <p className="mt-4 text-lg leading-8 text-muted-foreground">
                The deposit is held or captured through PayPal before work begins. The final bill is
                a PayPal invoice, sent the moment you mark the job delivered.
              </p>
              <ul className="mt-6 space-y-3">
                {[
                  "Pay with PayPal or a debit / credit card",
                  "Prices are signed, so they can’t be changed at checkout",
                  "Saved payment for repeat clients (with their permission)",
                ].map((x) => (
                  <li key={x} className="flex items-start gap-3">
                    <Check className="mt-1 size-4 shrink-0 text-primary" aria-hidden="true" />
                    <span>{x}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="overflow-hidden rounded-2xl border border-border bg-card p-2 shadow-[0_24px_60px_-28px_rgba(16,24,40,0.25)]">
              <img
                src="/images/paypal-success.webp"
                alt="PayPal deposit paid confirmation for a ServiceReady booking"
                className="aspect-[4/3] w-full rounded-xl object-cover"
                width={1200}
                height={900}
                loading="lazy"
              />
            </div>
          </div>
        </section>

        <section className={`${container} pb-20 sm:pb-24`}>
          <div className="flex flex-col items-start justify-between gap-4 rounded-2xl border border-border bg-card p-6 sm:flex-row sm:items-center sm:p-8">
            <div className="flex items-start gap-4">
              <span className="icon-tile">
                <Gavel className="size-4" aria-hidden="true" />
              </span>
              <div>
                <h2 className="font-semibold">Judging the PayPal AI Hackathon?</h2>
                <p className="mt-1 text-muted-foreground">
                  A 3-minute guided path, the Claude MCP snippet and the “make it $1” tamper test.
                </p>
              </div>
            </div>
            <a href="/judges" className="btn-glass shrink-0">
              Open judge guide <ArrowRight className="size-4" aria-hidden="true" />
            </a>
          </div>
        </section>

        <section className="bg-foreground text-background">
          <div className={`${container} py-16 text-center sm:py-20`}>
            <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
              Ready for your next client?
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-background/70">
              Paste the price list you already have. Review it, publish it, share the link.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link to="/onboard" className="btn-mint w-full px-6 sm:w-auto">
                Create your storefront <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
              <Link
                to="/login"
                search={{ demo: "1", next: "/app" }}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-background/25 px-6 text-sm font-semibold text-background hover:bg-background/10 sm:min-h-10 sm:w-auto"
              >
                Explore the demo
              </Link>
            </div>
          </div>
        </section>
      </main>
      <footer className="border-t border-border">
        <div
          className={`${container} flex flex-col gap-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between`}
        >
          <Wordmark />
          <p>Built for independent service businesses.</p>
          <div className="flex gap-6">
            <a href="#how" className="hover:text-foreground">
              How it works
            </a>
            <a href="/judges" className="hover:text-foreground">
              Judges
            </a>
            <Link to="/login" search={{ next: "/app" }} className="hover:text-foreground">
              Sign in
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
        <Link
          to="/login"
          search={{ demo: "1", next: "/app/approvals" }}
          className="text-xs font-semibold hover:underline sm:text-sm"
        >
          Review message →
        </Link>
      </div>
    </div>
  );
}
