import { useState } from "react";
import { Check, Copy, FlaskConical, X } from "lucide-react";
import { USE_MOCKS } from "@/lib/api";

const BUYER_EMAIL =
  (import.meta.env["VITE_PAYPAL_SANDBOX_BUYER_EMAIL"] as string | undefined)?.trim() ||
  "sb-flkqr53721283@personal.example.com";

/**
 * Visible only in live sandbox mode. Password stays in README / judge docs — not the public UI.
 */
export function JudgeModeBanner() {
  const [hidden, setHidden] = useState(false);
  const [copied, setCopied] = useState(false);
  if (USE_MOCKS || hidden) return null;

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(BUYER_EMAIL);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="border-b border-amber-300/60 bg-amber-50 text-amber-950">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 px-5 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div className="flex items-start gap-2">
          <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">Judge mode — live PayPal sandbox</p>
            <ol className="mt-0.5 list-decimal pl-4 text-xs text-amber-900/90 sm:text-sm">
              <li>
                Open storefront{" "}
                <a className="underline" href="/s/maya-rao-studio">
                  /s/maya-rao-studio
                </a>
              </li>
              <li>Request a quote → pay deposit with the PayPal button</li>
              <li>Sandbox buyer: {BUYER_EMAIL} (password in README)</li>
              <li>
                Sign in as demo → seller desk{" "}
                <a className="underline" href="/login?demo=1&next=/app">
                  /login
                </a>{" "}
                → mark delivered → pay invoice
              </li>
            </ol>
          </div>
        </div>
        <div className="flex items-center gap-2 self-end sm:self-center">
          <button type="button" className="btn-glass btn-sm" onClick={copyEmail}>
            {copied ? (
              <Check className="size-3.5" aria-hidden="true" />
            ) : (
              <Copy className="size-3.5" aria-hidden="true" />
            )}
            Copy buyer email
          </button>
          <button
            type="button"
            className="rounded p-1 text-amber-900/70 hover:bg-amber-100"
            aria-label="Dismiss judge banner"
            onClick={() => setHidden(true)}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
