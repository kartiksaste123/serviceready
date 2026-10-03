import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import type { AgentEvent } from "@/lib/types";
import { Empty, PageHeader } from "@/components/kit";
import { EventTimeline } from "@/components/EventTimeline";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/app/log")({
  head: () => ({ meta: [{ title: "Agent log — ServiceReady" }, { name: "description", content: "Full audit log of every agent and PayPal action." }, { property: "og:title", content: "Agent log — ServiceReady" }, { property: "og:description", content: "Full audit log." }] }),
  component: Log,
});

const ACTORS: AgentEvent["actor"][] = ["seller_agent", "client_agent", "collections_agent", "paypal", "seller", "client", "system"];

function Log() {
  const [actor, setActor] = useState<AgentEvent["actor"] | "">("");
  const actorOptions: (AgentEvent["actor"] | "")[] = ["", ...ACTORS];
  const { data, isLoading } = useQuery({ queryKey: ["events", actor], queryFn: () => api.listEvents(actor || undefined) });
  return (
    <>
      <PageHeader title="Agent log" sub="Every tool call, webhook and approval — with inputs and outputs." />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {actorOptions.map((a) => (
          <button key={a || "all"} onClick={() => setActor(a)} className={`rounded-lg border border-dashed px-2.5 py-1.5 text-[12px] ${actor === a ? "border-mint/50 bg-mint/[0.12] text-mint" : "border-cream/15 text-cream/65 hover:text-cream"}`}>{a ? a.replace("_", " ") : "All actors"}</button>
        ))}
      </div>
      <div className="glass-card p-5">
        {isLoading ? <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          : !data?.length ? <Empty title="No events for this actor" />
          : <EventTimeline events={data} />}
      </div>
    </>
  );
}
