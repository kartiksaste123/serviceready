import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Check, Clock, Copy, ExternalLink, FileText, Upload } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { money0 } from "@/lib/format";
import { Empty, PageHeader } from "@/components/kit";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/app/catalog")({
  head: () => ({
    meta: [
      { title: "Catalog — ServiceReady" },
      { name: "description", content: "Your published, agent-ready services." },
      { property: "og:title", content: "Catalog — ServiceReady" },
      { property: "og:description", content: "Published services." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Catalog,
});

function Catalog() {
  const { data, isLoading } = useQuery({ queryKey: ["services"], queryFn: api.listServices });
  const { data: seller } = useQuery({ queryKey: ["seller"], queryFn: api.getSeller });
  const storefrontUrl =
    seller && typeof window !== "undefined"
      ? `${window.location.origin}/s/${seller.slug}`
      : "";
  return (
    <>
      <PageHeader title="Services & prices" sub="What AI assistants and clients can book.">
        {seller && (
          <Link to="/s/$slug" params={{ slug: seller.slug }} className="btn-glass btn-sm">
            View storefront
          </Link>
        )}
        <Link to="/onboard" className="btn-primary btn-sm">
          <Upload className="size-3.5" />
          Import rate card
        </Link>
      </PageHeader>
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40 rounded-2xl" />
          ))}
        </div>
      ) : !data?.length ? (
        <Empty title="No services yet">
          <Link to="/onboard" className="text-link">
            Import your rate card
          </Link>{" "}
          to get started.
        </Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {data.map((s) => (
            <div key={s.id} className="glass-card p-5">
              <div className="flex justify-between gap-3">
                <h2 className="font-semibold">{s.title}</h2>
                <span className="font-bold tabular-nums">{money0(s.price_cents)}</span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{s.description}</p>
              <div className="mt-3 flex flex-wrap gap-2 text-sm">
                <span className="rounded-md bg-muted px-2 py-0.5 text-foreground">
                  {s.deposit_pct}% deposit
                </span>
                <span className="flex items-center gap-1 rounded-md bg-muted px-2 py-0.5">
                  <Clock className="size-3" />
                  {s.lead_time_days > 0 ? `${s.lead_time_days}d` : "—"}
                </span>
                <span
                  className={`flex items-center gap-1 rounded-md px-2 py-0.5 ${s.status === "published" ? "bg-success-bg text-success" : "bg-muted text-muted-foreground"}`}
                >
                  {s.status === "published" ? (
                    <Check className="size-3.5" />
                  ) : (
                    <FileText className="size-3.5" />
                  )}
                  {s.status === "published" ? "Published" : "Draft"}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
      <section className="glass-card mt-5 p-5">
        <h2 className="font-semibold">How clients find you</h2>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
          <p className="min-w-0 flex-1 break-all rounded-lg border border-border bg-muted px-3 py-2 font-mono text-sm text-link">
            {storefrontUrl || "Loading storefront link…"}
          </p>
          <div className="flex shrink-0 gap-2">
            {storefrontUrl ? (
              <a
                href={storefrontUrl}
                target="_blank"
                rel="noreferrer"
                className="btn-glass btn-sm"
              >
                <ExternalLink className="size-3.5" />
                Open
              </a>
            ) : (
              <button className="btn-glass btn-sm" disabled>
                <ExternalLink className="size-3.5" />
                Open
              </button>
            )}
            <button
              className="btn-glass btn-sm"
              disabled={!storefrontUrl}
              onClick={() => {
                if (!storefrontUrl) return;
                navigator.clipboard.writeText(storefrontUrl);
                toast.success("Storefront link copied");
              }}
            >
              <Copy className="size-3.5" />
              Copy
            </button>
          </div>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          AI assistants can also book you through your{" "}
          <Link to="/app/connect" className="text-link">
            connection link
          </Link>
          .
        </p>
      </section>
    </>
  );
}
