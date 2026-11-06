import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Bot,
  Check,
  Clock,
  Loader2,
  LockKeyhole,
  Send,
  ShieldCheck,
  Wrench,
  Zap,
} from "lucide-react";
import { api, USE_MOCKS } from "@/lib/api";
import type { ChatMsg, Quote, Service, ToolTrace } from "@/lib/types";
import { money0 } from "@/lib/format";
import { depositOf, LIMITS, quoteRequestErrors } from "@/lib/validation";
import { Empty, ErrorState, Field, JsonBlock, Wordmark } from "@/components/kit";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/s/$slug")({
  head: () => ({
    meta: [
      { title: "Maya Rao Studio — Agent-ready storefront | ServiceReady" },
      {
        name: "description",
        content:
          "Brand design services you or your AI assistant can quote and book, with a PayPal deposit up front.",
      },
      { property: "og:title", content: "Maya Rao Studio — Agent-ready storefront" },
      {
        property: "og:description",
        content: "Quote and book brand design services directly or through an AI agent.",
      },
      { property: "og:type", content: "website" },
      {
        property: "og:image",
        content: "https://serviceready.onrender.com/images/maya-portrait.webp",
      },
      { name: "twitter:card", content: "summary_large_image" },
      {
        name: "twitter:image",
        content: "https://serviceready.onrender.com/images/maya-portrait.webp",
      },
    ],
  }),
  component: Storefront,
});

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

function serviceCover(title: string, imageUrl?: string | null): string | null {
  if (imageUrl) return imageUrl;
  const t = title.toLowerCase();
  if (t.includes("brand")) return "/images/service-brand.webp";
  if (t.includes("landing")) return "/images/service-landing.webp";
  if (t.includes("pitch")) return "/images/service-pitch.webp";
  // Soft gradient fallback so new services never show a blank hole
  return null;
}

