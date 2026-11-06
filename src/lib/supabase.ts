import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

const url = (import.meta.env["VITE_SUPABASE_URL"] as string | undefined)?.trim() ?? "";
const anon = (import.meta.env["VITE_SUPABASE_ANON_KEY"] as string | undefined)?.trim() ?? "";

/** Fixed demo seller for judges — password is also in README. */
export const DEMO_LOGIN = {
  email: "demo@serviceready.app",
  password: "DemoJudge2026!",
  name: "Maya Rao Studio",
} as const;

let _client: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  return Boolean(url && anon);
}

export function supabaseBrowser(): SupabaseClient {
  if (_client) return _client;
  if (!url || !anon) {
    throw new Error("Supabase is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).");
  }
  _client = createClient(url, anon, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: "serviceready.auth",
    },
  });
  return _client;
}

export async function getAccessToken(): Promise<string | null> {
  if (!isSupabaseConfigured() || typeof window === "undefined") return null;
  try {
    const { data } = await supabaseBrowser().auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  if (!isSupabaseConfigured() || typeof window === "undefined") return null;
  const { data } = await supabaseBrowser().auth.getSession();
  return data.session;
}
