import {
  Bot,
  BookOpen,
  Check,
  CheckSquare,
  Clock3,
  Coins,
  LayoutList,
  LockKeyhole,
  Settings,
} from "lucide-react";
import { LogoMark } from "@/components/kit";

/** Static, non-interactive render of the seller desk for marketing pages (no data calls). */
export function DeskPreview() {
  const rows = [
    ["Hannah Brooks", "Brand identity kit", "$1,200", 50, "Balance due", "warn"],
    ["Jordan Lee", "Brand identity kit", "$1,200", 0, "Awaiting deposit", "muted"],
    ["Tomás Ortega", "Landing page design", "$900", 40, "Work delivered", "ok"],
    ["Priya Shah", "Logo design", "$450", 50, "Deposit paid", "ok"],
    ["Aiko Tanaka", "Social media pack", "$300", 100, "Fully paid", "ok"],
  ] as const;
  const tone = {
    warn: "bg-warning-bg text-warning",
    muted: "bg-muted text-muted-foreground",
    ok: "bg-success-bg text-success",
  };
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-xl border border-border bg-background text-left shadow-[0_30px_80px_-30px_rgba(16,24,40,0.35)]"
    >
      <div className="flex h-9 items-center gap-1.5 border-b border-border bg-muted px-3">
        <span className="size-2.5 rounded-full bg-[#ff5f57]" />
        <span className="size-2.5 rounded-full bg-[#febc2e]" />
        <span className="size-2.5 rounded-full bg-[#28c840]" />
        <span className="mx-auto rounded-md bg-background px-3 py-0.5 font-mono text-[10px] text-muted-foreground">
          serviceready.app/app
        </span>
      </div>
      <div className="grid grid-cols-[150px_1fr] text-[11px] max-md:grid-cols-1">
        <div className="border-r border-border p-3 max-md:hidden">
          <div className="mb-4 flex items-center gap-1.5 font-bold">
            <LogoMark className="size-5 rounded-md" /> ServiceReady
          </div>
          {[
            [LayoutList, "Bookings", true],
            [CheckSquare, "Approvals", false],
            [Coins, "Payments due", false],
            [BookOpen, "Services", false],
            [Bot, "AI assistants", false],
            [Settings, "Settings", false],
          ].map(([I, l, a]) => {
            const Icon = I as typeof LayoutList;
            return (
              <div
                key={String(l)}
                className={`mb-0.5 flex items-center gap-2 rounded-md px-2 py-1.5 ${a ? "bg-accent font-semibold text-primary" : "text-muted-foreground"}`}
              >
                <Icon className="size-3" /> {String(l)}
                {l === "Approvals" && (
                  <span className="ml-auto rounded-full bg-primary px-1.5 text-[9px] font-semibold text-primary-foreground">
                    1
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <div className="min-w-0 bg-muted/60 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Bookings</p>
            <span className="rounded-md bg-primary px-2 py-1 text-[10px] font-semibold text-primary-foreground">
              Copy booking link
            </span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {[
              ["Deposits received", "$1,590"],
              ["Still to collect", "$825"],
              ["Fully paid", "$600"],
            ].map(([l, v]) => (
              <div key={l} className="rounded-lg border border-border bg-background p-2.5">
                <p className="text-[10px] text-muted-foreground">{l}</p>
                <p className="mt-0.5 text-base font-semibold tabular-nums">{v}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 overflow-hidden rounded-lg border border-border bg-background">
            {rows.map(([n, s, a, pct, st, t]) => (
              <div
                key={n}
                className="grid grid-cols-[1.2fr_1.2fr_.6fr_.9fr_1fr] items-center gap-2 border-b border-border px-3 py-2 last:border-0 max-sm:grid-cols-[1.2fr_.7fr_1fr]"
              >
                <span className="truncate font-medium">{n}</span>
                <span className="truncate text-muted-foreground max-sm:hidden">{s}</span>
                <span className="font-semibold tabular-nums">{a}</span>
                <span className="h-1 overflow-hidden rounded-full bg-muted max-sm:hidden">
                  <span
                    className={`block h-full rounded-full ${pct >= 100 ? "bg-success" : "bg-primary"}`}
                    style={{ width: `${pct}%` }}
                  />
                </span>
                <span
                  className={`justify-self-start whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${tone[t]}`}
                >
                  {st}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Stripe-style hosted quote + PayPal checkout card, static. */
export function CheckoutPreview() {
  return (
    <div
      aria-hidden="true"
      className="mx-auto w-full max-w-sm rounded-2xl border border-border bg-background p-6 text-left shadow-[0_30px_80px_-30px_rgba(16,24,40,0.35)]"
    >
      <p className="text-xs text-muted-foreground">Quote from Maya Rao Studio</p>
      <p className="mt-1 text-lg font-semibold">Brand identity kit</p>
      <div className="mt-4 space-y-2 border-y border-border py-4 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Total</span>
          <span className="tabular-nums">$1,200.00</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Balance on delivery</span>
          <span className="tabular-nums">$600.00</span>
        </div>
      </div>
      <p className="mt-4 text-xs font-medium text-muted-foreground">Due now</p>
      <p className="text-3xl font-semibold tracking-tight tabular-nums">$600.00</p>
      <div className="mt-4 rounded-lg bg-[#ffc439] py-2.5 text-center text-sm font-bold text-[#003087]">
        Pay with Pay<span className="text-[#0070e0]">Pal</span>
      </div>
      <div className="mt-2 rounded-lg bg-[#2c2e2f] py-2.5 text-center text-sm font-semibold text-white">
        Debit or Credit Card
      </div>
      <div className="mt-4 flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <LockKeyhole className="size-3" /> Price signed · can’t be changed
        </span>
        <span className="flex items-center gap-1">
          <Clock3 className="size-3" /> Free cancel 48h
        </span>
      </div>
      <div className="mt-4 flex items-center gap-2 rounded-lg bg-success-bg px-3 py-2 text-xs font-semibold text-success">
        <Check className="size-3.5" /> Booking confirms the moment PayPal does
      </div>
    </div>
  );
}
