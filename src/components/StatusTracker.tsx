import { Check, X } from "lucide-react";
import type { QuoteStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const steps: { status: QuoteStatus; label: string; hint: string }[] = [
  { status: "quoted", label: "Quote sent", hint: "Waiting for the deposit" },
  { status: "deposit_paid", label: "Deposit paid", hint: "Work in progress" },
  { status: "delivered", label: "Work delivered", hint: "Ready to invoice" },
  { status: "balance_invoiced", label: "Balance invoiced", hint: "Waiting for payment" },
  { status: "paid", label: "Fully paid", hint: "Booking complete" },
];

export function StatusTracker({ status }: { status: QuoteStatus }) {
  if (status === "cancelled")
    return (
      <div
        className="flex items-center gap-3 rounded-lg bg-danger-bg p-4 text-sm text-danger"
        role="status"
      >
        <X className="size-4 shrink-0" aria-hidden="true" />
        <span>
          <span className="font-semibold">Cancelled.</span> This quote is closed and can no longer
          be paid.
        </span>
      </div>
    );
  const current = steps.findIndex((step) => step.status === status);
  return (
    <ol aria-label="Booking progress" className="grid gap-4 sm:grid-cols-5 sm:gap-3">
      {steps.map((step, index) => {
        const complete = index < current || status === "paid";
        const active = index === current && status !== "paid";
        return (
          <li
            key={step.status}
            aria-current={active ? "step" : undefined}
            className="relative flex items-center gap-3 sm:flex-col sm:items-start sm:gap-2"
          >
            {index > 0 && (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute -left-3 top-3.5 hidden h-0.5 w-3 sm:block",
                  complete || active ? "bg-primary" : "bg-border",
                )}
              />
            )}
            <span
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold",
                complete
                  ? "border-primary bg-primary text-primary-foreground"
                  : active
                    ? "border-2 border-primary bg-background text-foreground"
                    : "border-input bg-background text-muted-foreground",
              )}
            >
              {complete ? <Check className="size-4" aria-hidden="true" /> : index + 1}
            </span>
            <span className="min-w-0">
              <span
                className={cn(
                  "block text-sm leading-tight",
                  complete || active ? "font-semibold text-foreground" : "text-muted-foreground",
                )}
              >
                {step.label}
                <span className="sr-only">{complete ? " (done)" : active ? " (current)" : ""}</span>
              </span>
              {active && (
                <span className="mt-0.5 block text-xs text-muted-foreground">{step.hint}</span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
