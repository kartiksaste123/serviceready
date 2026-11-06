import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  CheckSquare,
  Coins,
  ExternalLink,
  LayoutList,
  Loader2,
  LogOut,
  Menu,
  Plug,
  ScrollText,
  Settings,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api, USE_MOCKS } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { money } from "@/lib/format";
import { Wordmark } from "@/components/kit";
import { TourProvider, useWelcomeTour } from "@/components/Tour";
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

const NAV_GROUPS = [
  {
    label: "Daily work",
    items: [
      { to: "/app", l: "Bookings", i: LayoutList, exact: true },
      { to: "/app/approvals", l: "Approvals", i: CheckSquare },
      { to: "/app/collections", l: "Payments due", i: Coins },
    ],
  },
  {
    label: "Set up",
    items: [
      { to: "/app/catalog", l: "Services & prices", i: BookOpen },
      { to: "/app/connect", l: "AI assistants", i: Plug },
      { to: "/app/settings", l: "Settings", i: Settings },
    ],
  },
  {
    label: "Records",
    items: [{ to: "/app/log", l: "Activity log", i: ScrollText }],
  },
] as const;

function AppLayout() {
  return (
    <TourProvider>
      <AppShell />
    </TourProvider>
  );
}

const NAV_TOUR: Record<string, string> = {
  "/app": "nav-bookings",
  "/app/approvals": "nav-approvals",
  "/app/collections": "nav-payments",
  "/app/catalog": "nav-catalog",
  "/app/connect": "nav-connect",
  "/app/settings": "nav-settings",
  "/app/log": "nav-log",
};

function AppShell() {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const auth = useAuth();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (USE_MOCKS) return;
    if (!auth.ready) return;
    if (!auth.session) {
      navigate({ to: "/login", search: { next: pathname || "/app" } });
    }
  }, [auth.ready, auth.session, navigate, pathname]);
  const pending = useQuery({
    queryKey: ["proposals", "pending"],
    queryFn: () => api.listProposals("pending"),
    enabled: USE_MOCKS || !!auth.session,
  });
  const seller = useQuery({
    queryKey: ["seller"],
    queryFn: api.getSeller,
    enabled: USE_MOCKS || !!auth.session,
  });
  useWelcomeTour(USE_MOCKS || (auth.ready && !!auth.session));
  const count = pending.data?.length ?? 0;
  const slug = seller.data?.slug ?? "maya-rao-studio";

  if (!USE_MOCKS && (!auth.ready || !auth.session)) {
    return (
      <div className="grid min-h-[100dvh] place-items-center bg-muted">
        <Loader2
          className="size-6 animate-spin text-muted-foreground"
          aria-label="Checking sign-in"
        />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-muted lg:grid lg:grid-cols-[248px_1fr]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-background focus:px-4 focus:py-2 focus:shadow"
      >
        Skip to content
      </a>
      <aside className="sticky top-0 z-30 border-b border-border bg-background lg:flex lg:h-[100dvh] lg:flex-col lg:border-b-0 lg:border-r">
        <div className="flex h-16 items-center justify-between px-5">
          <Link to="/" aria-label="ServiceReady home">
            <Wordmark />
          </Link>
          <button
            type="button"
            className="relative grid size-11 place-items-center rounded-lg border border-border lg:hidden"
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
          {NAV_GROUPS.map((g) => (
            <div key={g.label} className="mb-3">
              <p className="px-3 pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                {g.label}
              </p>
              {g.items.map((n) => (
                <Link
                  key={n.to}
                  to={n.to}
                  data-tour={NAV_TOUR[n.to]}
                  activeOptions={{ exact: "exact" in n }}
                  className="flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  activeProps={{
                    className: "!bg-accent !font-semibold !text-primary",
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
            </div>
          ))}
          <a
            href={`/s/${slug}`}
            target="_blank"
            rel="noreferrer"
            data-tour="nav-storefront"
            className="mx-1 mt-1 flex min-h-10 items-center justify-center gap-2 rounded-lg border border-input bg-background px-3 py-2 text-sm font-semibold text-foreground shadow-xs hover:bg-muted"
          >
            <ExternalLink className="size-4" aria-hidden="true" />
            Open my storefront
          </a>
          <div className="mt-3 border-t border-border px-3 pb-1 pt-3 text-sm lg:hidden">
            {seller.data ? (
              <p className="truncate font-semibold">{seller.data.name}</p>
            ) : (
              <Skeleton className="h-5 w-32" />
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {USE_MOCKS || auth.isDemo
                ? "Demo workspace · PayPal sandbox"
                : "Your workspace · PayPal sandbox"}
            </p>
            {!USE_MOCKS && (
              <button
                type="button"
                className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
                onClick={async () => {
                  await auth.signOut();
                  navigate({ to: "/login" });
                }}
              >
                <LogOut className="size-3.5" aria-hidden="true" />
                Sign out
              </button>
            )}
          </div>
        </nav>
        <div className="hidden border-t border-border p-5 text-sm lg:block">
          {seller.data ? (
            <p className="truncate font-semibold">{seller.data.name}</p>
          ) : (
            <Skeleton className="h-5 w-32" />
          )}
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
            {USE_MOCKS
              ? "Demo workspace · PayPal sandbox"
              : auth.isDemo
                ? "Demo workspace · PayPal sandbox"
                : "Your workspace · PayPal sandbox"}
          </p>
          {!USE_MOCKS && (
            <button
              type="button"
              className="mt-3 inline-flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground"
              onClick={async () => {
                await auth.signOut();
                navigate({ to: "/login" });
              }}
            >
              <LogOut className="size-3.5" aria-hidden="true" />
              Sign out
            </button>
          )}
        </div>
      </aside>
      <div className="min-w-0">
        <main id="main" className="w-full max-w-[1600px] px-4 py-5 sm:px-6 sm:py-6 lg:px-10">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
