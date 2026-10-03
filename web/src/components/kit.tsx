import { useState, type ReactNode } from 'react';
import { AudioWaveform, ChevronRight, Inbox } from 'lucide-react';
import type { Proposal, QuoteStatus, Source } from '@/lib/types';
import { cn } from '@/lib/utils';

export function LogoMark({ className }: { className?: string }) {
  return (
    <span className={cn('grid size-8 place-items-center rounded-lg bg-mint text-deep-950', className)}>
      <AudioWaveform className="size-4" strokeWidth={2.5} />
    </span>
  );
}
export function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className="text-[15px] font-bold tracking-tight">ServiceReady</span>
    </span>
  );
}

const statusStyle: Record<QuoteStatus, string> = {
  quoted: 'bg-cream/[0.08] text-cream/80',
  deposit_paid: 'bg-mint/15 text-mint',
  delivered: 'bg-cream/[0.08] text-cream',
  balance_invoiced: 'bg-warn/15 text-warn',
  paid: 'bg-mint text-deep-950',
  cancelled: 'bg-cream/[0.04] text-cream/45 line-through',
};
export const statusLabel: Record<QuoteStatus, string> = {
  quoted: 'Quoted', deposit_paid: 'Deposit paid', delivered: 'Delivered', balance_invoiced: 'Balance invoiced', paid: 'Paid', cancelled: 'Cancelled',
};
export function StatusBadge({ status }: { status: QuoteStatus }) {
  return <span className={cn('inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-[11.5px] font-semibold', statusStyle[status])}>{statusLabel[status]}</span>;
}
const sourceLabel: Record<Source, string> = { web: 'Web', mcp: 'MCP', webmcp: 'WebMCP', agent_sim: 'Agent sim' };
export function SourceBadge({ source }: { source: Source }) {
  return <span className={cn('inline-flex rounded-md px-1.5 py-0.5 font-mono text-[10.5px] font-medium ringline', source === 'web' ? 'text-cream/60' : 'text-mint')}>{sourceLabel[source]}</span>;
}
export function PayStatus({ status }: { status?: string }) {
  if (!status) return <span className="text-cream/35">—</span>;
  const ok = status === 'COMPLETED' || status === 'PAID';
  return <span className={cn('inline-flex items-center gap-1.5 text-[12px] font-medium', ok ? 'text-mint' : 'text-warn')}><span className={cn('size-1.5 rounded-full', ok ? 'bg-mint' : 'bg-warn')} />{status}</span>;
}
const actionStyle: Record<Proposal['action'], string> = {
  wait: 'bg-cream/[0.08] text-cream/80', send_reminder: 'bg-warn/15 text-warn', thank_and_close: 'bg-mint/15 text-mint', escalate: 'bg-danger/15 text-danger',
};
export function ActionPill({ action }: { action: Proposal['action'] }) {
  return <span className={cn('inline-flex rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold', actionStyle[action])}>{action}</span>;
}

export function JsonBlock({ label, value }: { label: string; value: unknown }) {
  const [open, setOpen] = useState(false);
  if (value === undefined) return null;
  return (
    <div>
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-cream/55 hover:text-cream">
        <ChevronRight className={cn('size-3 transition', open && 'rotate-90')} />{label}
      </button>
      {open && <pre className="mt-1 max-h-60 overflow-auto rounded-lg bg-deep-950/80 p-2.5 font-mono text-[11px] leading-relaxed text-cream/80 ringline">{JSON.stringify(value, null, 2)}</pre>}
    </div>
  );
}

export function Empty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl px-6 py-14 text-center ringline">
      <span className="icon-tile size-11">{icon ?? <Inbox className="size-5" />}</span>
      <p className="font-semibold">{title}</p>
      {children && <div className="max-w-sm text-sm text-cream/60">{children}</div>}
    </div>
  );
}

export function PageHeader({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-[-0.02em]">{title}</h1>
        {sub && <p className="mt-1 text-sm text-cream/60">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}
