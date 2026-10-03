import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Clock, Upload } from "lucide-react";
import { api } from "@/lib/api";
import { money0 } from "@/lib/format";
import { Empty, PageHeader } from "@/components/kit";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/app/catalog")({
  head: () => ({ meta: [{ title: "Catalog — ServiceReady" }, { name: "description", content: "Your published, agent-ready services." }, { property: "og:title", content: "Catalog — ServiceReady" }, { property: "og:description", content: "Published services." }] }),
  component: Catalog,
});

function Catalog() {
  const { data, isLoading } = useQuery({ queryKey: ["services"], queryFn: api.listServices });
  return (
    <>
      <PageHeader title="Catalog" sub="What AI agents and clients can book.">
        <Link to="/s/$slug" params={{ slug: "maya-rao-studio" }} className="btn-glass btn-sm">View storefront</Link>
        <Link to="/onboard" className="btn-mint btn-sm"><Upload className="size-3.5" />Import rate card</Link>
      </PageHeader>
      {isLoading ? <div className="grid gap-4 sm:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}</div>
        : !data?.length ? <Empty title="No services yet"><Link to="/onboard" className="text-mint">Import your rate card</Link> to get started.</Empty>
        : (
          <div className="grid gap-4 sm:grid-cols-2">
            {data.map((s) => (
              <div key={s.id} className="glass-card p-5">
                <div className="flex justify-between gap-3"><h2 className="font-semibold">{s.title}</h2><span className="font-bold tabular-nums">{money0(s.price_cents)}</span></div>
                <p className="mt-1 text-sm text-cream/60">{s.description}</p>
                <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
                  <span className="rounded-md bg-mint/15 px-2 py-0.5 text-mint">{s.deposit_pct}% deposit</span>
                  <span className="flex items-center gap-1 rounded-md bg-cream/[0.06] px-2 py-0.5"><Clock className="size-3" />{s.lead_time_days}d</span>
                  <span className="rounded-md bg-cream/[0.06] px-2 py-0.5 capitalize">{s.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}
    </>
  );
}
