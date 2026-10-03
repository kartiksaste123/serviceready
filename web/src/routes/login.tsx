import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { AuthCode } from "@/components/AuthCode";
import { AuthShell } from "@/components/AuthShell";
import { api, safeRedirect, type AuthChallenge } from "@/lib/api";

export const Route = createFileRoute("/login")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { redirect?: string } => {
    const redirect = search["redirect"];
    return typeof redirect === "string" ? { redirect } : {};
  },
  head: () => ({ meta: [{ title: "Log in — ServiceReady" }] }),
  component: Login,
});

function Login() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { redirect } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [challenge, setChallenge] = useState<AuthChallenge | null>(null);
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const finishAuth = async () => {
    queryClient.clear();
    await navigate({ to: safeRedirect(redirect) ?? "/app" });
  };

  const startLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      setChallenge(await api.auth.login({ email, password }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Email or password is incorrect.");
    } finally {
      setBusy(false);
    }
  };

  const startForgot = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      setChallenge(await api.auth.forgot({ email }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We couldn't send a reset code.");
    } finally {
      setBusy(false);
    }
  };

  const useDemo = async () => {
    setBusy(true);
    setError("");
    try {
      await api.auth.demo();
      await finishAuth();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The demo studio couldn't be opened.");
    } finally {
      setBusy(false);
    }
  };

  const resetFlow = () => {
    setChallenge(null);
    setError("");
  };

  return (
    <AuthShell>
      {challenge ? (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">
            {mode === "forgot" ? "Reset your password" : "Check your email"}
          </h1>
          {mode === "forgot" && (
            <div className="mt-4 space-y-3">
              <label className="block text-sm font-medium">
                New password
                <input
                  className="field mt-1.5"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </label>
              <label className="block text-sm font-medium">
                Confirm new password
                <input
                  className="field mt-1.5"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
              </label>
            </div>
          )}
          <div className="mt-5">
            <AuthCode
              challenge={challenge}
              autoSubmit={mode !== "forgot"}
              onSubmit={async (code) => {
                if (mode === "forgot") {
                  if (newPassword.length < 8 || newPassword.length > 128) {
                    throw new Error("Password must be 8–128 characters.");
                  }
                  if (newPassword !== confirmPassword) throw new Error("Passwords do not match.");
                  await api.auth.verify({
                    challenge_id: challenge.challenge_id,
                    code,
                    new_password: newPassword,
                  });
                } else {
                  await api.auth.verify({ challenge_id: challenge.challenge_id, code });
                }
                await finishAuth();
              }}
              onResend={() => api.auth.resend({ challenge_id: challenge.challenge_id })}
              onDifferentEmail={resetFlow}
            />
          </div>
        </>
      ) : mode === "forgot" ? (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Enter your account email and we’ll send a code if it’s registered.
          </p>
          <form className="mt-5 space-y-4" onSubmit={(event) => void startForgot(event)}>
            <label className="block text-sm font-medium">
              Email
              <input
                className="field mt-1.5"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            {error && <p className="text-sm text-danger" role="alert">{error}</p>}
            <button className="btn-primary w-full" disabled={busy}>
              {busy ? "Sending code…" : "Send reset code"}
            </button>
          </form>
          <button
            type="button"
            className="mt-4 w-full text-center text-sm text-link underline underline-offset-4"
            onClick={() => {
              setMode("login");
              setError("");
            }}
          >
            Back to log in
          </button>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">Log in</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            We’ll email you a code after checking your password.
          </p>
          <form className="mt-5 space-y-4" onSubmit={(event) => void startLogin(event)}>
            <label className="block text-sm font-medium">
              Email
              <input
                className="field mt-1.5"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <label className="block text-sm font-medium">
              Password
              <input
                className="field mt-1.5"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            <div className="-mt-2 text-right">
              <button
                type="button"
                className="text-sm text-link underline underline-offset-4"
                onClick={() => {
                  setMode("forgot");
                  setError("");
                }}
              >
                Forgot password?
              </button>
            </div>
            {error && <p className="text-sm text-danger" role="alert">{error}</p>}
            <button className="btn-primary w-full" disabled={busy}>
              {busy ? "Checking…" : "Log in"}
            </button>
          </form>
          <div className="mt-4 border-t border-border pt-4">
            <button className="btn-glass w-full" disabled={busy} onClick={() => void useDemo()}>
              Try the demo studio
            </button>
          </div>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            New here?{" "}
            <Link to="/signup" className="text-link underline underline-offset-4">Create an account</Link>
          </p>
        </>
      )}
    </AuthShell>
  );
}
