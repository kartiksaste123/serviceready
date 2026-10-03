import { useQuery } from "@tanstack/react-query";
import { AgStudio, createWidgets } from "ag-studio-react";
import {
  AgStudioAiModule,
  AgStudioLicenseManager,
  createAiHarness,
  directLlmRunner,
  enableStudioDevValidations,
  studioTheme,
} from "ag-studio";
import type {
  AgAiHarnessSetupParams,
  AgDefaultRegistry,
  AgExternalShape,
  AgFieldDefinition,
  AgReportState,
  AgWidgetData,
  AgWidgetDataFormat,
  AgWidgetParams,
} from "ag-studio";
import { PartyPopper } from "lucide-react";
import { useMemo } from "react";
import { api } from "@/lib/api";
import type { Stats } from "@/lib/types";
import { money } from "@/lib/format";
import { getStudioAiAdapter, getStudioNudgeTools } from "@/lib/studio-ai";
import { sourceLabel, statusLabel } from "@/components/kit";

if (import.meta.env.DEV) enableStudioDevValidations();

type FriendlyScoreboardFormat = AgWidgetDataFormat<Record<string, never>>;
interface FriendlyScoreboardState extends AgWidgetData<
  Record<string, never>,
  FriendlyScoreboardFormat
> {
  type: "friendly-scoreboard";
}
type FriendlyScoreboardDefinition = import("ag-studio-react").AgWidgetDefinition<
  "friendly-scoreboard",
  FriendlyScoreboardState
>;
type CollectionsRegistry = Omit<import("ag-studio-react").AgRegistry, "widgets"> & {
  widgets: readonly (AgDefaultRegistry["widgets"][number] | FriendlyScoreboardDefinition)[];
};

interface BookingRow {
  quote_id: string;
  client_name: string;
  service_title: string;
  source: string;
  status: string;
  status_label: string;
  total_usd: number;
  deposit_usd: number;
  balance_usd: number;
  created_at: string;
}

interface OwedRow {
  client_name: string;
  quote_id: string;
  outstanding_usd: number;
  days_since_invoice: number;
}

interface FriendlyScoreboardContext {
  bookings: BookingRow[];
  owed: OwedRow[];
}

