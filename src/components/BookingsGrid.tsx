import { useEffect, useMemo, useState } from "react";
import type { Quote } from "@/lib/types";
import { money, timeAgo } from "@/lib/format";
import { riskForQuote, type CollectionsRisk } from "@/lib/risk";
import { RiskPill } from "./RiskPill";
import { Check, ChevronRight, Clock3, Minus } from "lucide-react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type ICellRendererParams,
} from "ag-grid-community";
import { SourceBadge, StatusBadge } from "./kit";

ModuleRegistry.registerModules([AllCommunityModule]);

/** AG Grid Community theme mapped onto ServiceReady's semantic tokens. */
const gridTheme = themeQuartz.withParams({
  fontFamily: "inherit",
  fontSize: 14,
  backgroundColor: "var(--background)",
  foregroundColor: "var(--foreground)",
  headerBackgroundColor: "var(--muted)",
  headerTextColor: "var(--muted-foreground)",
  headerFontWeight: 600,
  borderColor: "var(--border)",
  rowHoverColor: "var(--muted)",
  accentColor: "var(--primary)",
  wrapperBorderRadius: 0,
  wrapperBorder: false,
  rowHeight: 60,
  headerHeight: 40,
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

type Row = Quote & { risk: CollectionsRisk | null };

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
        flex: 1.4,
        minWidth: 170,
        cellRenderer: (p: ICellRendererParams<Row>) =>
          p.data ? (
            <div className="flex h-full flex-col justify-center leading-tight">
              <div className="font-medium">{p.data.client_name}</div>
              <div className="text-xs text-muted-foreground">{p.data.client_email}</div>
            </div>
          ) : null,
      },
      { headerName: "Service", field: "service_title", flex: 1.1, minWidth: 130 },
      {
        headerName: "Booked through",
        field: "source",
        width: 140,
        cellRenderer: (p: ICellRendererParams<Row>) =>
          p.data ? <SourceBadge source={p.data.source} /> : null,
      },
      {
        headerName: "Total",
        field: "total_cents",
        width: 110,
        type: "rightAligned",
        valueFormatter: (p) => money(Number(p.value ?? 0)),
        cellClass: "font-semibold tabular-nums",
      },
      {
        headerName: "Deposit",
        field: "deposit_cents",
        width: 140,
        cellRenderer: (p: ICellRendererParams<Row>) =>
          p.data ? <PayCell state={depositState(p.data)} cents={p.data.deposit_cents} /> : null,
      },
      {
        headerName: "Balance",
        field: "balance_cents",
        width: 140,
        cellRenderer: (p: ICellRendererParams<Row>) =>
          p.data ? <PayCell state={balanceState(p.data)} cents={p.data.balance_cents} /> : null,
      },
      {
        headerName: "Status",
        field: "status",
        width: 150,
        cellRenderer: (p: ICellRendererParams<Row>) =>
          p.data ? <StatusBadge status={p.data.status} /> : null,
      },
      {
        headerName: "Risk",
        colId: "risk",
        width: 110,
        valueGetter: (p) => p.data?.risk?.score ?? -1,
        cellRenderer: (p: ICellRendererParams<Row>) => <RiskPill risk={p.data?.risk} />,
        headerTooltip: "Collections risk: days overdue × amount × client pay history",
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
      <div className="hidden md:block" data-testid="bookings-ag-grid" aria-label="Bookings" role="region">
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
