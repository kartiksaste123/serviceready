import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  ArrowRight,
  Bot,
  Check,
  CircleDollarSign,
  FileCheck2,
  LockKeyhole,
  MessageSquareText,
  ReceiptText,
  Sparkles,
} from "lucide-react";
import { Wordmark } from "@/components/kit";
import { api } from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ServiceReady — Get booked by AI agents and paid before you start" },
      {
        name: "description",
        content:
          "Turn your rate card into services AI assistants can quote and book, with a PayPal deposit collected before work starts.",
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
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Home,
});

const tools = [
  "PayPal Orders v2",
  "PayPal Invoicing",
  "PayPal Agent Toolkit",
  "MCP",
  "Cloudflare Workers AI",
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
    text: "Claude and ChatGPT can discover your services, prepare a quote and send the client to pay over MCP.",
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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const account = useQuery({ queryKey: ["me"], queryFn: api.auth.me });
  const [demoPending, setDemoPending] = useState(false);
  const tryDemo = async () => {
    setDemoPending(true);
    try {
      await api.auth.demo();
      queryClient.clear();
      await navigate({ to: "/app" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't open the demo studio.");
    } finally {
      setDemoPending(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-2 px-5 sm:px-8">
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
          <div className="flex shrink-0 items-center gap-2">
            {account.data ? (
              <Link to="/app" className="btn-primary btn-sm">
                <span className="sm:hidden">My studio</span>
                <span className="hidden sm:inline">Open my studio</span>
                <ArrowRight className="size-4" />
              </Link>
            ) : (
              <>
                <Link to="/login" className="text-sm text-muted-foreground hover:text-foreground">
                  Log in
                </Link>
                <Link to="/signup" className="btn-primary btn-sm">
                  <span className="sm:hidden">Get started</span>
                  <span className="hidden sm:inline">Make my services bookable</span>
                  <ArrowRight className="size-4" />
                </Link>
              </>
            )}
          </div>
        </div>
      </header>
      <main>
        <section className="border-b border-border">
          <div className="mx-auto grid max-w-7xl items-center gap-10 px-5 py-8 sm:px-8 lg:grid-cols-[1.03fr_.97fr] lg:py-11">
            <div>
              <p className="eyebrow">The agent-ready service desk for freelancers</p>
              <h1 className="mt-5 max-w-3xl text-5xl font-semibold leading-[1.02] sm:text-6xl lg:text-7xl">
                Get booked by AI agents. Get paid before you start.
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">
                Publish services assistants can understand, collect a PayPal deposit before work
                begins, and keep every client follow-up under your control.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link to={account.data ? "/app" : "/signup"} className="btn-primary">
                  {account.data ? "Open my studio" : "Get started"} <ArrowRight className="size-4" />
                </Link>
                <Link to="/s/$slug" params={{ slug: "maya-rao-studio" }} className="btn-glass">
                  See Maya&apos;s storefront
                </Link>
                <button className="btn-glass" onClick={() => void tryDemo()} disabled={demoPending}>
                  {demoPending ? "Opening demo…" : "Try the demo"}
                </button>
              </div>
              <p className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
                <Check className="size-4 text-success" />
                Maya Rao Studio is available as a one-click demo.
              </p>
            </div>
            <BookingProof />
          </div>
        </section>
        <section className="border-b border-border bg-muted">
          <div className="mx-auto max-w-7xl px-5 py-5 sm:px-8">
            <p className="text-center text-xs font-semibold text-muted-foreground">Built on</p>
            <div className="mt-4 flex flex-wrap justify-center gap-x-8 gap-y-3 text-sm font-semibold">
              {tools.map((tool) => (
                <span key={tool}>{tool}</span>
              ))}
            </div>
          </div>
        </section>
        <section id="how" className="mx-auto max-w-7xl px-5 py-9 sm:px-8">
          <div className="max-w-2xl">
            <p className="eyebrow">How it works</p>
            <h2 className="mt-3 text-3xl font-semibold sm:text-5xl">
              From loose notes to a paid booking.
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              The assistant handles the repetitive steps. You keep the decisions.
            </p>
          </div>
          <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-2 lg:grid-cols-4">
            {steps.map((step) => (
              <article key={step.n} className="bg-card p-6">
                <div className="flex items-center justify-between">
                  <span className="icon-tile">
                    <step.icon className="size-4" />
                  </span>
                  <span className="text-xs font-semibold text-muted-foreground">{step.n}</span>
                </div>
                <h3 className="mt-8 text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.text}</p>
              </article>
            ))}
          </div>
        </section>
        <section id="proof" className="border-y border-border bg-muted">
          <div className="mx-auto grid max-w-7xl gap-10 px-5 py-9 sm:px-8 lg:grid-cols-[.8fr_1.2fr]">
            <div>
              <p className="eyebrow">Why now</p>
              <h2 className="mt-3 text-3xl font-semibold sm:text-4xl">Less chasing. More trust.</h2>
              <p className="mt-4 leading-7 text-muted-foreground">
                Late-payment follow-up takes time and strains client relationships. At the same
                time, clients increasingly ask AI to find who to hire.
              </p>
            </div>
            <div className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
              {[
                ["15", "days a year spent chasing late payments", "Sage, 3,000+ SMBs"],
                ["45%", "of US consumers used AI to find a local business", "BrightLocal 2026"],
                ["30%+", "avoid chasing to protect the relationship", "Sage"],
              ].map(([value, copy, source]) => (
                <article key={value} className="bg-card p-6">
                  <div className="text-4xl font-semibold tabular-nums">{value}</div>
                  <p className="mt-3 text-sm leading-6">{copy}</p>
                  <p className="mt-4 text-xs text-muted-foreground">Source: {source}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
        <section
          id="control"
          className="mx-auto grid max-w-7xl gap-10 px-5 py-9 sm:px-8 lg:grid-cols-2"
        >
          <div>
            <p className="eyebrow">Human-in-the-loop by design</p>
            <h2 className="mt-3 text-3xl font-semibold sm:text-4xl">
              Automation without giving up control.
            </h2>
            <p className="mt-4 max-w-xl leading-7 text-muted-foreground">
              ServiceReady prepares the work and shows its evidence. The important decisions stay
              with you.
            </p>
          </div>
          <ul className="divide-y divide-border border-y border-border">
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
              const ItemIcon = Icon as typeof LockKeyhole;
              return (
                <li key={String(title)} className="flex gap-4 py-5">
                  <span className="icon-tile">
                    <ItemIcon className="size-4" />
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
          <div className="mx-auto max-w-3xl px-5 py-9 text-center sm:px-8">
            <MessageSquareText className="mx-auto size-7" />
            <h2 className="mt-5 text-4xl font-semibold">
              Make your services ready for the next client.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
              Paste the rate card you already have. Review the result before anything is published.
            </p>
            <Link to={account.data ? "/app" : "/signup"} className="btn-primary mt-8">
              {account.data ? "Open my studio" : "Get started"} <ArrowRight className="size-4" />
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
            <Link to={account.data ? "/app" : "/login"} className="hover:text-foreground">
              {account.data ? "Open my studio" : "Seller console"}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function BookingProof() {
  return (
    <div className="glass-card dash-shadow p-5 sm:p-6">
      <div className="flex items-start justify-between border-b border-border pb-5">
        <div>
          <p className="text-sm font-semibold">Maya Rao Studio</p>
          <p className="mt-1 text-xs text-muted-foreground">Brand identity sprint · Nina Park</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-success-bg px-2.5 py-1 text-xs font-semibold text-success">
          <Check className="size-3.5" />
          Deposit paid
        </span>
      </div>
      <div className="grid grid-cols-2 gap-px border-b border-border bg-border">
        <div className="-ml-5 bg-card px-5 py-5">
          <p className="text-xs text-muted-foreground">Deposit received</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">$300</p>
        </div>
        <div className="-mr-5 bg-card px-5 py-5">
          <p className="text-xs text-muted-foreground">Balance invoiced</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">$300</p>
        </div>
      </div>
      <div className="mt-5 rounded-lg border border-border bg-muted p-4">
        <div className="flex gap-3">
          <span className="icon-tile">
            <Bot className="size-4" />
          </span>
          <div>
            <p className="font-semibold">Payment status checked</p>
            <p className="mt-1 text-sm text-muted-foreground">
              PayPal says the balance is unpaid. A friendly reminder is ready for Maya to review.
            </p>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-bg px-2.5 py-1 text-xs font-semibold text-warning">
            <span className="size-1.5 rounded-full bg-warning" />
            Awaiting approval
          </span>
          <span className="text-sm font-semibold">Review message →</span>
        </div>
      </div>
    </div>
  );
}
