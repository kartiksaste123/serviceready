import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Bot, ExternalLink, Loader2, LockKeyhole, Send } from "lucide-react";
import { api } from "@/lib/api";
import type { AgentRun } from "@/lib/types";
import { money } from "@/lib/format";
import { Empty, StatusBadge, Wordmark } from "@/components/kit";
import { PayPalDepositButton } from "@/components/PayPalDepositButton";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusTracker } from "@/components/StatusTracker";

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

function QuotePage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ["quote", id], queryFn: () => api.getQuote(id) });
  const [msg, setMsg] = useState("");
  const [run, setRun] = useState<AgentRun | null>(null);
  const reply = useMutation({ mutationFn: () => api.postReply(id, msg, "client"), onSuccess: (r) => { setRun(r.agent_run); setMsg(""); qc.invalidateQueries({ queryKey: ["quote", id] }); } });

  return (
    <div className="relative min-h-screen">
      <header className="relative mx-auto flex h-16 max-w-2xl items-center justify-between px-6"><Link to="/"><Wordmark /></Link><span className="text-[12px] text-muted-foreground">Secure quote</span></header>
      <main className="relative mx-auto max-w-xl px-6 pb-20 pt-6">
        {isLoading ? <Skeleton className="h-[560px] rounded-2xl" /> : isError || !data ? <Empty title="Quote not found">This link may be outdated.</Empty> : (() => {
          const q = data.quote;
          const bal = data.payments.find((p) => p.kind === "balance");
          return (
            <>
              <article className="glass-card overflow-hidden">
                <div className="border-b border-dashed border-border p-6 sm:p-8">
                  <div className="flex items-start justify-between gap-3">
                    <div><p className="eyebrow">Quote · Maya Rao Studio</p><h1 className="mt-2 text-2xl font-bold tracking-tight">{q.service_title}</h1><p className="mt-1 text-sm text-muted-foreground">for {q.client_name}</p></div>
                    <StatusBadge status={q.status} />
                  </div>
                  <p className="mt-5 text-[14px] leading-relaxed text-muted-foreground">{q.scope_summary}</p>
                </div>
                <div className="space-y-2 p-6 text-sm tabular-nums sm:px-8">
                  {q.line_items.map((li) => <div key={li.label} className="flex justify-between"><span className="text-muted-foreground">{li.label}</span><span>{money(li.amount_cents)}</span></div>)}
                  <div className="my-3 border-t border-border" />
                  <div className="flex justify-between font-semibold"><span>Total</span><span>{money(q.total_cents)}</span></div>
                  <div className="flex justify-between text-link"><span>Deposit due now</span><span className="font-bold">{money(q.deposit_cents)}</span></div>
                  <div className="flex justify-between text-muted-foreground"><span>Balance on delivery</span><span>{money(q.balance_cents)}</span></div>
                </div>
                 <div className="border-t border-border p-6 sm:px-8"><h2 className="mb-5 font-semibold">Booking progress</h2><StatusTracker status={q.status} /></div>
                <div className="border-t border-border p-6 sm:px-8">
                   {q.status === "quoted" && <><div className="rounded-lg border border-border bg-muted p-4"><p className="mb-3 text-sm"><span className="font-semibold">Secure PayPal checkout</span><br/><span className="text-muted-foreground">Pay {money(q.deposit_cents)} to confirm this booking before work begins.</span></p><PayPalDepositButton quoteId={q.id} onPaid={() => qc.invalidateQueries({ queryKey: ["quote", id] })} /></div><p className="mt-2 flex items-center justify-center gap-1 text-xs text-muted-foreground"><LockKeyhole className="size-3" />Demo payment — no real charge</p></>}
                   {q.status === "balance_invoiced" && bal?.invoice_url && <a href={bal.invoice_url} target="_blank" rel="noreferrer" className="btn-mint w-full">Pay remaining {money(bal.amount_cents)} with PayPal <ExternalLink className="size-4" /></a>}
                  {q.status === "deposit_paid" && <p className="text-center text-sm text-link">Deposit received — Maya is on it.</p>}
                  {q.status === "paid" && <p className="text-center text-sm text-link">All paid. Thank you!</p>}
                  {(q.status === "delivered" || q.status === "cancelled") && <p className="text-center text-sm text-muted-foreground">{q.status === "cancelled" ? "This quote was cancelled." : "Delivered — balance invoice coming shortly."}</p>}
                </div>
              </article>

              <section className="glass-card mt-6 p-5">
                <h2 className="font-semibold">Message Maya</h2>
                <textarea className="field mt-3" rows={3} maxLength={2000} placeholder="e.g. I already paid the invoice!" value={msg} onChange={(e) => setMsg(e.target.value)} />
                <button className="btn-mint btn-sm mt-3" disabled={!msg.trim() || reply.isPending} onClick={() => reply.mutate()}>{reply.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}Send</button>
                {run && (
                  <div className="glass-row mt-4 flex gap-3 p-3 text-[13px]">
                    <Bot className="mt-0.5 size-4 shrink-0 text-link" />
                    <div><p className="text-foreground">{run.summary}</p><p className="mt-1 text-muted-foreground">Maya reviews every reply before anything is sent.</p></div>
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
