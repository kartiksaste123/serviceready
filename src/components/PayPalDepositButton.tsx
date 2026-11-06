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
 * Swap-in seam — keep props stable.
 * - Mock mode: a simulated PayPal sandbox checkout (create order → buyer approves → capture).
 * - Real mode: the official PayPal JS SDK buttons. The order is only captured after the
 *   buyer approves it in PayPal (the previous version captured immediately, which real PayPal rejects).
 */
export function PayPalDepositButton({
  quoteId,
  onPaid,
}: {
  quoteId: string;
  onPaid?: (q: Quote) => void;
}) {
  return USE_MOCKS ? (
    <MockCheckout quoteId={quoteId} onPaid={onPaid} />
  ) : (
    <SdkCheckout quoteId={quoteId} onPaid={onPaid} />
  );
}

type Props = { quoteId: string; onPaid?: ((q: Quote) => void) | undefined };

function MockCheckout({ quoteId, onPaid }: Props) {
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
      toast.success("Deposit paid through PayPal");
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
            <dd>Capture deposit</dd>
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
    style?: Record<string, string>;
    createOrder: () => Promise<string>;
    onApprove: (d: { orderID: string }) => Promise<void>;
    onError: (e: unknown) => void;
    onCancel?: () => void;
  }) => { render: (el: HTMLElement) => Promise<void>; close?: () => void };
};
let sdkPromise: Promise<PayPalNs> | null = null;
function loadSdk(clientId: string): Promise<PayPalNs> {
  const w = window as unknown as { paypal?: PayPalNs };
  if (w.paypal) return Promise.resolve(w.paypal);
  sdkPromise ??= new Promise<PayPalNs>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture&components=buttons`;
    s.async = true;
    s.onload = () =>
      w.paypal ? resolve(w.paypal) : reject(new Error("PayPal SDK failed to initialise"));
    s.onerror = () => {
      sdkPromise = null;
      reject(new Error("Couldn't load PayPal. Check your connection or ad blocker."));
    };
    document.head.appendChild(s);
  });
  return sdkPromise;
}

function SdkCheckout({ quoteId, onPaid }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const onPaidRef = useRef(onPaid);
  onPaidRef.current = onPaid;
  useEffect(() => {
    setState("loading");
    let cancelled = false;
    let close: (() => void) | undefined;
    (async () => {
      try {
        const cfg = await api.paypalConfig();
        const paypal = await loadSdk(cfg.client_id);
        if (cancelled || !ref.current) return;
        ref.current.innerHTML = "";
        const btns = paypal.Buttons({
          style: { layout: "vertical", shape: "rect", label: "pay", color: "gold", height: 48 },
          createOrder: async () => (await api.createDepositOrder(quoteId)).order_id,
          onApprove: async ({ orderID }) => {
            const q = await api.captureDeposit(quoteId, orderID);
            toast.success("Deposit paid through PayPal");
            onPaidRef.current?.(q);
          },
          onCancel: () => toast("Payment cancelled — you can try again anytime"),
          onError: (e) => toast.error(errMsg(e)),
        });
        close = btns.close;
        await btns.render(ref.current);
        if (!cancelled) setState("ready");
      } catch (e) {
        if (!cancelled) {
          setError(errMsg(e, "PayPal is unavailable"));
          setState("error");
        }
      }
    })();
    return () => {
      cancelled = true;
      close?.();
    };
  }, [quoteId, attempt]);
  return (
    <div className="w-full min-w-0">
      {state === "loading" && (
        <div className="flex min-h-11 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Loading PayPal…
        </div>
      )}
      {state === "error" && (
        <div role="alert" className="space-y-2">
          <p className="text-sm text-danger">{error}</p>
          <button
            type="button"
            className="btn-glass btn-sm w-full sm:w-auto"
            onClick={() => {
              sdkPromise = null;
              setAttempt((a) => a + 1);
            }}
          >
            Retry PayPal
          </button>
        </div>
      )}
      <div ref={ref} className="w-full min-w-0 [&_iframe]:max-w-full" />
    </div>
  );
}
