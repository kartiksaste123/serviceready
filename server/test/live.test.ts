import { describe, expect, it } from 'vitest';
import { AIService } from '../src/ai.js';
import { createApp } from '../src/app.js';
import { createId, Store, timestamp } from '../src/db.js';
import { PayPalService } from '../src/paypal.js';
import type { Quote } from '../src/types.js';

const live = process.env.LIVE === '1';

describe.skipIf(!live)('live sandbox and AI gateway', () => {
  it('creates an uncaptured order, sends and cancels a balance invoice, parses rate card, and runs collections', async () => {
    const store = new Store(':memory:');
    const paypal = new PayPalService();
    const app = createApp({ store, paypal, ai: new AIService() });
    const demoAuth = await app.request('/api/auth/demo', { method: 'POST' });
    expect(demoAuth.status).toBe(200);
    const demoCookie = demoAuth.headers.get('set-cookie')?.split(';', 1)[0];
    expect(demoCookie).toBeTruthy();
    let invoiceId: string | undefined;
    let testError: unknown;
    try {
      const quoteResponse = await app.request('/api/public/maya-rao-studio/quotes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          service_id: 'svc_logo_design',
          client_name: 'Demo Client',
          client_email: 'client-demo@example.com',
          brief: 'I need a polished logo for my neighborhood coffee bakery and would like a simple, friendly look.',
          source: 'web'
        })
      });
      expect(quoteResponse.status).toBe(201);
      const quote = await quoteResponse.json() as Quote;

      const orderResponse = await app.request(`/api/quotes/${quote.id}/deposit/order`, { method: 'POST' });
      expect(orderResponse.status).toBe(200);
      const orderId = (await orderResponse.json() as { order_id: string }).order_id;
      const order = await paypal.getOrder(orderId);
      expect(order.status).toBe('CREATED');

      quote.status = 'deposit_paid';
      quote.updated_at = timestamp();
      store.saveQuote(quote);
      const deliveryResponse = await app.request(`/api/quotes/${quote.id}/deliver`, {
        method: 'POST',
        headers: { cookie: demoCookie! },
      });
      expect(deliveryResponse.status).toBe(200);
      invoiceId = store.getPayment(quote.id, 'balance')?.paypal_invoice_id ?? undefined;
      expect(invoiceId).toBeTruthy();
      const invoiceDetails = await paypal.getInvoice(invoiceId!);
      expect(typeof invoiceDetails.status).toBe('string');
      expect(invoiceDetails.status).not.toBe('DRAFT');
      const detail = invoiceDetails.detail as Record<string, unknown> | undefined;
      const metadata = detail?.metadata as Record<string, unknown> | undefined;
      expect(typeof metadata?.recipient_view_url).toBe('string');

      const toolkit = paypal.toolkit();
      const getInvoiceTool = toolkit.getTools().find((tool) => tool.type === 'function' && tool.function.name === 'get_invoice');
      expect(getInvoiceTool).toBeTruthy();
      const invoiceResult = await toolkit.handleToolCall({
        id: createId('live-tool'),
        type: 'function',
        function: { name: 'get_invoice', arguments: JSON.stringify({ invoice_id: invoiceId }) }
      });
      expect(invoiceResult.role).toBe('tool');

      const catalogResponse = await app.request('/api/catalog/parse', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: demoCookie! },
        body: JSON.stringify({
          raw_text: 'logo 450 (2 rounds) | brand kit w/ logo+colors+fonts 1200, half upfront | social templates x10 (package price $15) | rush +30% | website landing pg 900 2wks'
        })
      });
      expect(catalogResponse.status).toBe(200);
      const catalog = await catalogResponse.json() as {
        services: Array<{ tmp_id: string; price_cents: number }>;
        flags: Array<{ tmp_id: string; field: string; message: string }>;
      };
      const lowPrice = catalog.services.find((service) => service.price_cents === 1500);
      expect(lowPrice).toBeTruthy();
      expect(catalog.flags.some((flag) => flag.tmp_id === lowPrice?.tmp_id && flag.field === 'price_cents')).toBe(true);

      const collections = await app.request(`/api/quotes/${quote.id}/collections/run`, {
        method: 'POST',
        headers: { cookie: demoCookie! },
      });
      expect(collections.status).toBe(200);

      await paypal.request(`/v2/invoicing/invoices/${encodeURIComponent(invoiceId!)}/cancel`, {
        method: 'POST',
        body: { subject: 'Cancelled live test invoice', note: 'ServiceReady live test cleanup.', send_to_recipient: false }
      });
      invoiceId = undefined;
    } catch (error) {
      testError = error;
      throw error;
    } finally {
      let cleanupError: unknown;
      try {
        if (invoiceId) {
          const invoice = await paypal.getInvoice(invoiceId);
          const path = `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}`;
          if (invoice.status === 'DRAFT' || invoice.status === 'SCHEDULED') {
            await paypal.request(path, { method: 'DELETE' });
          } else {
            await paypal.request(`${path}/cancel`, {
              method: 'POST',
              body: { subject: 'Cancelled live test invoice', note: 'ServiceReady live test cleanup.', send_to_recipient: false }
            });
          }
        }
      } catch (error) {
        cleanupError = error;
      }
      store.close();
      if (cleanupError && testError) {
        const testMessage = testError instanceof Error ? testError.message : 'unknown test failure';
        const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : 'unknown cleanup failure';
        throw new AggregateError([testError, cleanupError], `Live test and invoice cleanup both failed (${testMessage}; ${cleanupMessage}).`);
      }
      if (cleanupError) throw cleanupError;
    }
  }, 120_000);
});