function SellerAvatar({ name, slug }: { name: string; slug: string }) {
  const [broken, setBroken] = useState(false);
  const usePortrait = slug === "maya-rao-studio" && !broken;
  if (usePortrait) {
    return (
      <img
        src="/images/maya-portrait.webp"
        alt=""
        aria-hidden="true"
        className="size-16 shrink-0 rounded-2xl object-cover"
        width={64}
        height={64}
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="grid size-16 shrink-0 place-items-center rounded-2xl bg-primary text-xl font-bold text-primary-foreground"
    >
      {initials(name)}
    </span>
  );
}

function Storefront() {
  const { slug } = Route.useParams();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["public", slug],
    queryFn: () => api.getPublicStore(slug),
    retry: false,
    meta: { silent: true },
  });
  const [picked, setPicked] = useState<Service | null>(null);
  useEffect(() => setPicked(null), [slug]);
  const notFound = isError && error instanceof Error && /not found/i.test(error.message);

  return (
    <div className="min-h-screen">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:h-16 sm:px-5 lg:px-8">
          <Link to="/" aria-label="ServiceReady home">
            <Wordmark />
          </Link>
          <span className="text-xs text-muted-foreground">Powered by ServiceReady</span>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 pb-14 sm:px-5 lg:px-8">
        {isLoading ? (
          <div className="space-y-4 py-10">
            <Skeleton className="h-10 w-72" />
            <Skeleton className="h-5 w-96 max-w-full" />
            <div className="grid gap-4 pt-6 sm:grid-cols-2 lg:w-2/3">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-56" />
              ))}
            </div>
          </div>
        ) : notFound ? (
          <div className="py-16">
            <Empty title="Storefront not found">
              Check the link and try again, or{" "}
              <Link to="/" className="text-link">
                visit ServiceReady
              </Link>
              .
            </Empty>
          </div>
        ) : isError || !data ? (
          <div className="py-16">
            <ErrorState title="Couldn't load this storefront" onRetry={() => refetch()} />
          </div>
        ) : (
          <>
            <section className="flex flex-wrap items-end justify-between gap-6 py-8">
              <div className="flex items-center gap-4">
                <SellerAvatar name={data.seller.name} slug={slug} />
                <div>
                  <h1 className="display text-2xl sm:text-4xl">{data.seller.name}</h1>
                  <p className="mt-2 max-w-lg text-muted-foreground">{data.seller.tagline}</p>
                </div>
              </div>
              <AgentBadge mcp={data.agent.mcp_url} tools={data.agent.webmcp_tools} />
            </section>
            <ul className="mb-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
              <li className="flex items-center gap-1.5">
                <ShieldCheck className="size-4" aria-hidden="true" />
                Fixed prices, no surprises
              </li>
              <li className="flex items-center gap-1.5">
                <LockKeyhole className="size-4" aria-hidden="true" />
                Deposit paid securely via PayPal
              </li>
              <li className="flex items-center gap-1.5">
                <Check className="size-4" aria-hidden="true" />
                Balance only due on delivery
              </li>
            </ul>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_420px]">
              {data.services.length === 0 ? (
                <Empty title="No services published yet">Check back soon.</Empty>
              ) : (
                <div
                  className={`grid content-start gap-4 ${
                    data.services.length === 3
                      ? "md:grid-cols-2 xl:grid-cols-3"
                      : data.services.length === 1
                        ? "grid-cols-1"
                        : "md:grid-cols-2"
                  }`}
                >
                  {data.services.map((s) => {
                    const cover = serviceCover(s.title, s.image_url);
                    return (
                      <article key={s.id} className="glass-card flex flex-col overflow-hidden p-0">
                        {cover ? (
                          <img
                            src={cover}
                            alt=""
                            aria-hidden="true"
                            className="aspect-[16/9] w-full object-cover"
                            width={640}
                            height={360}
                            loading="lazy"
                          />
                        ) : (
                          <div
                            aria-hidden="true"
                            className="flex aspect-[16/9] w-full items-end bg-gradient-to-br from-emerald-100 via-sky-100 to-violet-100 p-4"
                          >
                            <span className="rounded-full bg-background/80 px-3 py-1 text-xs font-semibold text-foreground">
                              {s.title}
                            </span>
                          </div>
                        )}
                        <div className="flex flex-1 flex-col p-5">
                          <div className="flex items-start justify-between gap-3">
                            <h2 className="font-semibold">{s.title}</h2>
                            <span className="text-xl font-bold tabular-nums">
                              {money0(s.price_cents)}
                            </span>
                          </div>
                          <p className="mt-1.5 text-sm text-muted-foreground">{s.description}</p>
                          <div className="mt-3 flex flex-wrap gap-2 text-xs">
                            <span className="rounded-md bg-success-bg px-2 py-0.5 font-semibold text-success tabular-nums">
                              {s.deposit_pct}% deposit ·{" "}
                              {money0(depositOf(s.price_cents, s.deposit_pct))}
                            </span>
                            <span className="flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-muted-foreground">
                              <Clock className="size-3" aria-hidden="true" />~{s.lead_time_days}{" "}
                              days
                            </span>
                          </div>
                          {s.deliverables.length > 0 && (
                            <ul className="mt-3 flex-1 space-y-1 text-[13px] text-muted-foreground">
                              {s.deliverables.map((d) => (
                                <li key={d} className="flex items-start gap-1.5">
                                  <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                                  {d}
                                </li>
                              ))}
                            </ul>
                          )}
                          <button
                            type="button"
                            className="btn-mint btn-sm mt-4 self-start"
                            onClick={() => setPicked(s)}
                            aria-label={`Request a quote for ${s.title}`}
                          >
                            Request quote <ArrowRight className="size-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
              <AgentChat key={slug} slug={slug} />
            </div>
          </>
        )}
      </main>
      <QuoteDialog slug={slug} service={picked} onClose={() => setPicked(null)} />
    </div>
  );
}

/** Register storefront tools with WebMCP browsers; each tool proxies to our MCP server. */
function useWebMcp(mcpUrl: string, tools: string[]) {
  useEffect(() => {
    const mc = (
      navigator as unknown as { modelContext?: { provideContext?: (c: unknown) => void } }
    ).modelContext;
    if (!mc?.provideContext || !mcpUrl) return;
    const call = async (name: string, args: unknown) => {
      const res = await fetch(new URL(mcpUrl).pathname, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args ?? {} },
        }),
      });
      const j = (await res.json()) as { result?: unknown };
      return j.result;
    };
    try {
      mc.provideContext({
        tools: [...tools, "create_deposit_link"].map((name) => ({
          name,
          description: `ServiceReady storefront tool: ${name.replace(/_/g, " ")}`,
          inputSchema: { type: "object", additionalProperties: true },
          execute: (args: unknown) => call(name, args),
        })),
      });
    } catch {
      /* experimental API — ignore */
    }
  }, [mcpUrl, tools]);
}

