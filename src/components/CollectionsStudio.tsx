import { Link } from "@tanstack/react-router";
import { AlertTriangle, ChevronRight, Clock3, PartyPopper } from "lucide-react";
import type { Stats } from "@/lib/types";
import { money } from "@/lib/format";
import { Empty } from "./kit";

const OVERDUE_DAYS = 7;

export function CollectionsStudio({ stats }: { stats: Stats }) {
  const rows = stats.owed_by_client;
  if (!rows.length)
    return (
      <Empty title="Everyone has paid" icon={<PartyPopper className="size-5" aria-hidden="true" />}>
        There are no open balances. New balance invoices appear here as soon as you mark work
        delivered.
      </Empty>
    );
  const overdue = rows.filter((r) => r.days_since_invoice > OVERDUE_DAYS);
  const overdueCents = overdue.reduce((s, r) => s + r.outstanding_cents, 0);
  return (
    <div className="space-y-5">
      <div className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
        <div className="bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Open balances</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">
            {money(stats.outstanding_cents)}
          </p>
        </div>
        <div className="bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Clients waiting to pay</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{rows.length}</p>
        </div>
        <div className="bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Over {OVERDUE_DAYS} days old</p>
          <p
            className={`mt-1 text-xl font-semibold tabular-nums ${overdue.length ? "text-danger" : ""}`}
          >
            {money(overdueCents)}{" "}
            <span className="text-sm font-medium text-muted-foreground">· {overdue.length}</span>
          </p>
        </div>
      </div>
      <div className="glass-card w-full overflow-hidden">
        <div className="flex items-baseline justify-between border-b border-border p-5">
          <h2 className="font-semibold">Oldest first</h2>
          <span className="text-sm text-muted-foreground">
            Open a client to check PayPal and draft a follow-up
          </span>
        </div>
        <ol className="divide-y divide-border">
          {rows.map((r) => {
            const late = r.days_since_invoice > OVERDUE_DAYS;
            return (
              <li key={r.quote_id}>
                <Link
                  to="/app/quotes/$id"
                  params={{ id: r.quote_id }}
                  className="flex items-center gap-4 p-5 no-underline transition hover:bg-muted"
                >
                  <span
                    className={`grid size-9 shrink-0 place-items-center rounded-full ${late ? "bg-danger-bg text-danger" : "bg-warning-bg text-warning"}`}
                  >
                    {late ? (
                      <AlertTriangle className="size-4" aria-hidden="true" />
                    ) : (
                      <Clock3 className="size-4" aria-hidden="true" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between gap-4">
                      <span className="truncate font-semibold">{r.client_name}</span>
                      <span className="font-bold tabular-nums">{money(r.outstanding_cents)}</span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {r.days_since_invoice === 0
                        ? "Invoice sent today"
                        : `Invoice sent ${r.days_since_invoice} day${r.days_since_invoice === 1 ? "" : "s"} ago`}{" "}
                      ·{" "}
                      <span className={late ? "font-medium text-danger" : ""}>
                        {late ? "Overdue — needs attention" : "Waiting for payment"}
                      </span>
                    </p>
                  </div>
                  <ChevronRight
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
