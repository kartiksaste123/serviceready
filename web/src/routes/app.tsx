import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  CheckSquare,
  Coins,
  LayoutList,
  Menu,
  Plug,
  ScrollText,
  Settings,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
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
  { to: "/app/connect", l: "Connect AI assistants", i: Plug },
  { to: "/app/catalog", l: "Services & prices", i: BookOpen },
  { to: "/app/settings", l: "Settings", i: Settings },
] as const;
function AppLayout() {
  const [open, setOpen] = useState(false);
  const pathname = useLocation().pathname;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const account = useQuery({ queryKey: ["me"], queryFn: api.auth.me });
  const showKpis = pathname === "/app" || pathname === "/app/collections";
  const pending = useQuery({
    queryKey: ["proposals", "pending"],
    queryFn: () => api.listProposals("pending"),
    enabled: Boolean(account.data),
  });
  const count = pending.data?.length ?? 0;
  useEffect(() => {
    if (account.data === null) {
      void navigate({ to: "/login", search: { redirect: pathname } });
    }
  }, [account.data, navigate, pathname]);

  const logout = async () => {
    try {
      await api.auth.logout();
      queryClient.clear();
      await navigate({ to: "/login" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't log out.");
    }
  };

  if (account.isError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted p-6">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">We couldn&apos;t check your login.</p>
          <button className="btn-glass mt-3" onClick={() => void account.refetch()}>
            Try again
          </button>
        </div>
      </main>
    );
  }

  if (account.isLoading || !account.data) {
    return (
      <main className="min-h-screen bg-muted p-6">
        <Skeleton className="mx-auto mt-12 h-72 max-w-3xl rounded-2xl" />
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-muted lg:grid lg:grid-cols-[250px_1fr]">
      <aside className="sticky top-0 z-30 border-b border-border bg-background lg:flex lg:h-screen lg:flex-col lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="flex h-16 items-center justify-between px-5">
          <Link to="/">
            <Wordmark />
          </Link>
          <button
            className="grid size-9 place-items-center rounded-lg border border-border lg:hidden"
            aria-label="Toggle menu"
            onClick={() => setOpen(!open)}
          >
            {open ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
        <nav
          className={`${open ? "flex" : "hidden"} flex-col gap-1 border-t border-border px-3 py-3 lg:flex lg:flex-1 lg:border-0`}
        >
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeOptions={{ exact: "exact" in n }}
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 border-l-2 border-transparent px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              activeProps={{
                className: "!border-foreground bg-muted !font-semibold !text-foreground",
              }}
            >
              <n.i className="size-4" />
              {n.l}
              {n.to === "/app/approvals" && count > 0 && (
                <span className="ml-auto rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                  {count}
                </span>
              )}
            </Link>
          ))}
          <div className="mt-3 border-t border-border px-3 pt-4 text-sm lg:hidden">
            <p className="font-semibold">{account.data.seller.name}</p>
            <p className="mt-1 truncate text-xs text-muted-foreground" title={account.data.user.email}>
              {account.data.user.email}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {account.data.user.is_demo ? "Demo studio · PayPal sandbox" : "PayPal sandbox"}
            </p>
            <button className="mt-3 text-link underline underline-offset-4" onClick={() => void logout()}>
              Log out
            </button>
          </div>
        </nav>
        <div className="mt-auto hidden border-t border-border px-5 pb-5 pt-4 text-sm lg:block">
          <p className="font-semibold">{account.data.seller.name}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground" title={account.data.user.email}>
            {account.data.user.email}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {account.data.user.is_demo ? "Demo studio · PayPal sandbox" : "PayPal sandbox"}
          </p>
          <button className="mt-3 text-link underline underline-offset-4" onClick={() => void logout()}>
            Log out
          </button>
        </div>
      </aside>
      <div className="min-w-0">
        <div className="mx-auto max-w-7xl px-5 py-7 sm:px-8">
          {showKpis && <KPIs />}
          <Outlet />
        </div>
      </div>
    </div>
  );
}
function KPIs() {
  const { data, isLoading } = useQuery({ queryKey: ["stats"], queryFn: api.getStats });
  const k = [
    { l: "Deposits received", v: data && money(data.deposits_collected_cents) },
    { l: "Still to collect", v: data && money(data.outstanding_cents) },
    { l: "Fully paid", v: data && money(data.paid_cents) },
    {
      l: "Average time to pay",
      v: data && (data.avg_days_to_pay == null ? "—" : `${data.avg_days_to_pay} days`),
    },
  ];
  return (
    <div className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-4">
      {k.map((x) => (
        <div key={x.l} className="bg-card p-4 sm:p-5">
          <div className="text-xs font-medium text-muted-foreground">{x.l}</div>
          {isLoading || !x.v ? (
            <Skeleton className="mt-2 h-7 w-24" />
          ) : (
            <div className="mt-1 text-xl font-semibold tabular-nums sm:text-2xl">{x.v}</div>
          )}
        </div>
      ))}
    </div>
  );
}
