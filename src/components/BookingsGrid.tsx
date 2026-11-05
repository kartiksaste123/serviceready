import type { Quote } from "@/lib/types";
import { money, timeAgo } from "@/lib/format";
import { Check, ChevronRight, Clock3, Minus } from "lucide-react";
import { SourceBadge, StatusBadge } from "./kit";

type PayState = "Paid" | "Waiting" | "Due" | "Not due" | "—";
const depositState = (q: Quote): PayState =>
  q.status === "quoted" ? "Waiting" : q.status === "cancelled" ? "—" : "Paid";
const balanceState = (q: Quote): PayState =>
  q.balance_cents === 0 && q.status !== "quoted" && q.status !== "cancelled"
    ? "Paid"
    : q.status === "paid"
      ? "Paid"
      : q.status === "balance_invoiced"
        ? "Due"
        : q.status === "cancelled"
          ? "—"
          : "Not due";

function PayCell({ state, cents }: { state: PayState; cents: number }) {
  const Icon = state === "Paid" ? Check : state === "—" ? Minus : Clock3;
  const tone =
    state === "Paid" ? "text-success" : state === "Due" ? "text-warning" : "text-muted-foreground";
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      <Icon className={`size-3.5 ${tone}`} aria-hidden="true" />
      <span className="tabular-nums">{money(cents)}</span>
      <span className={`text-xs ${tone}`}>{state === "—" ? "n/a" : state.toLowerCase()}</span>
    </span>
  );
}

export function BookingsGrid({ rows, onOpen }: { rows: Quote[]; onOpen: (id: string) => void }) {
  return (
    <>
      {/* Mobile: stacked cards */}
      <ul className="divide-y divide-border md:hidden">
        {rows.map((q) => (
          <li key={q.id}>
            <button
              type="button"
              onClick={() => onOpen(q.id)}
              className="flex w-full items-start gap-3 px-4 py-4 text-left transition hover:bg-muted"
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate font-semibold">{q.client_name}</span>
                  <span className="font-semibold tabular-nums">{money(q.total_cents)}</span>
                </span>
                <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                  {q.service_title}
                </span>
                <span className="mt-2 flex flex-wrap items-center gap-2">
                  <StatusBadge status={q.status} />
                  <span className="text-xs text-muted-foreground">{timeAgo(q.updated_at)}</span>
                </span>
              </span>
              <ChevronRight
                className="mt-1 size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            </button>
          </li>
        ))}
      </ul>
      {/* Desktop: dense table */}
      <div className="hidden max-h-[620px] overflow-auto md:block">
        <table className="w-full min-w-[960px] border-collapse text-sm">
          <caption className="sr-only">Bookings</caption>
          <thead className="sticky top-0 z-10 bg-muted text-left text-xs text-muted-foreground">
            <tr>
              {[
                "Client",
                "Service",
                "Booked through",
                "Total",
                "Deposit",
                "Balance",
                "Status",
                "Updated",
              ].map((h, i) => (
                <th
                  key={h}
                  scope="col"
                  className={`border-b border-border px-4 py-3 font-semibold ${i === 3 ? "text-right" : ""}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((q) => (
              <tr
                key={q.id}
                tabIndex={0}
                aria-label={`Open booking for ${q.client_name}`}
                onClick={() => onOpen(q.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpen(q.id);
                  }
                }}
                className="cursor-pointer border-b border-border transition last:border-b-0 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
              >
                <td className="px-4 py-3">
                  <div className="font-medium">{q.client_name}</div>
                  <div className="text-xs text-muted-foreground">{q.client_email}</div>
                </td>
                <td className="px-4 py-3">{q.service_title}</td>
                <td className="px-4 py-3">
                  <SourceBadge source={q.source} />
                </td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums">
                  {money(q.total_cents)}
                </td>
                <td className="px-4 py-3">
                  <PayCell state={depositState(q)} cents={q.deposit_cents} />
                </td>
                <td className="px-4 py-3">
                  <PayCell state={balanceState(q)} cents={q.balance_cents} />
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={q.status} />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                  <time dateTime={q.updated_at}>{timeAgo(q.updated_at)}</time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