function FriendlyScoreboard({ context }: AgWidgetParams<FriendlyScoreboardState>) {
  const data = context as FriendlyScoreboardContext | undefined;
  const bookingById = new Map((data?.bookings ?? []).map((booking) => [booking.quote_id, booking]));
  const clients = new Map<
    string,
    {
      quote_id: string;
      outstanding_usd: number;
      total_usd: number;
      days_since_invoice: number;
    }
  >();

  for (const row of data?.owed ?? []) {
    const booking = bookingById.get(row.quote_id);
    const current = clients.get(row.client_name) ?? {
      quote_id: row.quote_id,
      outstanding_usd: 0,
      total_usd: 0,
      days_since_invoice: 0,
    };
    current.outstanding_usd += row.outstanding_usd;
    current.total_usd += booking?.total_usd ?? row.outstanding_usd;
    current.days_since_invoice = Math.max(current.days_since_invoice, row.days_since_invoice);
    clients.set(row.client_name, current);
  }

  const rows = [...clients.entries()].sort(
    ([, first], [, second]) => first.outstanding_usd - second.outstanding_usd,
  );
  if (!rows.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 rounded-xl bg-success-bg p-5 text-center text-foreground">
        <PartyPopper className="size-7 text-success" aria-hidden="true" />
        <p className="font-semibold text-success">All square ✓</p>
        <p className="text-sm text-muted-foreground">No open balances. Nice work.</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto rounded-xl bg-background p-4 text-foreground sm:p-5">
      <ol className="space-y-3">
        {rows.map(([clientName, row]) => {
          const paid = Math.max(0, row.total_usd - row.outstanding_usd);
          const progress = row.total_usd > 0 ? Math.min(100, (paid / row.total_usd) * 100) : 0;
          const invoiceAge =
            row.days_since_invoice === 0
              ? "invoiced today"
              : `invoiced ${row.days_since_invoice} day${row.days_since_invoice === 1 ? "" : "s"} ago`;

          return (
            <li key={clientName}>
              <a
                href={`/app/quotes/${encodeURIComponent(row.quote_id)}`}
                className="block rounded-lg border border-border bg-background p-3 transition hover:bg-muted"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-medium">{clientName}</span>
                  <span className="shrink-0 font-semibold tabular-nums">
                    {money(Math.round(row.outstanding_usd * 100))} to go
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{invoiceAge}</p>
                <div
                  className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
                  aria-label={`${Math.round(progress)}% paid`}
                >
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="mt-1.5 text-[11px] tabular-nums text-muted-foreground">
                  {money(Math.round(paid * 100))} of {money(Math.round(row.total_usd * 100))} paid
                </p>
              </a>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const scoreboardWidget: FriendlyScoreboardDefinition = {
  id: "friendly-scoreboard",
  label: "Friendly scoreboard",
  comp: FriendlyScoreboard,
  form: ({ createDefaults }) => createDefaults({}),
  formatShape: ({ api: studioApi }) =>
    studioApi.defineAiCommand((shape) => ({
      input: shape.object({}),
      execute: () => ({ success: true, value: {} }),
    })).shape as AgExternalShape<FriendlyScoreboardFormat>,
  ai: {
    label: "Friendly scoreboard",
    description:
      "A friendly one-row-per-client view of open balances with a paid-versus-total progress bar.",
    usage:
      "Use for a concise, supportive overview of clients with open invoices. Show the all-square state when there are no open balances.",
    configuration: "Uses the open balances and booking totals supplied in the Studio context.",
  },
  defaultSize: { width: 14, height: 12 },
  minSize: { width: 6, height: 6 },
};

const studioWidgets = createWidgets<CollectionsRegistry>({
  additionalTypes: [scoreboardWidget],
  menu: [
    { label: "ServiceReady", widgetIds: ["friendly-scoreboard"] },
    { label: "Collections", widgetIds: ["value", "column-chart-grouped", "grid"] },
  ],
});

const initialState: AgReportState<CollectionsRegistry> = {
  pages: [
    {
      id: "collections",
      layout: { height: 920, columns: 24, rowHeight: 36, pagePadding: 12 },
      widgets: {
        scoreboard: { type: "friendly-scoreboard", dataMapping: {}, format: {} },
        deposits: {
          type: "value",
          dataMapping: { value: [{ id: "metrics.deposits_collected_usd", aggregation: "sum" }] },
          format: {
            title: {
              text: "Deposits in",
              enabled: true,
              color: "var(--foreground)",
              typography: { fontFamily: "Inter, sans-serif", fontSize: 14, fontWeight: "normal" },
            },
          },
        },
        outstanding: {
          type: "value",
          dataMapping: { value: [{ id: "metrics.outstanding_usd", aggregation: "sum" }] },
          format: {
            title: {
              text: "Still owed",
              enabled: true,
              color: "var(--foreground)",
              typography: { fontFamily: "Inter, sans-serif", fontSize: 14, fontWeight: "normal" },
            },
          },
        },
        status: {
          type: "column-chart-grouped",
          dataMapping: {
            categoryKey: [{ id: "bookings.status_label" }],
            valueKey: [{ id: "bookings.quote_id", aggregation: "count" }],
          },
          format: { title: { text: "Bookings by status", enabled: true } },
        },
        bookings: {
          type: "grid",
          dataMapping: {
            cols: [
              { id: "bookings.client_name" },
              { id: "bookings.service_title" },
              { id: "bookings.source" },
              { id: "bookings.status_label" },
              { id: "bookings.total_usd" },
              { id: "bookings.deposit_usd" },
              { id: "bookings.balance_usd" },
              { id: "bookings.created_at" },
            ],
          },
          format: { title: { text: "Bookings", enabled: true } },
        },
      },
      widgetLayout: {
        scoreboard: { xTrack: 0, yTrack: 0, xSpan: 12, ySpan: 4 },
        deposits: { xTrack: 12, yTrack: 0, xSpan: 6, ySpan: 4 },
        outstanding: { xTrack: 18, yTrack: 0, xSpan: 6, ySpan: 4 },
        status: { xTrack: 0, yTrack: 4, xSpan: 24, ySpan: 6 },
        bookings: { xTrack: 0, yTrack: 10, xSpan: 24, ySpan: 14 },
      },
    },
  ],
  selectedPageId: "collections",
};

const currencyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

const bookingsFields: AgFieldDefinition<CollectionsRegistry>[] = [
  { id: "quote_id", name: "Quote ID", format: "textFormat" },
  { id: "client_name", name: "Client", format: "textFormat" },
  { id: "service_title", name: "Service", format: "textFormat" },
  { id: "source", name: "Booked through", format: "textFormat" },
  { id: "status", name: "Status code", format: "textFormat" },
  { id: "status_label", name: "Status", format: "textFormat" },
  {
    id: "total_usd",
    name: "Total",
    format: "currencyFormat",
    formatOptions: { format: currencyFormatter },
  },
  {
    id: "deposit_usd",
    name: "Deposit",
    format: "currencyFormat",
    formatOptions: { format: currencyFormatter },
  },
  {
    id: "balance_usd",
    name: "Balance",
    format: "currencyFormat",
    formatOptions: { format: currencyFormatter },
  },
  { id: "created_at", name: "Created", format: "dateTimeFormat" },
];

const owedFields: AgFieldDefinition<CollectionsRegistry>[] = [
  { id: "client_name", name: "Client", format: "textFormat" },
  { id: "quote_id", name: "Quote ID", format: "textFormat" },
  {
    id: "outstanding_usd",
    name: "Outstanding",
    format: "currencyFormat",
    formatOptions: { format: currencyFormatter },
  },
  { id: "days_since_invoice", name: "Days since invoice", format: "integerFormat" },
];

const summaryFields: AgFieldDefinition<CollectionsRegistry>[] = [
  {
    id: "deposits_collected_usd",
    name: "Deposits collected",
    format: "currencyFormat",
    formatOptions: { format: currencyFormatter },
  },
  {
    id: "outstanding_usd",
    name: "Balances outstanding",
    format: "currencyFormat",
    formatOptions: { format: currencyFormatter },
  },
];

const ledgerlineTheme = studioTheme.withParams({
  accentColor: "var(--foreground)",
  backgroundColor: "var(--background)",
  borderColor: "var(--border)",
  browserColorScheme: "light",
  foregroundColor: "var(--foreground)",
  textColor: "var(--foreground)",
  subtleTextColor: "var(--muted-foreground)",
  fontFamily: "Inter, sans-serif",
  studioWrapperBackgroundColor: "var(--background)",
  studioPanelContainerBackgroundColor: "var(--background)",
  studioPanelGroupBackgroundColor: "var(--background)",
  studioPanelGroupTitleBarTextColor: "var(--foreground)",
  studioWidgetBackgroundColor: "var(--background)",
  studioWidgetTitleFontFamily: "Inter, sans-serif",
  studioWidgetTitleTextColor: "var(--foreground)",
  studioWidgetSubtitleFontFamily: "Inter, sans-serif",
  studioWidgetSubtitleTextColor: "var(--muted-foreground)",
  studioCanvasBackgroundColor: "var(--background)",
  studioCanvasFontFamily: "Inter, sans-serif",
  studioToggleButtonActiveBackgroundColor: "var(--foreground)",
  studioToggleButtonActiveBorderColor: "var(--foreground)",
  studioToggleButtonActiveColor: "var(--primary-foreground)",
  chartAccentColor: "var(--foreground)",
  chartFontFamily: "Inter, sans-serif",
  chartTextColor: "var(--foreground)",
  chartSubtleTextColor: "var(--muted-foreground)",
  chartPaletteFills1Color: "var(--muted-foreground)",
  chartPaletteFills2Color: "var(--muted-foreground)",
  chartPaletteFills3Color: "var(--muted-foreground)",
  chartPaletteFills4Color: "var(--muted-foreground)",
  chartPaletteFills5Color: "var(--muted-foreground)",
});

const licenseKey = import.meta.env["VITE_AG_STUDIO_LICENSE_KEY"];
if (licenseKey) AgStudioLicenseManager.setLicenseKey(licenseKey);

export function CollectionsStudio({ stats }: { stats: Stats }) {
  const quotesQuery = useQuery({ queryKey: ["quotes"], queryFn: api.listQuotes });
  const quotes = quotesQuery.data;
  const bookings = useMemo<BookingRow[]>(
    () =>
      (quotes ?? []).map((quote) => ({
        quote_id: quote.id,
        client_name: quote.client_name,
        service_title: quote.service_title,
        source: sourceLabel[quote.source],
        status: quote.status,
        status_label: statusLabel[quote.status],
        total_usd: quote.total_cents / 100,
        deposit_usd: quote.deposit_cents / 100,
        balance_usd: quote.balance_cents / 100,
        created_at: quote.created_at,
      })),
    [quotes],
  );
  const owed = useMemo<OwedRow[]>(
    () =>
      stats.owed_by_client.map((row) => ({
        client_name: row.client_name,
        quote_id: row.quote_id,
        outstanding_usd: row.outstanding_cents / 100,
        days_since_invoice: row.days_since_invoice,
      })),
    [stats.owed_by_client],
  );
  const data = useMemo(
    () => ({
      sources: [
        {
          id: "bookings",
          name: "Bookings",
          description: "Service quotes and their payment status.",
          data: bookings,
          fields: bookingsFields,
        },
        {
          id: "owed",
          name: "Open balances",
          description: "Invoices awaiting payment, in dollars.",
          data: owed,
          fields: owedFields,
        },
        {
          id: "metrics",
          name: "Collections totals",
          description: "Server totals for deposits collected and balances outstanding, in dollars.",
          data: [
            {
              deposits_collected_usd: stats.deposits_collected_cents / 100,
              outstanding_usd: stats.outstanding_cents / 100,
            },
          ],
          fields: summaryFields,
        },
      ],
    }),
    [bookings, owed, stats.deposits_collected_cents, stats.outstanding_cents],
  );
  const context = useMemo<FriendlyScoreboardContext>(() => ({ bookings, owed }), [bookings, owed]);

  if (quotesQuery.isLoading) {
    return (
      <div
        className="h-[560px] animate-pulse rounded-2xl bg-muted sm:h-[700px] lg:h-[920px]"
        aria-label="Loading collections report"
      />
    );
  }
  if (quotesQuery.error || !quotes) {
    return (
      <p className="rounded-xl border border-border p-5 text-sm text-muted-foreground">
        The collections report could not be loaded.
      </p>
    );
  }

  const aiAdapter = licenseKey ? getStudioAiAdapter() : undefined;
  const ai =
    licenseKey && aiAdapter
      ? ({ api: studioApi }: AgAiHarnessSetupParams) =>
          createAiHarness(studioApi, ({ builtIn }) => ({
            agents: [
              ...Object.values(builtIn).map((agent) =>
                directLlmRunner({ ...agent, adapter: aiAdapter }),
              ),
              directLlmRunner({
                id: "nudge-bot",
                name: "Nudge-bot",
                description: "Checks unpaid invoices and drafts friendly, approval-gated nudges.",
                adapter: aiAdapter,
                instructions: () =>
                  "You are a friendly collections assistant. Always check PayPal before asserting payment status. Never send anything yourself; drafts must wait for seller approval.",
                tools: () => getStudioNudgeTools(studioApi),
              }),
            ],
            primary: "lead",
            promptStarters: [
              { label: "Who still owes me money?", prompt: "Who still owes me money?" },
              {
                label: "Check PayPal and draft a friendly nudge for the oldest unpaid invoice",
                prompt: "Check PayPal and draft a friendly nudge for the oldest unpaid invoice",
              },
            ],
          }))
      : undefined;

  return (
    <>
      <div className="collections-studio h-[560px] min-h-0 w-full overflow-x-auto overflow-y-auto rounded-2xl tabular-nums sm:h-[700px] lg:h-[920px]">
        <AgStudio<CollectionsRegistry>
          className="h-full min-w-[720px] lg:min-w-0"
          data={data}
          initialState={initialState}
          mode="view"
          theme={ledgerlineTheme}
          context={context}
          panels={{ view: { left: [], right: [] } }}
          widgets={studioWidgets}
          {...(licenseKey ? { modules: [AgStudioAiModule] } : {})}
          {...(ai ? { ai } : {})}
        />
      </div>
      {!licenseKey && (
        <p className="mt-2 text-xs text-muted-foreground">
          AI assistant activates with an AG Studio licence
        </p>
      )}
    </>
  );
}
