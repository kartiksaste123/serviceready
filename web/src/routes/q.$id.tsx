import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Bot,
  Check,
  ExternalLink,
  Info,
  Loader2,
  RefreshCw,
  Send,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { AgentRun } from "@/lib/types";
import { money } from "@/lib/format";
import { Empty, StatusBadge, Wordmark } from "@/components/kit";
import { PayPalDepositButton } from "@/components/PayPalDepositButton";
import { StatusTracker } from "@/components/StatusTracker";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/q/$id")({
  head: () => ({
    meta: [
      { title: "Your quote — Maya Rao Studio | ServiceReady" },
      {
        name: "description",
        content: "Review your quote and pay the deposit securely with PayPal.",
      },
      { property: "og:title", content: "Your quote from Maya Rao Studio" },
      {
        property: "og:description",
        content: "Review scope, totals and pay the deposit with PayPal.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: QuotePage,
});

function QuotePage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["quote", id],
    queryFn: () => api.getQuote(id),
  });
  const [msg, setMsg] = useState("");
  const [run, setRun] = useState<AgentRun | null>(null);
  const [showFullScope, setShowFullScope] = useState(false);
  const reply = useMutation({
    mutationFn: () => api.postReply(id, msg, "client"),
    onSuccess: (r) => {
      setRun(r.agent_run);
      setMsg("");
      qc.invalidateQueries({ queryKey: ["quote", id] });
    },
  });
  const refresh = useMutation({
    mutationFn: () => api.getQuote(id, true),
    onSuccess: (detail) => {
      qc.setQueryData(["quote", id], detail);
      toast.success("Synced with PayPal");
    },
  });

  return (
    <div className="relative min-h-screen">
      <div className="grain pointer-events-none absolute inset-x-0 top-0 h-[380px]" />
      <header className="relative mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link to="/">
          <Wordmark />
        </Link>
        <span className="text-[12px] text-muted-foreground">Secure quote</span>
      </header>
      <main className="relative mx-auto max-w-6xl px-6 pb-20 pt-6">
        {isLoading ? (
          <Skeleton className="h-[560px] rounded-2xl" />
        ) : isError || !data ? (
          <Empty title="Quote not found">This link may be outdated.</Empty>
        ) : (
          (() => {
            const q = data.quote;
            const bal = data.payments.find((p) => p.kind === "balance");
            const isSample = data.events.some((event) => event.demo_sample);
            const hasLongScope = q.scope_summary.length > 220;
            const balanceLabel =
              q.status === "balance_invoiced"
                ? "Balance due"
                : q.status === "paid"
                  ? "Balance paid"
                  : "Balance on delivery";
            return (
              <>
                <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.75fr)]">
                  <article className="glass-card overflow-hidden">
                    <div className="border-b border-dashed border-border p-6 sm:p-8">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="eyebrow">Quote from Maya Rao Studio</p>
                          <h1 className="mt-2 text-2xl font-bold tracking-tight">
                            {q.service_title}
                          </h1>
                          <p className="mt-1 text-sm text-muted-foreground">for {q.client_name}</p>
                          {isSample && (
                            <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-0.5 text-[11px] text-muted-foreground">
                              <Info className="size-3" />
                              Sample data
                            </span>
                          )}
                        </div>
                        <StatusBadge status={q.status} />
                      </div>
                      <p
                        className={`mt-5 text-[14px] leading-relaxed text-muted-foreground ${hasLongScope && !showFullScope ? "line-clamp-3" : ""}`}
                      >
                        {q.scope_summary}
                      </p>
                      {hasLongScope && (
                        <button
                          type="button"
                          className="mt-2 text-sm font-medium text-link underline underline-offset-4 hover:no-underline"
                          aria-expanded={showFullScope}
                          onClick={() => setShowFullScope((expanded) => !expanded)}
                        >
                          {showFullScope ? "Show less" : "Show full details"}
                        </button>
                      )}
                    </div>
                    <div className="space-y-2 p-6 text-sm tabular-nums sm:px-8">
                      {q.line_items.map((li) => (
                        <div key={li.label} className="flex justify-between">
                          <span className="text-muted-foreground">{li.label}</span>
                          <span>{money(li.amount_cents)}</span>
                        </div>
                      ))}
                      <div className="my-3 border-t border-border" />
                      <div className="flex justify-between font-semibold">
                        <span>Total</span>
                        <span>{money(q.total_cents)}</span>
                      </div>
                      <div className="flex justify-between text-foreground">
                        <span className="flex items-center gap-1.5">
                          {["deposit_paid", "delivered", "balance_invoiced", "paid"].includes(
                            q.status,
                          ) && <Check className="size-4 text-success" />}
                          {q.status === "quoted"
                            ? "Deposit due now"
                            : ["deposit_paid", "delivered", "balance_invoiced", "paid"].includes(
                                  q.status,
                                )
                              ? "Deposit paid"
                              : "Deposit"}
                        </span>
                        <span className="font-bold">{money(q.deposit_cents)}</span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span
                          className={`flex items-center gap-1.5 ${q.status === "balance_invoiced" ? "text-warning" : q.status === "paid" ? "text-success" : ""}`}
                        >
                          {q.status === "paid" && <Check className="size-4" />}
                          {balanceLabel}
                        </span>
                        <span>{money(q.balance_cents)}</span>
                      </div>
                    </div>
                    <div className="border-t border-border p-6 sm:px-8">
                      <StatusTracker status={q.status} />
                    </div>
                  </article>
                  <aside className="space-y-5 lg:sticky lg:top-6">
                    <section className="glass-card p-6 sm:p-8">
                      {q.status === "quoted" &&
                        (isSample ? (
                          <p className="text-center text-sm text-muted-foreground">
                            Sample data — PayPal payments are disabled.
                          </p>
                        ) : (
                          <>
                            <div className="paypal-secure-box mb-3">
                              <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                                <ShieldCheck className="size-4" />
                                Secure payment by PayPal
                              </p>
                              <PayPalDepositButton
                                quoteId={q.id}
                                onPaid={() => qc.invalidateQueries({ queryKey: ["quote", id] })}
                              />
                              <p className="mt-3 text-center text-xs text-muted-foreground">
                                You pay through PayPal. ServiceReady never sees your card or bank
                                details.
                              </p>
                            </div>
                            <p className="mt-2 text-center text-[12px] text-muted-foreground">
                              Work starts once the deposit is captured.
                            </p>
                          </>
                        ))}
                      {q.status === "balance_invoiced" && bal?.invoice_url && (
                        <a
                          href={bal.invoice_url}
                          target="_blank"
                          rel="noreferrer"
                          className="btn-primary w-full"
                        >
                          Pay remaining {money(bal.amount_cents)}{" "}
                          <ExternalLink className="size-4" />
                        </a>
                      )}
                      {q.status === "deposit_paid" && (
                        <p className="flex items-center justify-center gap-2 text-center text-sm text-success">
                          <Check className="size-4" />
                          Deposit received — Maya is on it.
                        </p>
                      )}
                      {q.status === "paid" && (
                        <p className="flex items-center justify-center gap-2 text-center text-sm text-success">
                          <Check className="size-4" />
                          All paid. Thank you!
                        </p>
                      )}
                      {(q.status === "delivered" || q.status === "cancelled") && (
                        <p className="text-center text-sm text-muted-foreground">
                          {q.status === "cancelled"
                            ? "This quote was cancelled."
                            : "Delivered — balance invoice coming shortly."}
                        </p>
                      )}
                      {!isSample && (
                        <button
                          className="btn-glass mt-3 flex w-full justify-center"
                          disabled={refresh.isPending}
                          onClick={() => refresh.mutate()}
                        >
                          {refresh.isPending ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="size-3.5" />
                          )}
                          Check payment status
                        </button>
                      )}
                    </section>
                    <section className="glass-card p-5">
                      <h2 className="font-semibold">Message Maya</h2>
                      {isSample ? (
                        <p className="mt-3 text-sm text-muted-foreground">
                          Sample data — client messages are disabled.
                        </p>
                      ) : (
                        <>
                          <p className="mt-1 text-sm text-muted-foreground">
                            Already paid or have a question? Tell Maya here.
                          </p>
                          <textarea
                            className="field mt-3"
                            rows={3}
                            maxLength={2000}
                            placeholder="e.g. I already paid the invoice!"
                            value={msg}
                            onChange={(e) => setMsg(e.target.value)}
                          />
                          <button
                            className="btn-primary btn-sm mt-3"
                            disabled={!msg.trim() || reply.isPending}
                            onClick={() => reply.mutate()}
                          >
                            {reply.isPending ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <Send className="size-3.5" />
                            )}
                            Send
                          </button>
                          {run && (
                            <div className="glass-row mt-4 flex gap-3 p-3 text-[13px]">
                              <Bot className="mt-0.5 size-4 shrink-0 text-link" />
                              <div>
                                <p className="text-muted-foreground">{run.summary}</p>
                                <p className="mt-1 text-muted-foreground">
                                  Maya reviews every reply before anything is sent.
                                </p>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </section>
                  </aside>
                </div>
              </>
            );
          })()
        )}
      </main>
    </div>
  );
}
