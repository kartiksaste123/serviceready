import { useQuery } from '@tanstack/react-query';
import { AgStudio, createWidgets } from 'ag-studio-react';
import {
  AgStudioAiModule,
  AgStudioLicenseManager,
  createAiHarness,
  directLlmRunner,
  studioTheme,
} from 'ag-studio';
import type {
  AgAiHarnessSetupParams,
  AgDefaultRegistry,
  AgExternalShape,
  AgFieldDefinition,
  AgReportState,
  AgWidgetData,
  AgWidgetDataFormat,
  AgWidgetParams,
} from 'ag-studio';
import { PartyPopper } from 'lucide-react';
import { useMemo } from 'react';
import { api } from '@/lib/api';
import type { Stats } from '@/lib/types';
import { money } from '@/lib/format';
import { getStudioAiAdapter, getStudioNudgeTools } from '@/lib/studio-ai';

type FriendlyScoreboardFormat = AgWidgetDataFormat<Record<string, never>>;
interface FriendlyScoreboardState extends AgWidgetData<Record<string, never>, FriendlyScoreboardFormat> {
  type: 'friendly-scoreboard';
}
type FriendlyScoreboardDefinition = import('ag-studio-react').AgWidgetDefinition<
  'friendly-scoreboard',
  FriendlyScoreboardState
>;
type CollectionsRegistry = Omit<import('ag-studio-react').AgRegistry, 'widgets'> & {
  widgets: readonly (AgDefaultRegistry['widgets'][number] | FriendlyScoreboardDefinition)[];
};

interface BookingRow {
  quote_id: string;
  client_name: string;
  service_title: string;
  source: string;
  status: string;
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
  const clients = new Map<string, {
    quote_id: string;
    outstanding_usd: number;
    total_usd: number;
    days_since_invoice: number;
  }>();

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

