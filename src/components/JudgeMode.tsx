import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { ClipboardCopy, Gavel, X } from "lucide-react";
import { copyText } from "@/lib/clipboard";
import { USE_MOCKS } from "@/lib/api";

/** Public PayPal sandbox buyer (already published in README / Devpost for judges). Sandbox only. */
const SANDBOX_BUYER_EMAIL =
  String(import.meta.env["VITE_PAYPAL_SANDBOX_BUYER_EMAIL"] ?? "") ||
  "sb-flkqr53721283@personal.example.com";
const SANDBOX_BUYER_PASSWORD = "PcS5.(%K";
const KEY = "sr_judge_mode_v2";

const STEPS: Array<{ label: string; to: string }> = [
  { label: "Ask the storefront AI for a logo or brand kit (give a name + email)", to: "/s/maya-rao-studio" },
  { label: "Pay or authorize the deposit with the sandbox buyer below", to: "/s/maya-rao-studio" },
  { label: "Seller desk: Start work → Mark delivered (PayPal invoice)", to: "/login?demo=1&next=/app" },
  { label: "Pay invoice as the buyer, then Check payment status", to: "/login?demo=1&next=/app" },
];

/**
 * Compact, dismissible judge helper. Floating chip (bottom-left) that expands to the 4-step path
 * plus sandbox buyer copy buttons. Only on public demo routes; never on /login or the desk.
 */
export function JudgeMode() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState<"chip" | "open" | "hidden">("chip");
  useEffect(() => {
    setMounted(true);
    try {
      const v = localStorage.getItem(KEY);
      if (v === "hidden") setState("hidden");
    } catch {
      /* private mode */
    }
  }, []);
  const onRoute = path === "/" || path.startsWith("/s/") || path.startsWith("/q/");
  if (!mounted || !onRoute || state === "hidden") return null;

  const hide = () => {
    setState("hidden");
    try {
      localStorage.setItem(KEY, "hidden");
    } catch {
      /* ignore */
    }
  };

  if (state === "chip") {
    return (
      <div className="fixed bottom-3 left-3 z-40 flex items-center gap-1 rounded-full border border-border bg-background/95 py-1 pl-3 pr-1 text-xs shadow-md backdrop-blur print:hidden">
        <button
          type="button"
          onClick={() => setState("open")}
          className="flex items-center gap-1.5 font-semibold"
          aria-expanded="false"
        >
          <Gavel className="size-3.5" aria-hidden="true" />
          Judge path
        </button>
        <button
          type="button"
          onClick={hide}
          className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Hide judge path"
        >
          <X className="size-3" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <aside
      aria-label="Judge demo path"
      className="fixed bottom-3 left-3 z-40 w-[min(92vw,340px)] rounded-xl border border-border bg-background/97 p-3 text-xs shadow-lg backdrop-blur print:hidden"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          <Gavel className="size-4" aria-hidden="true" />
          Judge path · ~3 min
        </span>
        <span className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setState("chip")}
            className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted"
          >
            Minimize
          </button>
          <button
            type="button"
            onClick={hide}
            className="rounded p-1 text-muted-foreground hover:bg-muted"
            aria-label="Hide judge path"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </span>
      </div>
      <ol className="mb-2 list-decimal space-y-1 pl-4">
        {STEPS.map((s) => (
          <li key={s.label}>
            <a href={s.to} className="hover:underline">
              {s.label}
            </a>
          </li>
        ))}
      </ol>
      {!USE_MOCKS && (
        <div className="space-y-1 rounded-lg bg-muted p-2">
          <div className="text-[11px] font-semibold text-muted-foreground">PayPal sandbox buyer</div>
          <CopyRow label="Email" value={SANDBOX_BUYER_EMAIL} />
          <CopyRow label="Password" value={SANDBOX_BUYER_PASSWORD} />
        </div>
      )}
    </aside>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="min-w-0 truncate">
        <span className="text-muted-foreground">{label}: </span>
        <code className="font-mono">{value}</code>
      </span>
      <button
        type="button"
        onClick={() => void copyText(value, `${label} copied`)}
        className="flex shrink-0 items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 hover:bg-card"
        aria-label={`Copy sandbox buyer ${label.toLowerCase()}`}
      >
        <ClipboardCopy className="size-3" aria-hidden="true" />
        Copy
      </button>
    </div>
  );
}
