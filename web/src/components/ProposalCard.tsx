import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, Loader2, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Proposal } from "@/lib/types";
import { timeAgo } from "@/lib/format";
import { ActionPill } from "./kit";

export function ProposalCard({ p, showClient = true }: { p: Proposal; showClient?: boolean }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState(p.draft_message);
  const done = () => { ["proposals", "quote", "events", "stats", "quotes"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); };
  const approve = useMutation({ mutationFn: () => api.approveProposal(p.id, draft), onSuccess: () => { toast.success("Approved and sent"); done(); } });
  const reject = useMutation({ mutationFn: () => api.rejectProposal(p.id), onSuccess: () => { toast("Proposal rejected"); done(); } });
  const pending = p.status === "pending";
  return (
    <div className="glass-card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <ActionPill action={p.action} />
        {showClient && <Link to="/app/quotes/$id" params={{ id: p.quote_id }} className="font-semibold hover:text-mint">{p.client_name}</Link>}
        <span className="ml-auto text-[12px] text-cream/50">{timeAgo(p.created_at)}</span>
      </div>
      <p className="mt-3 text-sm text-cream/80">{p.reason}</p>
      <p className="glass-row mt-3 flex items-center gap-2 px-3 py-2 font-mono text-[12px] text-cream/80"><ShieldCheck className="size-3.5 shrink-0 text-mint" />{p.evidence}</p>
      {pending ? (
        <>
          <label className="mt-4 block text-[11px] uppercase tracking-wider text-cream/55">Draft message</label>
          <textarea className="field mt-1.5 text-[13px] leading-relaxed" rows={5} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button className="btn-mint btn-sm" disabled={approve.isPending || reject.isPending} onClick={() => approve.mutate()}>{approve.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}Approve</button>
            <button className="btn-glass btn-sm" disabled={approve.isPending || reject.isPending} onClick={() => reject.mutate()}><X className="size-3.5" />Reject</button>
            <span className="text-[12px] text-cream/50">Nothing is sent without you.</span>
          </div>
        </>
      ) : (
        <p className="mt-3 text-[12px] uppercase tracking-wider text-cream/55">Status: <span className={p.status === "executed" ? "text-mint" : ""}>{p.status}</span></p>
      )}
    </div>
  );
}
