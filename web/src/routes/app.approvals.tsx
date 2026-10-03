import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { Empty, PageHeader } from "@/components/kit";
import { ProposalCard } from "@/components/ProposalCard";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/app/approvals")({
  head: () => ({ meta: [{ title: "Approvals — ServiceReady" }, { name: "description", content: "Agent proposals waiting for your approval." }, { property: "og:title", content: "Approvals — ServiceReady" }, { property: "og:description", content: "Nothing is sent without you." }] }),
  component: Approvals,
});

function Approvals() {
  const { data, isLoading } = useQuery({ queryKey: ["proposals", "pending"], queryFn: () => api.listProposals("pending") });
  return (
    <>
      <PageHeader title="Approvals" sub="Nothing is sent without you. Agents check PayPal first, then wait for your call." />
      {isLoading ? <div className="space-y-3"><Skeleton className="h-64" /><Skeleton className="h-64" /></div>
        : !data?.length ? <Empty title="All caught up" icon={<ShieldCheck className="size-5" />}>No agent actions are waiting. Run the collections agent on a booking to generate one.</Empty>
        : <div className="space-y-4">{data.map((p) => <ProposalCard key={p.id} p={p} />)}</div>}
    </>
  );
}
