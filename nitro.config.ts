import { defineNitroConfig } from "nitro/config";

// Stable, tested compatibility date instead of the build machine's local date.
// A local date ahead of UTC makes Cloudflare preview reject an otherwise valid build.
export default defineNitroConfig({
  compatibilityDate: "2026-06-01",
  // Scan ./server for API routes (PayPal + Supabase live backend).
  serverDir: "./server",
  routeRules: {
    // App HTML shell: never sticky-cache so UI removals (e.g. Judge banner) show
    // immediately. Hashed /assets/* stay cacheable via their content hashes.
    "/**": {
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    },
    "/assets/**": {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    },
    // Login demo + any future public videos: always revalidate. Content-hashed
    // filenames already bust sticky caches; these headers stop disk-cache reuse
    // of the same URL between deploys if a hash is ever reused by mistake.
    "/login": {
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    },
    "/videos/**": {
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    },
    // Old unhashed Artlist paths → current hashed assets (302, not cached long).
    "/videos/login-demo.mp4": {
      redirect: { to: "/videos/login-demo.733a0af60e.mp4", status: 302 },
    },
    "/videos/login-demo.webm": {
      redirect: { to: "/videos/login-demo.8c9c9ece4a.webm", status: 302 },
    },
    "/videos/login-demo-poster.jpg": {
      redirect: { to: "/videos/login-demo-poster.5b7e660ed6.jpg", status: 302 },
    },
  },
});
