import { randomUUID } from 'node:crypto';
import { PayPalAgentToolkit } from '@paypal/agent-toolkit/openai';

export const PAYPAL_BASE = 'https://api-m.sandbox.paypal.com';
const clientId = (): string => process.env.PAYPAL_CLIENT_ID ?? '';
const clientSecret = (): string => process.env.PAYPAL_CLIENT_SECRET ?? '';

export class PayPalService {
  private token: string | null = null;
  private tokenExpires = 0;
  private readonly fetcher: typeof fetch;

  constructor(fetcher: typeof fetch = fetch) {
    this.fetcher = fetcher;
  }

  async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpires - 30_000) return this.token;
    if (!clientId() || !clientSecret()) throw new Error('PayPal sandbox credentials are not configured.');
    const response = await this.fetcher(`${PAYPAL_BASE}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId()}:${clientSecret()}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    });
    const payload = await response.json() as { access_token?: string; expires_in?: number };
    if (!response.ok || !payload.access_token) throw new Error('Unable to authenticate with PayPal sandbox.');
    this.token = payload.access_token;
    this.tokenExpires = Date.now() + (payload.expires_in ?? 300) * 1000;
    return this.token;
  }

  async request<T>(path: string, options: {
    method?: string;
    body?: unknown;
    requestId?: string;
  } = {}): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await this.accessToken()}`,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    };
    if (options.requestId) headers['PayPal-Request-Id'] = options.requestId;
    const response = await this.fetcher(`${PAYPAL_BASE}${path}`, {
      method: options.method ?? 'GET',
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
    });
    const raw = await response.text();
    let payload: unknown = {};
    if (raw) {
      try {
        payload = JSON.parse(raw) as unknown;
      } catch {
        payload = { message: raw };
      }
    }
    if (!response.ok) {
      const object = payload as { message?: string; name?: string; details?: Array<{ issue?: string; field?: string }> };
      const details = Array.isArray(object.details)
        ? object.details.map((detail) => [detail.issue, detail.field].filter(Boolean).join(' at ')).filter(Boolean).join('; ')
        : '';
      const suffix = details ? ` (${details})` : '';
      throw new Error(`PayPal request failed (${response.status}): ${object.message ?? object.name ?? 'unknown error'}${suffix}`);
    }
    return payload as T;
  }

  async createOrder(quoteId: string, amountCents: number, description: string, returnUrl: string, requestId: string): Promise<{ id: string }> {
    return this.request('/v2/checkout/orders', {
      method: 'POST',
      requestId,
      body: {
        intent: 'CAPTURE',
        purchase_units: [{
          reference_id: quoteId,
          custom_id: quoteId,
          description,
          amount: { currency_code: 'USD', value: (amountCents / 100).toFixed(2) }
        }],
        application_context: {
          return_url: returnUrl,
          cancel_url: returnUrl,
          user_action: 'PAY_NOW'
        }
      }
    });
  }

  async captureOrder(orderId: string): Promise<Record<string, unknown>> {
    return this.request(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: 'POST',
      requestId: `capture-${orderId}`
    });
  }

  async getOrder(orderId: string): Promise<Record<string, unknown>> {
    return this.request(`/v2/checkout/orders/${encodeURIComponent(orderId)}`);
  }

  async getInvoice(invoiceId: string): Promise<Record<string, unknown>> {
    return this.request(`/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}`);
  }

  async createInvoice(payload: unknown): Promise<Record<string, unknown>> {
    return this.request('/v2/invoicing/invoices', {
      method: 'POST',
      requestId: `invoice-${randomUUID()}`,
      body: payload
    });
  }

  async sendInvoice(invoiceId: string, note: string): Promise<Record<string, unknown>> {
    return this.request(`/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/send`, {
      method: 'POST',
      requestId: `send-${invoiceId}`,
      body: { send_to_recipient: true, note }
    });
  }

  async verifyWebhook(headers: Headers, webhookId: string, event: unknown): Promise<boolean> {
    const payload = {
      auth_algo: headers.get('paypal-auth-algo'),
      cert_url: headers.get('paypal-cert-url'),
      transmission_id: headers.get('paypal-transmission-id'),
      transmission_sig: headers.get('paypal-transmission-sig'),
      transmission_time: headers.get('paypal-transmission-time'),
      webhook_id: webhookId,
      webhook_event: event
    };
    const response = await this.request<{ verification_status?: string }>('/v1/notifications/verify-webhook-signature', {
      method: 'POST',
      body: payload
    });
    return response.verification_status === 'SUCCESS';
  }

  toolkit(): PayPalAgentToolkit {
    if (!clientId() || !clientSecret()) throw new Error('PayPal sandbox credentials are not configured.');
    return new PayPalAgentToolkit({
      clientId: clientId(),
      clientSecret: clientSecret(),
      configuration: {
        actions: { invoices: { get: true, sendReminder: true } },
        context: { sandbox: true }
      }
    });
  }
}

export function centsFromAmount(amount: unknown): number | null {
  if (!amount || typeof amount !== 'object') return null;
  const value = (amount as { value?: unknown; currency_code?: unknown }).value;
  const currency = (amount as { currency_code?: unknown }).currency_code;
  if (currency !== 'USD' || typeof value !== 'string' || !Number.isFinite(Number(value))) return null;
  return Math.round(Number(value) * 100);
}

export function payerLink(payloads: Array<Record<string, unknown>>): string | undefined {
  for (const payload of payloads) {
    if (typeof payload.recipient_view_url === 'string') return payload.recipient_view_url;
    const detail = payload.detail;
    if (detail && typeof detail === 'object') {
      const metadata = (detail as { metadata?: unknown }).metadata;
      if (
        metadata &&
        typeof metadata === 'object' &&
        typeof (metadata as { recipient_view_url?: unknown }).recipient_view_url === 'string'
      ) {
        return (metadata as { recipient_view_url: string }).recipient_view_url;
      }
    }
    const links = payload.links;
    if (Array.isArray(links)) {
      const payerView = links.find((link) => (
        link !== null &&
        typeof link === 'object' &&
        ['payer-view', 'payer_view'].includes(String((link as { rel?: unknown }).rel).toLowerCase())
      )) as { href?: unknown } | undefined;
      if (typeof payerView?.href === 'string') return payerView.href;
    }
  }
  return undefined;
}

export function invoiceIdFrom(payload: Record<string, unknown>): string | undefined {
  if (typeof payload.id === 'string') return payload.id;
  const hrefs: string[] = [];
  if (typeof payload.href === 'string') hrefs.push(payload.href);
  if (Array.isArray(payload.links)) {
    for (const link of payload.links) {
      if (link && typeof link === 'object' && typeof (link as { href?: unknown }).href === 'string') {
        hrefs.push((link as { href: string }).href);
      }
    }
  }
  for (const href of hrefs) {
    let pathname = href;
    try {
      pathname = new URL(href).pathname;
    } catch {}
    const match = pathname.match(/\/v2\/invoicing\/invoices\/([^/]+)\/?$/);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }
  return undefined;
}