  const rows = [...clients.entries()].sort(([, first], [, second]) => first.outstanding_usd - second.outstanding_usd);
  if (!rows.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 rounded-xl bg-teal-950 p-5 text-center text-cream">
        <PartyPopper className="size-7 text-mint" aria-hidden="true" />
        <p className="font-semibold text-mint">All square ✓</p>
        <p className="text-sm text-cream/65">No open balances. Nice work.</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto rounded-xl bg-teal-950 p-4 text-cream sm:p-5">
      <ol className="space-y-3">
        {rows.map(([clientName, row]) => {
          const paid = Math.max(0, row.total_usd - row.outstanding_usd);
          const progress = row.total_usd > 0 ? Math.min(100, (paid / row.total_usd) * 100) : 0;
          const invoiceAge = row.days_since_invoice === 0
            ? 'invoiced today'
            : `invoiced ${row.days_since_invoice} day${row.days_since_invoice === 1 ? '' : 's'} ago`;

          return (
            <li key={clientName}>
              <a
                href={`/app/quotes/${encodeURIComponent(row.quote_id)}`}
                className="block rounded-lg border border-cream/10 p-3 transition hover:bg-cream/[0.04]"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-medium">{clientName}</span>
                  <span className="shrink-0 font-semibold tabular-nums">{money(Math.round(row.outstanding_usd * 100))} to go</span>
                </div>
                <p className="mt-1 text-xs text-cream/60">{invoiceAge}</p>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-cream/10" aria-label={`${Math.round(progress)}% paid`}>
                  <div className="h-full rounded-full bg-mint" style={{ width: `${progress}%` }} />
                </div>
                <p className="mt-1.5 text-[11px] tabular-nums text-cream/55">
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
  id: 'friendly-scoreboard',
  label: 'Friendly scoreboard',
  comp: FriendlyScoreboard,
  form: ({ createDefaults }) => createDefaults({}),
  formatShape: ({ api: studioApi }) => studioApi.defineAiCommand((shape) => ({
    input: shape.object({}),
    execute: () => ({ success: true, value: {} }),
  })).shape as AgExternalShape<FriendlyScoreboardFormat>,
  ai: {
    label: 'Friendly scoreboard',
    description: 'A friendly one-row-per-client view of open balances with a paid-versus-total progress bar.',
    usage: 'Use for a concise, supportive overview of clients with open invoices. Show the all-square state when there are no open balances.',
    configuration: 'Uses the open balances and booking totals supplied in the Studio context.',
  },
  defaultSize: { width: 14, height: 12 },
  minSize: { width: 6, height: 6 },
};

const studioWidgets = createWidgets<CollectionsRegistry>({
  additionalTypes: [scoreboardWidget],
  menu: [
    { label: 'ServiceReady', widgetIds: ['friendly-scoreboard'] },
    { label: 'Collections', widgetIds: ['value', 'column-chart-grouped', 'grid'] },
  ],
});

const initialState: AgReportState<CollectionsRegistry> = {
  pages: [{
    id: 'collections',
    widgets: {
      scoreboard: { type: 'friendly-scoreboard', dataMapping: {}, format: {} },
      deposits: {
        type: 'value',
        dataMapping: { value: [{ id: 'metrics_deposits_collected_usd', aggregation: 'sum' }] },
        format: { title: { text: 'Deposits collected', enabled: true } },
      },
      outstanding: {
        type: 'value',
        dataMapping: { value: [{ id: 'metrics_outstanding_usd', aggregation: 'sum' }] },
        format: { title: { text: 'Balances outstanding', enabled: true } },
      },
      status: {
        type: 'column-chart-grouped',
        dataMapping: {
          categoryKey: [{ id: 'bookings_status' }],
          valueKey: [{ id: 'bookings_quote_id', aggregation: 'count' }],
        },
        format: { title: { text: 'Bookings by status', enabled: true } },
      },
      bookings: {
        type: 'grid',
        dataMapping: {
          cols: [
            { id: 'bookings_quote_id' },
            { id: 'bookings_client_name' },
            { id: 'bookings_service_title' },
            { id: 'bookings_source' },
            { id: 'bookings_status' },
            { id: 'bookings_total_usd' },
            { id: 'bookings_deposit_usd' },
            { id: 'bookings_balance_usd' },
            { id: 'bookings_created_at' },
          ],
        },
        format: { title: { text: 'Bookings', enabled: true } },
      },
    },
    widgetLayout: {
      scoreboard: { xTrack: 0, yTrack: 0, xSpan: 14, ySpan: 12 },
      deposits: { xTrack: 14, yTrack: 0, xSpan: 5, ySpan: 6 },
      outstanding: { xTrack: 19, yTrack: 0, xSpan: 5, ySpan: 6 },
      status: { xTrack: 14, yTrack: 6, xSpan: 10, ySpan: 8 },
      bookings: { xTrack: 0, yTrack: 12, xSpan: 24, ySpan: 18 },
    },
  }],
  selectedPageId: 'collections',
};

const currencyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

const bookingsFields: AgFieldDefinition<CollectionsRegistry>[] = [
  { id: 'bookings_quote_id', name: 'Quote ID', format: 'textFormat', accessor: 'quote_id' },
  { id: 'bookings_client_name', name: 'Client', format: 'textFormat', accessor: 'client_name' },
  { id: 'bookings_service_title', name: 'Service', format: 'textFormat', accessor: 'service_title' },
  { id: 'bookings_source', name: 'Source', format: 'textFormat', accessor: 'source' },
  { id: 'bookings_status', name: 'Status', format: 'textFormat', accessor: 'status' },
  { id: 'bookings_total_usd', name: 'Total', format: 'currencyFormat', formatOptions: { format: currencyFormatter }, accessor: 'total_usd' },
  { id: 'bookings_deposit_usd', name: 'Deposit', format: 'currencyFormat', formatOptions: { format: currencyFormatter }, accessor: 'deposit_usd' },
  { id: 'bookings_balance_usd', name: 'Balance', format: 'currencyFormat', formatOptions: { format: currencyFormatter }, accessor: 'balance_usd' },
  { id: 'bookings_created_at', name: 'Created', format: 'dateTimeFormat', accessor: 'created_at' },
];

const owedFields: AgFieldDefinition<CollectionsRegistry>[] = [
  { id: 'owed_client_name', name: 'Client', format: 'textFormat', accessor: 'client_name' },
  { id: 'owed_quote_id', name: 'Quote ID', format: 'textFormat', accessor: 'quote_id' },
  { id: 'owed_outstanding_usd', name: 'Outstanding', format: 'currencyFormat', formatOptions: { format: currencyFormatter }, accessor: 'outstanding_usd' },
  { id: 'owed_days_since_invoice', name: 'Days since invoice', format: 'integerFormat', accessor: 'days_since_invoice' },
];

const summaryFields: AgFieldDefinition<CollectionsRegistry>[] = [
  { id: 'metrics_deposits_collected_usd', name: 'Deposits collected', format: 'currencyFormat', formatOptions: { format: currencyFormatter }, accessor: 'deposits_collected_usd' },
  { id: 'metrics_outstanding_usd', name: 'Balances outstanding', format: 'currencyFormat', formatOptions: { format: currencyFormatter }, accessor: 'outstanding_usd' },
];

const ledgerlineTheme = studioTheme.withParams({
  accentColor: '#4fd1c5',
  backgroundColor: '#0f3d3e',
  borderColor: '#4fd1c5',
  browserColorScheme: 'dark',
  foregroundColor: '#eef5f0',
  textColor: '#eef5f0',
  subtleTextColor: '#b7cbc7',
  fontFamily: 'Inter, sans-serif',
  studioWrapperBackgroundColor: '#0f3d3e',
  studioPanelContainerBackgroundColor: '#0a2a2b',
  studioPanelGroupBackgroundColor: '#0a2a2b',
  studioPanelGroupTitleBarTextColor: '#eef5f0',
  studioWidgetBackgroundColor: '#0a2a2b',
  studioWidgetTitleFontFamily: 'Inter, sans-serif',
  studioWidgetTitleTextColor: '#eef5f0',
  studioWidgetSubtitleFontFamily: 'Inter, sans-serif',
  studioWidgetSubtitleTextColor: '#b7cbc7',
  studioCanvasBackgroundColor: '#0f3d3e',
  studioCanvasFontFamily: 'Inter, sans-serif',
  studioToggleButtonActiveBackgroundColor: '#4fd1c5',
  studioToggleButtonActiveBorderColor: '#4fd1c5',
  studioToggleButtonActiveColor: '#0a2a2b',
  chartAccentColor: '#4fd1c5',
  chartFontFamily: 'Inter, sans-serif',
  chartTextColor: '#eef5f0',
  chartSubtleTextColor: '#b7cbc7',
  chartPaletteFills1Color: '#4fd1c5',
  chartPaletteFills2Color: '#eef5f0',
  chartPaletteFills3Color: '#0f3d3e',
  chartPaletteFills4Color: '#74b9a9',
  chartPaletteFills5Color: '#c3e4d4',
});

const licenseKey = import.meta.env['VITE_AG_STUDIO_LICENSE_KEY'];
if (licenseKey) AgStudioLicenseManager.setLicenseKey(licenseKey);

export function CollectionsStudio({ stats }: { stats: Stats }) {
  const quotesQuery = useQuery({ queryKey: ['quotes'], queryFn: api.listQuotes });
  const quotes = quotesQuery.data;
  const bookings = useMemo<BookingRow[]>(() => (quotes ?? []).map((quote) => ({
    quote_id: quote.id,
    client_name: quote.client_name,
    service_title: quote.service_title,
    source: quote.source,
    status: quote.status,
    total_usd: quote.total_cents / 100,
    deposit_usd: quote.deposit_cents / 100,
    balance_usd: quote.balance_cents / 100,
    created_at: quote.created_at,
  })), [quotes]);
  const owed = useMemo<OwedRow[]>(() => stats.owed_by_client.map((row) => ({
    client_name: row.client_name,
    quote_id: row.quote_id,
    outstanding_usd: row.outstanding_cents / 100,
    days_since_invoice: row.days_since_invoice,
  })), [stats.owed_by_client]);
  const data = useMemo(() => ({
    sources: [
      { id: 'bookings', name: 'Bookings', description: 'Service quotes and their payment status.', data: bookings, fields: bookingsFields },
      { id: 'owed', name: 'Open balances', description: 'Invoices awaiting payment, in dollars.', data: owed, fields: owedFields },
      {
        id: 'metrics',
        name: 'Collections totals',
        description: 'Server totals for deposits collected and balances outstanding, in dollars.',
        data: [{
          deposits_collected_usd: stats.deposits_collected_cents / 100,
          outstanding_usd: stats.outstanding_cents / 100,
        }],
        fields: summaryFields,
      },
    ],
  }), [bookings, owed, stats.deposits_collected_cents, stats.outstanding_cents]);
  const context = useMemo<FriendlyScoreboardContext>(() => ({ bookings, owed }), [bookings, owed]);

  if (quotesQuery.isLoading) {
    return <div className="h-[920px] animate-pulse rounded-2xl bg-cream/[0.04]" aria-label="Loading collections report" />;
  }
  if (quotesQuery.error || !quotes) {
    return <p className="rounded-xl border border-cream/10 p-5 text-sm text-cream/65">The collections report could not be loaded.</p>;
  }

  const aiAdapter = licenseKey ? getStudioAiAdapter() : undefined;
  const ai = licenseKey && aiAdapter
    ? ({ api: studioApi }: AgAiHarnessSetupParams) => createAiHarness(studioApi, ({ builtIn }) => ({
      agents: [
        ...Object.values(builtIn).map((agent) => directLlmRunner({ ...agent, adapter: aiAdapter })),
        directLlmRunner({
          id: 'nudge-bot',
          name: 'Nudge-bot',
          description: 'Checks unpaid invoices and drafts friendly, approval-gated nudges.',
          adapter: aiAdapter,
          instructions: () => 'You are a friendly collections assistant. Always check PayPal before asserting payment status. Never send anything yourself; drafts must wait for seller approval.',
          tools: () => getStudioNudgeTools(studioApi),
        }),
      ],
      primary: 'lead',
      promptStarters: [
        { label: 'Who still owes me money?', prompt: 'Who still owes me money?' },
        {
          label: 'Check PayPal and draft a friendly nudge for the oldest unpaid invoice',
          prompt: 'Check PayPal and draft a friendly nudge for the oldest unpaid invoice',
        },
      ],
    }))
    : undefined;

  return (
    <>
      <div className="h-[920px] min-h-[720px] w-full overflow-hidden rounded-2xl tabular-nums">
      <AgStudio<CollectionsRegistry>
        className="h-full w-full"
        data={data}
        initialState={initialState}
        mode="view"
        theme={ledgerlineTheme}
        context={context}
        widgets={studioWidgets}
        {...(licenseKey ? { modules: [AgStudioAiModule] } : {})}
        {...(ai ? { ai } : {})}
      />
      </div>
      {!licenseKey && <p className="mt-2 text-xs text-cream/50">AI assistant activates with an AG Studio licence</p>}
    </>
  );
}
