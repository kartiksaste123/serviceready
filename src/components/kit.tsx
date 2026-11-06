import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Clock3,
  Copy,
  Inbox,
  RotateCcw,
  X,
} from "lucide-react";
import type { Proposal, QuoteStatus, Source } from "@/lib/types";
import { cn } from "@/lib/utils";
import { copyText } from "@/lib/clipboard";
import { statusLabel } from "@/lib/labels";

export function LogoMark({ className }: { className?: string }) {
  return (
    <img
      src="/images/logo-mark.png?v=sr3"
      alt=""
      width={32}
      height={32}
      aria-hidden="true"
      className={cn("size-8 rounded-lg", className)}
    />
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
  quoted: { label: statusLabel.quoted, style: "bg-muted text-muted-foreground", icon: Clock3 },
  deposit_paid: {
    label: statusLabel.deposit_paid,
    style: "bg-success-bg text-success",
    icon: Check,
  },
  delivered: { label: statusLabel.delivered, style: "bg-success-bg text-success", icon: Check },
  balance_invoiced: {
    label: statusLabel.balance_invoiced,
    style: "bg-warning-bg text-warning",
    icon: Clock3,
  },
  paid: { label: statusLabel.paid, style: "bg-success-bg text-success", icon: Check },
  cancelled: { label: statusLabel.cancelled, style: "bg-danger-bg text-danger", icon: X },
};
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
      <Icon className="size-3.5" aria-hidden="true" />
      {x.label}
    </span>
  );
}
const sourceLabel: Record<Source, string> = {
  web: "Storefront",
  mcp: "AI assistant (MCP)",
  webmcp: "Browser assistant",
  agent_sim: "Demo assistant",
};
export function SourceBadge({ source }: { source: Source }) {
  return (
    <span className="inline-flex whitespace-nowrap rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
      {sourceLabel[source]}
    </span>
  );
}

const payLabels: Record<string, string> = {
  COMPLETED: "Captured",
  PAID: "Paid",
  UNPAID: "Unpaid",
  CREATED: "Checkout started",
  VOIDED: "Voided",
  SENT: "Sent",
  AUTHORIZED: "Held",
  REFUNDED: "Refunded",
  PARTIALLY_REFUNDED: "Part refunded",
  PARTIALLY_CAPTURED: "Fee captured",
};
export function PayStatus({ status }: { status?: string | undefined }) {
  const ok = status === "COMPLETED" || status === "PAID";
  const muted = !status || status === "VOIDED";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-1 text-xs font-semibold",
        ok
          ? "bg-success-bg text-success"
          : muted
            ? "bg-muted text-muted-foreground"
            : "bg-warning-bg text-warning",
      )}
    >
      {ok ? (
        <Check className="size-3.5" aria-hidden="true" />
      ) : (
        <Clock3 className="size-3.5" aria-hidden="true" />
      )}
      {status ? (payLabels[status] ?? status) : "Waiting"}
    </span>
  );
}

const actionLabel: Record<Proposal["action"], string> = {
  wait: "Keep waiting",
  send_reminder: "Send a reminder",
  thank_and_close: "Thank & close",
  escalate: "Needs your attention",
};
export function ActionPill({ action }: { action: Proposal["action"] }) {
  const attention = action === "escalate";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold",
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
        <AlertTriangle className="size-3.5" aria-hidden="true" />
      ) : action === "send_reminder" ? (
        <Clock3 className="size-3.5" aria-hidden="true" />
      ) : (
        <Check className="size-3.5" aria-hidden="true" />
      )}
      {actionLabel[action]}
    </span>
  );
}

export function JsonBlock({ label, value }: { label: string; value: unknown }) {
  const [open, setOpen] = useState(false);
  if (value === undefined) return null;
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => v === undefined)
  )
    return null;
  const text = label.charAt(0).toUpperCase() + label.slice(1);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-xs font-medium text-link underline underline-offset-4"
      >
        <ChevronRight className={cn("size-3 transition", open && "rotate-90")} aria-hidden="true" />
        {open ? `Hide ${text.toLowerCase()}` : text}
      </button>
      {open && (
        <pre
          tabIndex={0}
          aria-label={`${text} JSON`}
          className="code-box mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-all text-xs leading-relaxed"
        >
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
      <span className="icon-tile size-11">
        {icon ?? <Inbox className="size-5" aria-hidden="true" />}
      </span>
      <p className="font-semibold">{title}</p>
      {children && <div className="max-w-sm text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}
export function ErrorState({
  title = "Couldn't load this",
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card px-6 py-12 text-center"
    >
      <span className="grid size-11 place-items-center rounded-lg bg-danger-bg text-danger">
        <AlertTriangle className="size-5" aria-hidden="true" />
      </span>
      <p className="font-semibold">{title}</p>
      {message && <p className="max-w-sm text-sm text-muted-foreground">{message}</p>}
      {onRetry && (
        <button type="button" className="btn-glass btn-sm" onClick={onRetry}>
          <RotateCcw className="size-3.5" aria-hidden="true" />
          Try again
        </button>
      )}
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
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {sub && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}
export function CopyButton({
  text,
  label = "Copy",
  className,
  iconOnly = false,
}: {
  text: string;
  label?: string;
  className?: string;
  iconOnly?: boolean;
}) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={iconOnly ? label : undefined}
      disabled={!text}
      className={cn("btn-glass btn-sm", className)}
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }
      }}
    >
      {done ? (
        <Check className="size-3.5" aria-hidden="true" />
      ) : (
        <Copy className="size-3.5" aria-hidden="true" />
      )}
      {!iconOnly && (done ? "Copied" : label)}
    </button>
  );
}
export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | undefined;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-foreground">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="mt-1 text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="mt-1 text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
