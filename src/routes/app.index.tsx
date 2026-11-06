import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  ExternalLink,
  PackageCheck,
  Search,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import type { QuoteStatus } from "@/lib/types";
import { money } from "@/lib/format";
import { BookingsGrid } from "@/components/BookingsGrid";
import { CopyButton, Empty, ErrorState, PageHeader } from "@/components/kit";
import { KPIs } from "@/components/KPIs";
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

const PAGE = 25;
type FilterKey = "all" | "quoted" | "active" | "balance_invoiced" | "paid" | "cancelled";
const FILTERS: Array<{ key: FilterKey; label: string; match: QuoteStatus[] | null }> = [
  { key: "all", label: "All", match: null },
  { key: "quoted", label: "Awaiting deposit", match: ["quoted"] },
  { key: "active", label: "In progress", match: ["deposit_paid", "delivered"] },
  { key: "balance_invoiced", label: "Balance due", match: ["balance_invoiced"] },
  { key: "paid", label: "Paid", match: ["paid"] },
  { key: "cancelled", label: "Cancelled", match: ["cancelled"] },
];

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
  const [st, setSt] = useState<FilterKey>("all");
  const [page, setPage] = useState(0);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: data?.length ?? 0 };
    for (const x of data ?? []) c[x.status] = (c[x.status] ?? 0) + 1;
    c["active"] = (c["deposit_paid"] ?? 0) + (c["delivered"] ?? 0);
    return c;
  }, [data]);
  const seller = useQuery({ queryKey: ["seller"], queryFn: api.getSeller });
  const slug = seller.data?.slug ?? "maya-rao-studio";
  const storeUrl =
    typeof window === "undefined" ? `/s/${slug}` : `${window.location.origin}/s/${slug}`;
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data ?? []).filter(
      (x) =>
        (FILTERS.find((f) => f.key === st)?.match?.includes(x.status) ?? true) &&
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
      <PageHeader
        title="Bookings"
        sub="Every client request in one place — from quote, to PayPal deposit, to final payment."
        tour="bookings"
      >
        <a href={`/s/${slug}`} target="_blank" rel="noreferrer" className="btn-glass btn-sm">
          <ExternalLink className="size-3.5" aria-hidden="true" />
          View storefront
        </a>
        <span data-tour="copy-link" className="inline-flex">
          <CopyButton
            text={storeUrl}
            label="Copy booking link"
            className="!border-primary !bg-primary !text-primary-foreground hover:!bg-primary-hover"
          />
        </span>
      </PageHeader>
      <div data-tour="kpis">
        <KPIs />
      </div>
      <section className="mb-8" aria-labelledby="today" data-tour="today">
        <h2 id="today" className="mb-3 text-base font-semibold">
          Needs you today
        </h2>
        {pendingCount === 0 && owed === 0 && toDeliver === 0 ? (
          <div className="glass-card flex items-center gap-3 p-4 text-sm">
            <CheckCircle2 className="size-5 text-success" aria-hidden="true" />
            <span>
              <span className="font-semibold">You’re all caught up.</span>{" "}
              <span className="text-muted-foreground">New requests will show up here.</span>
            </span>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            <TodayCard
              to="/app/approvals"
              icon={<AlertTriangle className="size-4" />}
              tone={pendingCount ? "danger" : "muted"}
              title={
                pendingCount
                  ? `${pendingCount} message${pendingCount === 1 ? "" : "s"} to approve`
                  : "No messages to approve"
              }
              text="Nothing is sent until you say yes."
            />
            <TodayCard
              to="/app/collections"
              icon={<Clock3 className="size-4" />}
              tone={owed ? "warning" : "muted"}
              title={
                owed
                  ? `${money(stats.data?.outstanding_cents ?? 0)} waiting to be paid`
                  : "No unpaid balances"
              }
              text={
                owed
                  ? `${owed} client${owed === 1 ? "" : "s"} with an open invoice.`
                  : "Every invoice is settled."
              }
            />
            <TodayCard
              onClick={() => {
                setSt(toDeliver ? "active" : "all");
                setPage(0);
                document.getElementById("all-bookings")?.scrollIntoView({ behavior: "smooth" });
              }}
              icon={<PackageCheck className="size-4" />}
              tone="muted"
              title={
                toDeliver
                  ? `${toDeliver} job${toDeliver === 1 ? "" : "s"} in progress`
                  : "No jobs in progress"
              }
              text="Finish the work, then send the final bill."
            />
          </div>
        )}
      </section>
      <div
        id="all-bookings"
        data-tour="all-bookings"
        className="glass-card scroll-mt-6 overflow-hidden"
      >
        <div className="flex flex-col gap-3 px-4 pt-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <h2 className="text-base font-semibold">All bookings</h2>
          <div className="relative w-full sm:w-64">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              type="text"
              aria-label="Search bookings"
              className="field h-9 pl-8 pr-8"
              placeholder="Search client or service"
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
        </div>
        <div
          className="mt-3 flex gap-5 overflow-x-auto border-b border-border px-4 sm:px-5"
          role="group"
          aria-label="Filter by status"
          data-tour="bookings-filters"
        >
          {FILTERS.map((f) => (
            <button
              type="button"
              key={f.key}
              aria-pressed={st === f.key}
              onClick={() => {
                setSt(f.key);
                setPage(0);
              }}
              className={`-mb-px flex min-h-10 shrink-0 items-center gap-1.5 border-b-2 py-2 text-sm font-medium transition ${st === f.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {f.label}
              <span
                className={`rounded-full px-1.5 py-0.5 text-xs tabular-nums ${st === f.key ? "bg-accent text-primary" : "bg-muted text-muted-foreground"}`}
              >
                {counts[f.key] ?? 0}
              </span>
            </button>
          ))}
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
            all={data ?? []}
            onOpen={(id) => nav({ to: "/app/quotes/$id", params: { id } })}
          />
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm text-muted-foreground sm:px-5">
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
  to?: "/app/approvals" | "/app/collections";
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
      <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </>
  );
  const cls =
    "glass-card flex items-start gap-3 p-4 text-left transition hover:border-input hover:shadow-sm";
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
