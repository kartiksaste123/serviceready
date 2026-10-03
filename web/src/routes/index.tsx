import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight, ArrowDownLeft, Bot, Check, CircleCheck, ClipboardList, FileText, Github, Hand,
  Linkedin, ListChecks, PlayCircle, ScrollText, ShieldCheck, Sparkle, Twitter, Wallet, Zap, AlertTriangle, Clock,
} from "lucide-react";
import { Wordmark, LogoMark } from "@/components/kit";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ServiceReady — Get booked by AI agents, paid before you start" },
      { name: "description", content: "Turn a messy rate card into agent-ready services. AI assistants quote and book you, clients pay a PayPal deposit first, and collections check PayPal before replying." },
      { property: "og:title", content: "ServiceReady — the agent-ready service desk" },
      { property: "og:description", content: "Get booked by AI agents. Get paid before you start." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const STORE = { to: "/s/$slug" as const, params: { slug: "maya-rao-studio" } };

function Landing() {
  return (
    <div className="min-h-screen bg-deep-900">
      <Nav />
      <Hero />
      <TrustStrip />
      <Features />
      <Stats />
      <HumanLoop />
      <CTA />
      <Footer />
    </div>
  );
}

function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-cream/10 bg-deep-900/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6 lg:px-8">
        <div className="flex items-center gap-8">
          <Link to="/"><Wordmark /></Link>
          <nav className="hidden items-center gap-6 text-[13.5px] text-cream/70 md:flex">
            <a href="#how" className="hover:text-cream">How it works</a>
            <a href="#trust" className="hover:text-cream">Human-in-the-loop</a>
            <Link {...STORE} className="hover:text-cream">Demo storefront</Link>
            <Link to="/onboard" className="hover:text-cream">Import rate card</Link>
          </nav>
        </div>
        <Link to="/app" className="btn-mint btn-sm">Open seller console <ArrowRight className="size-4" /></Link>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="grain pointer-events-none absolute inset-0" />
      <div className="relative mx-auto grid max-w-7xl gap-12 px-6 pb-16 pt-16 lg:grid-cols-[1.04fr_1fr] lg:px-8 lg:pb-24 lg:pt-24">
        <div className="flex flex-col justify-center">
          <span className="inline-flex w-fit items-center gap-2 rounded-full bg-cream/[0.04] py-1 pl-1 pr-3 text-[13px] text-cream/80 ringline">
            <span className="rounded-full bg-mint px-2 py-0.5 text-[11px] font-bold text-deep-950">NEW</span>
            Your services, readable by Claude & ChatGPT
          </span>
          <h1 className="display mt-6 text-[clamp(42px,6vw,62px)]">
            Get booked by AI agents. Get <span className="text-mint">paid</span> before you start.
          </h1>
          <p className="mt-6 max-w-md text-base leading-relaxed text-cream/70">
            Paste your rate card. ServiceReady turns it into packages AI assistants can quote and book, takes a PayPal deposit up front, and chases the balance — only with your approval.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/app" className="btn-mint">Open seller console <ArrowRight className="size-4" /></Link>
            <Link {...STORE} className="btn-glass"><PlayCircle className="size-4 text-mint" /> See Maya's agent-ready storefront</Link>
          </div>
          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-cream/70">
            <span className="flex items-center gap-1.5"><Check className="size-4 text-mint" /> Deposit before work starts</span>
            <span className="flex items-center gap-1.5"><Check className="size-4 text-mint" /> AI never sets your prices</span>
            <span className="hidden items-center gap-1.5 sm:flex"><Check className="size-4 text-mint" /> You approve every send</span>
          </div>
        </div>
        <div className="relative lg:pl-6">
          <div className="absolute -inset-6 rounded-[32px] bg-mint/10 blur-3xl" />
          <DashboardMock />
          <div className="absolute -bottom-24 -left-7 z-10 hidden w-[214px] -rotate-6 rounded-2xl bg-gradient-to-br from-deep-700 to-deep-800 p-4 softcard sm:block lg:-left-12">
            <div className="flex items-center justify-between text-[12px] font-semibold text-cream/80">PayPal deposit <span className="grid size-6 place-items-center rounded-full bg-mint text-deep-950"><Check className="size-3.5" strokeWidth={3} /></span></div>
            <div className="mt-4 text-2xl font-bold tabular-nums">$300.00</div>
            <div className="mt-3 flex items-center justify-between text-[11px] tracking-wider text-cream/60"><span>ORDER 5O1…K4P</span><span className="font-bold text-mint">CAPTURED</span></div>
          </div>
        </div>
      </div>
    </section>
  );
}

