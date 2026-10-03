import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Bot, Check, ExternalLink, Loader2, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { AgentRun, QuoteStatus } from "@/lib/types";
import { money } from "@/lib/format";
import { Empty, StatusBadge, Wordmark } from "@/components/kit";
import { PayPalDepositButton } from "@/components/PayPalDepositButton";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/q/$id")({
  head: () => ({
    meta: [
      { title: "Your quote — Maya Rao Studio | ServiceReady" },
      { name: "description", content: "Review your quote and pay the deposit securely with PayPal." },
      { property: "og:title", content: "Your quote from Maya Rao Studio" },
      { property: "og:description", content: "Review scope, totals and pay the deposit with PayPal." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: QuotePage,
});

const STEPS: { s: QuoteStatus; l: string }[] = [
  { s: "quoted", l: "Quoted" }, { s: "deposit_paid", l: "Deposit paid" }, { s: "delivered", l: "Delivered" }, { s: "balance_invoiced", l: "Balance invoiced" }, { s: "paid", l: "Paid" },
];

function QuotePage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ["quote", id], queryFn: () => api.getQuote(id) });
  const [msg, setMsg] = useState("");
  const [run, setRun] = useState<AgentRun | null>(null);
  const reply = useMutation({ mutationFn: () => api.postReply(id, msg, "client"), onSuccess: (r) => { setRun(r.agent_run); setMsg(""); qc.invalidateQueries({ queryKey: ["quote", id] }); } });
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
      <header className="relative mx-auto flex h-16 max-w-2xl items-center justify-between px-6"><Link to="/"><Wordmark /></Link><span className="text-[12px] text-cream/55">Secure quote</span></header>
      <main className="relative mx-auto max-w-xl px-6 pb-20 pt-6">
        {isLoading ? <Skeleton className="h-[560px] rounded-2xl" /> : isError || !data ? <Empty title="Quote not found">This link may be outdated.</Empty> : (() => {
          const q = data.quote;
          const bal = data.payments.find((p) => p.kind === "balance");
          const idx = q.status === "cancelled" ? -1 : STEPS.findIndex((x) => x.s === q.status);
          return (
            <>
              <article className="glass-card overflow-hidden">
                <div className="border-b border-dashed border-cream/15 p-6 sm:p-8">
                  <div className="flex items-start justify-between gap-3">
                    <div><p className="eyebrow">Quote · Maya Rao Studio</p><h1 className="mt-2 text-2xl font-bold tracking-tight">{q.service_title}</h1><p className="mt-1 text-sm text-cream/60">for {q.client_name}</p></div>
                    <StatusBadge status={q.status} />
                  </div>
                  <p className="mt-5 text-[14px] leading-relaxed text-cream/75">{q.scope_summary}</p>
                </div>
                <div className="space-y-2 p-6 text-sm tabular-nums sm:px-8">
                  {q.line_items.map((li) => <div key={li.label} className="flex justify-between"><span className="text-cream/75">{li.label}</span><span>{money(li.amount_cents)}</span></div>)}
                  <div className="my-3 border-t border-cream/10" />
                  <div className="flex justify-between font-semibold"><span>Total</span><span>{money(q.total_cents)}</span></div>
                  <div className="flex justify-between text-mint"><span>Deposit due now</span><span className="font-bold">{money(q.deposit_cents)}</span></div>
                  <div className="flex justify-between text-cream/65"><span>Balance on delivery</span><span>{money(q.balance_cents)}</span></div>
                </div>
                <div className="border-t border-cream/10 p-6 sm:px-8">
                  <ol className="space-y-0">
                    {STEPS.map((st, i) => (
                      <li key={st.s} className="flex items-center gap-3 py-1.5 text-sm">
                        <span className={`grid size-5 place-items-center rounded-full ${i <= idx ? "bg-mint text-deep-950" : "ringline text-cream/40"}`}>{i <= idx ? <Check className="size-3" strokeWidth={3} /> : <span className="size-1 rounded-full bg-cream/40" />}</span>
                        <span className={i <= idx ? "" : "text-cream/45"}>{st.l}</span>
                      </li>
                    ))}
                  </ol>
                </div>
                <div className="border-t border-cream/10 p-6 sm:px-8">
                  {q.status === "quoted" && <><PayPalDepositButton quoteId={q.id} onPaid={() => qc.invalidateQueries({ queryKey: ["quote", id] })} /><p className="mt-2 text-center text-[12px] text-cream/50">Work starts once the deposit is captured.</p></>}
                  {q.status === "balance_invoiced" && bal?.invoice_url && <a href={bal.invoice_url} target="_blank" rel="noreferrer" className="btn-mint w-full">Pay balance invoice · {money(bal.amount_cents)} <ExternalLink className="size-4" /></a>}
                  {q.status === "deposit_paid" && <p className="text-center text-sm text-mint">Deposit received — Maya is on it.</p>}
                  {q.status === "paid" && <p className="text-center text-sm text-mint">All paid. Thank you!</p>}
                  {(q.status === "delivered" || q.status === "cancelled") && <p className="text-center text-sm text-cream/60">{q.status === "cancelled" ? "This quote was cancelled." : "Delivered — balance invoice coming shortly."}</p>}
                  <button className="btn-glass mt-3 flex w-full justify-center" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
                    {refresh.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}Refresh from PayPal
                  </button>
                </div>
              </article>

              <section className="glass-card mt-6 p-5">
                <h2 className="font-semibold">Message Maya</h2>
                <textarea className="field mt-3" rows={3} maxLength={2000} placeholder="e.g. I already paid the invoice!" value={msg} onChange={(e) => setMsg(e.target.value)} />
                <button className="btn-mint btn-sm mt-3" disabled={!msg.trim() || reply.isPending} onClick={() => reply.mutate()}>{reply.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}Send</button>
                {run && (
                  <div className="glass-row mt-4 flex gap-3 p-3 text-[13px]">
                    <Bot className="mt-0.5 size-4 shrink-0 text-mint" />
                    <div><p className="text-cream/85">{run.summary}</p><p className="mt-1 text-cream/50">Maya reviews every reply before anything is sent.</p></div>
                  </div>
                )}
              </section>
            </>
          );
        })()}
      </main>
    </div>
  );
}
