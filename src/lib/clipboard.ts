import { toast } from "sonner";

/** Copy text with a fallback for non-secure contexts (iframes, http previews). Reports real success/failure. */
export async function copyText(text: string, label = "Copied to clipboard") {
  if (!text) return false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (!ok) throw new Error("copy failed");
    }
    toast.success(label);
    return true;
  } catch {
    toast.error("Couldn't copy automatically — select the text and copy it manually");
    return false;
  }
}

/** Absolute URL for a path on this site (client-only; falls back to the path during SSR). */
export const absoluteUrl = (path: string) =>
  typeof window === "undefined" ? path : new URL(path, window.location.origin).toString();
