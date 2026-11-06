// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Outside Lovable (e.g. Render), pin Nitro to Node via NITRO_PRESET.
// Inside Lovable sandbox the plugin still forces cloudflare-module.
const nitroPreset = process.env["NITRO_PRESET"]?.trim();

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Mirror nitro.config.ts routeRules so the Lovable/vite nitro merge keeps video headers.
  nitro: {
    ...(nitroPreset ? { preset: nitroPreset } : {}),
    routeRules: {
      "/login": {
        headers: {
          "Cache-Control": "no-cache, must-revalidate",
        },
      },
      "/videos/**": {
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      },
      "/videos/login-demo.mp4": {
        redirect: { to: "/videos/login-demo.c8211490fc.mp4", status: 302 },
      },
      "/videos/login-demo.webm": {
        redirect: { to: "/videos/login-demo.52f703be51.webm", status: 302 },
      },
      "/videos/login-demo-poster.jpg": {
        redirect: { to: "/videos/login-demo-poster.5b7e660ed6.jpg", status: 302 },
      },
    },
  },
});
