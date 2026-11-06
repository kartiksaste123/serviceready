import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { api, USE_MOCKS } from "@/lib/api";
import type { SellerRules } from "@/lib/types";
import { rulesErrors } from "@/lib/validation";
import { DEFAULT_CANCEL_POLICY, describeCancelPolicy } from "@/lib/cancel-policy";
import { ErrorState, Field, PageHeader } from "@/components/kit";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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

const TONES = [
  { t: "friendly", l: "Friendly", d: "Warm, no pressure" },
  { t: "neutral", l: "Neutral", d: "Short and factual" },
  { t: "firm", l: "Firm", d: "Clear due dates" },
] as const;

// Keep raw strings while typing so clearing a field doesn't silently become 0.
type Draft = {
  default_deposit_pct: string;
  max_reminders: string;
  wait_days_before_nudge: string;
  reminder_tone: SellerRules["reminder_tone"];
  free_cancel_hours: string;
  late_cancel_keep_pct: string;
  no_show_keep_pct: string;
};
const toDraft = (r: SellerRules): Draft => {
  const cp = r.cancel_policy ?? DEFAULT_CANCEL_POLICY;
  return {
    default_deposit_pct: String(r.default_deposit_pct),
    max_reminders: String(r.max_reminders),
    wait_days_before_nudge: String(r.wait_days_before_nudge),
    reminder_tone: r.reminder_tone,
    free_cancel_hours: String(cp.free_cancel_hours),
    late_cancel_keep_pct: String(cp.late_cancel_keep_pct),
    no_show_keep_pct: String(cp.no_show_keep_pct),
  };
};
const num = (s: string) => (s.trim() === "" ? NaN : Number(s));
const toRules = (d: Draft): SellerRules => ({
  default_deposit_pct: num(d.default_deposit_pct),
  max_reminders: num(d.max_reminders),
  wait_days_before_nudge: num(d.wait_days_before_nudge),
  reminder_tone: d.reminder_tone,
  cancel_policy: {
    free_cancel_hours: num(d.free_cancel_hours),
    late_cancel_keep_pct: num(d.late_cancel_keep_pct),
    no_show_keep_pct: num(d.no_show_keep_pct),
  },
});

function SettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["seller"],
    queryFn: api.getSeller,
  });
  const [d, setD] = useState<Draft | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => {
    if (data) setD(toDraft(data.rules));
  }, [data]);
  const rules = d ? toRules(d) : null;
  const errors = rules ? rulesErrors(rules) : {};
  const valid = Object.keys(errors).length === 0;
  const dirty = !!(data && d && JSON.stringify(toDraft(data.rules)) !== JSON.stringify(d));
  const save = useMutation({
    mutationFn: () => {
      if (!rules || !valid) throw new Error("Fix the highlighted fields first");
      return api.updateRules(rules);
    },
    onSuccess: (s) => {
      qc.setQueryData(["seller"], s);
      qc.invalidateQueries({ queryKey: ["events"] });
      toast.success("Rules saved — assistants will use them from the next check");
    },
  });
  const reset = useMutation({
    mutationFn: api.resetDemo,
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("Demo data restored");
    },
  });
  const set = (patch: Partial<Draft>) => d && setD({ ...d, ...patch });

  return (
    <>
      <PageHeader
        title="Settings"
        sub="Your business rules — deposit, reminders and cancellations. Assistants and quotes always follow them."
        tour="settings"
      />
      {isLoading ? (
        <Skeleton className="h-80 rounded-2xl" />
      ) : isError || !d ? (
        <ErrorState title="Couldn't load settings" onRetry={() => refetch()} />
      ) : (
        <form
          data-tour="settings-form"
          className="glass-card p-5 sm:p-6"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
            <div>
              <h2 className="font-semibold">Deposits</h2>
              <div className="mt-3">
                <Field
                  htmlFor="dep"
                  label="Default deposit (%)"
                  hint="Applied to newly imported services. You can change it per service before publishing."
                  error={errors.default_deposit_pct}
                >
                  <input
                    id="dep"
                    inputMode="numeric"
                    type="number"
                    min={1}
                    max={100}
                    step={1}
                    aria-invalid={!!errors.default_deposit_pct}
                    aria-describedby={errors.default_deposit_pct ? "dep-error" : "dep-hint"}
                    className={`field tabular-nums sm:max-w-40 ${errors.default_deposit_pct ? "border-danger" : ""}`}
                    value={d.default_deposit_pct}
                    onChange={(e) => set({ default_deposit_pct: e.target.value })}
                  />
                </Field>
              </div>
            </div>
            <div className="border-t border-border pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
              <h2 className="font-semibold">Payment follow-ups</h2>
              <fieldset className="mt-3">
                <legend className="mb-1.5 block text-sm font-medium">Reminder tone</legend>
                <div className="grid gap-2 sm:grid-cols-3" role="radiogroup">
                  {TONES.map(({ t, l, d: desc }) => (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={d.reminder_tone === t}
                      key={t}
                      onClick={() => set({ reminder_tone: t })}
                      className={`min-h-11 rounded-lg border px-3 py-2.5 text-left text-sm ${d.reminder_tone === t ? "border-primary bg-primary text-primary-foreground" : "border-input text-muted-foreground hover:bg-muted"}`}
                    >
                      <span className="block font-semibold">{l}</span>
                      <span className="block text-xs opacity-80">{desc}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
              <div className="mt-4 grid gap-5 sm:grid-cols-2">
                <Field
                  htmlFor="wait"
                  label="Wait before first nudge (days)"
                  hint="Grace period after the invoice is sent."
                  error={errors.wait_days_before_nudge}
                >
                  <input
                    id="wait"
                    type="number"
                    min={0}
                    max={60}
                    step={1}
                    aria-invalid={!!errors.wait_days_before_nudge}
                    className={`field tabular-nums ${errors.wait_days_before_nudge ? "border-danger" : ""}`}
                    value={d.wait_days_before_nudge}
                    onChange={(e) => set({ wait_days_before_nudge: e.target.value })}
                  />
                </Field>
                <Field
                  htmlFor="max"
                  label="Max reminders"
                  hint="After this, the assistant flags it for you instead."
                  error={errors.max_reminders}
                >
                  <input
                    id="max"
                    type="number"
                    min={0}
                    max={10}
                    step={1}
                    aria-invalid={!!errors.max_reminders}
                    className={`field tabular-nums ${errors.max_reminders ? "border-danger" : ""}`}
                    value={d.max_reminders}
                    onChange={(e) => set({ max_reminders: e.target.value })}
                  />
                </Field>
              </div>
            </div>
          </div>
          <div className="mt-6 border-t border-border pt-6">
            <h2 className="font-semibold">Cancellation &amp; no-show policy</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Enforced automatically on cancel: held deposits are voided or partially captured, paid
              deposits are refunded. Agents can quote it but never change it.
            </p>
            <div className="mt-4 grid gap-5 sm:grid-cols-3">
              <Field
                htmlFor="fch"
                label="Free-cancel window (hours)"
                hint="After the deposit is paid, before work starts."
                error={errors.free_cancel_hours}
              >
                <input
                  id="fch"
                  type="number"
                  min={0}
                  max={720}
                  step={1}
                  aria-invalid={!!errors.free_cancel_hours}
                  className={`field tabular-nums ${errors.free_cancel_hours ? "border-danger" : ""}`}
                  value={d.free_cancel_hours}
                  onChange={(e) => set({ free_cancel_hours: e.target.value })}
                />
              </Field>
              <Field
                htmlFor="lck"
                label="Late cancel: keep (% of deposit)"
                hint="0 = full refund, 100 = keep all."
                error={errors.late_cancel_keep_pct}
              >
                <input
                  id="lck"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  aria-invalid={!!errors.late_cancel_keep_pct}
                  className={`field tabular-nums ${errors.late_cancel_keep_pct ? "border-danger" : ""}`}
                  value={d.late_cancel_keep_pct}
                  onChange={(e) => set({ late_cancel_keep_pct: e.target.value })}
                />
              </Field>
              <Field
                htmlFor="nsk"
                label="No-show: keep (% of deposit)"
                hint="Client unreachable or didn't show."
                error={errors.no_show_keep_pct}
              >
                <input
                  id="nsk"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  aria-invalid={!!errors.no_show_keep_pct}
                  className={`field tabular-nums ${errors.no_show_keep_pct ? "border-danger" : ""}`}
                  value={d.no_show_keep_pct}
                  onChange={(e) => set({ no_show_keep_pct: e.target.value })}
                />
              </Field>
            </div>
            {rules?.cancel_policy && valid && (
              <p className="glass-row mt-4 p-3 text-sm" aria-live="polite">
                <span className="font-medium">Clients and agents see: </span>
                {describeCancelPolicy(rules.cancel_policy)}
              </p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Applies to new quotes; existing quotes keep the policy they were booked under.
            </p>
          </div>
          <div className="sticky bottom-0 z-10 -mx-5 mt-6 flex flex-wrap items-center gap-3 border-t border-border bg-card/95 px-5 py-4 backdrop-blur sm:-mx-6 sm:px-6">
            <button
              type="submit"
              className="btn-mint"
              disabled={save.isPending || !dirty || !valid}
            >
              {save.isPending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}Save
              rules
            </button>
            {dirty && (
              <button
                type="button"
                className="btn-glass"
                onClick={() => data && setD(toDraft(data.rules))}
              >
                Discard changes
              </button>
            )}
            <span className="text-sm text-muted-foreground" aria-live="polite">
              {!dirty
                ? "All changes saved"
                : !valid
                  ? "Fix the highlighted fields"
                  : "Unsaved changes"}
            </span>
          </div>
        </form>
      )}
      {USE_MOCKS && (
        <section className="glass-card mt-5 flex flex-wrap items-center justify-between gap-4 p-6">
          <div>
            <h2 className="font-semibold">Reset demo data</h2>
            <p className="text-sm text-muted-foreground">
              Restores Maya's services, bookings and suggestions. Anything you created in this demo
              is removed.
            </p>
          </div>
          <button
            type="button"
            className="btn-glass"
            disabled={reset.isPending}
            onClick={() => setConfirmReset(true)}
          >
            {reset.isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <RotateCcw className="size-4" aria-hidden="true" />
            )}
            Reset
          </button>
        </section>
      )}
      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent className="border-border bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Reset all demo data?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Quotes, payments and settings you changed will be replaced with the original demo
              data. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="btn-glass">Cancel</AlertDialogCancel>
            <AlertDialogAction className="btn-mint" onClick={() => reset.mutate()}>
              Reset demo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