function DashboardMock() {
  return (
    <div className="relative rounded-2xl bg-deep-950/80 dash-shadow">
      <div className="flex items-center justify-between border-b border-cream/10 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="icon-tile"><Wallet className="size-4" /></span>
          <div><div className="text-sm font-semibold">Bookings · Maya Rao Studio</div><div className="text-[12px] text-cream/55">Brand identity kit · Hannah B.</div></div>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-mint/15 px-2.5 py-1 text-[11px] font-semibold text-mint"><span className="size-1.5 animate-pulse rounded-full bg-mint" />Live</span>
      </div>
      <div className="grid grid-cols-2 gap-px bg-cream/10">
        <div className="bg-deep-950 p-5"><div className="text-[11px] uppercase tracking-wider text-cream/60">Deposit received</div><div className="mt-1 text-[28px] font-bold tabular-nums text-mint">$300<span className="text-cream/40">.00</span></div></div>
        <div className="bg-deep-950 p-5"><div className="text-[11px] uppercase tracking-wider text-cream/60">Balance invoiced</div><div className="mt-1 text-[28px] font-bold tabular-nums">$300<span className="text-cream/40">.00</span></div></div>
      </div>
      <div className="space-y-1 p-3">
        {[
          { icon: <ArrowDownLeft className="size-4" />, mint: true, t: "PayPal deposit captured", s: "Orders v2 · 50% upfront", a: "+$300.00" },
          { icon: <FileText className="size-4" />, t: "Balance invoice sent", s: "PayPal Invoicing · INV2-8K2D", a: "$300.00" },
          { icon: <Bot className="size-4" />, t: "Client: \"I already paid\"", s: "Collections agent checking PayPal…", a: "" },
        ].map((r) => (
          <div key={r.t} className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-cream/[0.04]">
            <span className={r.mint ? "icon-tile" : "grid size-9 place-items-center rounded-lg bg-cream/[0.06] text-cream/70"}>{r.icon}</span>
            <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{r.t}</div><div className="truncate text-[12px] text-cream/55">{r.s}</div></div>
            <span className={`text-sm font-semibold tabular-nums ${r.mint ? "text-mint" : ""}`}>{r.a}</span>
          </div>
        ))}
        <div className="mt-1 rounded-xl bg-warn/10 p-3 text-[13px] text-cream/85 ringline">
          <span className="font-semibold text-warn">Agent checked PayPal: UNPAID</span> → friendly reminder awaiting your approval
        </div>
      </div>
    </div>
  );
}

