import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  CheckCircle2,
  CircleDollarSign,
  ExternalLink,
  Loader2,
  LockKeyhole,
  Send,
  ShieldCheck,
} from "lucide-react";
import { api, USE_MOCKS } from "@/lib/api";
import type { QuoteDetail } from "@/lib/types";
import { fmtDate, money } from "@/lib/format";
import { LIMITS } from "@/lib/validation";
import { Empty, ErrorState, StatusBadge, Wordmark } from "@/components/kit";
import { PayPalDepositButton } from "@/components/PayPalDepositButton";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusTracker } from "@/components/StatusTracker";
import { toast } from "sonner";

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
      { name: "robots", content: "noindex" },
    ],
  }),
  component: QuotePage,
});

function QuotePage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["quote", id],
    queryFn: () => api.getQuote(id),
    retry: false,
    meta: { silent: true },
  });
  const [msg, setMsg] = useState("");
  const [sent, setSent] = useState(false);
  useEffect(() => {
    setMsg("");
    setSent(false);
  }, [id]);
  const invalidate = () =>
    ["quote", "quotes", "stats", "events", "proposals"].forEach((k) =>
      qc.invalidateQueries({ queryKey: [k] }),
    );
  const reply = useMutation({
    mutationFn: () => api.postReply(id, msg, "client"),
    onSuccess: () => {
      setSent(true);
      setMsg("");
      invalidate();
    },
  });
  const payBalance = useMutation({
    mutationFn: () => api.simulateBalancePaid(id),
    onSuccess: (d: QuoteDetail) => {
      qc.setQueryData(["quote", id], d);
      invalidate();
      toast.success("Balance paid — thank you!");
    },
  });
  // Buyers who approved via a PayPal link from an AI agent (MCP create_deposit_link) land here
  // with ?paypal=return&token=<orderId>; capture server-side so the booking confirms.
  const [returnCapture, setReturnCapture] = useState<"idle" | "capturing" | "done" | "error">(
    "idle",
  );
  useEffect(() => {
    if (USE_MOCKS || typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const token = sp.get("token");
    if (sp.get("paypal") !== "return" || !token) return;
    setReturnCapture("capturing");
    api
      .captureDeposit(id, token)
      .then(() => {
        setReturnCapture("done");
        toast.success("Deposit paid with PayPal — your booking is confirmed");
        invalidate();
      })
      .catch((e: unknown) => {
        setReturnCapture("error");
        toast.error(e instanceof Error ? e.message : "Could not confirm the PayPal payment");
      })
      .finally(() => window.history.replaceState(null, "", window.location.pathname));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const notFound = isError && error instanceof Error && /not found/i.test(error.message);

  return (
    <div className="min-h-screen bg-muted">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-between px-5">
          <Link to="/" aria-label="ServiceReady home">
            <Wordmark />
          </Link>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <LockKeyhole className="size-3" aria-hidden="true" />
            Secure quote
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-5 pb-14 pt-8">
        {returnCapture === "capturing" && (
          <p
            role="status"
            className="mb-4 flex items-center gap-2 rounded-lg bg-background px-4 py-3 text-sm"
          >
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Confirming your PayPal payment…
          </p>
        )}
        {isLoading ? (
          <Skeleton className="h-[560px] rounded-2xl" />
        ) : notFound ? (
          <Empty title="Quote not found">
            This link may be outdated or mistyped. Ask the seller to send it again.
          </Empty>
        ) : isError || !data ? (
          <ErrorState title="Couldn't load your quote" onRetry={() => refetch()} />
        ) : (
          (() => {
            const q = data.quote;
            const bal = data.payments.find((p) => p.kind === "balance");
            const dep = data.payments.find((p) => p.kind === "deposit" && p.status === "COMPLETED");
            return (
              <>
                <article className="glass-card overflow-hidden">
                  <div className="border-b border-dashed border-border p-6 sm:p-8">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-muted-foreground">
                          Quote from Maya Rao Studio
                        </p>
                        <h1 className="mt-2 text-2xl font-bold tracking-tight">
                          {q.service_title}
                        </h1>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Prepared for {q.client_name} · {fmtDate(q.created_at)}
                        </p>
                      </div>
                      <StatusBadge status={q.status} />
                    </div>
                    <p className="mt-5 text-[15px] leading-relaxed text-muted-foreground">
                      {q.scope_summary}
                    </p>
                    {q.brief && (
                      <p className="mt-3 rounded-lg bg-muted p-3 text-sm">
                        <span className="font-medium">Your brief:</span> {q.brief}
                      </p>
                    )}
                  </div>
                  <dl className="space-y-2 p-6 text-sm tabular-nums sm:px-8">
                    {q.line_items.map((li) => (
                      <div key={li.label} className="flex justify-between">
                        <dt className="text-muted-foreground">{li.label}</dt>
                        <dd>{money(li.amount_cents)}</dd>
                      </div>
                    ))}
                    <div className="my-3 border-t border-border" />
                    <div className="flex justify-between font-semibold">
                      <dt>Total</dt>
                      <dd>{money(q.total_cents)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>{dep ? "Deposit paid" : "Deposit due now"}</dt>
                      <dd className="font-bold">{money(q.deposit_cents)}</dd>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <dt>{q.status === "paid" ? "Balance paid" : "Balance on delivery"}</dt>
                      <dd>{money(q.balance_cents)}</dd>
                    </div>
                  </dl>
                  <div className="border-t border-border p-6 sm:px-8">
                    <h2 className="mb-5 font-semibold">Booking progress</h2>
                    <StatusTracker status={q.status} />
                  </div>
                  <div className="border-t border-border p-6 sm:px-8">
                    {q.status === "quoted" && (
                      <>
                        <div className="rounded-lg border border-border bg-muted p-4">
                          <p className="mb-3 text-sm">
                            <span className="font-semibold">Secure PayPal checkout</span>
                            <br />
                            <span className="text-muted-foreground">
                              Pay {money(q.deposit_cents)} to confirm this booking. The remaining{" "}
                              {money(q.balance_cents)} is invoiced when the work is delivered.
                            </span>
                          </p>
                          <PayPalDepositButton
                            quoteId={q.id}
                            onPaid={(nq) => {
                              qc.setQueryData<QuoteDetail>(["quote", id], (old) =>
                                old ? { ...old, quote: nq } : old,
                              );
                              invalidate();
                            }}
                          />
                        </div>
                        <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                          <ShieldCheck className="size-3.5" aria-hidden="true" />
                          {USE_MOCKS
                            ? "Demo payment in PayPal sandbox — no real charge"
                            : "Processed by PayPal. ServiceReady never sees your card details."}
                        </p>
                      </>
                    )}
                    {q.status === "balance_invoiced" &&
                      bal &&
                      (USE_MOCKS ? (
                        <button
                          type="button"
                          className="btn-mint w-full"
                          disabled={payBalance.isPending}
                          onClick={() => payBalance.mutate()}
                        >
                          {payBalance.isPending ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <CircleDollarSign className="size-4" aria-hidden="true" />
                          )}
                          Pay remaining {money(bal.amount_cents)} with PayPal (demo)
                        </button>
                      ) : (
                        bal.invoice_url && (
                          <a
                            href={bal.invoice_url}
                            target="_blank"
                            rel="noreferrer"
                            className="btn-mint w-full"
                          >
                            Pay remaining {money(bal.amount_cents)} with PayPal{" "}
                            <ExternalLink className="size-4" aria-hidden="true" />
                          </a>
                        )
                      ))}
                    {q.status === "deposit_paid" && (
                      <Notice>
                        Deposit received — Maya is working on it. You'll get the balance invoice on
                        delivery.
                      </Notice>
                    )}
                    {q.status === "delivered" && (
                      <Notice>Work delivered — your balance invoice is on its way.</Notice>
                    )}
                    {q.status === "paid" && <Notice>All paid. Thank you for your business!</Notice>}
                    {q.status === "cancelled" && (
                      <p className="text-center text-sm text-muted-foreground">
                        This quote was cancelled. Contact the seller if you'd like a new one.
                      </p>
                    )}
                  </div>
                </article>

                {q.status !== "cancelled" && (
                  <section className="glass-card mt-6 p-5" aria-labelledby="msg-h">
                    <h2 id="msg-h" className="font-semibold">
                      Message Maya
                    </h2>
                    {sent ? (
                      <p className="mt-3 flex items-center gap-2 text-sm" role="status">
                        <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
                        Message sent. Maya will get back to you by email.{" "}
                        <button type="button" className="text-link" onClick={() => setSent(false)}>
                          Send another
                        </button>
                      </p>
                    ) : (
                      <>
                        <label htmlFor="client-msg" className="sr-only">
                          Your message
                        </label>
                        <textarea
                          id="client-msg"
                          className="field mt-3"
                          rows={3}
                          maxLength={LIMITS.message}
                          placeholder="Questions about scope, timing or payment…"
                          value={msg}
                          onChange={(e) => setMsg(e.target.value)}
                        />
                        <button
                          type="button"
                          className="btn-mint btn-sm mt-3"
                          disabled={!msg.trim() || reply.isPending}
                          onClick={() => reply.mutate()}
                        >
                          {reply.isPending ? (
                            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                          ) : (
                            <Send className="size-3.5" aria-hidden="true" />
                          )}
                          Send
                        </button>
                      </>
                    )}
                  </section>
                )}
              </>
            );
          })()
        )}
        <p className="mt-8 text-center text-xs text-muted-foreground">
          Powered by ServiceReady · Payments by PayPal
        </p>
      </main>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center justify-center gap-2 text-center text-sm font-medium text-success">
      <CheckCircle2 className="size-4" aria-hidden="true" />
      {children}
    </p>
  );
}
