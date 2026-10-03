// Mount point for AG Studio. For now: a friendly "who still owes what" scoreboard.
import { Link } from '@tanstack/react-router';
import { PartyPopper } from 'lucide-react';
import type { Stats } from '@/lib/types';
import { money } from '@/lib/format';
import { Empty } from './kit';

export function CollectionsStudio({ stats }: { stats: Stats }) {
  const rows = stats.owed_by_client;
  if (!rows.length) return <Empty title="Everyone's square" icon={<PartyPopper className="size-5" />}>No open balances. Nice work.</Empty>;
  const max = Math.max(...rows.map((r) => r.outstanding_cents));
  return (
    <div className="glass-card p-5 sm:p-6">
      <div className="mb-5 flex items-baseline justify-between">
        <h2 className="font-semibold">Who still owes what</h2>
        <span className="text-sm tabular-nums text-cream/60">{money(stats.outstanding_cents)} open</span>
      </div>
      <ol className="space-y-3">
        {rows.map((r, i) => (
          <li key={r.quote_id}>
            <Link to="/app/quotes/$id" params={{ id: r.quote_id }} className="glass-row flex items-center gap-4 p-3.5 transition hover:bg-cream/[0.04]">
              <span className="grid size-9 place-items-center rounded-full bg-mint/15 text-sm font-bold text-mint">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-medium">{r.client_name}</span>
                  <span className="font-bold tabular-nums">{money(r.outstanding_cents)}</span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-cream/[0.06]"><div className="h-full rounded-full bg-mint" style={{ width: `${(r.outstanding_cents / max) * 100}%` }} /></div>
                <p className="mt-1.5 text-[12px] text-cream/55">{r.days_since_invoice === 0 ? 'Invoiced today' : `Invoiced ${r.days_since_invoice} day${r.days_since_invoice === 1 ? '' : 's'} ago`} · {r.days_since_invoice > 7 ? 'a friendly nudge could help' : 'still within a normal window'}</p>
              </div>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
