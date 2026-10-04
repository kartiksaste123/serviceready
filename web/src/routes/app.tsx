import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  CheckSquare,
  Coins,
  GraduationCap,
  LayoutList,
  Menu,
  Plug,
  ScrollText,
  Settings,
  X,
} from "lucide-react";
import type { Driver } from "driver.js";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { getTourStage, setTourStage, startStudioTour } from "@/lib/tour";
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
  { key: "bookings", to: "/app", l: "Bookings", i: LayoutList, exact: true },
  { key: "approvals", to: "/app/approvals", l: "Needs your approval", i: CheckSquare },
  { key: "collections", to: "/app/collections", l: "Who owes what", i: Coins },
  { key: "log", to: "/app/log", l: "Activity log", i: ScrollText },
  { key: "connect", to: "/app/connect", l: "Connect AI assistants", i: Plug },
  { key: "services", to: "/app/catalog", l: "Services & prices", i: BookOpen },
  { key: "settings", to: "/app/settings", l: "Settings", i: Settings },
] as const;
function AppLayout() {
  const [open, setOpen] = useState(false);
  const activeTour = useRef<Driver | null>(null);
  const didAutoStartTour = useRef(false);
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
  const showStudioTour = useCallback((closeMenuOnDone = true) => {
    const userId = account.data!.user.id;
    activeTour.current = startStudioTour({
      onDone: () => {
        setTourStage(userId, "done");
        if (closeMenuOnDone && window.matchMedia("(max-width: 1023px)").matches) {
          setOpen(false);
        }
      },
    });
  }, [account.data]);

  useEffect(() => {
    const current = account.data;
    if (!current || current.user.is_demo || didAutoStartTour.current) return;
    const stage = getTourStage(current.user.id);
    if (stage !== "studio" && stage !== "onboard") return;
    didAutoStartTour.current = true;
    const mobile = window.matchMedia("(max-width: 1023px)").matches;
    const start = () => showStudioTour(mobile);
    if (mobile) {
      setOpen(true);
      const timer = window.setTimeout(start, 0);
      return () => window.clearTimeout(timer);
    }
    start();
    return undefined;
  }, [account.data, showStudioTour]);

  useEffect(
    () => () => {
      activeTour.current?.destroy();
      activeTour.current = null;
    },
    [],
  );

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
              data-tour={`nav-${n.key}`}
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
            <button
              data-tour="tour-button"
              className="mt-3 flex items-center gap-2 text-link"
              onClick={() => showStudioTour()}
            >
              <GraduationCap className="size-4" />
              Show tutorial
            </button>
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
          <button
            data-tour="tour-button"
            className="mt-3 flex items-center gap-2 text-link"
            onClick={() => showStudioTour()}
          >
            <GraduationCap className="size-4" />
            Show tutorial
          </button>
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
