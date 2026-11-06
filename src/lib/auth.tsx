import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { USE_MOCKS } from "@/lib/api";
import {
  DEMO_LOGIN,
  isSupabaseConfigured,
  supabaseBrowser,
} from "@/lib/supabase";

type AuthState = {
  ready: boolean;
  session: Session | null;
  user: User | null;
  isDemo: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, fullName: string) => Promise<void>;
  signInDemo: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

function friendlyAuthError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  const lower = msg.toLowerCase();
  if (lower.includes("invalid login") || lower.includes("invalid credentials")) {
    return "Email or password is wrong";
  }
  if (lower.includes("already registered") || lower.includes("already been registered")) {
    return "That email already has an account — try signing in";
  }
  if (lower.includes("password")) return "Password must be at least 6 characters";
  if (lower.includes("email")) return "Enter a valid email address";
  if (lower.includes("rate limit") || lower.includes("too many")) {
    return "Too many attempts — wait a minute and try again";
  }
  return msg || "Could not sign in — try again";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(USE_MOCKS || !isSupabaseConfigured());
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    if (USE_MOCKS || !isSupabaseConfigured()) {
      setReady(true);
      return;
    }
    let cancelled = false;
    const sb = supabaseBrowser();
    sb.auth.getSession().then(({ data }) => {
      if (!cancelled) {
        setSession(data.session);
        setReady(true);
      }
    });
    const { data: sub } = sb.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setReady(true);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabaseBrowser().auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) throw new Error(friendlyAuthError(error));
  }, []);

  const signUp = useCallback(async (email: string, password: string, fullName: string) => {
    const { data, error } = await supabaseBrowser().auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: { data: { full_name: fullName.trim() || undefined } },
    });
    if (error) throw new Error(friendlyAuthError(error));
    if (!data.session) {
      throw new Error("Account created — check your email to confirm, then sign in");
    }
  }, []);

  const signInDemo = useCallback(async () => {
    await signIn(DEMO_LOGIN.email, DEMO_LOGIN.password);
  }, [signIn]);

  const signOut = useCallback(async () => {
    if (USE_MOCKS || !isSupabaseConfigured()) {
      setSession(null);
      return;
    }
    await supabaseBrowser().auth.signOut();
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      ready,
      session,
      user: session?.user ?? null,
      isDemo: (session?.user?.email ?? "").toLowerCase() === DEMO_LOGIN.email,
      signIn,
      signUp,
      signInDemo,
      signOut,
    }),
    [ready, session, signIn, signUp, signInDemo, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
