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
        ? "Open your seller desk — bookings, deposits and approvals."
        : "Create an account to publish services AI assistants can book.",
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

  return (
    <div className="min-h-screen bg-muted">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex h-16 max-w-lg items-center justify-between px-5">
          <Link to="/" aria-label="ServiceReady home">
            <Wordmark />
          </Link>
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
            Back to site
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-lg px-5 py-10">
        <div className="glass-card p-6 sm:p-8">
          <p className="eyebrow flex items-center gap-2">
            <LockKeyhole className="size-3.5" aria-hidden="true" />
            Seller desk
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            {tab === "signin" ? "Sign in" : "Create account"}
          </h1>
          <p className="mt-2 text-muted-foreground">{subtitle}</p>

          <div className="mt-6 grid grid-cols-2 gap-1 rounded-xl bg-muted p-1" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "signin"}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${tab === "signin" ? "bg-background shadow-sm" : "text-muted-foreground"}`}
              onClick={() => setTab("signin")}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "signup"}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${tab === "signup" ? "bg-background shadow-sm" : "text-muted-foreground"}`}
              onClick={() => setTab("signup")}
            >
              Create account
            </button>
          </div>

          <form className="mt-6 space-y-4" onSubmit={onSubmit}>
            {tab === "signup" && (
              <div>
                <label htmlFor="name" className="text-sm font-medium">
                  Studio / business name
                </label>
                <input
                  id="name"
                  className="field mt-1.5"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Maya Rao Studio"
                  autoComplete="organization"
                  required
                />
              </div>
            )}
            <div>
              <label htmlFor="email" className="text-sm font-medium">
                Email
              </label>
              <input
                id="email"
                type="email"
                className="field mt-1.5"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@studio.com"
                autoComplete="email"
                required
              />
            </div>
            <div>
              <label htmlFor="password" className="text-sm font-medium">
                Password
              </label>
              <input
                id="password"
                type="password"
                className="field mt-1.5"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                autoComplete={tab === "signup" ? "new-password" : "current-password"}
                minLength={6}
                required
              />
            </div>
            {error && (
              <p className="rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="btn-mint w-full" disabled={busy !== null}>
              {busy === "form" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <ArrowRight className="size-4" aria-hidden="true" />
              )}
              {tab === "signin" ? "Sign in to desk" : "Create account & open desk"}
            </button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center" aria-hidden="true">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">or for judges</span>
            </div>
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
            Continue as demo (Maya Rao Studio)
          </button>
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Demo login: <span className="font-mono">{DEMO_LOGIN.email}</span> — password in README
          </p>
        </div>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Public storefronts and quote links stay open without signing in.
        </p>
      </main>
    </div>
  );
}
