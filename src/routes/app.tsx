import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  CheckSquare,
  Coins,
  ExternalLink,
  LayoutList,
  Menu,
  Plug,
  ScrollText,
  Settings,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api, USE_MOCKS } from "@/lib/api";
import { money } from "@/lib/format";
import { Wordmark } from "@/components/kit";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/app")({
  head: () => ({
    meta: [
      { title: "Seller workspace — ServiceReady" },
      { name: "description", content: "Manage bookings, approvals and payments." },
      { property: "og:title", content: "Seller workspace — ServiceReady" },
      { property: "og:description", content: "Manage bookings, approvals and payments." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AppLayout,
});

const NAV = [
  { to: "/app", l: "Bookings", i: LayoutList, exact: true },
  { to: "/app/approvals", l: "Needs your approval", i: CheckSquare },
  { to: "/app/collections", l: "Who owes what", i: Coins },
  { to: "/app/log", l: "Activity log", i: ScrollText },
  { to: "/app/catalog", l: "Services & prices", i: BookOpen },
  { to: "/app/connect", l: "Connect AI assistants", i: Plug },
  { to: "/app/settings", l: "Settings", i: Settings },
] as const;

function AppLayout() {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => setOpen(false), [pathname]);
  const pending = useQuery({
    queryKey: ["proposals", "pending"],
    queryFn: () => api.listProposals("pending"),
  });
  const seller = useQuery({ queryKey: ["seller"], queryFn: api.getSeller });
  const count = pending.data?.length ?? 0;
  const slug = seller.data?.slug ?? "maya-rao-studio";
  return (
    <div className="min-h-screen bg-muted lg:grid lg:grid-cols-[260px_1fr]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-background focus:px-4 focus:py-2 focus:shadow"
      >
        Skip to content
      </a>
      <aside className="sticky top-0 z-30 border-b border-border bg-background lg:flex lg:h-screen lg:flex-col lg:border-b-0 lg:border-r">
        <div className="flex h-16 items-center justify-between px-5">
          <Link to="/" aria-label="ServiceReady home">
            <Wordmark />
          </Link>
          <button
            type="button"
            className="relative grid size-9 place-items-center rounded-lg border border-border lg:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="app-nav"
            onClick={() => setOpen(!open)}
          >
            {open ? <X className="size-4" /> : <Menu className="size-4" />}
            {!open && count > 0 && (
              <span
                className="absolute -right-1 -top-1 size-2.5 rounded-full bg-danger"
                aria-hidden="true"
              />
            )}
          </button>
        </div>
        <nav
          id="app-nav"
          aria-label="Workspace"
          className={`${open ? "flex" : "hidden"} flex-col gap-1 border-t border-border px-3 py-3 lg:flex lg:flex-1 lg:border-0`}
        >
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeOptions={{ exact: "exact" in n }}
              className="flex items-center gap-3 rounded-r-lg border-l-2 border-transparent px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              activeProps={{
                className: "!border-foreground bg-muted !font-semibold !text-foreground",
              }}
            >
              <n.i className="size-4" aria-hidden="true" />
              {n.l}
              {n.to === "/app/approvals" && count > 0 && (
                <span
                  className="ml-auto rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground"
                  aria-label={`${count} pending`}
                >
                  {count}
                </span>
              )}
            </Link>
          ))}
          <a
            href={`/s/${slug}`}
            target="_blank"
            rel="noreferrer"
            className="mt-2 flex items-center gap-3 border-l-2 border-transparent px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ExternalLink className="size-4" aria-hidden="true" />
            View public storefront
          </a>
        </nav>
        <div className="hidden border-t border-border p-5 text-sm lg:block">
          {seller.data ? (
            <p className="truncate font-semibold">{seller.data.name}</p>
          ) : (
            <Skeleton className="h-5 w-32" />
          )}
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
            {USE_MOCKS ? "Demo workspace · PayPal sandbox" : "Connected · PayPal sandbox"}
          </p>
        </div>
      </aside>
      <div className="min-w-0">
        <main id="main" className="mx-auto max-w-7xl px-4 py-6 sm:px-8 sm:py-7">
          <KPIs />
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function KPIs() {
  const { data, isLoading, isError } = useQuery({ queryKey: ["stats"], queryFn: api.getStats });
  if (isError) return null;
  const k = [
    { l: "Deposits received", v: data && money(data.deposits_collected_cents) },
    {
      l: "Still to collect",
      v: data && money(data.outstanding_cents),
      sub:
        data &&
        `${data.owed_by_client.length} open invoice${data.owed_by_client.length === 1 ? "" : "s"}`,
    },
    {
      l: "Fully paid",
      v: data && money(data.paid_cents),
      sub: data && `${data.by_status.paid} booking${data.by_status.paid === 1 ? "" : "s"}`,
    },
    {
      l: "Avg. time to pay balance",
      v: data && (data.avg_days_to_pay == null ? "—" : `${data.avg_days_to_pay} days`),
    },
  ];
  return (
    <section
      aria-label="Key numbers"
      className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-4"
    >
      {k.map((x) => (
        <div key={x.l} className="bg-card p-4 sm:p-5">
          <div className="text-xs font-medium text-muted-foreground">{x.l}</div>
          {isLoading || !x.v ? (
            <Skeleton className="mt-2 h-7 w-24" />
          ) : (
            <>
              <div className="mt-1 text-xl font-semibold tabular-nums sm:text-2xl">{x.v}</div>
              {x.sub && <div className="mt-0.5 text-xs text-muted-foreground">{x.sub}</div>}
            </>
          )}
        </div>
      ))}
    </section>
  );
}
