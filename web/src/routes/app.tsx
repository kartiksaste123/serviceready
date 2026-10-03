import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, CheckSquare, Coins, LayoutList, Plug, ScrollText, Settings } from "lucide-react";
import { api, USE_MOCKS } from "@/lib/api";
import { money } from "@/lib/format";
import { Wordmark } from "@/components/kit";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/app")({
  head: () => ({
    meta: [
      { title: "Seller console — ServiceReady" },
      { name: "description", content: "Bookings, approvals, collections and agent activity for your service business." },
      { property: "og:title", content: "Seller console — ServiceReady" },
      { property: "og:description", content: "Manage bookings, deposits and agent approvals." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AppLayout,
});

const NAV = [
  { to: "/app", l: "Bookings", i: LayoutList, exact: true },
  { to: "/app/approvals", l: "Approvals", i: CheckSquare },
  { to: "/app/collections", l: "Collections", i: Coins },
  { to: "/app/log", l: "Agent log", i: ScrollText },
  { to: "/app/connect", l: "Connect agents", i: Plug },
  { to: "/app/catalog", l: "Catalog", i: BookOpen },
  { to: "/app/settings", l: "Settings", i: Settings },
] as const;

function AppLayout() {
  const pending = useQuery({ queryKey: ["proposals", "pending"], queryFn: () => api.listProposals("pending") });
  const count = pending.data?.length ?? 0;
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="sticky top-0 z-30 border-b border-cream/10 bg-deep-950/95 backdrop-blur-md lg:h-screen lg:border-b-0 lg:border-r">
        <div className="flex h-16 items-center px-5"><Link to="/"><Wordmark /></Link></div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:pb-0">
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} activeOptions={{ exact: "exact" in n }} className="flex shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] text-cream/70 transition hover:bg-cream/[0.05] hover:text-cream" activeProps={{ className: "bg-mint/[0.12] !text-mint" }}>
              <n.i className="size-4" />{n.l}
              {n.to === "/app/approvals" && count > 0 && <span className="ml-auto rounded-full bg-warn px-1.5 text-[11px] font-bold tabular-nums text-deep-950">{count}</span>}
            </Link>
          ))}
        </nav>
        <div className="absolute bottom-5 left-5 right-5 hidden lg:block">
          <div className="glass-row p-3 text-[12px]"><div className="font-semibold">Maya Rao Studio</div><div className="text-cream/55">{USE_MOCKS ? "Demo data · PayPal sandbox" : "PayPal sandbox"}</div></div>
        </div>
      </aside>
      <div className="min-w-0">
        <div className="mx-auto max-w-6xl px-5 py-6 sm:px-8 sm:py-8">
          <KPIs />
          <Outlet />
        </div>
      </div>
    </div>
  );
}

function KPIs() {
  const { data, isLoading } = useQuery({ queryKey: ["stats"], queryFn: api.getStats });
  const k = [
    { l: "Deposits collected", v: data && money(data.deposits_collected_cents), mint: true },
    { l: "Outstanding balances", v: data && money(data.outstanding_cents), warn: true },
    { l: "Paid", v: data && money(data.paid_cents) },
    { l: "Avg days to pay", v: data && (data.avg_days_to_pay == null ? "—" : `${data.avg_days_to_pay} d`) },
  ];
  return (
    <div className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-cream/10 ringline lg:grid-cols-4">
      {k.map((x) => (
        <div key={x.l} className="bg-deep-950/70 p-4 sm:p-5">
          <div className="text-[11px] uppercase tracking-wider text-cream/55">{x.l}</div>
          {isLoading || !x.v ? <Skeleton className="mt-2 h-7 w-24" /> : <div className={`mt-1 text-xl font-bold tabular-nums sm:text-2xl ${x.mint ? "text-mint" : x.warn ? "text-warn" : ""}`}>{x.v}</div>}
        </div>
      ))}
    </div>
  );
}
