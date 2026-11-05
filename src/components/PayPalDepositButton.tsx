import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Quote } from "@/lib/types";
import { money } from "@/lib/format";

export function PayPalDepositButton({ quoteId, onPaid }: { quoteId: string; onPaid?: (q: Quote) => void }) {
  const [busy, setBusy] = useState(false);
  async function pay() { setBusy(true); try { const { order_id } = await api.createDepositOrder(quoteId); const q = await api.captureDeposit(quoteId, order_id); toast.success("Deposit paid through PayPal"); onPaid?.(q); } catch (e) { toast.error(e instanceof Error ? e.message : "Payment failed"); } finally { setBusy(false); } }
  return <button onClick={pay} disabled={busy} className="btn-mint w-full">{busy && <Loader2 className="size-4 animate-spin" />}{busy ? "Processing payment…" : "Pay deposit with PayPal"}</button>;
}