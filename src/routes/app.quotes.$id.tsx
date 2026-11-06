import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Bot,
  CircleDollarSign,
  ExternalLink,
  Loader2,
  PackageCheck,
  Play,
  RefreshCw,
  Send,
  ShieldCheck,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import {
  decideCancel,
  describeCancelPolicy,
  normalizePolicy,
  type CancelReason,
} from "@/lib/cancel-policy";
import { finalBill } from "@/lib/tip";
import { toast } from "sonner";
import { api, USE_MOCKS } from "@/lib/api";
import type { AgentRun, Quote, QuoteDetail } from "@/lib/types";
import { fmtDate, money, timeAgo } from "@/lib/format";
import { absoluteUrl } from "@/lib/clipboard";
import { LIMITS } from "@/lib/validation";
import {
  CopyButton,
  Empty,
  ErrorState,
  PayStatus,
  SourceBadge,
  StatusBadge,
} from "@/components/kit";
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

function nextStep(q: Quote, held = false): string {
  switch (q.status) {
    case "quoted":
      return `Waiting for ${q.client_name} to ${q.deposit_intent === "AUTHORIZE" ? "authorize" : "pay"} the ${money(q.deposit_cents)} deposit. Share the quote link if they haven't seen it.`;
    case "deposit_paid":
      if (held)
        return "Deposit authorized — PayPal is holding the funds. Start work to capture it (cancel now voids the hold, nothing to refund).";
      return "Deposit received — do the work, then mark it delivered to send the balance invoice.";
    case "delivered":
      return "Work delivered — send the balance invoice to get paid.";
    case "balance_invoiced":
      return "Balance invoice sent. Run a payment check to see what PayPal reports and get a follow-up suggestion.";
    case "paid":
      return "Paid in full. Nothing left to collect.";
    case "cancelled":
      return "This quote is cancelled.";
  }
}

