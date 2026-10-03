// Wrapper for the bookings table. Swap internals for AG Grid; keep the props.
import type { Quote } from '@/lib/types';
import { money, timeAgo } from '@/lib/format';
import { SourceBadge, StatusBadge } from './kit';

const depositState = (q: Quote) => (q.status === 'quoted' ? 'Awaiting' : q.status === 'cancelled' ? '—' : 'Captured');
const balanceState = (q: Quote) => (q.status === 'paid' ? 'Paid' : q.status === 'balance_invoiced' ? 'Invoiced' : q.status === 'cancelled' ? '—' : 'Not yet');

export function BookingsGrid({ rows, onOpen }: { rows: Quote[]; onOpen: (id: string) => void }) {
  return (
    <div className="max-h-[560px] overflow-auto">
      <table className="w-full min-w-[860px] border-collapse text-[13px] tabular-nums">
        <thead className="sticky top-0 z-10 bg-deep-950 text-left text-[11px] uppercase tracking-wider text-cream/55 shadow-[0_1px_0_rgb(238_245_240/0.1)]">
          <tr>
            {['Client', 'Service', 'Source', 'Total', 'Deposit', 'Balance', 'Status', 'Updated'].map((h, i) => (
              <th key={h} className={`px-4 py-2.5 font-semibold ${i === 3 ? 'text-right' : ''}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((q) => (
            <tr key={q.id} onClick={() => onOpen(q.id)} className="cursor-pointer border-b border-cream/[0.06] transition hover:bg-cream/[0.04]">
              <td className="px-4 py-3">
                <div className="font-medium">{q.client_name}</div>
                <div className="text-[11.5px] text-cream/50">{q.client_email}</div>
              </td>
              <td className="px-4 py-3 text-cream/85">{q.service_title}</td>
              <td className="px-4 py-3"><SourceBadge source={q.source} /></td>
              <td className="px-4 py-3 text-right font-semibold">{money(q.total_cents)}</td>
              <td className={`px-4 py-3 ${depositState(q) === 'Captured' ? 'text-mint' : 'text-cream/60'}`}>{depositState(q)} <span className="text-cream/40">· {money(q.deposit_cents)}</span></td>
              <td className={`px-4 py-3 ${balanceState(q) === 'Invoiced' ? 'text-warn' : balanceState(q) === 'Paid' ? 'text-mint' : 'text-cream/60'}`}>{balanceState(q)}</td>
              <td className="px-4 py-3"><StatusBadge status={q.status} /></td>
              <td className="px-4 py-3 text-cream/55">{timeAgo(q.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
