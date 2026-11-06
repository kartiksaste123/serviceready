import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, FlaskConical, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { api, USE_MOCKS } from "@/lib/api";
import { Wordmark } from "@/components/kit";
import { LOGIN_DEMO } from "@/lib/login-demo-assets";

type Tab = "signin" | "signup";

type LoginSearch = { next?: string; tab?: string; demo?: string };

export const Route = createFileRoute("/login")({
  validateSearch: (s: Record<string, unknown>): LoginSearch => {
    const out: LoginSearch = {};
    if (typeof s["next"] === "string") out.next = s["next"];
    if (typeof s["tab"] === "string") out.tab = s["tab"];
    if (typeof s["demo"] === "string") out.demo = s["demo"];
    return out;
  },
  head: () => ({
    meta: [
      { title: "Sign in — ServiceReady" },
      {
        name: "description",
        content: "Sign in to your seller desk, or continue as the shared demo workspace.",
      },
      { property: "og:title", content: "Sign in — ServiceReady" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LoginPage,
});

function safeNext(next?: string) {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/app";
  return next;
}

function LoginPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const auth = useAuth();
  const next = safeNext(search.next);
  const [tab, setTab] = useState<Tab>(search.tab === "signup" ? "signup" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<"form" | "demo" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (USE_MOCKS) return;
    if (auth.ready && auth.session) {
      void (async () => {
        try {
          await api.bootstrapSeller(name.trim() ? { name: name.trim() } : {});
        } catch {
          /* demo account already linked */
        }
        navigate({ to: next });
      })();
    }
  }, [auth.ready, auth.session, navigate, next, name]);

  useEffect(() => {
    if (search.demo === "1" && auth.ready && !auth.session && !busy) {
      void onDemo();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.demo, auth.ready]);

  async function afterAuth(fullName?: string) {
    try {
      const n = (fullName || name).trim();
      await api.bootstrapSeller(n ? { name: n } : {});
    } catch (e) {
      // Demo user is already linked; new users should succeed.
      if (!(e instanceof Error && /already|linked|workspace/i.test(e.message))) {
        console.warn("bootstrap", e);
      }
    }
    toast.success(tab === "signup" ? "Welcome — your desk is ready" : "Signed in");
    navigate({ to: next });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy("form");
    try {
      if (USE_MOCKS) {
        navigate({ to: next });
        return;
      }
      if (tab === "signup") {
        await auth.signUp(email, password, name);
      } else {
        await auth.signIn(email, password);
      }
      await afterAuth(name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in");
    } finally {
      setBusy(null);
    }
  }

  async function onDemo() {
    setError(null);
    setBusy("demo");
    try {
      if (USE_MOCKS) {
        navigate({ to: next });
        return;
      }
      await auth.signInDemo();
      toast.success("Opened Maya Rao Studio (demo)");
      navigate({ to: next });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Demo sign-in failed");
    } finally {
      setBusy(null);
    }
  }

  if (!USE_MOCKS && auth.ready && auth.session) {
    return (
      <div className="grid min-h-screen place-items-center bg-muted">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    );
  }

  const inputCls = "field mt-1 h-9 py-1.5";

  return (
    <div className="grid h-[100dvh] min-h-[100dvh] grid-cols-1 overflow-hidden bg-background lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* LEFT — brand + auth card */}
      <section className="flex h-full min-h-0 flex-col px-5 py-4 sm:px-8 lg:px-12 lg:py-5">
        <header className="flex shrink-0 items-center justify-between">
          <Link to="/" aria-label="ServiceReady home">
            <Wordmark />
          </Link>
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
            Back to site
          </Link>
        </header>

        <main className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto py-3">
          <div className="my-auto w-full max-w-[400px]">
            <div className="mb-4 text-center max-sm:mb-3">
              <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.75rem]">
                {tab === "signin" ? "Welcome back" : "Create your free account"}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {tab === "signin"
                  ? "Sign in to manage bookings, deposits and invoices."
                  : "Set up your storefront and start taking PayPal deposits."}
              </p>
            </div>

            <div className="glass-card rounded-2xl p-5 shadow-[0_12px_40px_-16px_rgba(16,24,40,0.18)] sm:p-6">
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "signin"}
                  className={`min-h-10 rounded-md px-3 py-2 text-sm font-medium transition ${tab === "signin" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={() => setTab("signin")}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "signup"}
                  className={`min-h-10 rounded-md px-3 py-2 text-sm font-medium transition ${tab === "signup" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={() => setTab("signup")}
                >
                  Create account
                </button>
              </div>

              <form className="mt-5 space-y-4" onSubmit={onSubmit}>
                {tab === "signup" && (
                  <div>
                    <label htmlFor="name" className="mb-1.5 block text-sm font-medium">
                      Studio / business name
                    </label>
                    <input
                      id="name"
                      className={inputCls}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Maya Rao Studio"
                      autoComplete="organization"
                      required
                    />
                  </div>
                )}
                <div>
                  <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    className={inputCls}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@studio.com"
                    autoComplete="email"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
                    Password
                  </label>
                  <input
                    id="password"
                    type="password"
                    className={inputCls}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    autoComplete={tab === "signup" ? "new-password" : "current-password"}
                    minLength={6}
                    required
                  />
                </div>
                {error && (
                  <p
                    className="rounded-lg border border-danger/30 bg-danger-bg px-3 py-1.5 text-xs text-danger"
                    role="alert"
                  >
                    {error}
                  </p>
                )}
                <button type="submit" className="btn-mint w-full" disabled={busy !== null}>
                  {busy === "form" ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <ArrowRight className="size-4" aria-hidden="true" />
                  )}
                  {tab === "signin" ? "Sign in" : "Create account"}
                </button>
              </form>

              <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
                <div className="h-px flex-1 bg-border" aria-hidden="true" />
                or
                <div className="h-px flex-1 bg-border" aria-hidden="true" />
              </div>

              <button
                type="button"
                className="btn-glass w-full"
                disabled={busy !== null}
                onClick={() => void onDemo()}
              >
                {busy === "demo" ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <FlaskConical className="size-4" aria-hidden="true" />
                )}
                <span className="truncate">Explore the demo workspace</span>
              </button>
              <p className="mt-2 text-center text-[11px] text-muted-foreground">
                No sign-up needed · sample data · PayPal sandbox
              </p>
            </div>
          </div>
        </main>

        <p className="shrink-0 text-center text-xs text-muted-foreground max-sm:hidden">
          Public storefronts and quote links stay open without signing in.
        </p>
      </section>

      {/* RIGHT — calm cream stage + contained demo card */}
      <aside
        className="relative hidden h-full min-h-0 lg:flex lg:flex-col lg:items-center lg:justify-center lg:bg-[#f4f1ea] lg:px-10 lg:py-10"
        aria-label="ServiceReady workflow demo"
      >
        <LoginDemoPanel />
      </aside>
    </div>
  );
}

/**
 * Right-hand demo: contained framed card (not edge-to-edge).
 * Plays Artlist login-demo via content-hashed URLs (LOGIN_DEMO) so browsers
 * cannot reuse a sticky /videos/login-demo.* disk cache after a cut update.
 * MP4 is listed first for universal decode; WebM is progressive enhancement.
 * On media error, show poster only — never a product-UI chat mock slideshow.
 */
function LoginDemoPanel() {
  const [videoFailed, setVideoFailed] = useState(false);

  return (
    <div className="flex w-full flex-col items-center">
      <div className="relative aspect-[4/5] h-[min(78dvh,680px)] w-auto max-w-[min(100%,440px)] overflow-hidden rounded-2xl bg-neutral-950 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.35)] ring-1 ring-black/10">
        {!videoFailed ? (
          <video
            key={LOGIN_DEMO.contentId}
            poster={LOGIN_DEMO.poster}
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            onError={() => setVideoFailed(true)}
            className="h-full w-full object-cover"
            aria-label="ServiceReady workflow demo video"
          >
            <source src={LOGIN_DEMO.mp4} type="video/mp4" />
            <source src={LOGIN_DEMO.webm} type="video/webm" />
          </video>
        ) : (
          <img
            src={LOGIN_DEMO.poster}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
      </div>
    </div>
  );
}
