// Isolated PayPal deposit button. Replace the internals with the real PayPal JS SDK
// (createOrder -> api.createDepositOrder, onApprove -> api.captureDeposit).
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { PayPalButtons, PayPalScriptProvider } from '@paypal/react-paypal-js';
import { api, USE_MOCKS } from '@/lib/api';
import type { Quote } from '@/lib/types';

export function PayPalDepositButton({ quoteId, onPaid }: { quoteId: string; onPaid?: (q: Quote) => void }) {
  const [busy, setBusy] = useState(false);
  const config = useQuery({
    queryKey: ['paypal-config'],
    queryFn: api.paypalConfig,
    enabled: !USE_MOCKS,
    staleTime: Infinity,
    retry: false,
  });

  async function pay() {
    setBusy(true);
    try {
      const { order_id } = await api.createDepositOrder(quoteId);
      const q = await api.captureDeposit(quoteId, order_id);
      toast.success('Deposit captured by PayPal');
      onPaid?.(q);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Payment failed');
    } finally {
      setBusy(false);
    }
  }

  if (USE_MOCKS) {
    return (
      <button onClick={pay} disabled={busy} className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-paypal text-[15px] font-bold text-paypal-ink transition hover:brightness-95 disabled:opacity-70">
        {busy ? <Loader2 className="size-4 animate-spin" /> : <span className="italic">PayPal</span>}
        {busy ? 'Processing…' : 'Pay deposit with PayPal'}
      </button>
    );
  }

  if (config.isPending) {
    return (
      <button disabled className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-paypal text-[15px] font-bold text-paypal-ink opacity-70">
        <Loader2 className="size-4 animate-spin" />Loading PayPal…
      </button>
    );
  }

  if (!config.data?.client_id) {
    return (
      <button disabled className="flex h-12 w-full items-center justify-center rounded-full bg-paypal text-[15px] font-bold text-paypal-ink opacity-70">
        PayPal is unavailable
      </button>
    );
  }

  return (
    <PayPalScriptProvider options={{ clientId: config.data.client_id, currency: 'USD', intent: 'capture', disableFunding: 'paylater' }}>
      <PayPalButtons
        className="bg-transparent"
        style={{ layout: 'vertical', shape: 'pill', color: 'gold', label: 'paypal' }}
        disabled={busy}
        createOrder={async () => {
          setBusy(true);
          try {
            const { order_id } = await api.createDepositOrder(quoteId);
            return order_id;
          } finally {
            setBusy(false);
          }
        }}
        onApprove={async ({ orderID }) => {
          setBusy(true);
          try {
            await api.captureDeposit(quoteId, orderID);
            const detail = await api.getQuote(quoteId);
            toast.success('Deposit captured by PayPal');
            onPaid?.(detail.quote);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Payment failed');
          } finally {
            setBusy(false);
          }
        }}
        onCancel={() => {
          setBusy(false);
          toast.info('PayPal payment was cancelled.');
        }}
        onError={(error) => {
          setBusy(false);
          toast.error(error instanceof Error ? error.message : 'PayPal payment failed.');
        }}
      />
    </PayPalScriptProvider>
  );
}
