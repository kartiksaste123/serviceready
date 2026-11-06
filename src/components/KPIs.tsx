import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";

/** Seller money snapshot (Bookings overview only). */
export function KPIs() {
  const { data, isLoading, isError } = useQuery({ queryKey: ["stats"], queryFn: api.getStats });
  if (isError) return null;
  const k = [
    { l: "Deposits received", v: data && money(data.deposits_collected_cents) },
    {
      l: "Still to collect",
      v: data && money(data.outstanding_cents),
      sub:
        data &&
        `${data.owed_by_client.length} open invoice${data.owed_by_client.length === 1 ? "" : "s"}`,
    },
    {
      l: "Fully paid",
      v: data && money(data.paid_cents),
      sub: data && `${data.by_status.paid} booking${data.by_status.paid === 1 ? "" : "s"}`,
    },
    {
      l: "Avg. time to pay balance",
      v: data && (data.avg_days_to_pay == null ? "—" : `${data.avg_days_to_pay} days`),
    },
  ];
  return (
    <section aria-label="Key numbers" className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {k.map((x) => (
        <div key={x.l} className="glass-card p-4 sm:p-5">
          <div className="text-xs font-medium text-muted-foreground">{x.l}</div>
          {isLoading || !x.v ? (
            <Skeleton className="mt-2 h-7 w-24" />
          ) : (
            <>
              <div className="mt-1 text-xl font-semibold tabular-nums sm:text-2xl">{x.v}</div>
              {x.sub && <div className="mt-0.5 text-xs text-muted-foreground">{x.sub}</div>}
            </>
          )}
        </div>
      ))}
    </section>
  );
}
