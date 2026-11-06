/** Server-only env helpers. Never put secrets in VITE_* vars. */

function read(name: string): string | undefined {
  try {
    const v = (typeof process !== "undefined" ? process.env?.[name] : undefined) as
      string | undefined;
    const t = v?.trim();
    return t || undefined;
  } catch {
    return undefined;
  }
}

export function paypalEnv() {
  const clientId = read("PAYPAL_CLIENT_ID");
  const clientSecret = read("PAYPAL_CLIENT_SECRET");
  const env = (read("PAYPAL_ENV") ?? "sandbox").toLowerCase();
  const apiBase =
    env === "live" || env === "production"
      ? "https://api-m.paypal.com"
      : "https://api-m.sandbox.paypal.com";
  if (!clientId || !clientSecret) {
    throw new Error(
      "PayPal is not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET on the server.",
    );
  }
  return {
    clientId,
    clientSecret,
    apiBase,
    env: (env === "live" || env === "production" ? "live" : "sandbox") as "live" | "sandbox",
  };
}

export function supabaseEnv() {
  const url = read("SUPABASE_URL") ?? read("VITE_SUPABASE_URL");
  const anonKey = read("SUPABASE_ANON_KEY") ?? read("VITE_SUPABASE_ANON_KEY");
  if (!url || !anonKey) {
    throw new Error("Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.");
  }
  return { url, anonKey };
}

export function publicOrigin(request?: Request): string {
  const fromEnv = read("PUBLIC_ORIGIN") ?? read("VITE_PUBLIC_ORIGIN");
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (request) {
    const u = new URL(request.url);
    // Behind Render's proxy the inner URL can be http://; trust forwarded headers.
    const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ?? u.host;
    return `${proto || u.protocol.replace(":", "")}://${host}`;
  }
  return "https://serviceready.onrender.com";
}

/** PayPal webhook id (Developer Dashboard → app → Webhooks). Optional: without it we re-verify via the PayPal API. */
export function paypalWebhookId(): string | undefined {
  return read("PAYPAL_WEBHOOK_ID");
}

/** Deposit AUTHORIZE threshold in cents (DEPOSIT_AUTHORIZE_MIN_USD; "0" disables AUTHORIZE). */
export function authorizeMinDepositCents(): number {
  const v = read("DEPOSIT_AUTHORIZE_MIN_USD");
  if (v === undefined) return 500_00;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 500_00;
}
