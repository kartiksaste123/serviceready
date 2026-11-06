import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, FlaskConical, Loader2, LockKeyhole } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { api, USE_MOCKS } from "@/lib/api";
import { DEMO_LOGIN } from "@/lib/supabase";
import { Wordmark } from "@/components/kit";

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

  const subtitle = useMemo(
    () =>
      tab === "signin"
        ? "Bookings, deposits and approvals"
        : "Publish services AI assistants can book",
    [tab],
  );

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
    <div className="grid h-[100dvh] min-h-[100dvh] grid-cols-1 overflow-hidden bg-background lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
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
              <h1 className="text-[1.5rem] font-semibold leading-[1.1] tracking-tight sm:text-[2rem] xl:text-[2.25rem]">
                Let AI assistants book
                <br className="hidden sm:block" /> your services
              </h1>
              <p className="mt-2 text-sm text-muted-foreground max-sm:hidden [@media(max-height:760px)]:hidden">
                Quotes, deposits and invoices — paid through PayPal while you sleep.
              </p>
            </div>

            <div className="glass-card rounded-2xl p-4 sm:p-5 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.18)]">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <LockKeyhole className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="shrink-0 font-semibold uppercase tracking-wide">Seller desk</span>
                <span aria-hidden="true">·</span>
                <span className="truncate">{subtitle}</span>
              </p>

              <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "signin"}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${tab === "signin" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={() => setTab("signin")}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "signup"}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${tab === "signup" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={() => setTab("signup")}
                >
                  Create account
                </button>
              </div>

              <form className="mt-3 space-y-2.5" onSubmit={onSubmit}>
                {tab === "signup" && (
                  <div>
                    <label htmlFor="name" className="text-xs font-medium">
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
                  <label htmlFor="email" className="text-xs font-medium">
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
                  <label htmlFor="password" className="text-xs font-medium">
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
                <button
                  type="submit"
                  className="btn-mint min-h-9 w-full py-2"
                  disabled={busy !== null}
                >
                  {busy === "form" ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <ArrowRight className="size-4" aria-hidden="true" />
                  )}
                  {tab === "signin" ? "Sign in to desk" : "Create account & open desk"}
                </button>
              </form>

              <div className="my-3 flex items-center gap-3 text-[11px] uppercase tracking-wide text-muted-foreground">
                <div className="h-px flex-1 bg-border" aria-hidden="true" />
                or for judges
                <div className="h-px flex-1 bg-border" aria-hidden="true" />
              </div>

              <button
                type="button"
                className="btn-glass min-h-9 w-full py-2"
                disabled={busy !== null}
                onClick={() => void onDemo()}
              >
                {busy === "demo" ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <FlaskConical className="size-4" aria-hidden="true" />
                )}
                <span className="truncate">Continue as demo (Maya Rao Studio)</span>
              </button>
              <p className="mt-2 text-center text-[11px] text-muted-foreground">
                Demo login: <span className="font-mono">{DEMO_LOGIN.email}</span> — password in
                README
              </p>
            </div>
          </div>
        </main>

        <p className="shrink-0 text-center text-xs text-muted-foreground max-sm:hidden">
          Public storefronts and quote links stay open without signing in.
        </p>
      </section>

      {/* RIGHT — looping workflow demo */}
      <aside
        className="hidden h-full min-h-0 p-4 pl-0 lg:block"
        aria-label="ServiceReady workflow demo"
      >
        <LoginDemoPanel />
      </aside>
    </div>
  );
}

const DEMO_STILLS = [
  { src: "/images/hero.webp", caption: "Paste your prices — AI structures your catalog" },
  { src: "/images/service-landing.webp", caption: "A storefront AI assistants can read and book" },
  { src: "/images/agent-chat-bg.webp", caption: "Buyers' agents request quotes over MCP" },
  { src: "/images/paypal-success.webp", caption: "Deposits and invoices paid through PayPal" },
];

/**
 * Right-hand demo panel. Plays Artlist login-demo (WebM then MP4).
 * Cache-bust ?v=artlist1 — bump when swapping PayPal-updated cut.
 * Falls back to a cross-fading still slideshow if the video can't load.
 */
function LoginDemoPanel() {
  const [videoFailed, setVideoFailed] = useState(false);
  const [i, setI] = useState(0);

  useEffect(() => {
    if (!videoFailed) return;
    const t = window.setInterval(() => setI((n) => (n + 1) % DEMO_STILLS.length), 4000);
    return () => window.clearInterval(t);
  }, [videoFailed]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl bg-neutral-950 shadow-xl ring-1 ring-black/5">
      {!videoFailed ? (
        <video
          poster="/videos/login-demo-poster.jpg?v=artlist1"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          onError={() => setVideoFailed(true)}
          className="h-full w-full object-cover"
        >
          <source src="/videos/login-demo.webm?v=artlist1" type="video/webm" />
          <source src="/videos/login-demo.mp4?v=artlist1" type="video/mp4" />
        </video>
      ) : (
        DEMO_STILLS.map((s, n) => (
          <img
            key={s.src}
            src={s.src}
            alt=""
            aria-hidden={n !== i}
            className={`absolute inset-0 h-full w-full object-cover transition-[opacity,transform] duration-[1800ms] ease-out ${n === i ? "scale-105 opacity-100" : "scale-100 opacity-0"}`}
          />
        ))
      )}
      {videoFailed && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-6">
          <p className="text-lg font-semibold text-white">{DEMO_STILLS[i]?.caption}</p>
        </div>
      )}
    </div>
  );
}
