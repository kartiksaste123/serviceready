import type { Quote } from "@/lib/types";
import { money, timeAgo } from "@/lib/format";
import { Check, Clock3, XCircle } from "lucide-react";
import { SourceBadge, StatusBadge } from "./kit";
const depositState = (q: Quote) =>
  q.status === "quoted" ? "Waiting" : q.status === "cancelled" ? "Not applicable" : "Paid";
const balanceState = (q: Quote) =>
  q.status === "paid"
    ? { label: "Paid", icon: Check, className: "text-success" }
    : q.status === "balance_invoiced"
      ? { label: "Due", icon: Clock3, className: "text-warning" }
      : q.status === "cancelled"
        ? { label: "Cancelled", icon: XCircle, className: "text-danger" }
        : { label: "Not due", icon: Clock3, className: "text-muted-foreground" };
export function BookingsGrid({ rows, onOpen }: { rows: Quote[]; onOpen: (id: string) => void }) {
  return (
    <div>
      <div className="max-h-[560px] space-y-3 overflow-auto p-3 md:hidden">
        {rows.map((q) => {
          const balance = balanceState(q);
          const BalanceIcon = balance.icon;
          const deposit = depositState(q);
          return (
            <button
              key={q.id}
              type="button"
              onClick={() => onOpen(q.id)}
              className="glass-card block w-full p-4 text-left transition hover:bg-muted"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{q.client_name}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{q.client_email}</p>
                </div>
                <StatusBadge status={q.status} />
              </div>
              <p className="mt-3 text-sm text-muted-foreground">{q.service_title}</p>
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3 text-sm">
                <span className="text-muted-foreground">Total</span>
                <span className="font-semibold tabular-nums">{money(q.total_cents)}</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  {deposit === "Paid" ? (
                    <Check className="size-3.5 text-success" />
                  ) : (
                    <Clock3 className="size-3.5" />
                  )}
                  Deposit {deposit} · {money(q.deposit_cents)}
                </span>
                <span className={`flex items-center gap-1.5 ${balance.className}`}>
                  <BalanceIcon className="size-3.5" />
                  Balance {balance.label}
                </span>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">Updated {timeAgo(q.updated_at)}</p>
            </button>
          );
        })}
      </div>
      <div className="hidden max-h-[560px] overflow-auto md:block">
        <table className="w-full min-w-[900px] border-collapse text-sm tabular-nums">
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
                className={`border-b border-border px-4 py-3 font-semibold ${i === 3 ? "text-right" : ""}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((q) => {
            const balance = balanceState(q);
            const BalanceIcon = balance.icon;
            return (
              <tr
                key={q.id}
                onClick={() => onOpen(q.id)}
                className="cursor-pointer border-b border-border transition hover:bg-muted"
              >
                <td className="px-4 py-3">
                  <div className="font-medium">{q.client_name}</div>
                  <div className="text-xs text-muted-foreground">{q.client_email}</div>
                </td>
                <td className="px-4 py-3">{q.service_title}</td>
                <td className="px-4 py-3">
                  <SourceBadge source={q.source} />
                </td>
                <td className="px-4 py-3 text-right font-semibold">{money(q.total_cents)}</td>
                <td className="px-4 py-3">
                  <span className="flex items-center gap-1.5">
                    {depositState(q) === "Paid" ? (
                      <Check className="size-3.5 text-success" />
                    ) : (
                      <Clock3 className="size-3.5 text-muted-foreground" />
                    )}
                    {depositState(q)} · {money(q.deposit_cents)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`flex items-center gap-1.5 ${balance.className}`}>
                    <BalanceIcon className="size-3.5" />
                    {balance.label}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={q.status} />
                </td>
                <td className="px-4 py-3 text-muted-foreground">{timeAgo(q.updated_at)}</td>
              </tr>
            );
          })}
        </tbody>
        </table>
      </div>
    </div>
  );
}
