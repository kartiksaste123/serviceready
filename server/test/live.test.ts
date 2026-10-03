import { describe, expect, it } from 'vitest';
import { AIService } from '../src/ai.js';
import { createApp } from '../src/app.js';
import { createId, Store, timestamp } from '../src/db.js';
import { invoiceIdFrom, PayPalService } from '../src/paypal.js';
import type { Payment, Quote } from '../src/types.js';

const live = process.env.LIVE === '1';

describe.skipIf(!live)('live sandbox and AI gateway', () => {
  it('creates an uncaptured order, sends and cancels a balance invoice, parses rate card, and runs collections', async () => {
    const store = new Store(':memory:');
    const paypal = new PayPalService();
    const app = createApp({ store, paypal, ai: new AIService() });
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

      const createdInvoice = await paypal.createInvoice({
        detail: { currency_code: 'USD', note: 'ServiceReady sandbox live-test invoice.' },
        primary_recipients: [{
          billing_info: {
            name: { given_name: 'Demo', surname: 'Client' },
            email_address: 'client-demo@example.com'
          }
        }],
        items: [{
          name: 'Logo design — balance',
          quantity: '1',
          unit_amount: { currency_code: 'USD', value: (quote.balance_cents / 100).toFixed(2) },
          unit_of_measure: 'QUANTITY'
        }]
      });
      invoiceId = invoiceIdFrom(createdInvoice);
      expect(invoiceId, `PayPal invoice create response fields: ${Object.keys(createdInvoice).join(', ')}`).toBeTruthy();
      expect(typeof invoiceId).toBe('string');
      await paypal.sendInvoice(invoiceId!, 'ServiceReady sandbox live-test invoice.');
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

      const now = timestamp();
      quote.status = 'balance_invoiced';
      quote.updated_at = now;
      store.saveQuote(quote);
      const balance: Payment = {
        id: createId('payment'),
        kind: 'balance',
        amount_cents: quote.balance_cents,
        status: 'SENT',
        paypal_invoice_id: invoiceId,
        updated_at: now
      };
      store.savePayment(quote.id, balance);
      const catalogResponse = await app.request('/api/catalog/parse', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          raw_text: 'logo 450 (2 rounds) | brand kit w/ logo+colors+fonts 1200, half upfront | social templates x10 - 15 | rush +30% | website landing pg 900 2wks'
        })
      });
      expect(catalogResponse.status).toBe(200);
      const catalog = await catalogResponse.json() as {
        services: Array<{ tmp_id: string; price_cents: number }>;
        flags: Array<{ tmp_id: string; field: string; message: string }>;
      };
      const lowPrice = catalog.services.find((service) => service.price_cents === 1500);
      expect(lowPrice).toBeTruthy();
      expect(catalog.flags.some((flag) => flag.tmp_id === lowPrice?.tmp_id && flag.field === 'price_usd')).toBe(true);

      const collections = await app.request(`/api/quotes/${quote.id}/collections/run`, { method: 'POST' });
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
