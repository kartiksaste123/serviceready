import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import type { AgentEvent } from "@/lib/types";
import { Empty, PageHeader } from "@/components/kit";
import { EventTimeline } from "@/components/EventTimeline";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/app/log")({
  head: () => ({
    meta: [
      { title: "Activity log — ServiceReady" },
      {
        name: "description",
        content: "A readable record of assistant, client, PayPal, and seller actions.",
      },
      { property: "og:title", content: "Activity log — ServiceReady" },
      { property: "og:description", content: "A readable record of actions." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Log,
});

const ACTORS: AgentEvent["actor"][] = [
  "seller_agent",
  "client_agent",
  "collections_agent",
  "paypal",
  "seller",
  "client",
  "system",
];
const ACTOR_LABELS: Record<AgentEvent["actor"], string> = {
  seller_agent: "Seller assistant",
  client_agent: "Client assistant",
  collections_agent: "Payment assistant",
  paypal: "PayPal",
  seller: "You",
  client: "Client",
  system: "ServiceReady",
};

function Log() {
  const [actor, setActor] = useState<AgentEvent["actor"] | "">("");
  const actorOptions: (AgentEvent["actor"] | "")[] = ["", ...ACTORS];
  const { data, isLoading } = useQuery({
    queryKey: ["events", actor],
    queryFn: () => api.listEvents(actor || undefined),
  });
  return (
    <>
      <PageHeader
        title="Activity log"
        sub="A plain record of what assistants, clients, PayPal and you did. Technical details stay folded away."
      />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {actorOptions.map((a) => (
          <button
            key={a || "all"}
            onClick={() => setActor(a)}
            className={`rounded-lg border px-2.5 py-1.5 text-sm ${actor === a ? "border-foreground bg-primary text-primary-foreground" : "border-input bg-background text-muted-foreground hover:text-foreground"}`}
          >
            {a ? ACTOR_LABELS[a] : "Everyone"}
          </button>
        ))}
      </div>
      <div className="glass-card p-5">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : !data?.length ? (
          <Empty title="No events for this actor" />
        ) : (
          <EventTimeline events={data} />
        )}
      </div>
    </>
  );
}
