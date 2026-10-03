import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/kit";
import { CollectionsStudio } from "@/components/CollectionsStudio";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/app/collections")({
  head: () => ({ meta: [{ title: "Collections — ServiceReady" }, { name: "description", content: "Who still owes what." }, { property: "og:title", content: "Collections — ServiceReady" }, { property: "og:description", content: "Who still owes what." }] }),
  component: Collections,
});

function Collections() {
  const { data, isLoading } = useQuery({ queryKey: ["stats"], queryFn: api.getStats });
  return (
    <>
      <PageHeader title="Who still owes what" sub="A friendly view of open balances, deposits, and bookings." />
      {isLoading || !data ? <Skeleton className="h-80 rounded-2xl" /> : <CollectionsStudio stats={data} />}
    </>
  );
}
