import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Clock3, PackageCheck, Search, Share2, X } from "lucide-react";
import { api } from "@/lib/api";
import type { QuoteStatus } from "@/lib/types";
import { money } from "@/lib/format";
import { BookingsGrid } from "@/components/BookingsGrid";
import { Empty, ErrorState, PageHeader } from "@/components/kit";
import { statusLabel } from "@/lib/labels";
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
const FILTERS = [
  "all",
  "quoted",
  "deposit_paid",
  "delivered",
  "balance_invoiced",
  "paid",
  "cancelled",
] as const;

function Bookings() {
  const nav = useNavigate();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["quotes"],
    queryFn: api.listQuotes,
  });
  const pending = useQuery({
    queryKey: ["proposals", "pending"],
    queryFn: () => api.listProposals("pending"),
  });
  const stats = useQuery({ queryKey: ["stats"], queryFn: api.getStats });
  const [q, setQ] = useState("");
  const [st, setSt] = useState<QuoteStatus | "all">("all");
  const [page, setPage] = useState(0);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: data?.length ?? 0 };
    for (const x of data ?? []) c[x.status] = (c[x.status] ?? 0) + 1;
    return c;
  }, [data]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data ?? []).filter(
      (x) =>
        (st === "all" || x.status === st) &&
        `${x.client_name} ${x.client_email} ${x.service_title}`.toLowerCase().includes(needle),
    );
  }, [data, q, st]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const cur = Math.min(page, pages - 1);
  const toDeliver = (counts["deposit_paid"] ?? 0) + (counts["delivered"] ?? 0);
  const pendingCount = pending.data?.length ?? 0;
  const owed = stats.data?.owed_by_client.length ?? 0;

  return (
    <>
      <PageHeader title="Bookings" sub="Track each client from quote to final payment." />
      <section className="mb-8" aria-labelledby="today">
        <h2 id="today" className="mb-3 text-sm font-semibold">
          What needs you today
        </h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <TodayCard
            to="/app/approvals"
            icon={<AlertTriangle className="size-4" />}
            tone="danger"
            title={
              pendingCount
                ? `${pendingCount} message${pendingCount === 1 ? "" : "s"} to review`
                : "No messages to review"
            }
            text="Nothing is sent until you approve it."
          />
          <TodayCard
            to="/app/collections"
            icon={<Clock3 className="size-4" />}
            tone="warning"
            title={
              owed
                ? `${owed} open balance${owed === 1 ? "" : "s"} · ${money(stats.data?.outstanding_cents ?? 0)}`
                : "No open balances"
            }
            text="See who is due and what PayPal reports."
          />
          <TodayCard
            onClick={() => {
              setSt(toDeliver ? (counts["delivered"] ? "delivered" : "deposit_paid") : "all");
              setPage(0);
            }}
            icon={<PackageCheck className="size-4" />}
            tone="muted"
            title={
              toDeliver
                ? `${toDeliver} booking${toDeliver === 1 ? "" : "s"} in progress`
                : "Nothing in progress"
            }
            text="Deliver the work, then send the balance invoice."
          />
          <TodayCard
            to="/app/connect"
            icon={<Share2 className="size-4" />}
            tone="muted"
            title="Share with an AI assistant"
            text="Use your connection details with Claude or ChatGPT."
          />
        </div>
      </section>
      <div className="glass-card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border bg-muted p-3 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1 lg:min-w-[200px] lg:max-w-xs">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              type="text"
              aria-label="Search bookings"
              className="field h-9 pl-8 pr-8"
              placeholder="Search bookings…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(0);
              }}
            />
            {q && (
              <button
                type="button"
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                onClick={() => setQ("")}
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <div
            className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:pb-0"
            role="group"
            aria-label="Filter by status"
          >
            {FILTERS.map((s) => (
              <button
                type="button"
                key={s}
                aria-pressed={st === s}
                onClick={() => {
                  setSt(s);
                  setPage(0);
                }}
                className={`flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-sm ${st === s ? "border-foreground bg-primary text-primary-foreground" : "border-input bg-background text-muted-foreground hover:text-foreground"}`}
              >
                {s === "all" ? "All" : statusLabel[s]}
                <span className={`tabular-nums text-xs ${st === s ? "opacity-80" : ""}`}>
                  {counts[s] ?? 0}
                </span>
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
        ) : isError ? (
          <div className="p-6">
            <ErrorState title="Couldn't load bookings" onRetry={() => refetch()} />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6">
            {data?.length ? (
              <Empty title="No bookings match">
                Try a different search or filter.{" "}
                <button
                  type="button"
                  className="text-link"
                  onClick={() => {
                    setQ("");
                    setSt("all");
                  }}
                >
                  Clear filters
                </button>
              </Empty>
            ) : (
              <Empty title="No bookings yet">
                Share your{" "}
                <Link to="/s/$slug" params={{ slug: "maya-rao-studio" }} className="text-link">
                  storefront
                </Link>{" "}
                or connect an AI assistant to get your first quote request.
              </Empty>
            )}
          </div>
        ) : (
          <BookingsGrid
            rows={rows.slice(cur * PAGE, cur * PAGE + PAGE)}
            onOpen={(id) => nav({ to: "/app/quotes/$id", params: { id } })}
          />
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
          <span className="tabular-nums">
            {rows.length
              ? `Showing ${cur * PAGE + 1}–${Math.min(rows.length, cur * PAGE + PAGE)} of ${rows.length}`
              : "0 bookings"}
          </span>
          {pages > 1 && (
            <nav aria-label="Pagination" className="flex items-center gap-3">
              <span className="tabular-nums">
                Page {cur + 1} of {pages}
              </span>
              <button
                type="button"
                className="btn-glass btn-sm"
                disabled={cur === 0}
                onClick={() => setPage(cur - 1)}
              >
                Prev
              </button>
              <button
                type="button"
                className="btn-glass btn-sm"
                disabled={cur >= pages - 1}
                onClick={() => setPage(cur + 1)}
              >
                Next
              </button>
            </nav>
          )}
        </div>
      </div>
    </>
  );
}

function TodayCard({
  to,
  onClick,
  icon,
  tone,
  title,
  text,
}: {
  to?: "/app/approvals" | "/app/collections" | "/app/connect";
  onClick?: () => void;
  icon: React.ReactNode;
  tone: "danger" | "warning" | "muted";
  title: string;
  text: string;
}) {
  const tile =
    tone === "danger"
      ? "bg-danger-bg text-danger"
      : tone === "warning"
        ? "bg-warning-bg text-warning"
        : "bg-muted text-foreground";
  const body = (
    <>
      <span
        className={`grid size-9 shrink-0 place-items-center rounded-lg ${tile}`}
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="mt-1 block text-sm text-muted-foreground">{text}</span>
      </span>
      <ArrowRight className="mt-1 size-4 shrink-0" aria-hidden="true" />
    </>
  );
  const cls = "glass-card flex items-start gap-3 p-4 text-left transition hover:bg-muted";
  return to ? (
    <Link to={to} className={cls}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cls}>
      {body}
    </button>
  );
}