function AgentBadge({ mcp, tools }: { mcp: string; tools: string[] }) {
  const [webmcp, setWebmcp] = useState<boolean | null>(null);
  useEffect(() => setWebmcp("modelContext" in navigator), []);
  useWebMcp(mcp, tools);
  return (
    <Popover>
      <PopoverTrigger className="flex items-center gap-2 rounded-full bg-success-bg px-3.5 py-1.5 text-sm font-semibold text-success ringline hover:bg-muted">
        <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
        Agent-ready
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 border-border bg-background text-foreground">
        <p className="text-xs font-medium text-muted-foreground">MCP endpoint</p>
        <p className="mt-1 break-all font-mono text-xs text-link">{mcp}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Live MCP server (Streamable HTTP). Tools: list_services, get_service, request_quote,
          get_quote_status, create_deposit_link (real PayPal sandbox order).
        </p>
        {USE_MOCKS && (
          <p className="mt-2 text-xs text-muted-foreground">
            Mock mode: the MCP endpoint is served by the live deploy.
          </p>
        )}
        <p className="mt-4 text-xs font-medium text-muted-foreground">WebMCP tools</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {tools.map((t) => (
            <code key={t} className="rounded-md bg-muted px-2 py-0.5 font-mono text-[11px]">
              {t}
            </code>
          ))}
        </div>
        <p className="mt-4 flex items-center gap-2 text-[13px] text-muted-foreground">
          <span
            className={`size-2 rounded-full ${webmcp ? "bg-success" : "bg-input"}`}
            aria-hidden="true"
          />
          {webmcp === null
            ? "Checking…"
            : webmcp
              ? "Browser supports WebMCP"
              : "WebMCP: not supported in this browser"}
        </p>
      </PopoverContent>
    </Popover>
  );
}

const EMPTY_FORM = { name: "", email: "", brief: "" };
function QuoteDialog({
  slug,
  service,
  onClose,
}: {
  slug: string;
  service: Service | null;
  onClose: () => void;
}) {
  const nav = useNavigate();
  const [f, setF] = useState(EMPTY_FORM);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (service) setTouched(false);
  }, [service]);
  const m = useMutation({
    mutationFn: () => {
      if (!service) throw new Error("Choose a service first");
      return api.requestQuote(slug, {
        service_id: service.id,
        client_name: f.name.trim(),
        client_email: f.email.trim(),
        brief: f.brief.trim(),
        source: "web",
      });
    },
    onSuccess: (q) => {
      setF(EMPTY_FORM);
      onClose();
      nav({ to: "/q/$id", params: { id: q.id } });
    },
  });
  const errs = quoteRequestErrors({ client_name: f.name, client_email: f.email, brief: f.brief });
  const ok = Object.keys(errs).length === 0;
  const show = (k: keyof typeof errs) => (touched ? errs[k] : undefined);
  return (
    <Dialog open={!!service} onOpenChange={(o) => !o && !m.isPending && onClose()}>
      <DialogContent className="border-border bg-background text-foreground">
        <DialogHeader>
          <DialogTitle>Request a quote · {service?.title}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {service
              ? `${money0(service.price_cents)} total · ${money0(depositOf(service.price_cents, service.deposit_pct))} deposit to confirm. `
              : ""}
            Nothing is charged yet.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (ok) m.mutate();
          }}
        >
          <Field htmlFor="qd-name" label="Your name" error={show("client_name")}>
            <input
              id="qd-name"
              autoComplete="name"
              className="field"
              maxLength={LIMITS.name}
              aria-invalid={!!show("client_name")}
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
            />
          </Field>
          <Field
            htmlFor="qd-email"
            label="Email"
            hint="Your quote and invoices are sent here."
            error={show("client_email")}
          >
            <input
              id="qd-email"
              type="email"
              autoComplete="email"
              className="field"
              maxLength={LIMITS.email}
              aria-invalid={!!show("client_email")}
              value={f.email}
              onChange={(e) => setF({ ...f, email: e.target.value })}
            />
          </Field>
          <Field htmlFor="qd-brief" label="About the project" error={show("brief")}>
            <textarea
              id="qd-brief"
              className="field"
              rows={4}
              placeholder="What do you need, and by when?"
              maxLength={LIMITS.brief}
              aria-invalid={!!show("brief")}
              value={f.brief}
              onChange={(e) => setF({ ...f, brief: e.target.value })}
            />
          </Field>
          <button type="submit" className="btn-mint w-full" disabled={m.isPending}>
            {m.isPending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}Get my
            quote
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type Item =
  | { kind: "msg"; msg: ChatMsg }
  | { kind: "tool"; trace: ToolTrace }
  | { kind: "quote"; quote: Quote }
  | { kind: "error"; text: string };

