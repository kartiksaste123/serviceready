import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { History, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { Empty, ErrorState, PageHeader } from "@/components/kit";
import { ProposalCard } from "@/components/ProposalCard";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/app/approvals")({
  head: () => ({
    meta: [
      { title: "Approvals — ServiceReady" },
      { name: "description", content: "Agent proposals waiting for your approval." },
      { property: "og:title", content: "Approvals — ServiceReady" },
      { property: "og:description", content: "Nothing is sent without you." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Approvals,
});

function Approvals() {
  const [tab, setTab] = useState<"pending" | "history">("pending");
  const pending = useQuery({
    queryKey: ["proposals", "pending"],
    queryFn: () => api.listProposals("pending"),
  });
  const all = useQuery({
    queryKey: ["proposals", "all"],
    queryFn: () => api.listProposals(),
    enabled: tab === "history",
  });
  const active = tab === "pending" ? pending : all;
  const rows =
    tab === "pending"
      ? (pending.data ?? [])
      : (all.data ?? []).filter((p) => p.status !== "pending");
  return (
    <>
      <PageHeader
        title="Needs your approval"
        sub="Nothing is sent without you. Assistants check PayPal first, then wait for your decision."
      />
      <div
        role="tablist"
        aria-label="Approvals"
        className="mb-4 inline-flex rounded-lg border border-border bg-background p-1"
      >
        {(["pending", "history"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {t === "pending"
              ? `Waiting${pending.data ? ` · ${pending.data.length}` : ""}`
              : "Decided"}
          </button>
        ))}
      </div>
      {active.isLoading ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      ) : active.isError ? (
        <ErrorState title="Couldn't load approvals" onRetry={() => active.refetch()} />
      ) : !rows.length ? (
        tab === "pending" ? (
          <Empty title="All caught up" icon={<ShieldCheck className="size-5" aria-hidden="true" />}>
            No assistant actions are waiting. Open a booking with an unpaid balance and run a
            payment check to get a suggestion.
          </Empty>
        ) : (
          <Empty title="No decisions yet" icon={<History className="size-5" aria-hidden="true" />}>
            Approved and dismissed suggestions will appear here as an audit record.
          </Empty>
        )
      ) : (
        <div className={`grid items-start gap-4 ${rows.length > 1 ? "xl:grid-cols-2" : ""}`}>
          {rows.map((p) => (
            <ProposalCard key={`${p.id}-${p.status}`} p={p} />
          ))}
        </div>
      )}
    </>
  );
}