function Detail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const key = ["quote", id];
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: key,
    queryFn: () => api.getQuote(id),
    retry: false,
    meta: { silent: true },
  });
  const [confirm, setConfirm] = useState<null | "deliver" | "cancel">(null);
  const [reason, setReason] = useState<CancelReason>("client_cancel");
  const [paste, setPaste] = useState("");
  const [run, setRun] = useState<AgentRun | null>(null);
  useEffect(() => {
    setConfirm(null);
    setPaste("");
    setRun(null);
  }, [id]);
  const refreshAll = () =>
    ["quote", "proposals", "stats", "quotes", "events"].forEach((k) =>
      qc.invalidateQueries({ queryKey: [k] }),
    );
  const applyDetail = (d: QuoteDetail) => {
    qc.setQueryData(key, d);
    refreshAll();
  };

  const deliver = useMutation({
    mutationFn: () => api.deliver(id),
    onSuccess: (d) => {
      applyDetail(d);
      toast.success(
        d.quote.status === "paid"
          ? "Delivered — booking closed (deposit covered the full price)"
          : "Delivered — balance invoice sent via PayPal",
      );
    },
  });
  const cancel = useMutation({
    mutationFn: () => api.cancelQuote(id, reason),
    onSuccess: (d) => {
      applyDetail(d);
      const rule = [...d.events].reverse().find((e) => e.tool?.startsWith("cancel_policy."));
      toast(rule?.text?.replace(/^Policy rule fired: /, "Cancelled · ") ?? "Quote cancelled");
    },
  });
  const startWork = useMutation({
    mutationFn: () => api.startWork(id),
    onSuccess: (d) => {
      applyDetail(d);
      toast.success("Work started — held deposit captured on PayPal");
    },
  });
  const simulate = useMutation({
    mutationFn: () => api.simulateBalancePaid(id),
    onSuccess: (d) => {
      applyDetail(d);
      toast.success("PayPal webhook: balance paid");
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
      if (!r.agent_run) toast.success("Reply saved to the booking");
    },
  });
  const refresh = useMutation({
    mutationFn: () => api.getQuote(id, true),
    onSuccess: (d) => {
      applyDetail(d);
      toast.success("Checked with PayPal — statuses are up to date");
    },
  });

  if (isLoading)
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-20" />
        <Skeleton className="h-48" />
        <Skeleton className="h-72" />
      </div>
    );
  if (isError || !data) {
    const notFound = error instanceof Error && /not found/i.test(error.message);
    return notFound ? (
      <Empty title="Booking not found">
        It may have been removed or the link is wrong.{" "}
        <Link to="/app" className="text-link">
          Back to bookings
        </Link>
      </Empty>
    ) : (
      <ErrorState title="Couldn't load this booking" onRetry={() => refetch()} />
    );
  }
  const q = data.quote;
  const pending = data.proposals.filter((p) => p.status === "pending");
  const bal = data.payments.find((p) => p.kind === "balance");
  const canDeliver = q.status === "deposit_paid" || q.status === "delivered";
  const heldDeposit = data.payments.find((p) => p.kind === "deposit" && p.status === "AUTHORIZED");
  const canCollect = !!bal && q.status !== "cancelled";
  const quoteLink = absoluteUrl(q.approval_url);
  const paidDeposit = data.payments.find(
    (p) => p.kind === "deposit" && (p.status === "COMPLETED" || p.status === "AUTHORIZED"),
  );
  const policy = normalizePolicy(q.cancel_policy);
  const preview = decideCancel({
    policy,
    reason,
    deposit_cents: paidDeposit?.amount_cents ?? 0,
    deposit_state: !paidDeposit
      ? "none"
      : paidDeposit.status === "AUTHORIZED"
        ? "held"
        : "captured",
    deposit_paid_at: q.deposit_paid_at ?? paidDeposit?.updated_at ?? null,
    work_started:
      !!q.work_started_at ||
      q.status === "delivered" ||
      (paidDeposit?.intent === "AUTHORIZE" && paidDeposit.status === "COMPLETED"),
  });
  const tip = q.tip_cents ?? 0;
  const bill = finalBill(q.balance_cents, tip);

  return (
    <>
      <Link
        to="/app"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        All bookings
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{q.client_name}</h1>
            <StatusBadge status={q.status} />
            <SourceBadge source={q.source} />
            {q.integrity === "tampered" ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-danger-bg px-2 py-1 text-xs font-semibold text-danger">
                <ShieldAlert className="size-3.5" aria-hidden="true" /> Amounts tampered · payments
                blocked
              </span>
            ) : (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground"
                title="Amounts are HMAC-signed from the catalog and re-checked against the PayPal order before any capture"
              >
                <ShieldCheck className="size-3.5" aria-hidden="true" />
                {q.integrity === "signed" ? "Signed amounts" : "Catalog-priced"}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {q.service_title} · <span className="tabular-nums">{money(q.total_cents)}</span> ·
            updated {timeAgo(q.updated_at)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-glass btn-sm"
            disabled={refresh.isPending}
            onClick={() => refresh.mutate()}
            title="Re-reads the PayPal order / invoice — use if a webhook was missed"
          >
            {refresh.isPending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="size-3.5" aria-hidden="true" />
            )}
            Check PayPal
          </button>
          {(q.status === "quoted" || q.status === "deposit_paid" || q.status === "delivered") && (
            <button
              type="button"
              className="btn-glass btn-sm"
              disabled={cancel.isPending}
              onClick={() => setConfirm("cancel")}
            >
              {cancel.isPending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <XCircle className="size-3.5" aria-hidden="true" />
              )}
              {q.status === "quoted" ? "Cancel quote" : "Cancel booking…"}
            </button>
          )}
          {heldDeposit && q.status === "deposit_paid" && (
            <button
              type="button"
              className="btn-mint btn-sm"
              disabled={startWork.isPending}
              onClick={() => startWork.mutate()}
              title="Capture the PayPal authorization"
            >
              {startWork.isPending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Play className="size-3.5" aria-hidden="true" />
              )}
              Start work · capture {money(heldDeposit.amount_cents)}
            </button>
          )}
          {canDeliver && (
            <button
              type="button"
              className="btn-mint btn-sm"
              disabled={deliver.isPending}
              onClick={() => setConfirm("deliver")}
            >
              {deliver.isPending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <PackageCheck className="size-3.5" aria-hidden="true" />
              )}
              Mark delivered & invoice balance
            </button>
          )}
        </div>
      </div>

      <div className="glass-card mb-5 p-5">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">Booking progress</h2>
          <p className="text-sm text-muted-foreground">{nextStep(q, !!heldDeposit)}</p>
        </div>
        <StatusTracker status={q.status} />
      </div>

      {pending.length > 0 && (
        <section className="mb-5 space-y-3" aria-labelledby="ap-h">
          <h2 id="ap-h" className="font-semibold">
            Waiting for your approval
          </h2>
          {pending.map((p) => (
            <ProposalCard key={p.id} p={p} showClient={false} />
          ))}
        </section>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.2fr_1fr]">
        <section className="glass-card p-5" aria-labelledby="pay-h">
          <h2 id="pay-h" className="mb-4 font-semibold">
            Payments
          </h2>
          <dl className="mb-4 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-border bg-border text-sm">
            <div className="bg-card p-3">
              <dt className="text-xs text-muted-foreground">Total</dt>
              <dd className="mt-0.5 font-semibold tabular-nums">{money(q.total_cents)}</dd>
            </div>
            <div className="bg-card p-3">
              <dt className="text-xs text-muted-foreground">Deposit</dt>
              <dd className="mt-0.5 font-semibold tabular-nums">{money(q.deposit_cents)}</dd>
            </div>
            <div className="bg-card p-3">
              <dt className="text-xs text-muted-foreground">Balance</dt>
              <dd className="mt-0.5 font-semibold tabular-nums">
                {money(q.balance_cents)}
                {tip > 0 && (
                  <span className="block text-xs font-normal text-muted-foreground">
                    + {money(tip)} tip
                  </span>
                )}
              </dd>
            </div>
          </dl>
          {data.payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {q.status === "cancelled"
                ? "No payments were taken."
                : `No payments yet. Waiting for the client to pay the ${money(q.deposit_cents)} deposit.`}
            </p>
          ) : (
            <div className="space-y-3">
              {data.payments.map((p) => (
                <div key={p.id} className="glass-row p-4 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">
                      {p.kind === "deposit" ? "Deposit (PayPal order)" : "Balance (PayPal invoice)"}
                    </span>
                    <span className="font-bold tabular-nums">{money(p.amount_cents)}</span>
                  </div>
                  <div className="mt-2 grid gap-1 break-all font-mono text-xs text-muted-foreground">
                    {p.paypal_order_id && <span>Order {p.paypal_order_id}</span>}
                    {p.paypal_capture_id && <span>Capture {p.paypal_capture_id}</span>}
                    {p.paypal_invoice_id && <span>Invoice {p.paypal_invoice_id}</span>}
                    {p.fingerprint_short && (
                      <span title="HMAC(quote id + amount + currency + intent), re-checked against PayPal before capture">
                        Fingerprint {p.fingerprint_short}…
                      </span>
                    )}
                  </div>
                  {(p.kept_cents != null || p.refunded_cents != null) && (
                    <p className="mt-2 text-xs">
                      Policy outcome: kept{" "}
                      <span className="font-semibold tabular-nums">{money(p.kept_cents ?? 0)}</span>{" "}
                      · returned to client{" "}
                      <span className="font-semibold tabular-nums">
                        {money(p.refunded_cents ?? 0)}
                      </span>
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <PayStatus status={p.status} />
                      <span className="text-xs text-muted-foreground">{fmtDate(p.updated_at)}</span>
                    </span>
                    {p.invoice_url && !USE_MOCKS && (
                      <a
                        href={p.invoice_url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 text-sm text-link"
                      >
                        Open invoice <ExternalLink className="size-3" aria-hidden="true" />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {USE_MOCKS && q.status === "balance_invoiced" && bal?.status === "UNPAID" && (
            <div className="mt-4 rounded-lg border border-dashed border-border p-3 text-sm">
              <p className="text-muted-foreground">
                Demo: simulate the client paying the invoice in PayPal.
              </p>
              <button
                type="button"
                className="btn-glass btn-sm mt-2"
                disabled={simulate.isPending}
                onClick={() => simulate.mutate()}
              >
                {simulate.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <CircleDollarSign className="size-3.5" aria-hidden="true" />
                )}
                Simulate balance payment
              </button>
            </div>
          )}
          <dl className="mt-5 grid gap-3 border-t border-border pt-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Client email</dt>
              <dd className="mt-0.5 break-all">
                <a className="text-link" href={`mailto:${q.client_email}`}>
                  {q.client_email}
                </a>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Requested</dt>
              <dd className="mt-0.5">{fmtDate(q.created_at)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium text-muted-foreground">Brief</dt>
              <dd className="mt-0.5 whitespace-pre-wrap">{q.brief}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium text-muted-foreground">Scope</dt>
              <dd className="mt-0.5 text-muted-foreground">{q.scope_summary}</dd>
            </div>
          </dl>
          <p className="mt-4 border-t border-border pt-4 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Cancellation policy: </span>
            {describeCancelPolicy(policy)}
          </p>
          {q.status !== "cancelled" && (
            <div className="mt-4 border-t border-border pt-4">
              <p className="text-xs font-medium text-muted-foreground">Client quote link</p>
              <div className="glass-row mt-1.5 flex items-center gap-2 p-1.5 pl-3 font-mono text-xs">
                <a
                  href={q.approval_url}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 truncate text-link"
                >
                  {quoteLink}
                </a>
                <CopyButton text={quoteLink} label="Copy link" className="ml-auto shrink-0" />
              </div>
            </div>
          )}
        </section>

        <section className="glass-card space-y-4 p-5" aria-labelledby="col-h">
          <div>
            <h2 id="col-h" className="font-semibold">
              Payment follow-up
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The assistant checks PayPal, applies your rules from Settings and drafts a message.
              Nothing is sent without your approval.
            </p>
          </div>
          <button
            type="button"
            className="btn-glass btn-sm w-full"
            disabled={!canCollect || collect.isPending}
            onClick={() => collect.mutate()}
          >
            {collect.isPending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Bot className="size-3.5" aria-hidden="true" />
            )}
            {collect.isPending ? "Checking PayPal…" : "Run payment check"}
          </button>
          {!canCollect && (
            <p className="-mt-2 text-xs text-muted-foreground">
              {q.status === "cancelled"
                ? "Not available for cancelled quotes."
                : "Available once a balance invoice has been sent."}
            </p>
          )}
          <div>
            <label htmlFor="paste" className="text-sm font-medium">
              Paste a client reply
            </label>
            <textarea
              id="paste"
              className="field mt-1.5"
              rows={3}
              maxLength={LIMITS.message}
              placeholder="e.g. Already paid this morning!"
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
            />
            <button
              type="button"
              className="btn-mint btn-sm mt-2"
              disabled={!paste.trim() || reply.isPending}
              onClick={() => reply.mutate()}
            >
              {reply.isPending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="size-3.5" aria-hidden="true" />
              )}
              {canCollect ? "Add reply & check" : "Add reply"}
            </button>
          </div>
          {run && (
            <div className="glass-row flex gap-2 p-3 text-sm" role="status">
              <Bot className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {run.summary}
            </div>
          )}
          {data.replies.length > 0 && (
            <div>
              <p className="text-sm font-medium">Conversation</p>
              {data.replies.map((r) => (
                <div key={r.id} className="mt-2 rounded-lg bg-muted px-3 py-2 text-sm">
                  <span className="text-xs text-muted-foreground">
                    {r.from === "client" ? q.client_name : "Pasted by you"} ·{" "}
                    {timeAgo(r.created_at)}
                  </span>
                  <p className="mt-0.5 whitespace-pre-wrap break-words">{r.text}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="glass-card mt-6 p-5" aria-labelledby="audit-h">
        <h2 id="audit-h" className="mb-5 font-semibold">
          Activity
        </h2>
        {data.events.length ? (
          <EventTimeline events={data.events} />
        ) : (
          <p className="text-sm text-muted-foreground">No events yet.</p>
        )}
      </section>

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent className="border-border bg-background text-foreground">
          {confirm === "cancel" ? (
            <AlertDialogHeader>
              <AlertDialogTitle>
                {q.status === "quoted" ? "Cancel this quote?" : "Cancel this booking?"}
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3 text-sm text-muted-foreground">
                  {q.status === "quoted" ? (
                    <p>
                      {q.client_name} will no longer be able to pay the deposit. No money has been
                      taken.
                    </p>
                  ) : (
                    <>
                      <fieldset>
                        <legend className="mb-1.5 font-medium text-foreground">Why?</legend>
                        <div className="grid gap-1.5 sm:grid-cols-3" role="radiogroup">
                          {(
                            [
                              ["client_cancel", "Client cancelled"],
                              ["no_show", "Client no-show"],
                              ["seller_cancel", "I'm cancelling"],
                            ] as const
                          ).map(([r, l]) => (
                            <button
                              key={r}
                              type="button"
                              role="radio"
                              aria-checked={reason === r}
                              onClick={() => setReason(r)}
                              className={`rounded-lg border px-2.5 py-2 text-left text-xs font-semibold ${reason === r ? "border-primary bg-primary text-primary-foreground" : "border-input hover:bg-muted"}`}
                            >
                              {l}
                            </button>
                          ))}
                        </div>
                      </fieldset>
                      <div className="glass-row p-3 text-foreground" aria-live="polite">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Rule that will fire: {preview.rule.replace(/_/g, " ")}
                        </p>
                        <p className="mt-1">{preview.explanation}</p>
                        <p className="mt-2 grid grid-cols-2 gap-2 text-xs tabular-nums">
                          <span>
                            You keep <b>{money(preview.keep_cents)}</b>
                          </span>
                          <span>
                            Client gets back <b>{money(preview.release_cents)}</b>
                          </span>
                        </p>
                      </div>
                      <p className="text-xs">{describeCancelPolicy(policy)}</p>
                    </>
                  )}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
          ) : (
            <AlertDialogHeader>
              <AlertDialogTitle>Mark delivered and send the final bill?</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2 text-sm text-muted-foreground">
                  {heldDeposit && (
                    <p>The held {money(heldDeposit.amount_cents)} deposit is captured first.</p>
                  )}
                  {bill.total_cents > 0 ? (
                    <>
                      <dl className="glass-row space-y-1 p-3 tabular-nums text-foreground">
                        {bill.lines
                          .filter((l) => l.amount_cents > 0)
                          .map((l) => (
                            <div key={l.label} className="flex justify-between">
                              <dt>{l.label}</dt>
                              <dd>{money(l.amount_cents)}</dd>
                            </div>
                          ))}
                        <div className="flex justify-between border-t border-border pt-1 font-semibold">
                          <dt>PayPal invoice to {q.client_email}</dt>
                          <dd>{money(bill.total_cents)}</dd>
                        </div>
                      </dl>
                      <p className="text-xs">
                        {tip > 0
                          ? "Tip was chosen by the client on their quote page."
                          : "No tip yet — the client can still add one on the PayPal invoice."}
                      </p>
                    </>
                  ) : (
                    <p>
                      The deposit covered the full price, so the booking will be closed as paid.
                    </p>
                  )}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel className="btn-glass">
              {confirm === "cancel" ? "Keep quote" : "Not yet"}
            </AlertDialogCancel>
            <AlertDialogAction
              className="btn-mint"
              onClick={() => (confirm === "cancel" ? cancel.mutate() : deliver.mutate())}
            >
              {confirm === "cancel"
                ? q.status === "quoted"
                  ? "Cancel quote"
                  : preview.action === "void"
                    ? "Void hold & cancel"
                    : preview.action === "refund_full"
                      ? "Refund & cancel"
                      : preview.action === "keep_full"
                        ? "Keep deposit & cancel"
                        : preview.action === "capture_full"
                          ? "Capture hold & cancel"
                          : "Apply policy & cancel"
                : bill.total_cents > 0
                  ? `Send ${money(bill.total_cents)} invoice`
                  : "Close booking"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
