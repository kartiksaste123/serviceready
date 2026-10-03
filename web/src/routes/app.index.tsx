import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { api } from "@/lib/api";
import type { QuoteStatus } from "@/lib/types";
import { BookingsGrid } from "@/components/BookingsGrid";
import { Empty, PageHeader, statusLabel } from "@/components/kit";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/app/")({
  head: () => ({ meta: [{ title: "Bookings — ServiceReady" }, { name: "description", content: "All quotes and bookings." }, { property: "og:title", content: "Bookings — ServiceReady" }, { property: "og:description", content: "All quotes and bookings." }] }),
  component: Bookings,
});

const PAGE = 10;

function Bookings() {
  const nav = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ["quotes"], queryFn: api.listQuotes });
  const [q, setQ] = useState("");
  const [st, setSt] = useState<QuoteStatus | "all">("all");
  const [page, setPage] = useState(0);
  const rows = useMemo(() => (data ?? []).filter((x) => (st === "all" || x.status === st) && `${x.client_name} ${x.service_title}`.toLowerCase().includes(q.toLowerCase())), [data, q, st]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const cur = Math.min(page, pages - 1);

  return (
    <>
      <PageHeader title="Bookings" sub="Every quote, deposit and balance in one place." />
      <div className="glass-card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-cream/10 bg-deep-950/40 p-3">
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs"><Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-cream/45" /><input className="field h-9 pl-8" placeholder="Filter bookings…" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} /></div>
          <div className="flex flex-wrap gap-1">
            {(["all", "quoted", "deposit_paid", "balance_invoiced", "paid"] as const).map((s) => (
              <button key={s} onClick={() => { setSt(s); setPage(0); }} className={`rounded-lg border border-dashed px-2.5 py-1.5 text-[12px] ${st === s ? "border-mint/50 bg-mint/[0.12] text-mint" : "border-cream/15 text-cream/65 hover:text-cream"}`}>{s === "all" ? "All" : statusLabel[s]}</button>
            ))}
          </div>
        </div>
        {isLoading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-11" />)}</div>
        ) : rows.length === 0 ? (
          <div className="p-6"><Empty title="No bookings match">Try a different filter, or share your storefront to get the first one.</Empty></div>
        ) : (
          <BookingsGrid rows={rows.slice(cur * PAGE, cur * PAGE + PAGE)} onOpen={(id) => nav({ to: "/app/quotes/$id", params: { id } })} />
        )}
        <div className="flex items-center justify-between border-t border-cream/10 bg-deep-950/40 px-4 py-2.5 text-[12.5px] text-cream/55">
          <span className="tabular-nums">{rows.length} booking{rows.length === 1 ? "" : "s"}</span>
          <div className="flex items-center gap-3">
            <span className="tabular-nums">Page {cur + 1} of {pages}</span>
            <button className="btn-glass btn-sm" disabled={cur === 0} onClick={() => setPage(cur - 1)}>Prev</button>
            <button className="btn-glass btn-sm" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Next</button>
          </div>
        </div>
      </div>
    </>
  );
}
