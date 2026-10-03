import { z } from 'zod';
import { PayPalService } from '../src/paypal.js';

const url = z.string().url().parse(process.argv[2]);
const paypal = new PayPalService();
const result = await paypal.request<{ id?: string }>('/v1/notifications/webhooks', {
  method: 'POST',
  body: {
    url,
    event_types: [
      { name: 'PAYMENT.CAPTURE.COMPLETED' },
      { name: 'INVOICING.INVOICE.PAID' },
      { name: 'INVOICING.INVOICE.CANCELLED' }
    ]
  }
});
if (!result.id) throw new Error('PayPal did not return a webhook id.');
console.log(result.id);
