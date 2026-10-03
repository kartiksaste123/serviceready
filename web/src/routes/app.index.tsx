import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Clock3, Search, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import type { QuoteStatus } from "@/lib/types";
import { BookingsGrid } from "@/components/BookingsGrid";
import { Empty, PageHeader, statusLabel } from "@/components/kit";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/app/")({
  head: () => ({
    meta: [
      { title: "Bookings — ServiceReady" },
      { name: "description", content: "All quotes and bookings." },
      { property: "og:title", content: "Bookings — ServiceReady" },
      { property: "og:description", content: "All quotes and bookings." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Bookings,
});

const PAGE = 10;

function Bookings() {
  const nav = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ["quotes"], queryFn: api.listQuotes });
  const [q, setQ] = useState("");
  const [st, setSt] = useState<QuoteStatus | "all">("all");
  const [page, setPage] = useState(0);
  const rows = useMemo(
    () =>
      (data ?? []).filter(
        (x) =>
          (st === "all" || x.status === st) &&
          `${x.client_name} ${x.service_title}`.toLowerCase().includes(q.toLowerCase()),
      ),
    [data, q, st],
  );
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const cur = Math.min(page, pages - 1);

  return (
    <>
      <PageHeader title="Bookings" sub="Track each client from quote to final payment." />
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold">What needs you today</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <Link
            to="/app/approvals"
            className="glass-card flex items-start gap-3 p-4 transition hover:bg-muted"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-danger-bg text-danger">
              <AlertTriangle className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">Review pending messages</span>
              <span className="mt-1 block text-sm text-muted-foreground">
                Nothing is sent until you approve it.
              </span>
            </span>
            <ArrowRight className="mt-1 size-4" />
          </Link>
          <Link
            to="/app/collections"
            className="glass-card flex items-start gap-3 p-4 transition hover:bg-muted"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-warning-bg text-warning">
              <Clock3 className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">Check open balances</span>
              <span className="mt-1 block text-sm text-muted-foreground">
                See who is due and what PayPal reports.
              </span>
            </span>
            <ArrowRight className="mt-1 size-4" />
          </Link>
          <Link
            to="/app/connect"
            className="glass-card flex items-start gap-3 p-4 transition hover:bg-muted"
          >
            <span className="icon-tile">
              <ShieldCheck className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">Share with an AI assistant</span>
              <span className="mt-1 block text-sm text-muted-foreground">
                Use your connection details with Claude or ChatGPT.
              </span>
            </span>
            <ArrowRight className="mt-1 size-4" />
          </Link>
        </div>
      </section>
      <div className="glass-card overflow-hidden">
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-muted p-3">
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              className="field h-9 pl-8"
              placeholder="Filter bookings…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(0);
              }}
            />
          </div>
          <div className="flex w-full min-w-0 gap-1 overflow-x-auto pb-1 sm:w-auto sm:flex-wrap sm:overflow-visible">
            {(["all", "quoted", "deposit_paid", "balance_invoiced", "paid"] as const).map((s) => (
              <button
                key={s}
                onClick={() => {
                  setSt(s);
                  setPage(0);
                }}
                className={`shrink-0 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-sm ${st === s ? "border-foreground bg-primary text-primary-foreground" : "border-input bg-background text-muted-foreground hover:text-foreground"}`}
              >
                {s === "all" ? "All" : statusLabel[s]}
              </button>
            ))}
          </div>
        </div>
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-11" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6">
            <Empty title="No bookings match">
              Try a different filter, or share your storefront to get the first one.
            </Empty>
          </div>
        ) : (
          <BookingsGrid
            rows={rows.slice(cur * PAGE, cur * PAGE + PAGE)}
            onOpen={(id) => nav({ to: "/app/quotes/$id", params: { id } })}
          />
        )}
        <div className="flex items-center justify-between border-t border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
          <span className="tabular-nums">
            {rows.length} booking{rows.length === 1 ? "" : "s"}
          </span>
          <div className="flex items-center gap-3">
            <span className="tabular-nums">
              Page {cur + 1} of {pages}
            </span>
            <button
              className="btn-glass btn-sm"
              disabled={cur === 0}
              onClick={() => setPage(cur - 1)}
            >
              Prev
            </button>
            <button
              className="btn-glass btn-sm"
              disabled={cur >= pages - 1}
              onClick={() => setPage(cur + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