function AgentChat({ slug }: { slug: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [text, setText] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<string | null>(null);
  const msgs = items
    .filter((i): i is Extract<Item, { kind: "msg" }> => i.kind === "msg")
    .map((i) => i.msg);
  const m = useMutation({
    mutationFn: (all: ChatMsg[]) => api.agentChat(slug, all),
    onSuccess: (r, sent) => {
      if (r.engine) {
        setEngine(
          r.engine.kind === "llm"
            ? `Live AI · ${r.engine.provider} ${r.engine.model}`.trim()
            : "Offline fallback (no model reachable)",
        );
      }
      const fresh = r.messages.slice(sent.length).map((msg): Item => ({ kind: "msg", msg }));
      setItems((it) => [
        ...it,
        ...r.tool_calls.map((trace): Item => ({ kind: "tool", trace })),
        ...fresh,
        ...(r.quote ? [{ kind: "quote", quote: r.quote } as Item] : []),
      ]);
    },
    onError: (e) =>
      setItems((it) => [
        ...it,
        { kind: "error", text: e instanceof Error ? e.message : "The assistant is unavailable" },
      ]),
  });
  // Scroll only the chat pane (scrollIntoView also scrolled the whole page on mobile).
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [items, m.isPending]);
  const send = (t: string) => {
    if (!t.trim() || m.isPending) return;
    const all = [...msgs, { role: "user" as const, content: t.trim() }];
    const last = all[all.length - 1]!;
    setItems((it) => [...it, { kind: "msg", msg: last }]);
    setText("");
    m.mutate(all);
  };
  return (
    <aside
      className="glass-card relative flex h-[min(70dvh,480px)] flex-col overflow-hidden lg:sticky lg:top-6 lg:h-[520px]"
      aria-label="AI assistant demo"
    >
      <img
        src="/images/agent-chat-bg.webp"
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-[0.14]"
      />
      <div className="flex items-center gap-3 border-b border-border px-5 py-4">
        <span className="icon-tile">
          <Bot className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Try booking with an AI assistant</h2>
          <p className="text-xs text-muted-foreground">
            {engine ?? "Real tool calls · PayPal sandbox deposit link at the end"}
          </p>
        </div>
        {items.length > 0 && (
          <button
            type="button"
            className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
            onClick={() => setItems([])}
            disabled={m.isPending}
          >
            Clear
          </button>
        )}
      </div>
      <div
        ref={scroller}
        className="flex flex-1 flex-col space-y-3 overflow-y-auto p-4"
        aria-live="polite"
      >
        {!items.length && (
          <div className="mt-auto space-y-2">
            <p className="text-center text-sm text-muted-foreground">Ask like a client would:</p>
            {[
              "What services do you offer?",
              "Tell me about the brand identity kit",
              "I want a logo for my bakery, my name is Sam Lee, email sam@bakery.com",
            ].map((s) => (
              <button
                type="button"
                key={s}
                onClick={() => send(s)}
                className="glass-row block min-h-11 w-full p-3 text-left text-[13px] hover:bg-background"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {items.map((it, i) =>
          it.kind === "msg" ? (
            it.msg.role === "user" ? (
              <div
                key={i}
                className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm text-primary-foreground"
              >
                {it.msg.content}
              </div>
            ) : (
              <div
                key={i}
                className="max-w-[95%] whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground"
                dangerouslySetInnerHTML={{ __html: md(it.msg.content) }}
              />
            )
          ) : it.kind === "tool" ? (
            <div key={i} className="glass-row space-y-1.5 p-2.5">
              <div className="flex items-center gap-2 text-[12px]">
                <Wrench className="size-3" aria-hidden="true" />
                <code className="font-mono font-semibold">{it.trace.tool}</code>
                <span className="text-muted-foreground">tool call</span>
              </div>
              <div className="flex flex-wrap gap-4">
                <JsonBlock label="input" value={it.trace.input} />
                <JsonBlock label="output" value={it.trace.output} />
              </div>
            </div>
          ) : it.kind === "quote" ? (
            <Link key={i} to="/q/$id" params={{ id: it.quote.id }} className="btn-mint w-full">
              <Zap className="size-4" aria-hidden="true" />
              Review & pay deposit · {money0(it.quote.deposit_cents)}
            </Link>
          ) : (
            <p
              key={i}
              role="alert"
              className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger"
            >
              {it.text}
            </p>
          ),
        )}
        {m.isPending && (
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            Assistant is calling tools…
          </div>
        )}
      </div>
      <form
        className="flex gap-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <label htmlFor="agent-input" className="sr-only">
          Message the assistant
        </label>
        <input
          id="agent-input"
          className="field"
          placeholder="Message the assistant…"
          maxLength={LIMITS.message}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          type="submit"
          aria-label="Send"
          className="btn-mint size-11 shrink-0 p-0 sm:size-10"
          disabled={!text.trim() || m.isPending}
        >
          <Send className="size-4" aria-hidden="true" />
        </button>
      </form>
    </aside>
  );
}

// Minimal, XSS-safe markdown: escape everything, then allow **bold** only.
function md(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}
