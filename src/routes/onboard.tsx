import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CircleCheck,
  Loader2,
  Plus,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { api, USE_MOCKS } from "@/lib/api";
import type { Flag, Service, ServiceDraft } from "@/lib/types";
import { CopyButton, Wordmark } from "@/components/kit";
import { money } from "@/lib/format";
import { catalogErrors, depositOf, LIMITS } from "@/lib/validation";

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
  "logo 450 (2 rounds) | brand kit w/ logo+colors+fonts 1200, half upfront, 2wks | social templates x10 - 15, 5 days | rush +30% | website landing pg 900 2wks";
const num = (v: string) => (v.trim() === "" ? NaN : Number(v));

function Onboard() {
  const qc = useQueryClient();
  const seller = useQuery({ queryKey: ["seller"], queryFn: api.getSeller });
  const slug = seller.data?.slug ?? "maya-rao-studio";
  const [raw, setRaw] = useState("");
  const [drafts, setDrafts] = useState<ServiceDraft[] | null>(null);
  const [aiFlags, setAiFlags] = useState<Flag[]>([]);
  const originals = useRef<Record<string, ServiceDraft>>({});
  const [published, setPublished] = useState<Service[] | null>(null);
  const parse = useMutation({
    mutationFn: () => api.parseCatalog(raw),
    onSuccess: (r) => {
      originals.current = Object.fromEntries(r.services.map((s) => [s.tmp_id, s]));
      setDrafts(r.services);
      setAiFlags(r.flags);
      if (!r.services.length) toast.error("We couldn't find any services in that text");
    },
  });
  const publish = useMutation({
    mutationFn: () => api.publishCatalog(drafts ?? []),
    onSuccess: (s) => {
      setPublished(s);
      ["services", "public", "events"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success(`${s.length} service${s.length === 1 ? "" : "s"} published`);
    },
  });
  const step = published ? 3 : drafts ? 2 : 1;
  const upd = (id: string, patch: Partial<ServiceDraft>) =>
    setDrafts((d) => d?.map((x) => (x.tmp_id === id ? { ...x, ...patch } : x)) ?? null);

  // Live flags: hard validation always; AI "check this" hints only while the flagged field is unchanged.
  const flags = useMemo(() => {
    if (!drafts) return [];
    return drafts.flatMap((d) => {
      const o = originals.current[d.tmp_id];
      const hard = catalogErrors(drafts).filter((f) => f.tmp_id === d.tmp_id);
      const ai = aiFlags.filter(
        (f) =>
          f.tmp_id === d.tmp_id &&
          o &&
          d[f.field as keyof ServiceDraft] === o[f.field as keyof ServiceDraft] &&
          !hard.some((h) => h.field === f.field),
      );
      return [
        ...ai.filter((f) => f.severity === "error"),
        ...hard,
        ...ai.filter((f) => f.severity === "warning"),
      ];
    });
  }, [drafts, aiFlags]);
  const blocking = flags.filter((f) => f.severity === "error").length;
  const warnings = flags.length - blocking;
  const mcpUrl = `${typeof window !== "undefined" ? window.location.origin : "https://serviceready.onrender.com"}/mcp/${slug}`;

  const addBlank = () => {
    const tmp_id = `tmp_new_${Date.now().toString(36)}`;
    const d: ServiceDraft = {
      tmp_id,
      title: "",
      description: "",
      deliverables: [],
      price_cents: 0,
      deposit_pct: seller.data?.rules.default_deposit_pct ?? 50,
      lead_time_days: 7,
    };
    originals.current[tmp_id] = d;
    setDrafts((x) => [...(x ?? []), d]);
  };

  return (
    <div className="min-h-screen bg-muted">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link to="/" aria-label="ServiceReady home">
            <Wordmark />
          </Link>
          <Link to="/app/catalog" className="text-sm text-muted-foreground hover:text-foreground">
            Back to workspace
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 pb-16 pt-8">
        <ol className="mb-8 flex flex-wrap gap-2 text-[13px]" aria-label="Progress">
          {["Paste what you charge", "Check services and prices", "Publish for assistants"].map(
            (l, i) => (
              <li
                key={l}
                aria-current={step === i + 1 ? "step" : undefined}
                className={`flex items-center gap-2 rounded-full border px-3 py-1 ${step === i + 1 ? "border-foreground bg-background font-semibold text-foreground" : step > i + 1 ? "border-border bg-background text-foreground" : "border-border text-muted-foreground"}`}
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
              Any format — one service per line or separated by “|”. AI structures it, never changes
              your prices, and flags anything that looks off.
            </p>
            <label htmlFor="raw" className="sr-only">
              Rate card text
            </label>
            <textarea
              id="raw"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              rows={8}
              maxLength={10000}
              placeholder={"e.g.\nlogo 450 (2 rounds), 1 week\nbrand kit 1200 half upfront, 2wks"}
              className="field mt-6 resize-y font-mono text-[13px] leading-relaxed"
            />
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="btn-mint"
                disabled={!raw.trim() || parse.isPending}
                onClick={() => parse.mutate()}
              >
                {parse.isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Wand2 className="size-4" aria-hidden="true" />
                )}
                {parse.isPending ? "Structuring…" : "Structure with AI"}
              </button>
              <button type="button" className="btn-glass" onClick={() => setRaw(EXAMPLE)}>
                Load example
              </button>
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                {raw.length.toLocaleString()}/10,000
              </span>
            </div>
          </section>
        )}

        {step === 2 && drafts && (
          <section>
            <div className="sticky top-0 z-20 -mx-5 mb-5 flex flex-wrap items-end justify-between gap-4 border-b border-border bg-muted/95 px-5 py-4 backdrop-blur">
              <div>
                <h1 className="text-2xl font-bold tracking-tight">
                  Review {drafts.length} service{drafts.length === 1 ? "" : "s"}
                </h1>
                <p className="text-sm text-muted-foreground" aria-live="polite">
                  {blocking
                    ? `${blocking} issue${blocking === 1 ? "" : "s"} to fix before publishing`
                    : "Ready to publish"}
                  {warnings
                    ? ` · ${warnings} suggestion${warnings === 1 ? "" : "s"} to double-check`
                    : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn-glass btn-sm" onClick={() => setDrafts(null)}>
                  <ArrowLeft className="size-4" aria-hidden="true" />
                  Back
                </button>
                <button
                  type="button"
                  className="btn-mint btn-sm"
                  disabled={!drafts.length || blocking > 0 || publish.isPending}
                  onClick={() => publish.mutate()}
                >
                  {publish.isPending && (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  )}
                  Approve & publish
                </button>
              </div>
            </div>
            <div className="space-y-3">
              {drafts.map((d, idx) => {
                const fl = flags.filter((f) => f.tmp_id === d.tmp_id);
                const has = (f: string) => fl.find((x) => x.field === f);
                const cls = (f: string) =>
                  has(f)?.severity === "error"
                    ? "border-danger ring-2 ring-danger/30"
                    : has(f)
                      ? "border-warning ring-2 ring-warning/30"
                      : "";
                const fid = (f: string) => `${d.tmp_id}-${f}`;
                return (
                  <div key={d.tmp_id} className="glass-card p-4">
                    <div className="grid gap-3 md:grid-cols-[2fr_1fr_0.8fr_0.8fr_auto] md:items-end">
                      <L id={fid("title")} label="Service name">
                        <input
                          id={fid("title")}
                          className={`field ${cls("title")}`}
                          maxLength={LIMITS.title}
                          value={d.title}
                          onChange={(e) => upd(d.tmp_id, { title: e.target.value })}
                        />
                      </L>
                      <L id={fid("price")} label="Price (USD)">
                        <input
                          id={fid("price")}
                          type="number"
                          min={0}
                          step="0.01"
                          inputMode="decimal"
                          className={`field tabular-nums ${cls("price_cents")}`}
                          value={
                            Number.isFinite(d.price_cents) && d.price_cents !== 0
                              ? d.price_cents / 100
                              : ""
                          }
                          placeholder="0"
                          onChange={(e) =>
                            upd(d.tmp_id, {
                              price_cents: Math.round(num(e.target.value) * 100) || 0,
                            })
                          }
                        />
                      </L>
                      <L id={fid("dep")} label="Deposit %">
                        <input
                          id={fid("dep")}
                          type="number"
                          min={1}
                          max={100}
                          step={1}
                          className={`field tabular-nums ${cls("deposit_pct")}`}
                          value={Number.isFinite(d.deposit_pct) ? d.deposit_pct : ""}
                          onChange={(e) => upd(d.tmp_id, { deposit_pct: num(e.target.value) })}
                        />
                      </L>
                      <L id={fid("lead")} label="Turnaround (days)">
                        <input
                          id={fid("lead")}
                          type="number"
                          min={1}
                          max={LIMITS.maxLeadDays}
                          step={1}
                          className={`field tabular-nums ${cls("lead_time_days")}`}
                          value={d.lead_time_days ?? ""}
                          placeholder="—"
                          onChange={(e) =>
                            upd(d.tmp_id, {
                              lead_time_days: e.target.value ? num(e.target.value) : null,
                            })
                          }
                        />
                      </L>
                      <button
                        type="button"
                        aria-label={`Remove ${d.title || `service ${idx + 1}`}`}
                        className="btn-glass btn-sm h-[38px]"
                        onClick={() => setDrafts(drafts.filter((x) => x.tmp_id !== d.tmp_id))}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </button>
                    </div>
                    <L id={fid("desc")} label="Description" className="mt-3">
                      <input
                        id={fid("desc")}
                        className="field"
                        maxLength={LIMITS.description}
                        value={d.description}
                        onChange={(e) => upd(d.tmp_id, { description: e.target.value })}
                      />
                    </L>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      {d.deliverables.map((x) => (
                        <span
                          key={x}
                          className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-[12px]"
                        >
                          {x}
                          <button
                            type="button"
                            aria-label={`Remove deliverable ${x}`}
                            onClick={() =>
                              upd(d.tmp_id, { deliverables: d.deliverables.filter((y) => y !== x) })
                            }
                          >
                            <X className="size-3 text-muted-foreground" aria-hidden="true" />
                          </button>
                        </span>
                      ))}
                      {d.deliverables.length < LIMITS.maxDeliverables && (
                        <input
                          aria-label="Add a deliverable, then press Enter"
                          placeholder="+ deliverable (Enter)"
                          maxLength={LIMITS.deliverable}
                          className="w-44 rounded-full border border-dashed border-input bg-transparent px-2.5 py-0.5 text-[12px] outline-none placeholder:text-muted-foreground focus:border-ring"
                          onKeyDown={(e) => {
                            const v = e.currentTarget.value.trim();
                            if (e.key === "Enter") {
                              e.preventDefault();
                              if (
                                v &&
                                !d.deliverables.some((y) => y.toLowerCase() === v.toLowerCase())
                              )
                                upd(d.tmp_id, { deliverables: [...d.deliverables, v] });
                              e.currentTarget.value = "";
                            }
                          }}
                        />
                      )}
                      <span className="ml-auto text-[12px] tabular-nums text-muted-foreground">
                        Deposit{" "}
                        {Number.isFinite(d.deposit_pct)
                          ? money(depositOf(d.price_cents, d.deposit_pct))
                          : "—"}
                      </span>
                    </div>
                    {fl.map((f, i) => (
                      <p
                        key={i}
                        className={`mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${f.severity === "error" ? "bg-danger-bg text-danger" : "bg-warning-bg text-warning"}`}
                      >
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                        <span>
                          <span className="mr-1.5 font-semibold">
                            {f.severity === "error" ? "Fix before publishing:" : "Double-check:"}
                          </span>
                          {f.message}
                        </span>
                      </p>
                    ))}
                  </div>
                );
              })}
              <button type="button" className="btn-glass btn-sm" onClick={addBlank}>
                <Plus className="size-4" aria-hidden="true" />
                Add a service
              </button>
            </div>
          </section>
        )}

        {step === 3 && published && (
          <section className="glass-card mx-auto max-w-2xl p-8 text-center">
            <span className="icon-tile mx-auto size-12">
              <CircleCheck className="size-6" aria-hidden="true" />
            </span>
            <h1 className="display mt-5 text-3xl">Your services are now agent-ready</h1>
            <p className="mt-3 text-muted-foreground">
              {published.length} service{published.length === 1 ? "" : "s"} published.
              {USE_MOCKS
                ? " Your demo catalog is ready to quote on the storefront. MCP configuration preview:"
                : " AI assistants can discover and quote them at:"}
            </p>
            <div className="glass-row mx-auto mt-5 flex max-w-md items-center gap-2 p-2 pl-4 font-mono text-[13px]">
              <span className="min-w-0 truncate">{mcpUrl}</span>
              <CopyButton
                text={mcpUrl}
                label="Copy MCP URL"
                iconOnly
                className="ml-auto shrink-0"
              />
            </div>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link to="/s/$slug" params={{ slug }} className="btn-mint">
                View storefront <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
              <Link to="/app/catalog" className="btn-glass">
                Go to catalog
              </Link>
              <Link to="/app/connect" className="btn-glass">
                Connect assistants
              </Link>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function L({
  id,
  label,
  children,
  className = "",
}: {
  id: string;
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}
