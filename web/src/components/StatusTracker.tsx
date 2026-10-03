import { Check } from "lucide-react";
import type { QuoteStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const steps: { status: QuoteStatus; label: string }[] = [
  { status: "quoted", label: "Quote sent" },
  { status: "deposit_paid", label: "Deposit paid" },
  { status: "delivered", label: "Work delivered" },
  { status: "balance_invoiced", label: "Balance invoice sent" },
  { status: "paid", label: "Fully paid" },
];

export function StatusTracker({ status }: { status: QuoteStatus }) {
  const current = status === "cancelled" ? -1 : steps.findIndex((step) => step.status === status);
  return (
    <ol aria-label="Booking progress" className="grid gap-4 sm:grid-cols-5 sm:gap-2">
      {steps.map((step, index) => {
        const complete = index < current || status === "paid";
        const active = index === current && status !== "paid";
        return (
          <li
            key={step.status}
            className="relative flex items-center gap-3 sm:flex-col sm:items-start"
          >
            {index > 0 && (
              <span className="absolute -left-2 top-3 hidden h-px w-2 bg-border sm:block" />
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
              {complete ? <Check className="size-4" /> : index + 1}
            </span>
            <span
              className={cn(
                "text-sm leading-tight",
                complete || active ? "font-semibold text-foreground" : "text-muted-foreground",
              )}
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
