import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CircleCheck,
  Copy,
  Loader2,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Flag, Service, ServiceDraft } from "@/lib/types";
import { Wordmark } from "@/components/kit";
import { money } from "@/lib/format";

export const Route = createFileRoute("/onboard")({
  head: () => ({
    meta: [
      { title: "Import your rate card — ServiceReady" },
      {
        name: "description",
        content: "Paste a rate card and let AI structure it into agent-ready service packages.",
      },
      { property: "og:title", content: "Import your rate card — ServiceReady" },
      {
        property: "og:description",
        content: "From messy price list to agent-ready catalog in one step.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Onboard,
});

const EXAMPLE =
  "logo 450 (2 rounds) | brand kit w/ logo+colors+fonts 1200, half upfront | social templates x10 - 15 | rush +30% | website landing pg 900 2wks";

function Onboard() {
  const [raw, setRaw] = useState("");
  const [drafts, setDrafts] = useState<ServiceDraft[] | null>(null);
  const [flags, setFlags] = useState<Flag[]>([]);
  const [published, setPublished] = useState<Service[] | null>(null);
  const parse = useMutation({
    mutationFn: () => api.parseCatalog(raw),
    onSuccess: (r) => {
      setDrafts(r.services);
      setFlags(r.flags);
    },
  });
  const publish = useMutation({
    mutationFn: () => api.publishCatalog(drafts ?? []),
    onSuccess: (s) => {
      setPublished(s);
      toast.success("Services published");
    },
  });
  const step = published ? 3 : drafts ? 2 : 1;
  const upd = (id: string, patch: Partial<ServiceDraft>) =>
    setDrafts((d) => d?.map((x) => (x.tmp_id === id ? { ...x, ...patch } : x)) ?? null);

  return (
    <div className="relative min-h-screen">
      <header className="relative mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link to="/">
          <Wordmark />
        </Link>
        <Link to="/app/catalog" className="text-sm text-muted-foreground hover:text-foreground">
          Back to console
        </Link>
      </header>
      <main className="relative mx-auto max-w-6xl px-6 pb-24 pt-8">
        <ol className="mb-8 flex flex-wrap gap-2 text-[13px]">
          {["Paste what you charge", "Check services and prices", "Publish for assistants"].map(
            (l, i) => (
              <li
                key={l}
                className={`flex items-center gap-2 rounded-full px-3 py-1 ringline ${step === i + 1 ? "bg-success-bg text-link" : step > i + 1 ? "text-foreground" : "text-muted-foreground"}`}
              >
                <span className="font-mono text-[11px]">{step > i + 1 ? "✓" : i + 1}</span>
                {l}
              </li>
            ),
          )}
        </ol>

        {step === 1 && (
          <section className="glass-card max-w-3xl p-6 sm:p-8">
            <h1 className="display text-3xl sm:text-4xl">
              Paste your rate card, price list or WhatsApp message
            </h1>
            <p className="mt-3 text-muted-foreground">
              Any format. AI will structure it — it never changes your prices, only flags what looks
              off.
            </p>
            <textarea
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              rows={8}
              placeholder="e.g. logo 450, brand kit 1200 half upfront…"
              className="field mt-6 resize-y font-mono text-[13px] leading-relaxed"
            />
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                className="btn-primary"
                disabled={!raw.trim() || parse.isPending}
                onClick={() => parse.mutate()}
              >
                {parse.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Wand2 className="size-4" />
                )}
                {parse.isPending ? "Structuring…" : "Structure with AI"}
              </button>
              <button className="btn-glass" onClick={() => setRaw(EXAMPLE)}>
                Load example
              </button>
            </div>
          </section>
        )}

        {step === 2 && drafts && (
          <section>
            <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold tracking-tight">
                  Review {drafts.length} service{drafts.length === 1 ? "" : "s"}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {flags.length
                    ? `${flags.length} item${flags.length === 1 ? "" : "s"} need a look before publishing.`
                    : "Everything looks good."}
                </p>
              </div>
              <div className="flex gap-2">
                <button className="btn-glass btn-sm" onClick={() => setDrafts(null)}>
                  <ArrowLeft className="size-4" />
                  Back
                </button>
                <button
                  className="btn-primary btn-sm"
                  disabled={!drafts.length || publish.isPending}
                  onClick={() => publish.mutate()}
                >
                  {publish.isPending && <Loader2 className="size-4 animate-spin" />}Approve &
                  publish
                </button>
              </div>
            </div>
            <div className="space-y-3">
              {drafts.map((d) => {
                const fl = flags.filter((f) => f.tmp_id === d.tmp_id);
                const has = (f: string) => fl.find((x) => x.field === f);
                const cls = (f: string) =>
                  has(f)?.severity === "error"
                    ? "ring-2 ring-danger"
                    : has(f)
                      ? "ring-2 ring-warning"
                      : "";
                return (
                  <div key={d.tmp_id} className="glass-card p-4">
                    <div className="grid gap-3 md:grid-cols-[2fr_1fr_0.8fr_0.8fr_auto] md:items-end">
                      <L label="Title">
                        <input
                          className="field"
                          value={d.title}
                          onChange={(e) => upd(d.tmp_id, { title: e.target.value })}
                        />
                      </L>
                      <L label="Price (USD)">
                        <input
                          type="number"
                          className={`field tabular-nums ${cls("price_cents")}`}
                          value={d.price_cents / 100}
                          onChange={(e) =>
                            upd(d.tmp_id, { price_cents: Math.round(Number(e.target.value) * 100) })
                          }
                        />
                      </L>
                      <L label="Deposit %">
                        <input
                          type="number"
                          className="field tabular-nums"
                          value={d.deposit_pct}
                          onChange={(e) => upd(d.tmp_id, { deposit_pct: Number(e.target.value) })}
                        />
                      </L>
                      <L label="Lead time (days)">
                        <input
                          type="number"
                          className={`field tabular-nums ${cls("lead_time_days")}`}
                          value={d.lead_time_days ?? ""}
                          placeholder="—"
                          onChange={(e) =>
                            upd(d.tmp_id, {
                              lead_time_days: e.target.value ? Number(e.target.value) : null,
                            })
                          }
                        />
                      </L>
                      <button
                        aria-label="Remove"
                        className="btn-glass btn-sm h-[38px]"
                        onClick={() => setDrafts(drafts.filter((x) => x.tmp_id !== d.tmp_id))}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      {d.deliverables.map((x) => (
                        <span
                          key={x}
                          className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-[12px]"
                        >
                          {x}
                          <button
                            onClick={() =>
                              upd(d.tmp_id, { deliverables: d.deliverables.filter((y) => y !== x) })
                            }
                          >
                            <X className="size-3 text-muted-foreground" />
                          </button>
                        </span>
                      ))}
                      <input
                        placeholder="+ deliverable"
                        className="w-32 bg-transparent text-[12px] outline-none placeholder:text-muted-foreground"
                        onKeyDown={(e) => {
                          const v = e.currentTarget.value.trim();
                          if (e.key === "Enter" && v) {
                            upd(d.tmp_id, { deliverables: [...d.deliverables, v] });
                            e.currentTarget.value = "";
                          }
                        }}
                      />
                      <span className="ml-auto text-[12px] tabular-nums text-muted-foreground">
                        Deposit {money(Math.round((d.price_cents * d.deposit_pct) / 100))}
                      </span>
                    </div>
                    {fl.map((f, i) => (
                      <p
                        key={i}
                        className={`mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${f.severity === "error" ? "bg-danger-bg text-danger" : "bg-warning-bg text-warning"}`}
                      >
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                        <span>
                          <span className="mr-1.5 font-semibold">
                            {f.severity === "error"
                              ? "Fix before publishing:"
                              : "Check this price:"}
                          </span>
                          {f.message}
                        </span>
                      </p>
                    ))}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {step === 3 && published && (
          <section className="glass-card mx-auto max-w-2xl p-8 text-center">
            <span className="icon-tile mx-auto size-12">
              <CircleCheck className="size-6" />
            </span>
            <h1 className="display mt-5 text-3xl">Your services are now agent-ready</h1>
            <p className="mt-3 text-muted-foreground">
              {published.length} services published. AI assistants can discover and quote them at:
            </p>
            <div className="glass-row mx-auto mt-5 flex max-w-md items-center gap-2 p-2 pl-4 font-mono text-[13px]">
              <span className="truncate">https://serviceready.app/mcp/maya-rao-studio</span>
              <button
                className="btn-glass btn-sm ml-auto"
                onClick={() => {
                  navigator.clipboard.writeText("https://serviceready.app/mcp/maya-rao-studio");
                  toast.success("Copied");
                }}
              >
                <Copy className="size-3.5" />
              </button>
            </div>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link to="/s/$slug" params={{ slug: "maya-rao-studio" }} className="btn-primary">
                View storefront <ArrowRight className="size-4" />
              </Link>
              <Link to="/app/connect" className="btn-glass">
                Connect agents
              </Link>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
