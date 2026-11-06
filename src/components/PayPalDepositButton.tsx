import { useEffect, useRef, useState } from "react";
import { Loader2, LockKeyhole, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { api, USE_MOCKS } from "@/lib/api";
import type { Quote } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const errMsg = (e: unknown, fallback = "Payment failed") =>
  e instanceof Error ? e.message : fallback;

/**
 * Swap-in seam — keep props stable (`intent` is optional).
 * - Mock mode: a simulated PayPal sandbox checkout (create order → buyer approves → capture/authorize).
 * - Real mode: PayPal JS SDK **v6** (`/web-sdk/v6/core`, `<paypal-button>` + one-time payment session),
 *   with the legacy v5 Buttons SDK as an automatic fallback if v6 can't initialise.
 *   Orders are created server-side (amount from the catalog quote), and only captured or
 *   authorized server-side after the buyer approves in PayPal.
 */
export function PayPalDepositButton({
  quoteId,
  onPaid,
  intent = "CAPTURE",
}: {
  quoteId: string;
  onPaid?: (q: Quote) => void;
  intent?: "CAPTURE" | "AUTHORIZE" | undefined;
}) {
  return USE_MOCKS ? (
    <MockCheckout quoteId={quoteId} onPaid={onPaid} intent={intent} />
  ) : (
    <SdkCheckout quoteId={quoteId} onPaid={onPaid} intent={intent} />
  );
}

/** Warm PayPal before the buyer reaches the button: public config + v6 SDK script. */
export function prefetchPayPal(): void {
  if (USE_MOCKS || typeof window === "undefined") return;
  void api
    .paypalConfig()
    .then((cfg) => loadV6(cfg.env))
    .catch(() => undefined);
}

const paidToast = (intent: "CAPTURE" | "AUTHORIZE") =>
  intent === "AUTHORIZE"
    ? "Deposit authorized — PayPal holds it until work starts"
    : "Deposit paid through PayPal";

type Props = {
  quoteId: string;
  onPaid?: ((q: Quote) => void) | undefined;
  intent: "CAPTURE" | "AUTHORIZE";
};

function MockCheckout({ quoteId, onPaid, intent }: Props) {
  const [stage, setStage] = useState<"idle" | "creating" | "approve" | "capturing">("idle");
  const [orderId, setOrderId] = useState<string | null>(null);
  async function start() {
    setStage("creating");
    try {
      const { order_id } = await api.createDepositOrder(quoteId);
      setOrderId(order_id);
      setStage("approve");
    } catch (e) {
      toast.error(errMsg(e, "Couldn't start PayPal checkout"));
      setStage("idle");
    }
  }
  async function approve() {
    if (!orderId) return;
    setStage("capturing");
    try {
      const q = await api.captureDeposit(quoteId, orderId);
      toast.success(paidToast(intent));
      setStage("idle");
      onPaid?.(q);
    } catch (e) {
      toast.error(errMsg(e));
      setStage("approve");
    }
  }
  const busy = stage === "creating" || stage === "capturing";
  return (
    <>
      <button
        type="button"
        onClick={start}
        disabled={busy}
        className="btn-mint w-full"
        aria-busy={busy}
      >
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        {stage === "creating"
          ? "Opening PayPal…"
          : stage === "capturing"
            ? "Confirming payment…"
            : "Pay deposit with PayPal"}
      </button>
      <Dialog
        open={stage === "approve" || stage === "capturing"}
        onOpenChange={(o) => !o && stage !== "capturing" && setStage("idle")}
      >
        <DialogContent className="border-border bg-background text-foreground sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="size-5" aria-hidden="true" />
              PayPal sandbox checkout
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              This demo simulates the buyer approving the payment inside PayPal. No real money
              moves.
            </DialogDescription>
          </DialogHeader>
          <dl className="glass-row grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 p-4 text-sm">
            <dt className="text-muted-foreground">Order</dt>
            <dd className="truncate font-mono">{orderId}</dd>
            <dt className="text-muted-foreground">Intent</dt>
            <dd>{intent === "AUTHORIZE" ? "Authorize (hold) deposit" : "Capture deposit"}</dd>
          </dl>
          <DialogFooter className="gap-2 sm:gap-2">
            <button
              type="button"
              className="btn-glass"
              disabled={stage === "capturing"}
              onClick={() => setStage("idle")}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-mint"
              disabled={stage === "capturing"}
              onClick={approve}
            >
              {stage === "capturing" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <LockKeyhole className="size-4" aria-hidden="true" />
              )}
              Approve & pay
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

type PayPalNs = {
  Buttons: (o: {
    style?: Record<string, string | number>;
    createOrder: () => Promise<string>;
    onApprove: (d: { orderID: string }) => Promise<void>;
    onError: (e: unknown) => void;
    onCancel?: () => void;
  }) => { render: (el: HTMLElement) => Promise<void>; close?: () => void };
};

/* ---------- PayPal JS SDK v6 ---------- */
type V6Session = {
  start: (o: { presentationMode: string }, order: Promise<{ orderId: string }>) => Promise<void>;
};
type V6Instance = {
  findEligibleMethods: (o?: Record<string, unknown>) => Promise<{ isEligible: (m: string) => boolean }>;
  createPayPalOneTimePaymentSession: (o: {
    onApprove: (d: { orderId: string }) => Promise<void>;
    onCancel?: () => void;
    onError?: (e: unknown) => void;
  }) => V6Session;
};
type V6Ns = { createInstance: (o: Record<string, unknown>) => Promise<V6Instance> };

let v6Promise: Promise<V6Ns> | null = null;
function loadV6(env: "sandbox" | "live" = "sandbox"): Promise<V6Ns> {
  v6Promise ??= new Promise<V6Ns>((resolve, reject) => {
    const w = window as unknown as { paypal?: Partial<V6Ns> };
    if (w.paypal?.createInstance) return resolve(w.paypal as V6Ns);
    const s = document.createElement("script");
    s.src =
      env === "live"
        ? "https://www.paypal.com/web-sdk/v6/core"
        : "https://www.sandbox.paypal.com/web-sdk/v6/core";
    s.async = true;
    s.onload = () =>
      w.paypal?.createInstance
        ? resolve(w.paypal as V6Ns)
        : reject(new Error("PayPal SDK v6 failed to initialise"));
    s.onerror = () => {
      v6Promise = null;
      reject(new Error("Couldn't load PayPal. Check your connection or ad blocker."));
    };
    document.head.appendChild(s);
  });
  return v6Promise;
}

let v6InstancePromise: Promise<V6Instance> | null = null;
function v6Instance(clientId: string, env: "sandbox" | "live"): Promise<V6Instance> {
  v6InstancePromise ??= loadV6(env)
    .then((ns) =>
      ns.createInstance({ clientId, components: ["paypal-payments"], pageType: "checkout" }),
    )
    .catch((e) => {
      v6InstancePromise = null;
      throw e;
    });
  return v6InstancePromise;
}

/* ---------- Legacy v5 Buttons (fallback) — namespaced per intent so it never clashes with v6 ---------- */
const legacyPromises: Partial<Record<"CAPTURE" | "AUTHORIZE", Promise<PayPalNs>>> = {};
function loadLegacy(clientId: string, intent: "CAPTURE" | "AUTHORIZE"): Promise<PayPalNs> {
  const ns = intent === "AUTHORIZE" ? "paypalLegacyAuthorize" : "paypalLegacyCapture";
  const w = window as unknown as Record<string, PayPalNs | undefined>;
  if (w[ns]) return Promise.resolve(w[ns]!);
  legacyPromises[intent] ??= new Promise<PayPalNs>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=${intent.toLowerCase()}&components=buttons`;
    s.async = true;
    s.setAttribute("data-namespace", ns);
    s.onload = () =>
      w[ns] ? resolve(w[ns]!) : reject(new Error("PayPal SDK failed to initialise"));
    s.onerror = () => {
      delete legacyPromises[intent];
      reject(new Error("Couldn't load PayPal. Check your connection or ad blocker."));
    };
    document.head.appendChild(s);
  });
  return legacyPromises[intent]!;
}

function SdkCheckout({ quoteId, onPaid, intent }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [engine, setEngine] = useState<"v6" | "v5" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const onPaidRef = useRef(onPaid);
  onPaidRef.current = onPaid;
  useEffect(() => {
    setState("loading");
    let cancelled = false;
    let close: (() => void) | undefined;
    const approve = async (orderId: string) => {
      setBusy(true);
      try {
        const q = await api.captureDeposit(quoteId, orderId);
        toast.success(paidToast(intent));
        onPaidRef.current?.(q);
      } finally {
        setBusy(false);
      }
    };
    (async () => {
      const cfg = await api.paypalConfig();
      if (cancelled || !ref.current) return;
      // 1) PayPal JS SDK v6
      try {
        const sdk = await v6Instance(cfg.client_id, cfg.env);
        const elig = await sdk.findEligibleMethods({ currencyCode: "USD" }).catch(() => null);
        if (elig && !elig.isEligible("paypal")) throw new Error("PayPal not eligible in v6");
        if (cancelled || !ref.current) return;
        const session = sdk.createPayPalOneTimePaymentSession({
          onApprove: async ({ orderId }) => {
            try {
              await approve(orderId);
            } catch (e) {
              toast.error(errMsg(e));
            }
          },
          onCancel: () => toast("Payment cancelled — you can try again anytime"),
          onError: (e) => toast.error(errMsg(e)),
        });
        ref.current.innerHTML = "";
        const btn = document.createElement("paypal-button");
        btn.setAttribute("type", "pay");
        btn.className = "paypal-gold";
        btn.style.display = "block";
        btn.style.width = "100%";
        btn.addEventListener("click", () => {
          // Don't await createOrder before start() — keeps the click's transient activation.
          const order = api.createDepositOrder(quoteId).then((r) => ({ orderId: r.order_id }));
          session.start({ presentationMode: "auto" }, order).catch((e) => toast.error(errMsg(e)));
        });
        ref.current.appendChild(btn);
        if (!cancelled) {
          setEngine("v6");
          setState("ready");
        }
        return;
      } catch (e) {
        console.warn("[paypal] v6 unavailable, falling back to v5 Buttons:", errMsg(e, "v6"));
      }
      // 2) Legacy v5 Buttons fallback
      const paypal = await loadLegacy(cfg.client_id, intent);
      if (cancelled || !ref.current) return;
      ref.current.innerHTML = "";
      const btns = paypal.Buttons({
        style: { layout: "vertical", shape: "rect", label: "pay", color: "gold", height: 48 },
        createOrder: async () => (await api.createDepositOrder(quoteId)).order_id,
        onApprove: async ({ orderID }) => approve(orderID),
        onCancel: () => toast("Payment cancelled — you can try again anytime"),
        onError: (e) => toast.error(errMsg(e)),
      });
      close = btns.close;
      await btns.render(ref.current);
      if (!cancelled) {
        setEngine("v5");
        setState("ready");
      }
    })().catch((e) => {
      if (!cancelled) {
        setError(errMsg(e, "PayPal is unavailable"));
        setState("error");
      }
    });
    return () => {
      cancelled = true;
      close?.();
    };
  }, [quoteId, attempt, intent]);
  return (
    <div className="w-full min-w-0">
      {state === "loading" && (
        <div
          className="h-12 w-full animate-pulse rounded-md bg-muted"
          role="status"
          aria-label="Loading PayPal"
        />
      )}
      {state === "error" && (
        <div role="alert" className="space-y-2">
          <p className="text-sm text-danger">{error}</p>
          <button
            type="button"
            className="btn-glass btn-sm w-full sm:w-auto"
            onClick={() => {
              v6Promise = null;
              v6InstancePromise = null;
              setAttempt((a) => a + 1);
            }}
          >
            Retry PayPal
          </button>
        </div>
      )}
      <div ref={ref} className="w-full min-w-0 [&_iframe]:max-w-full" />
      {busy && (
        <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          {intent === "AUTHORIZE" ? "Authorizing with PayPal…" : "Confirming payment…"}
        </p>
      )}
      {state === "ready" && engine && (
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          {intent === "AUTHORIZE"
            ? "PayPal holds this deposit — it's only captured when work starts."
            : "Paid securely through PayPal."}{" "}
          <span className="opacity-70">SDK {engine}</span>
        </p>
      )}
    </div>
  );
}
