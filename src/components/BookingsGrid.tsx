import { useEffect, useMemo, useState } from "react";
import type { Quote } from "@/lib/types";
import { money, timeAgo } from "@/lib/format";
import { riskForQuote, type CollectionsRisk } from "@/lib/risk";
import { RiskPill } from "./RiskPill";
import { ChevronRight } from "lucide-react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type ICellRendererParams,
} from "ag-grid-community";
import { StatusBadge } from "./kit";

ModuleRegistry.registerModules([AllCommunityModule]);

/** AG Grid Community theme mapped onto ServiceReady's semantic tokens. */
const gridTheme = themeQuartz.withParams({
  fontFamily: "inherit",
  fontSize: 14,
  backgroundColor: "var(--background)",
  foregroundColor: "var(--foreground)",
  headerBackgroundColor: "var(--background)",
  headerTextColor: "var(--muted-foreground)",
  headerFontWeight: 600,
  borderColor: "var(--border)",
  rowHoverColor: "var(--muted)",
  accentColor: "var(--primary)",
  wrapperBorderRadius: 0,
  wrapperBorder: false,
  rowHeight: 64,
  headerHeight: 40,
  headerFontSize: 12,
  cellHorizontalPadding: 16,
});

type PayState = "Paid" | "Held" | "Waiting" | "Due" | "Not due" | "—";
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

type Row = Quote & { risk: CollectionsRisk | null };

const sourceShort: Record<Quote["source"], string> = {
  web: "storefront",
  mcp: "AI assistant",
  webmcp: "browser assistant",
  agent_sim: "demo assistant",
};
const paidCents = (q: Quote) =>
  (depositState(q) === "Paid" ? q.deposit_cents : 0) +
  (balanceState(q) === "Paid" && q.status === "paid" ? q.balance_cents : 0);

function PaidCell({ q }: { q: Quote }) {
  if (q.status === "cancelled") return <span className="text-muted-foreground">—</span>;
  const paid = paidCents(q);
  const pct = q.total_cents ? Math.min(100, Math.round((paid / q.total_cents) * 100)) : 0;
  return (
    <span className="flex h-full flex-col justify-center gap-1.5 leading-none">
      <span className="text-sm tabular-nums">
        <span className="font-medium">{money(paid)}</span>
        <span className="text-muted-foreground"> of {money(q.total_cents)}</span>
      </span>
      <span
        className="h-1.5 w-full max-w-[120px] overflow-hidden rounded-full bg-muted"
        aria-hidden="true"
      >
        <span
          className={`block h-full rounded-full ${pct >= 100 ? "bg-success" : "bg-primary"}`}
          style={{ width: `${pct}%` }}
        />
      </span>
    </span>
  );
}

export function BookingsGrid({
  rows,
  onOpen,
  all,
}: {
  rows: Quote[];
  onOpen: (id: string) => void;
  /** Full booking list (for client pay history in the risk score). Defaults to `rows`. */
  all?: Quote[];
}) {
  const data: Row[] = useMemo(
    () => rows.map((q) => ({ ...q, risk: riskForQuote(q, all ?? rows) })),
    [rows, all],
  );
  // AG Grid is client-only; render the desktop grid after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const cols = useMemo<ColDef<Row>[]>(
    () => [
      {
        headerName: "Client",
        field: "client_name",
        flex: 1.3,
        minWidth: 180,
        cellRenderer: (p: ICellRendererParams<Row>) =>
          p.data ? (
            <div className="flex h-full flex-col justify-center leading-tight">
              <div className="truncate font-medium">{p.data.client_name}</div>
              <div className="truncate text-xs text-muted-foreground">{p.data.client_email}</div>
            </div>
          ) : null,
      },
      {
        headerName: "Service",
        field: "service_title",
        flex: 1.2,
        minWidth: 160,
        cellRenderer: (p: ICellRendererParams<Row>) =>
          p.data ? (
            <div className="flex h-full flex-col justify-center leading-tight">
              <div className="truncate">{p.data.service_title}</div>
              <div className="truncate text-xs text-muted-foreground">
                via {sourceShort[p.data.source]}
              </div>
            </div>
          ) : null,
      },
      {
        headerName: "Amount",
        field: "total_cents",
        width: 120,
        type: "rightAligned",
        valueFormatter: (p) => money(Number(p.value ?? 0)),
        cellClass: "font-semibold tabular-nums",
      },
      {
        headerName: "Paid so far",
        colId: "paid",
        width: 160,
        headerTooltip: "Deposit and balance, as PayPal reports them",
        valueGetter: (p) => (p.data ? paidCents(p.data) : 0),
        cellRenderer: (p: ICellRendererParams<Row>) => (p.data ? <PaidCell q={p.data} /> : null),
      },
      {
        headerName: "Status",
        field: "status",
        flex: 1,
        minWidth: 230,
        headerTooltip: "Risk badge = how likely the balance needs a nudge",
        cellRenderer: (p: ICellRendererParams<Row>) =>
          p.data ? (
            <span className="flex h-full items-center gap-1.5">
              <StatusBadge status={p.data.status} />
              {p.data.risk && <RiskPill risk={p.data.risk} />}
            </span>
          ) : null,
      },
      {
        headerName: "Updated",
        field: "updated_at",
        width: 110,
        sort: "desc",
        cellRenderer: (p: ICellRendererParams<Row>) =>
          p.data ? (
            <time dateTime={p.data.updated_at} className="text-muted-foreground">
              {timeAgo(p.data.updated_at)}
            </time>
          ) : null,
      },
    ],
    [],
  );

  return (
    <>
      {/* Mobile: stacked cards */}
      <ul className="divide-y divide-border md:hidden">
        {data.map((q) => (
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
                  {q.risk && <RiskPill risk={q.risk} />}
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
      {/* Desktop: AG Grid Community (sortable, resizable columns; row click opens the booking) */}
      <div
        className="hidden md:block"
        data-testid="bookings-ag-grid"
        aria-label="Bookings"
        role="region"
      >
        {mounted && (
          <AgGridReact<Row>
            theme={gridTheme}
            rowData={data}
            columnDefs={cols}
            getRowId={(p) => p.data.id}
            domLayout="autoHeight"
            defaultColDef={{ sortable: true, resizable: true, suppressMovable: true }}
            rowClass="cursor-pointer"
            onRowClicked={(e) => e.data && onOpen(e.data.id)}
            onCellKeyDown={(e) => {
              const k = (e.event as KeyboardEvent | null | undefined)?.key;
              if ((k === "Enter" || k === " ") && e.data) onOpen(e.data.id);
            }}
            suppressCellFocus={false}
            animateRows
          />
        )}
      </div>
    </>
  );
}
