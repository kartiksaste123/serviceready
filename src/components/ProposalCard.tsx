import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, Clock3, Loader2, Send, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Proposal } from "@/lib/types";
import { timeAgo } from "@/lib/format";
import { LIMITS } from "@/lib/validation";
import { ActionPill, PayStatus } from "./kit";

const evidenceStatus = (e: string) => e.match(/status:\s*([A-Z_]+)/)?.[1];
const outcome: Record<Proposal["status"], string> = {
  pending: "",
  executed: "Approved — message sent to the client",
  approved: "Approved — no message sent",
  rejected: "Dismissed — nothing was sent",
  failed: "Failed to send — try running the check again",
};

export function ProposalCard({ p, showClient = true }: { p: Proposal; showClient?: boolean }) {
  const qc = useQueryClient();
  const fieldId = useId();
  const [draft, setDraft] = useState(p.draft_message);
  const sends = p.action !== "wait";
  const done = () =>
    ["proposals", "quote", "events", "stats", "quotes"].forEach((k) =>
      qc.invalidateQueries({ queryKey: [k] }),
    );
  const approve = useMutation({
    mutationFn: () => api.approveProposal(p.id, draft),
    onSuccess: () => {
      toast.success(
        sends ? `Message sent to ${p.client_name}` : "Okay — the assistant will keep waiting",
      );
      done();
    },
  });
  const reject = useMutation({
    mutationFn: () => api.rejectProposal(p.id),
    onSuccess: () => {
      toast("Suggestion dismissed — nothing was sent");
      done();
    },
  });
  const pending = p.status === "pending";
  const busy = approve.isPending || reject.isPending;
  const status = evidenceStatus(p.evidence);
  const edited = draft.trim() !== p.draft_message.trim();
  return (
    <article className="glass-card p-5 sm:p-6" aria-labelledby={`${fieldId}-title`}>
      <div className="flex flex-wrap items-center gap-2">
        <span id={`${fieldId}-title`} className="font-semibold">
          Suggested:
        </span>
        <ActionPill action={p.action} />
        {showClient && (
          <Link to="/app/quotes/$id" params={{ id: p.quote_id }} className="text-link">
            {p.client_name}
          </Link>
        )}
        <time dateTime={p.created_at} className="ml-auto text-xs text-muted-foreground">
          {timeAgo(p.created_at)}
        </time>
      </div>
      <p className="mt-4 text-sm">
        <span className="font-semibold">Why:</span> {p.reason}
      </p>
      <div className="mt-4 rounded-lg bg-muted p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <ShieldCheck className="size-4" aria-hidden="true" />
          <span className="font-semibold">PayPal evidence</span>
          <PayStatus status={status} />
          <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
            <Clock3 className="size-3" aria-hidden="true" />
            checked {timeAgo(p.created_at)}
          </span>
        </div>
        <p className="mt-2 break-all font-mono text-xs text-muted-foreground">{p.evidence}</p>
      </div>
      {pending ? (
        <>
          <label htmlFor={fieldId} className="mt-5 block text-sm font-semibold">
            {sends ? `Message to ${p.client_name}` : `Draft nudge (not sent while waiting)`}
          </label>
          <textarea
            id={fieldId}
            className="field mt-2 leading-relaxed"
            rows={5}
            maxLength={LIMITS.message}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="mt-1 flex justify-between text-xs text-muted-foreground">
            <span>
              {edited
                ? "Edited — your version will be sent"
                : sends
                  ? "Review and edit before sending"
                  : "Approving keeps waiting; dismiss to clear the suggestion"}
            </span>
            <span className="tabular-nums">
              {draft.length}/{LIMITS.message}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-mint btn-sm"
              disabled={busy || (sends && !draft.trim())}
              onClick={() => approve.mutate()}
            >
              {approve.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : sends ? (
                <Send className="size-4" aria-hidden="true" />
              ) : (
                <Check className="size-4" aria-hidden="true" />
              )}
              {sends ? "Approve & send" : "Agree, keep waiting"}
            </button>
            <button
              type="button"
              className="btn-glass btn-sm"
              disabled={busy}
              onClick={() => reject.mutate()}
            >
              {reject.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <X className="size-4" aria-hidden="true" />
              )}
              {sends ? "Don't send" : "Dismiss"}
            </button>
          </div>
        </>
      ) : (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          {p.status === "executed" || p.status === "approved" ? (
            <Check className="size-4 text-success" aria-hidden="true" />
          ) : (
            <X className="size-4" aria-hidden="true" />
          )}
          {outcome[p.status]}
        </p>
      )}
    </article>
  );
}
