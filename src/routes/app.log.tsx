import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { api } from "@/lib/api";
import type { AgentEvent } from "@/lib/types";
import { Empty, ErrorState, PageHeader } from "@/components/kit";
import { EventTimeline } from "@/components/EventTimeline";
import { actorLabel } from "@/lib/labels";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/app/log")({
  head: () => ({
    meta: [
      { title: "Activity log — ServiceReady" },
      { name: "description", content: "Full audit log of every agent and PayPal action." },
      { property: "og:title", content: "Activity log — ServiceReady" },
      { property: "og:description", content: "Full audit log." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Log,
});

const ACTORS: AgentEvent["actor"][] = [
  "seller",
  "client",
  "paypal",
  "collections_agent",
  "seller_agent",
  "client_agent",
  "system",
];
const STEP = 40;

function Log() {
  const [actor, setActor] = useState<AgentEvent["actor"] | "">("");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(STEP);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["events", actor],
    queryFn: () => api.listEvents(actor || undefined),
  });
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n
      ? (data ?? []).filter((e) =>
          `${e.text ?? ""} ${e.tool ?? ""} ${e.quote_id ?? ""}`.toLowerCase().includes(n),
        )
      : (data ?? []);
  }, [data, q]);
  return (
    <>
      <PageHeader
        title="Activity log"
        sub="Every quote, PayPal payment, approval and assistant action — newest first."
        tour="log"
      />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative lg:w-72">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="text"
            aria-label="Search activity"
            className="field h-9 pl-8"
            placeholder="Search text, tool or booking…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setLimit(STEP);
            }}
          />
        </div>
        <div
          className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:pb-0"
          role="group"
          aria-label="Filter by who acted"
        >
          {(["", ...ACTORS] as const).map((a) => (
            <button
              type="button"
              key={a || "all"}
              aria-pressed={actor === a}
              onClick={() => {
                setActor(a);
                setLimit(STEP);
              }}
              className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-sm ${actor === a ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background text-muted-foreground hover:text-foreground"}`}
            >
              {a ? actorLabel[a] : "Everyone"}
            </button>
          ))}
        </div>
      </div>
      <div
        data-tour="log-main"
        className="glass-card scroll-panel max-h-[max(360px,calc(100vh-16rem))] p-5"
      >
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState title="Couldn't load activity" onRetry={() => refetch()} />
        ) : !rows.length ? (
          <Empty
            title={q ? "No activity matches your search" : "No activity for this filter yet"}
          />
        ) : (
          <>
            <EventTimeline events={rows.slice(0, limit)} showQuoteLink />
            {rows.length > limit && (
              <div className="mt-5 flex justify-center border-t border-border pt-4">
                <button
                  type="button"
                  className="btn-glass btn-sm"
                  onClick={() => setLimit(limit + STEP)}
                >
                  Show more ({rows.length - limit} older)
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
