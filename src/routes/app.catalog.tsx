import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, ExternalLink, Upload } from "lucide-react";
import { api } from "@/lib/api";
import { money0 } from "@/lib/format";
import { depositOf } from "@/lib/validation";
import { Empty, ErrorState, PageHeader } from "@/components/kit";
import { ServiceImageField } from "@/components/ServiceImageField";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/app/catalog")({
  head: () => ({
    meta: [
      { title: "Services & prices — ServiceReady" },
      { name: "description", content: "Your published, agent-ready services." },
      { property: "og:title", content: "Services & prices — ServiceReady" },
      { property: "og:description", content: "Published services." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Catalog,
});

function Catalog() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["services"],
    queryFn: api.listServices,
  });
  const seller = useQuery({ queryKey: ["seller"], queryFn: api.getSeller });
  const slug = seller.data?.slug ?? "maya-rao-studio";
  const published = data?.filter((s) => s.status === "published").length ?? 0;
  return (
    <>
      <PageHeader
        title="Services & prices"
        sub={
          data
            ? `${published} published service${published === 1 ? "" : "s"} that AI assistants and clients can quote and book.`
            : "What AI assistants and clients can book."
        }
        tour="catalog"
      >
        <Link
          to="/s/$slug"
          params={{ slug }}
          className="btn-glass btn-sm"
          data-tour="catalog-storefront"
        >
          <ExternalLink className="size-3.5" aria-hidden="true" />
          View storefront
        </Link>
        <Link to="/onboard" className="btn-mint btn-sm" data-tour="catalog-import">
          <Upload className="size-3.5" aria-hidden="true" />
          Import rate card
        </Link>
      </PageHeader>
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-44 rounded-2xl" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState title="Couldn't load your services" onRetry={() => refetch()} />
      ) : !data?.length ? (
        <Empty title="No services yet">
          <Link to="/onboard" className="text-link">
            Import your rate card
          </Link>{" "}
          to publish your first services.
        </Empty>
      ) : (
        <div className="scroll-panel -m-1 grid gap-4 p-1 sm:grid-cols-2 lg:max-h-[calc(100vh-12rem)] xl:grid-cols-3 2xl:grid-cols-4">
          {data.map((s, idx) => (
            <article
              key={s.id}
              className="glass-card flex flex-col p-5"
              {...(idx === 0 ? { "data-tour": "service-card" } : {})}
            >
              <div className="mb-3" {...(idx === 0 ? { "data-tour": "service-cover" } : {})}>
                <ServiceImageField
                  title={s.title}
                  description={s.description}
                  deliverables={s.deliverables}
                  imageUrl={s.image_url ?? null}
                  serviceId={s.id}
                  signedIn
                  onChange={() => {
                    void qc.invalidateQueries({ queryKey: ["services"] });
                    void qc.invalidateQueries({ queryKey: ["public"] });
                  }}
                />
              </div>
              <div className="flex justify-between gap-3">
                <h2 className="font-semibold">{s.title}</h2>
                <span className="font-bold tabular-nums">{money0(s.price_cents)}</span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{s.description}</p>
              {s.deliverables.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {s.deliverables.map((d) => (
                    <li
                      key={d}
                      className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground"
                    >
                      {d}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-auto flex flex-wrap gap-2 pt-4 text-sm">
                <span className="rounded-md bg-success-bg px-2 py-0.5 font-medium text-success tabular-nums">
                  {s.deposit_pct}% deposit · {money0(depositOf(s.price_cents, s.deposit_pct))}
                </span>
                <span className="flex items-center gap-1 rounded-md bg-muted px-2 py-0.5">
                  <Clock className="size-3" aria-hidden="true" />
                  {s.lead_time_days} day{s.lead_time_days === 1 ? "" : "s"}
                </span>
                <span
                  className={`rounded-md px-2 py-0.5 capitalize ${s.status === "published" ? "bg-muted" : "bg-warning-bg text-warning"}`}
                >
                  {s.status}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
      <p className="mt-6 text-sm text-muted-foreground">
        To change a price, import an updated rate card — services with the same name are updated
        instead of duplicated.
      </p>
    </>
  );
}
