import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, Bot, ExternalLink, Info, Loader2, PackageCheck, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { AgentRun } from "@/lib/types";
import { money, timeAgo } from "@/lib/format";
import { Empty, PayStatus, SourceBadge, StatusBadge } from "@/components/kit";
import { EventTimeline } from "@/components/EventTimeline";
import { ProposalCard } from "@/components/ProposalCard";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusTracker } from "@/components/StatusTracker";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/app/quotes/$id")({
  head: () => ({
    meta: [
      { title: "Booking detail — ServiceReady" },
      { name: "description", content: "Payments, actions and audit trail for a booking." },
      { property: "og:title", content: "Booking detail — ServiceReady" },
      { property: "og:description", content: "Payments, actions and audit trail." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Detail,
});

function Detail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const key = ["quote", id];
  const { data, isLoading, isError } = useQuery({ queryKey: key, queryFn: () => api.getQuote(id) });
  const [confirm, setConfirm] = useState(false);
  const [paste, setPaste] = useState("");
  const [run, setRun] = useState<AgentRun | null>(null);
  const refreshAll = () =>
    ["quote", "proposals", "stats", "quotes", "events"].forEach((k) =>
      qc.invalidateQueries({ queryKey: [k] }),
    );

  const deliver = useMutation({
    mutationFn: () => api.deliver(id),
    onSuccess: (d) => {
      qc.setQueryData(key, d);
      toast.success("Delivered — balance invoice sent via PayPal");
      refreshAll();
    },
  });
  const collect = useMutation({
    mutationFn: () => api.runCollections(id),
    onSuccess: (r) => {
      setRun(r);
      refreshAll();
    },
  });
  const reply = useMutation({
    mutationFn: () => api.postReply(id, paste, "seller"),
    onSuccess: (r) => {
      setRun(r.agent_run);
      setPaste("");
      refreshAll();
    },
  });
  const refresh = useMutation({
    mutationFn: () => api.getQuote(id, true),
    onSuccess: (d) => {
      qc.setQueryData(key, d);
      toast.success("Synced with PayPal");
    },
  });

  if (isLoading)
    return (
      <div className="space-y-4">
        <Skeleton className="h-20" />
        <Skeleton className="h-48" />
        <Skeleton className="h-72" />
      </div>
    );
  if (isError || !data)
    return (
      <Empty title="Booking not found">
        <Link to="/app" className="text-link">
          Back to bookings
        </Link>
      </Empty>
    );
  const q = data.quote;
  const isSample = data.events.some((event) => event.demo_sample);
  const pending = data.proposals.filter((p) => p.status === "pending");

  return (
    <>
      <Link
        to="/app"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Bookings
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{q.client_name}</h1>
            <StatusBadge status={q.status} />
            <SourceBadge source={q.source} />
            {isSample && (
              <span className="inline-flex items-center gap-1 rounded-full border border-warning bg-warning-bg px-2.5 py-0.5 text-[11px] font-medium text-warning">
                <Info className="size-3" />
                Sample data
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {q.service_title} · <span className="tabular-nums">{money(q.total_cents)}</span> ·
            updated {timeAgo(q.updated_at)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!isSample && (
            <button
              className="btn-glass btn-sm"
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
          {!isSample && (q.status === "deposit_paid" || q.status === "delivered") && (
            <button className="btn-primary btn-sm" onClick={() => setConfirm(true)}>
              <PackageCheck className="size-3.5" />
              Mark delivered & send balance invoice
            </button>
          )}
        </div>
      </div>

      <section className="glass-card mb-5 p-5">
        <h2 className="mb-5 font-semibold">Booking progress</h2>
        <StatusTracker status={q.status} />
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <section className="glass-card p-5">
          <h2 className="mb-4 font-semibold">Payments</h2>
          {data.payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No payments yet. Waiting for the client to pay the {money(q.deposit_cents)} deposit.
            </p>
          ) : (
            <div className="space-y-3">
              {data.payments.map((p) => (
                <div key={p.id} className="glass-row p-4 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold capitalize">{p.kind}</span>
                    <span className="font-bold tabular-nums">{money(p.amount_cents)}</span>
                  </div>
                  <div className="mt-2 grid gap-1 font-mono text-[12px] text-muted-foreground">
                    {p.paypal_order_id && <span>Order {p.paypal_order_id}</span>}
                    {p.paypal_capture_id && <span>Capture {p.paypal_capture_id}</span>}
                    {p.paypal_invoice_id && <span>Invoice {p.paypal_invoice_id}</span>}
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <PayStatus status={p.status} />
                    {p.invoice_url && (
                      <a
                        href={p.invoice_url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 text-[12px] text-link"
                      >
                        Open invoice <ExternalLink className="size-3" />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-5 border-t border-border pt-4">
            <p className="text-[11px] text-muted-foreground">Brief</p>
            <p className="mt-1 text-sm text-muted-foreground">{q.brief}</p>
          </div>
        </section>

        <section className="glass-card space-y-4 p-5">
          <h2 className="font-semibold">Collections</h2>
          {isSample ? (
            <p className="text-sm text-muted-foreground">
              Sample data — PayPal and collections actions are disabled.
            </p>
          ) : (
            <>
              <button
                className="btn-glass btn-sm w-full"
                disabled={collect.isPending}
                onClick={() => collect.mutate()}
              >
                {collect.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Bot className="size-3.5 text-link" />
                )}
                Run collections agent
              </button>
              <div>
                <label className="text-[11px] text-muted-foreground">Paste client reply</label>
                <textarea
                  className="field mt-1.5"
                  rows={3}
                  maxLength={2000}
                  placeholder="e.g. Already paid this morning!"
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                />
                <button
                  className="btn-primary btn-sm mt-2"
                  disabled={!paste.trim() || reply.isPending}
                  onClick={() => reply.mutate()}
                >
                  {reply.isPending && <Loader2 className="size-3.5 animate-spin" />}Send to agent
                </button>
              </div>
              {run && (
                <div className="glass-row flex gap-2 p-3 text-[13px]">
                  <Bot className="mt-0.5 size-4 shrink-0 text-link" />
                  {run.summary}
                </div>
              )}
            </>
          )}
          {data.replies.length > 0 && (
            <div>
              <p className="text-[11px] text-muted-foreground">Replies</p>
              {data.replies.map((r) => (
                <p key={r.id} className="mt-2 rounded-lg bg-muted px-3 py-2 text-[13px]">
                  <span className="text-muted-foreground">
                    {r.from} · {timeAgo(r.created_at)}
                  </span>
                  <br />
                  {r.text}
                </p>
              ))}
            </div>
          )}
        </section>
      </div>

      {pending.length > 0 && (
        <section className="mt-6 space-y-3">
          <h2 className="font-semibold">Waiting for your approval</h2>
          {pending.map((p) => (
            <ProposalCard key={p.id} p={p} showClient={false} />
          ))}
        </section>
      )}

      <section className="glass-card mt-6 p-5">
        <h2 className="mb-5 font-semibold">Audit trail</h2>
        {data.events.length ? (
          <EventTimeline events={data.events} />
        ) : (
          <p className="text-sm text-muted-foreground">No events yet.</p>
        )}
      </section>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent className="border-border bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Mark delivered and invoice the balance?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              A PayPal invoice for {money(q.balance_cents)} will be sent to {q.client_email}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="btn-glass border-0">Cancel</AlertDialogCancel>
            <AlertDialogAction className="btn-primary" onClick={() => deliver.mutate()}>
              Send invoice
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
