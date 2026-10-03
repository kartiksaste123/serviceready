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

function SettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["seller"], queryFn: api.getSeller });
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
        <form
          className="glass-card max-w-2xl space-y-5 p-6"
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
      )}
      <section className="glass-card mt-6 flex max-w-2xl flex-wrap items-center justify-between gap-4 p-6">
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
    </>
  );
}

function F({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-sm text-muted-foreground">{hint}</span>}
    </label>
  );
}
