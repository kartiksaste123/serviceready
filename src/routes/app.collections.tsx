import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ErrorState, PageHeader } from "@/components/kit";
import { CollectionsStudio } from "@/components/CollectionsStudio";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/app/collections")({
  head: () => ({
    meta: [
      { title: "Collections — ServiceReady" },
      { name: "description", content: "Who still owes what." },
      { property: "og:title", content: "Collections — ServiceReady" },
      { property: "og:description", content: "Who still owes what." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Collections,
});

function Collections() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["stats"],
    queryFn: api.getStats,
  });
  return (
    <>
      <PageHeader
        title="Who owes what"
        sub="Open balance invoices, oldest first. Open a client to check PayPal and draft a follow-up for your approval."
      />
      {isLoading ? (
        <Skeleton className="h-80 rounded-2xl" />
      ) : isError || !data ? (
        <ErrorState title="Couldn't load balances" onRetry={() => refetch()} />
      ) : (
        <CollectionsStudio stats={data} />
      )}
    </>
  );
}
