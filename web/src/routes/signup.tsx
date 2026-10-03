import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { useState, type FormEvent } from "react";
import { AuthCode } from "@/components/AuthCode";
import { AuthShell } from "@/components/AuthShell";
import { api, type AuthChallenge } from "@/lib/api";

export const Route = createFileRoute("/signup")({
  head: () => ({ meta: [{ title: "Create your studio — ServiceReady" }] }),
  component: Signup,
});

function Signup() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [studioName, setStudioName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [challenge, setChallenge] = useState<AuthChallenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const startSignup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      setChallenge(await api.auth.signup({ studio_name: studioName, email, password }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We couldn't create your account.");
    } finally {
      setBusy(false);
    }
  };

  const useDemo = async () => {
    setBusy(true);
    setError("");
    try {
      await api.auth.demo();
      queryClient.clear();
      await navigate({ to: "/app" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The demo studio couldn't be opened.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      {challenge ? (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">Verify your email</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Confirm your email to open your new studio.
          </p>
          <div className="mt-5">
            <AuthCode
              challenge={challenge}
              onSubmit={async (code) => {
                await api.auth.verify({ challenge_id: challenge.challenge_id, code });
                queryClient.clear();
                await navigate({ to: "/onboard" });
              }}
              onResend={() => api.auth.resend({ challenge_id: challenge.challenge_id })}
              onDifferentEmail={() => {
                setChallenge(null);
                setError("");
              }}
            />
          </div>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">Create your studio</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your services, bookings and storefront will be yours.
          </p>
          <form className="mt-5 space-y-4" onSubmit={(event) => void startSignup(event)}>
            <label className="block text-sm font-medium">
              Studio or business name
              <input
                className="field mt-1.5"
                value={studioName}
                onChange={(event) => setStudioName(event.target.value)}
                minLength={1}
                maxLength={80}
                autoComplete="organization"
                required
              />
            </label>
            <label className="block text-sm font-medium">
              Email
              <input
                className="field mt-1.5"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </label>
            <label className="block text-sm font-medium">
              Password
              <span className="relative mt-1.5 block">
                <input
                  className="field pr-11"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={8}
                  maxLength={128}
                  autoComplete="new-password"
                  required
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((show) => !show)}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </span>
              <span className="mt-1 block text-xs font-normal text-muted-foreground">
                At least 8 characters
              </span>
            </label>
            {error && <p className="text-sm text-danger" role="alert">{error}</p>}
            <button className="btn-primary w-full" disabled={busy}>
              {busy ? "Sending code…" : "Create account"}
            </button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link to="/login" className="text-link underline underline-offset-4">Log in</Link>
          </p>
          <div className="mt-5 border-t border-border pt-4">
            <button className="btn-glass w-full" disabled={busy} onClick={() => void useDemo()}>
              Try the demo studio
            </button>
          </div>
        </>
      )}
    </AuthShell>
  );
}