function TrustStrip() {
  const items = ["PayPal Orders v2", "PayPal Invoicing", "PayPal Agent Toolkit", "MCP", "WebMCP", "Cloudflare Workers AI"];
  return (
    <section className="border-y border-cream/10 bg-deep-950/40 py-10">
      <div className="mx-auto max-w-7xl px-6 text-center lg:px-8">
        <div className="mx-auto mb-5 h-px w-24 bg-gradient-to-r from-transparent via-cream/30 to-transparent" />
        <p className="text-[12px] uppercase tracking-[0.18em] text-cream/65">Built on</p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-10 gap-y-4 text-[16px] font-semibold text-cream/70">
          {items.map((i) => <span key={i}>{i}</span>)}
        </div>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section id="how" className="mx-auto max-w-7xl px-6 py-20 lg:px-8 lg:py-28">
      <div className="max-w-2xl">
        <p className="eyebrow">From rate card to paid invoice</p>
        <h2 className="display mt-3 text-4xl sm:text-5xl">One desk for every job you take.</h2>
        <p className="mt-4 text-cream/65">Agents find you, quote you, and book you. PayPal holds the money. You keep the final say.</p>
      </div>
      <div className="mt-12 grid items-stretch gap-5 md:grid-cols-2 lg:grid-cols-3">
        <div className="glass-card p-6 md:col-span-2">
          <span className="icon-tile"><ClipboardList className="size-4" /></span>
          <h3 className="mt-4 text-lg font-semibold">Paste a messy rate card, get clean packages</h3>
          <p className="mt-1 text-sm text-cream/65">AI structures prices, deposits and turnaround — and flags anything that looks off.</p>
          <div className="mt-5 space-y-2">
            <div className="glass-row flex items-center justify-between p-3 text-sm"><span>Brand identity kit</span><span className="tabular-nums">$1,200 · 50% · 14d</span></div>
            <div className="glass-row flex items-center justify-between gap-3 p-3 text-sm"><span>Social templates ×10</span><span className="flex items-center gap-2 tabular-nums"><span className="rounded-md bg-danger/15 px-2 py-0.5 text-[11px] font-semibold text-danger"><AlertTriangle className="mr-1 inline size-3" />30× below median</span>$15</span></div>
          </div>
        </div>
        <div className="glass-card p-6">
          <span className="icon-tile"><Bot className="size-4" /></span>
          <h3 className="mt-4 text-lg font-semibold">Discoverable by AI agents</h3>
          <p className="mt-1 text-sm text-cream/65">Claude and ChatGPT via MCP, browsers via WebMCP.</p>
          <div className="mt-5 space-y-1.5 font-mono text-[12px]">
            {["list_services", "get_service", "request_quote"].map((t) => <div key={t} className="glass-row flex items-center gap-2 px-3 py-2"><Zap className="size-3 text-mint" />{t}</div>)}
          </div>
        </div>
        <div className="glass-card p-6">
          <span className="icon-tile"><Wallet className="size-4" /></span>
          <h3 className="mt-4 text-lg font-semibold">Deposit before work starts</h3>
          <p className="mt-1 text-sm text-cream/65">Clients pay through PayPal on the quote page. No deposit, no kickoff.</p>
          <div className="mt-5 flex items-center gap-3 glass-row p-3"><span className="icon-tile"><CircleCheck className="size-4" /></span><div><div className="text-xl font-bold tabular-nums">$450</div><div className="text-[12px] text-cream/60">deposits captured this week</div></div></div>
        </div>
        <div className="glass-card p-6 md:col-span-2">
          <span className="icon-tile"><ListChecks className="size-4" /></span>
          <h3 className="mt-4 text-lg font-semibold">Collections that check PayPal before replying</h3>
          <p className="mt-1 text-sm text-cream/65">"I already paid" gets verified against the real invoice status — then a draft lands in your approvals queue.</p>
          <div className="mt-5 flex flex-wrap gap-2">
            {["Client reply", "paypal.get_invoice → UNPAID", "Draft friendly reminder", "Your approval"].map((c, i) => (
              <span key={c} className="flex items-center gap-2 rounded-full bg-cream/[0.04] px-3 py-1.5 text-[13px] ringline"><span className="font-mono text-[11px] text-mint">{i + 1}</span>{c}</span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Stats() {
  const s = [
    { v: "15", u: "days/yr", c: "spent chasing late payments", src: "Sage, survey of 3,000+ SMBs", mint: true },
    { v: "45", u: "%", c: "of US consumers used AI to find a local business", src: "BrightLocal 2026" },
    { v: "30", u: "%+", c: "avoid chasing to protect the relationship", src: "Sage", mint: true },
  ];
  return (
    <section className="relative overflow-hidden border-y border-cream/10 bg-deep-950/55">
      <div className="grain pointer-events-none absolute inset-0 opacity-70" />
      <div className="relative mx-auto grid max-w-7xl gap-12 px-6 py-20 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
        <div>
          <p className="eyebrow">Why it matters</p>
          <h2 className="display mt-3 text-4xl">Freelancers do the work. Then they chase the money.</h2>
          <p className="mt-4 text-cream/65">ServiceReady flips the order: deposit first, polite verified follow-ups after.</p>
          <Link {...STORE} className="btn-glass mt-6">Try the demo storefront <ArrowRight className="size-4" /></Link>
        </div>
        <div className="grid gap-px overflow-hidden rounded-2xl bg-cream/10 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
          {s.map((x) => (
            <div key={x.c} className="bg-deep-900 p-6">
              <div className={`text-5xl font-extrabold tabular-nums tracking-tight ${x.mint ? "text-mint" : ""}`}>{x.v}<span className="ml-1 text-lg font-semibold text-cream/60">{x.u}</span></div>
              <p className="mt-2 text-sm text-cream/70">{x.c}</p>
              <p className="mt-3 text-[11px] uppercase tracking-wider text-cream/45">Source: {x.src}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HumanLoop() {
  const tiles = [
    { i: <Hand className="size-4" />, t: "AI never sets prices", s: "It structures what you wrote and flags oddities." },
    { i: <Wallet className="size-4" />, t: "Agents never pay for clients", s: "Clients approve their own PayPal payment." },
    { i: <ShieldCheck className="size-4" />, t: "Every PayPal write needs you", s: "Invoices and reminders wait for approval." },
    { i: <ScrollText className="size-4" />, t: "Full audit log", s: "Every tool call, input and output, timestamped." },
  ];
  return (
    <section id="trust" className="mx-auto grid max-w-7xl gap-12 px-6 py-20 lg:grid-cols-[1fr_1.05fr] lg:px-8 lg:py-28">
      <div>
        <p className="eyebrow">Human-in-the-loop by design</p>
        <h2 className="display mt-3 text-4xl sm:text-5xl">Agents do the legwork. You make the calls.</h2>
        <p className="mt-4 max-w-md text-cream/65">Nothing reaches a client or touches PayPal without your say-so. If an agent isn't sure, it waits.</p>
      </div>
      <div className="glass-card p-6">
        <div className="flex items-center justify-between"><h3 className="font-semibold">Guardrails</h3><span className="flex items-center gap-1.5 rounded-full bg-mint/15 px-2.5 py-1 text-[11px] font-semibold text-mint"><Check className="size-3" />Always on</span></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {tiles.map((x) => (
            <div key={x.t} className="glass-row flex gap-3 p-4"><span className="icon-tile">{x.i}</span><div><div className="text-sm font-semibold">{x.t}</div><div className="mt-0.5 text-[12.5px] text-cream/60">{x.s}</div></div></div>
          ))}
        </div>
        <Link to="/app/log" className="glass-row mt-3 flex items-center justify-between p-4 text-sm hover:bg-cream/[0.04]"><span className="flex items-center gap-3"><ScrollText className="size-4 text-mint" />Open the agent audit log</span><ArrowRight className="size-4" /></Link>
      </div>
    </section>
  );
}

function CTA() {
  return (
    <section className="relative overflow-hidden bg-deep-950">
      <div className="grain pointer-events-none absolute inset-0" />
      <div className="pointer-events-none absolute -bottom-32 left-1/2 h-72 w-[680px] -translate-x-1/2 rounded-full bg-mint/12 blur-[120px]" />
      <div className="relative mx-auto max-w-2xl px-6 py-24 text-center">
        <span className="inline-flex items-center gap-2 rounded-full bg-cream/[0.04] px-3 py-1 text-[13px] ringline"><Clock className="size-3.5 text-mint" />Agent-ready in minutes</span>
        <h2 className="display mt-6 text-4xl sm:text-5xl">Stop chasing.<br />Start with the deposit.</h2>
        <p className="mt-5 text-cream/70">Import your rate card and see your services the way an AI assistant does.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link to="/onboard" className="btn-mint">Import your rate card <ArrowRight className="size-4" /></Link>
          <Link to="/app" className="btn-glass">Open seller console</Link>
        </div>
        <p className="mt-6 text-[12px] text-cream/55">Demo runs on PayPal sandbox. No real money moves.</p>
      </div>
    </section>
  );
}

function Footer() {
  const cols = [
    { h: "Product", l: [["Seller console", "/app"], ["Import rate card", "/onboard"], ["Connect agents", "/app/connect"]] },
    { h: "Demo", l: [["Maya's storefront", "/s/maya-rao-studio"], ["Approvals", "/app/approvals"], ["Collections", "/app/collections"]] },
    { h: "Trust", l: [["Agent log", "/app/log"], ["Settings & rules", "/app/settings"]] },
  ];
  return (
    <footer className="border-t border-cream/10 bg-deep-950">
      <div className="mx-auto grid max-w-7xl gap-10 px-6 py-14 md:grid-cols-[1.4fr_1fr_1fr_1fr] lg:px-8">
        <div>
          <div className="flex items-center gap-2.5"><LogoMark /><span className="font-bold">ServiceReady</span></div>
          <p className="mt-4 max-w-xs text-sm text-cream/70">The agent-ready service desk that gets freelancers paid first.</p>
          <div className="mt-5 flex gap-2">
            {[Twitter, Linkedin, Github].map((I, i) => <span key={i} className="grid size-9 place-items-center rounded-lg bg-cream/[0.04] text-cream/70 ringline transition hover:text-mint"><I className="size-4" /></span>)}
          </div>
        </div>
        {cols.map((c) => (
          <div key={c.h}>
            <h4 className="text-[12px] uppercase tracking-wider text-cream/65">{c.h}</h4>
            <ul className="mt-4 space-y-2.5 text-sm text-cream/65">{c.l.map(([t, h]) => <li key={t}><a href={h} className="hover:text-cream">{t}</a></li>)}</ul>
          </div>
        ))}
      </div>
      <div className="border-t border-cream/10">
        <div className="mx-auto flex max-w-7xl flex-wrap justify-between gap-3 px-6 py-5 text-[12px] text-cream/55 lg:px-8">
          <span>© 2026 ServiceReady · <Sparkle className="inline size-3" /> PayPal sandbox demo</span>
          <span className="flex gap-4"><span>Privacy</span><span>Terms</span></span>
        </div>
      </div>
    </footer>
  );
}
