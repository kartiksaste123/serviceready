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
    <div className="max-h-[560px] overflow-auto">
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
  );
}
