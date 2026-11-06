import { defineNitroConfig } from "nitro/config";

// Stable, tested compatibility date instead of the build machine's local date.
// A local date ahead of UTC makes Cloudflare preview reject an otherwise valid build.
export default defineNitroConfig({
  compatibilityDate: "2026-06-01",
  // Scan ./server for API routes (PayPal + Supabase live backend).
  serverDir: "./server",
});
