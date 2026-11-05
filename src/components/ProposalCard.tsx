import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, Clock3, Loader2, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Proposal } from "@/lib/types";
import { timeAgo } from "@/lib/format";
import { ActionPill, PayStatus } from "./kit";

export function ProposalCard({ p, showClient = true }: { p: Proposal; showClient?: boolean }) {
  const qc = useQueryClient(); const [draft, setDraft] = useState(p.draft_message);
  const done = () => ["proposals", "quote", "events", "stats", "quotes"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const approve = useMutation({ mutationFn: () => api.approveProposal(p.id, draft), onSuccess: () => { toast.success("Message approved and sent"); done(); } });
  const reject = useMutation({ mutationFn: () => api.rejectProposal(p.id), onSuccess: () => { toast("Message not sent"); done(); } });
  const pending = p.status === "pending";
  return <article className="glass-card p-5 sm:p-6">
    <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">Suggested:</span><ActionPill action={p.action} />{showClient && <Link to="/app/quotes/$id" params={{ id: p.quote_id }} className="text-link">{p.client_name}</Link>}<span className="ml-auto text-xs text-muted-foreground">{timeAgo(p.created_at)}</span></div>
    <p className="mt-4 text-sm"><span className="font-semibold">Why:</span> {p.reason}</p>
    <div className="mt-4 rounded-lg bg-muted p-3 text-sm"><div className="flex flex-wrap items-center gap-2"><ShieldCheck className="size-4" /><span className="font-semibold">PayPal evidence</span><PayStatus status={p.evidence.toLowerCase().includes("unpaid") ? "UNPAID" : "COMPLETED"} /><span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground"><Clock3 className="size-3" />checked {timeAgo(p.created_at)}</span></div><p className="mt-2 font-mono text-xs text-muted-foreground">{p.evidence}</p></div>
    {pending ? <><label className="mt-5 block text-sm font-semibold">Message to {p.client_name}</label><textarea className="field mt-2 leading-relaxed" rows={5} value={draft} onChange={(e) => setDraft(e.target.value)} /><div className="mt-3 flex flex-wrap gap-2"><button className="btn-mint btn-sm" disabled={approve.isPending || reject.isPending} onClick={() => approve.mutate()}>{approve.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}Approve & send</button><button className="btn-glass btn-sm" disabled={approve.isPending || reject.isPending} onClick={() => reject.mutate()}><X className="size-4" />Don't send</button></div></> : <p className="mt-4 text-sm text-muted-foreground">{p.status === "executed" ? "Approved and sent" : "Not sent"}</p>}
  </article>;
}