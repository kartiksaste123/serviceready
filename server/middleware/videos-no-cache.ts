import { defineMiddleware } from "nitro";
import { setResponseHeader } from "h3";

/**
 * Force revalidation for /videos/* even when served as static public assets.
 * Content-hashed filenames are the primary bust; these headers are the belt.
 */
export default defineMiddleware((event) => {
  const path = (event.path ?? "").split("?")[0] ?? "";
  if (!path.startsWith("/videos/")) return;
  setResponseHeader(event, "Cache-Control", "no-cache, no-store, must-revalidate");
  setResponseHeader(event, "Pragma", "no-cache");
  setResponseHeader(event, "Expires", "0");
});
