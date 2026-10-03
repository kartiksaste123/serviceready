import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { ArrowRight, Bot, Clock, Loader2, Send, Wrench, Zap } from "lucide-react";
import { api } from "@/lib/api";
import type { ChatMsg, Quote, Service, ToolTrace } from "@/lib/types";
import { money0 } from "@/lib/format";
import { Empty, JsonBlock, Wordmark } from "@/components/kit";
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
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Storefront,
});

function Storefront() {
  const { slug } = Route.useParams();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["public", slug],
    queryFn: () => api.getPublicStore(slug),
  });
  const [picked, setPicked] = useState<Service | null>(null);

  return (
    <div className="relative min-h-screen">
      <div className="grain pointer-events-none absolute inset-x-0 top-0 h-[420px]" />
      <header className="relative mx-auto flex h-16 max-w-7xl items-center justify-between px-6 lg:px-8">
        <Link to="/">
          <Wordmark />
        </Link>
        <span className="text-[12px] text-muted-foreground">Powered by ServiceReady</span>
      </header>
      <main className="relative mx-auto max-w-7xl px-6 pb-20 lg:px-8">
        {isLoading ? (
          <div className="space-y-4 py-10">
            <Skeleton className="h-10 w-72" />
            <Skeleton className="h-5 w-96" />
          </div>
        ) : isError || !data ? (
          <div className="py-16">
            <Empty title="Storefront not found">Check the link and try again.</Empty>
          </div>
        ) : (
          <>
            <section className="flex flex-wrap items-end justify-between gap-6 py-10">
              <div className="flex items-center gap-4">
                <span className="grid size-16 place-items-center rounded-2xl bg-muted text-xl font-bold text-foreground softcard">
                  MR
                </span>
                <div>
                  <h1 className="display text-4xl">{data.seller.name}</h1>
                  <p className="mt-2 max-w-lg text-muted-foreground">{data.seller.tagline}</p>
                </div>
              </div>
              <AgentBadge mcp={data.agent.mcp_url} />
            </section>
            <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
              <div className="grid content-start gap-4 sm:grid-cols-2">
                {data.services.map((s) => (
                  <article key={s.id} className="glass-card flex flex-col p-5">
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="font-semibold">{s.title}</h2>
                      <span className="text-xl font-bold tabular-nums">
                        {money0(s.price_cents)}
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm text-muted-foreground">{s.description}</p>
                    <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
                      <span className="rounded-md bg-muted px-2 py-0.5 font-semibold text-foreground tabular-nums">
                        {s.deposit_pct}% deposit ·{" "}
                        {money0(Math.round((s.price_cents * s.deposit_pct) / 100))}
                      </span>
                      <span className="flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-muted-foreground">
                        <Clock className="size-3" />
                        {s.lead_time_days} days
                      </span>
                    </div>
                    <ul className="mt-3 flex-1 space-y-1 text-[13px] text-muted-foreground">
                      {s.deliverables.map((d) => (
                        <li key={d}>· {d}</li>
                      ))}
                    </ul>
                    <div className="mt-auto pt-4">
                      <button
                        className="btn-primary btn-sm self-start"
                        onClick={() => setPicked(s)}
                      >
                        Request quote <ArrowRight className="size-3.5" />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              <AgentChat slug={slug} />
            </div>
          </>
        )}
      </main>
      <QuoteDialog slug={slug} service={picked} onClose={() => setPicked(null)} />
    </div>
  );
}

function AgentBadge({ mcp }: { mcp: string }) {
  return (
    <Popover>
      <PopoverTrigger className="flex items-center gap-2 rounded-full bg-muted px-3.5 py-1.5 text-sm font-semibold text-foreground ringline hover:bg-muted">
        <span className="size-1.5 rounded-full bg-success" />
        Agent-ready
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 border-border bg-background text-foreground">
        <p className="text-[11px] text-muted-foreground">MCP endpoint</p>
        <p className="mt-1 break-all font-mono text-[12px] text-link">{mcp}</p>
        <p className="mt-4 text-sm text-muted-foreground">
          Connect through MCP. WebMCP tool registration is not implemented yet.
        </p>
      </PopoverContent>
    </Popover>
  );
}

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
  const [f, setF] = useState({ name: "", email: "", brief: "" });
  const m = useMutation({
    mutationFn: () =>
      api.requestQuote(slug, {
        service_id: service!.id,
        client_name: f.name,
        client_email: f.email,
        brief: f.brief,
        source: "web",
      }),
    onSuccess: (q) => nav({ to: "/q/$id", params: { id: q.id } }),
  });
  const ok = f.name.trim() && /\S+@\S+\.\S+/.test(f.email) && f.brief.trim();
  return (
    <Dialog open={!!service} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="border-border bg-background text-foreground">
        <DialogHeader>
          <DialogTitle>Request a quote · {service?.title}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            You'll get a quote with a PayPal deposit link. Nothing is charged yet.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (ok) m.mutate();
          }}
        >
          <input
            className="field"
            placeholder="Your name"
            maxLength={100}
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
          />
          <input
            className="field"
            type="email"
            placeholder="Email"
            maxLength={255}
            value={f.email}
            onChange={(e) => setF({ ...f, email: e.target.value })}
          />
          <textarea
            className="field"
            rows={4}
            placeholder="Tell Maya about the project"
            maxLength={2000}
            value={f.brief}
            onChange={(e) => setF({ ...f, brief: e.target.value })}
          />
          <button className="btn-primary w-full" disabled={!ok || m.isPending}>
            {m.isPending && <Loader2 className="size-4 animate-spin" />}Get my quote
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type Item =
  | { kind: "msg"; msg: ChatMsg }
  | { kind: "tool"; trace: ToolTrace }
  | { kind: "quote"; quote: Quote };

function AgentChat({ slug }: { slug: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const msgs = items
    .filter((i): i is Extract<Item, { kind: "msg" }> => i.kind === "msg")
    .map((i) => i.msg);
  const m = useMutation({
    mutationFn: (all: ChatMsg[]) => api.agentChat(slug, all),
    onSuccess: (r, sent) => {
      const fresh = r.messages.slice(sent.length).map((msg): Item => ({ kind: "msg", msg }));
      setItems((it) => [
        ...it,
        ...r.tool_calls.map((trace): Item => ({ kind: "tool", trace })),
        ...fresh,
        ...(r.quote ? [{ kind: "quote", quote: r.quote } as Item] : []),
      ]);
    },
  });
  useEffect(
    () => end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
    [items, m.isPending],
  );
  const send = (t: string) => {
    if (!t.trim() || m.isPending) return;
    const all = [...msgs, { role: "user" as const, content: t.trim() }];
    const last = all[all.length - 1]!;
    setItems((it) => [...it, { kind: "msg", msg: last }]);
    setText("");
    m.mutate(all);
  };
  return (
    <aside className="glass-card flex h-[360px] min-h-0 flex-col overflow-hidden sm:h-[400px] lg:sticky lg:top-6 lg:h-full">
      <div className="flex items-center gap-3 border-b border-border px-5 py-4">
        <span className="icon-tile">
          <Bot className="size-4" />
        </span>
        <div>
          <h2 className="text-sm font-semibold">Try booking with an AI assistant</h2>
          <p className="text-[12px] text-muted-foreground">See which storefront tools it uses</p>
        </div>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {!items.length && (
          <div className="space-y-2 pt-2 lg:pt-4">
            <p className="text-center text-sm text-muted-foreground">Ask like a client would:</p>
            {[
              "What services do you offer?",
              "I want a logo for my bakery, email me at sam@bakery.com",
              "How much is the deposit for a brand kit?",
              "How long does a landing page take?",
            ].map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="glass-row block w-full p-2.5 text-left text-[12px] hover:bg-muted sm:p-3 sm:text-[13px]"
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
                className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm text-primary-foreground"
              >
                {it.msg.content}
              </div>
            ) : (
              <div key={i} className="max-w-[95%] text-sm leading-relaxed text-foreground">
                <ReactMarkdown
                  components={{
                    p: ({ children }) => <p className="my-1.5">{children}</p>,
                    ul: ({ children }) => (
                      <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>
                    ),
                    ol: ({ children }) => (
                      <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>
                    ),
                    li: ({ children }) => <li>{children}</li>,
                  }}
                >
                  {it.msg.content}
                </ReactMarkdown>
              </div>
            )
          ) : it.kind === "tool" ? (
            <div key={i} className="glass-row space-y-1.5 p-2.5">
              <div className="flex items-center gap-2 text-[12px]">
                <Wrench className="size-3 text-link" />
                <span className="font-mono font-semibold text-link">{it.trace.tool}</span>
                <span className="text-muted-foreground">tool call</span>
              </div>
              <JsonBlock label="input" value={it.trace.input} />
              <JsonBlock label="output" value={it.trace.output} />
            </div>
          ) : (
            <a key={i} href={it.quote.approval_url} className="btn-primary w-full">
              <Zap className="size-4" />
              Review & pay deposit · {money0(it.quote.deposit_cents)}
            </a>
          ),
        )}
        {m.isPending && (
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Agent is calling tools…
          </div>
        )}
        <div ref={end} />
      </div>
      <form
        className="flex gap-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <input
          className="field"
          placeholder="Message the agent…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          aria-label="Send"
          className="btn-primary size-10 shrink-0 p-0"
          disabled={!text.trim() || m.isPending}
        >
          <Send className="size-4" />
        </button>
      </form>
    </aside>
  );
}
