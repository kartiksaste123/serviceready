import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { SellerRules } from "@/lib/types";
import { PageHeader } from "@/components/kit";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/app/settings")({
  head: () => ({
    meta: [
      { title: "Settings — ServiceReady" },
      { name: "description", content: "Deposit and reminder rules for your agents." },
      { property: "og:title", content: "Settings — ServiceReady" },
      { property: "og:description", content: "Agent rules." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsPage,
});

const reminderExamples: Record<SellerRules["reminder_tone"], string> = {
  friendly:
    "Hi Avery, just a friendly reminder that the $600.00 balance for Brand identity kit is ready to pay whenever you get a moment. Thank you!",
  neutral:
    "Hi Avery, this is a reminder that the $600.00 balance for Brand identity kit is now due. You can pay it from the PayPal invoice link.",
  firm: "Hi Avery, the $600.00 balance for Brand identity kit is now overdue. Please pay it through the PayPal invoice link today.",
};

function SettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["seller"], queryFn: api.getSeller });
  const { data: account } = useQuery({ queryKey: ["me"], queryFn: api.auth.me });
  const [r, setR] = useState<SellerRules | null>(null);
  useEffect(() => {
    if (data) setR(data.rules);
  }, [data]);
  const save = useMutation({
    mutationFn: () => {
      if (!r) throw new Error("Rules are still loading");
      return api.updateRules(r);
    },
    onSuccess: (s) => {
      qc.setQueryData(["seller"], s);
      toast.success("Rules saved");
    },
  });
  const reset = useMutation({
    mutationFn: api.resetDemo,
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("Demo data reset");
    },
  });

  return (
    <>
      <PageHeader title="Settings" sub="Rules your agents follow. They can't override them." />
      {isLoading || !r ? (
        <Skeleton className="h-80 rounded-2xl" />
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <form
            className="glass-card space-y-5 p-6"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <F label="Default deposit %" hint="Applied to newly imported services.">
              <input
                type="number"
                min={0}
                max={100}
                className="field tabular-nums"
                value={r.default_deposit_pct}
                onChange={(e) => setR({ ...r, default_deposit_pct: Number(e.target.value) })}
              />
            </F>
            <F label="Reminder tone">
              <div className="flex gap-2">
                {(["friendly", "neutral", "firm"] as const).map((t) => (
                  <button
                    type="button"
                    key={t}
                    onClick={() => setR({ ...r, reminder_tone: t })}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm capitalize ${r.reminder_tone === t ? "border-foreground bg-primary text-primary-foreground" : "border-input text-muted-foreground hover:bg-muted"}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </F>
            <div className="grid gap-5 sm:grid-cols-2">
              <F label="Max reminders">
                <input
                  type="number"
                  min={0}
                  max={10}
                  className="field tabular-nums"
                  value={r.max_reminders}
                  onChange={(e) => setR({ ...r, max_reminders: Number(e.target.value) })}
                />
              </F>
              <F label="Wait days before nudge">
                <input
                  type="number"
                  min={0}
                  max={60}
                  className="field tabular-nums"
                  value={r.wait_days_before_nudge}
                  onChange={(e) => setR({ ...r, wait_days_before_nudge: Number(e.target.value) })}
                />
              </F>
            </div>
            <button className="btn-primary" disabled={save.isPending}>
              {save.isPending && <Loader2 className="size-4 animate-spin" />}Save rules
            </button>
          </form>
          <aside className="glass-card space-y-5 p-6">
            <div>
              <h2 className="text-lg font-semibold">How assistants use these rules</h2>
              <p className="mt-4 text-sm font-medium text-muted-foreground">Example reminder</p>
              <p className="glass-row mt-2 p-4 text-sm leading-6">
                {reminderExamples[r.reminder_tone]}
              </p>
            </div>
            <div className="space-y-3 border-t border-border pt-4 text-sm leading-6">
              <p>
                <span className="font-semibold">Max reminders: </span>
                assistants won&apos;t suggest more than {r.max_reminders} reminders for one invoice.
              </p>
              <p>
                <span className="font-semibold">Wait days: </span>
                assistants won&apos;t suggest a reminder until {r.wait_days_before_nudge} days after
                the balance invoice is sent.
              </p>
            </div>
          </aside>
        </div>
      )}
      {account?.user.is_demo && (
        <section className="glass-card mt-6 flex flex-wrap items-center justify-between gap-4 p-6">
          <div>
            <h2 className="font-semibold">Reset demo data</h2>
            <p className="text-sm text-muted-foreground">
              Restores Maya's services, bookings and proposals.
            </p>
          </div>
          <button className="btn-glass" disabled={reset.isPending} onClick={() => reset.mutate()}>
            {reset.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RotateCcw className="size-4" />
            )}
            Reset
          </button>
        </section>
      )}
    </>
  );
}

function F({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-sm text-muted-foreground">{hint}</span>}
    </label>
  );
}
