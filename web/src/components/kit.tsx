import { useState, type ReactNode } from "react";
import { AlertTriangle, AudioWaveform, Check, ChevronRight, Clock3, Inbox } from "lucide-react";
import type { Proposal, QuoteStatus, Source } from "@/lib/types";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground",
        className,
      )}
    >
      <AudioWaveform className="size-4" strokeWidth={2.5} />
    </span>
  );
}
export function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className="text-[15px] font-bold">ServiceReady</span>
    </span>
  );
}

const statusData: Record<QuoteStatus, { label: string; style: string; icon: typeof Check }> = {
  quoted: { label: "Quote sent", style: "bg-muted text-muted-foreground", icon: Clock3 },
  deposit_paid: { label: "Deposit paid", style: "bg-success-bg text-success", icon: Check },
  delivered: { label: "Work delivered", style: "bg-success-bg text-success", icon: Check },
  balance_invoiced: { label: "Payment due", style: "bg-warning-bg text-warning", icon: Clock3 },
  paid: { label: "Fully paid", style: "bg-success-bg text-success", icon: Check },
  cancelled: { label: "Cancelled", style: "bg-danger-bg text-danger", icon: AlertTriangle },
};
export const statusLabel: Record<QuoteStatus, string> = Object.fromEntries(
  Object.entries(statusData).map(([key, value]) => [key, value.label]),
) as Record<QuoteStatus, string>;
export function StatusBadge({ status }: { status: QuoteStatus }) {
  const x = statusData[status];
  const Icon = x.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold",
        x.style,
      )}
    >
      <Icon className="size-3.5" />
      {x.label}
    </span>
  );
}
const sourceLabel: Record<Source, string> = {
  web: "Website",
  mcp: "AI assistant",
  webmcp: "Browser assistant",
  agent_sim: "Demo assistant",
};
export function SourceBadge({ source }: { source: Source }) {
  return (
    <span className="inline-flex rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
      {sourceLabel[source]}
    </span>
  );
}
export function PayStatus({ status }: { status?: string }) {
  const paid = status === "COMPLETED" || status === "PAID";
  const cancelled = status === "CANCELLED" || status === "VOID";
  const label = !status
    ? "Waiting"
    : paid
      ? "Paid"
      : cancelled
        ? "Cancelled"
        : status === "UNPAID"
          ? "Unpaid"
          : status === "SENT"
            ? "Sent"
            : status
                .toLowerCase()
                .replaceAll("_", " ")
                .replace(/^./, (c) => c.toUpperCase());
  const style = paid
    ? "bg-success-bg text-success"
    : cancelled
      ? "bg-danger-bg text-danger"
      : status
        ? "bg-warning-bg text-warning"
        : "bg-muted text-muted-foreground";
  const Icon = paid ? Check : cancelled ? AlertTriangle : Clock3;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-semibold",
        style,
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </span>
  );
}
const actionLabel: Record<Proposal["action"], string> = {
  wait: "Wait",
  send_reminder: "Send a friendly reminder",
  thank_and_close: "Thank the client and close",
  escalate: "Needs your attention",
};
export function ActionPill({ action }: { action: Proposal["action"] }) {
  const attention = action === "escalate";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        attention
          ? "bg-danger-bg text-danger"
          : action === "send_reminder"
            ? "bg-warning-bg text-warning"
            : action === "thank_and_close"
              ? "bg-success-bg text-success"
              : "bg-muted text-muted-foreground",
      )}
    >
      {attention ? (
        <AlertTriangle className="size-3.5" />
      ) : action === "send_reminder" || action === "wait" ? (
        <Clock3 className="size-3.5" />
      ) : (
        <Check className="size-3.5" />
      )}
      {actionLabel[action]}
    </span>
  );
}

export function JsonBlock({ label, value }: { label: string; value: unknown }) {
  const [open, setOpen] = useState(false);
  if (value === undefined) return null;
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-xs font-medium text-link underline underline-offset-4"
      >
        <ChevronRight className={cn("size-3 transition", open && "rotate-90")} />
        {label === "input" || label === "output" ? "Details" : label}
      </button>
      {open && (
        <pre className="code-box mt-2 max-h-60 overflow-auto text-xs leading-relaxed">
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </div>
  );
}
export function Empty({
  title,
  children,
  icon,
}: {
  title: string;
  children?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card px-6 py-12 text-center">
      <span className="icon-tile size-11">{icon ?? <Inbox className="size-5" />}</span>
      <p className="font-semibold">{title}</p>
      {children && <div className="max-w-sm text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}
export function PageHeader({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {sub && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}
