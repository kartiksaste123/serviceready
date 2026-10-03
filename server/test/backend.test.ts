import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type OpenAI from 'openai';
import type {
  ChatCompletion,
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionToolChoiceOption
} from 'openai/resources';
import { AIService, isDegenerateText } from '../src/ai.js';
import { createApp } from '../src/app.js';
import { ClientTools } from '../src/client-tools.js';
import { calculateQuoteAmounts, computeServiceDrafts } from '../src/core.js';
import { createEvent, createId, Store, timestamp } from '../src/db.js';
import { createMcpServer } from '../src/mcp.js';
import { PayPalService, payerLink } from '../src/paypal.js';
import type { Payment, Proposal, Quote, Source } from '../src/types.js';

class StubAI extends AIService {
  readonly completionQueue: ChatCompletion[] = [];
  readonly messageHistory: ChatCompletionMessageParam[][] = [];
  readonly toolChoiceHistory: ChatCompletionToolChoiceOption[] = [];
  readonly toolResultCalls: Array<{ system: string; user: string; tool: ChatCompletionTool }> = [];
  forcedToolResult: unknown;
  async quoteScope(): Promise<string> {
    return 'A concise scope summary. Fit check: Good fit.';
  }
  async chatCompletion(
    messages: ChatCompletionMessageParam[],
    _tools: ChatCompletionTool[],
    toolChoice: ChatCompletionToolChoiceOption = 'auto'
  ): Promise<ChatCompletion> {
    this.messageHistory.push([...messages]);
    this.toolChoiceHistory.push(toolChoice);
    return this.completionQueue.shift() ?? {
      choices: [{ message: { role: 'assistant', content: 'Please share your project details.' } }]
    } as unknown as ChatCompletion;
  }
  async toolResult<T>(
    system: string,
    user: string,
    tool: ChatCompletionTool,
    validate: (value: unknown) => T = (value) => value as T
  ): Promise<T> {
    this.toolResultCalls.push({ system, user, tool });
    if (this.forcedToolResult === undefined) throw new Error('No forced-tool result configured.');
    return validate(this.forcedToolResult);
  }
}

class StubPayPal extends PayPalService {
  verification = true;
  invoice: Record<string, unknown> = { id: 'INV-TEST', status: 'UNPAID' };
  order: Record<string, unknown> = {};
  orderBrandName = '';
  createOrderCount = 0;
  captureCount = 0;
  orderReadCount = 0;
  invoiceCreateCount = 0;
  invoiceSendCount = 0;
  invoiceReadCount = 0;
  invoiceCreatePayload: unknown;

  async createOrder(
    _quoteId: string,
    _amountCents: number,
    _description: string,
    _returnUrl: string,
    _requestId: string,
    brandName: string
  ): Promise<{ id: string }> {
    this.createOrderCount += 1;
    this.orderBrandName = brandName;
    return { id: 'ORDER12345678901234' };
  }
  async captureOrder(): Promise<Record<string, unknown>> {
    this.captureCount += 1;
    return { status: 'COMPLETED' };
  }
  async getOrder(): Promise<Record<string, unknown>> {
    this.orderReadCount += 1;
    return this.order;
  }
  async createInvoice(payload: unknown): Promise<Record<string, unknown>> {
    this.invoiceCreateCount += 1;
    this.invoiceCreatePayload = payload;
    return { id: 'INV-CREATED', status: 'DRAFT' };
  }
  async sendInvoice(_invoiceId: string, _note: string): Promise<Record<string, unknown>> {
    this.invoiceSendCount += 1;
    return { id: 'INV-CREATED', status: 'SENT' };
  }
  async getInvoice(): Promise<Record<string, unknown>> {
    this.invoiceReadCount += 1;
    return this.invoice;
  }
  async verifyWebhook(): Promise<boolean> {
    return this.verification;
  }
}

class StubToolkit {
  invoice: Record<string, unknown> = { id: 'INV-TEST', status: 'UNPAID' };
  calls: string[] = [];
  getTools(): ChatCompletionTool[] {
    return [
      {
        type: 'function',
        function: {
          name: 'get_invoice',
          description: 'Read invoice status',
          parameters: { type: 'object', properties: { invoice_id: { type: 'string' } }, required: ['invoice_id'] }
        }
      },
      {
        type: 'function',
        function: {
          name: 'send_invoice_reminder',
          description: 'Send reminder',
          parameters: { type: 'object', properties: { invoice_id: { type: 'string' } }, required: ['invoice_id'] }
        }
      }
    ];
  }
  async handleToolCall(call: { function: { name: string } }): Promise<{ role: 'tool'; tool_call_id: string; content: string }> {
    this.calls.push(call.function.name);
    return { role: 'tool', tool_call_id: 'test-call', content: JSON.stringify(this.invoice) };
  }
}

function makeQuote(overrides: Partial<Quote> = {}): Quote {
  const now = timestamp();
  return {
    id: 'quote-test',
    seller_id: 'seller_maya',
    service_id: 'svc_logo_design',
    service_title: 'Logo design',
    client_name: 'Casey Client',
    client_email: 'casey@example.com',
    brief: 'A new logo for my bakery.',
    scope_summary: 'Logo design scope.',
    line_items: [{ label: 'Logo design', amount_cents: 45000 }],
    total_cents: 45000,
    deposit_cents: 22500,
    balance_cents: 22500,
    status: 'quoted',
    source: 'web',
    approval_url: `http://localhost:8080/q/quote-test`,
    created_at: now,
    updated_at: now,
    ...overrides
  };
}

function makeReminderProposal(quote: Quote): Proposal {
  return {
    id: createId('prop'),
    quote_id: quote.id,
    client_name: quote.client_name,
    action: 'send_reminder',
    reason: 'Reminder approved and sent.',
    evidence: 'PayPal invoice INV-TEST status: UNPAID.',
    draft_message: 'A friendly reminder.',
    status: 'executed',
    created_at: timestamp()
  };
}

function makePendingProposal(quote: Quote, overrides: Partial<Proposal> = {}): Proposal {
  return {
    ...makeReminderProposal(quote),
    status: 'pending',
    ...overrides
  };
}

function saveBalanceInvoice(store: Store, quote: Quote, invoiceId = 'INV-TEST'): void {
  quote.status = 'balance_invoiced';
  quote.updated_at = timestamp();
  store.saveQuote(quote);
  const payment: Payment = {
    id: 'pay-balance',
    kind: 'balance',
    amount_cents: quote.balance_cents,
    status: 'SENT',
    paypal_invoice_id: invoiceId,
    updated_at: timestamp()
  };
  store.savePayment(quote.id, payment);
}

function toolCall(name: string, args: unknown, id = `call-${name}`): ChatCompletion {
  return {
    choices: [{
      message: {
        role: 'assistant',
        tool_calls: [{
          id,
          type: 'function',
          function: { name, arguments: JSON.stringify(args) }
        }]
      }
    }]
  } as unknown as ChatCompletion;
}

function appWith(store: Store, ai = new StubAI(), paypal = new StubPayPal(), toolkit = new StubToolkit()) {
  const app = createApp({
    store,
    ai,
    paypal,
    toolkitFactory: () => toolkit as unknown as ReturnType<PayPalService['toolkit']>
  });
  const request = app.request.bind(app);
  let demoCookie: Promise<string> | undefined;
  app.request = (async (input: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (!input.startsWith('/api/auth/') && !headers.has('cookie')) {
      demoCookie ??= Promise.resolve(request('/api/auth/demo', { method: 'POST' })).then((response) => {
        const setCookie = response.headers.get('set-cookie');
        if (!setCookie) throw new Error('Demo auth response did not set a session cookie.');
        const cookie = setCookie.split(';', 1)[0];
        if (!cookie) throw new Error('Demo auth response did not set a session cookie.');
        return cookie;
      });
      headers.set('cookie', await demoCookie);
    }
    return request(input, { ...init, headers });
  }) as typeof app.request;
  return { app, ai, paypal, toolkit };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('catalog flags and quote amounts', () => {
  it('publishes services without a lead time so they remain publicly visible', async () => {
    const store = new Store(':memory:');
    const { app } = appWith(store);
    const seller = store.getSellerById('seller_maya');
    const published = await app.request('/api/catalog/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        services: [{
          tmp_id: 'on-request',
          title: 'Cafe social media',
          description: 'Instagram management',
          deliverables: ['Monthly content'],
          price_cents: 60000,
          deposit_pct: 50,
          lead_time_days: null
        }]
      })
    });

    expect(published.status).toBe(200);
    const [service] = await published.json() as Array<{ id: string; status: string; lead_time_days: number }>;
    expect(service).toMatchObject({ status: 'published', lead_time_days: 0 });

    const publicStore = await app.request(`/api/public/${seller?.slug}`);
    expect(publicStore.status).toBe(200);
    expect(await publicStore.json()).toMatchObject({
      services: [expect.objectContaining({ id: service?.id, status: 'published', lead_time_days: 0 })]
    });
    store.close();
  });

  it('computes positive-price outliers and all requested input flags in code', () => {
    const result = computeServiceDrafts([
      { tmp_id: 'median-a', title: 'A', description: '', deliverables: ['Design'], price_usd: 450, price_currency: null, deposit_pct: 50, lead_time_days: 7 },
      { tmp_id: 'median-b', title: 'B', description: '', deliverables: ['Design'], price_usd: 450, price_currency: null, deposit_pct: 50, lead_time_days: 7 },
      { tmp_id: 'low', title: 'Low', description: '', deliverables: [], price_usd: 15, price_currency: null, deposit_pct: 10, lead_time_days: null },
      { tmp_id: 'zero', title: 'Zero', description: '', deliverables: ['Something'], price_usd: 0, price_currency: null, deposit_pct: 101, lead_time_days: 5 }
    ]);
    expect(result.flags).toEqual(expect.arrayContaining([
      expect.objectContaining({ tmp_id: 'low', field: 'price_cents', severity: 'warning', message: '$15.00 is 30× below your median — typo?' }),
      expect.objectContaining({ tmp_id: 'low', field: 'deposit_pct', severity: 'warning' }),
      expect.objectContaining({ tmp_id: 'low', field: 'deliverables', severity: 'warning' }),
      expect.objectContaining({ tmp_id: 'low', field: 'lead_time_days', severity: 'warning' }),
      expect.objectContaining({ tmp_id: 'zero', field: 'price_cents', severity: 'error' }),
      expect.objectContaining({ tmp_id: 'zero', field: 'deposit_pct', severity: 'warning' })
    ]));
    expect(result.services.find((service) => service.tmp_id === 'low')?.price_cents).toBe(1500);
  });

  it('does not flag normal price spreads below ten times the median', () => {
    const result = computeServiceDrafts([
      { tmp_id: 'mini', title: 'Mini session', description: '', deliverables: ['Photos'], price_usd: 150, price_currency: 'USD', deposit_pct: 30, lead_time_days: 5 },
      { tmp_id: 'family', title: 'Family session', description: '', deliverables: ['Photos'], price_usd: 350, price_currency: 'USD', deposit_pct: 30, lead_time_days: 7 },
      { tmp_id: 'event', title: 'Event coverage', description: '', deliverables: ['Photos'], price_usd: 900, price_currency: 'USD', deposit_pct: 30, lead_time_days: 14 },
      { tmp_id: 'wedding', title: 'Wedding full day', description: '', deliverables: ['Photos'], price_usd: 2800, price_currency: 'USD', deposit_pct: 30, lead_time_days: 21 }
    ]);

    expect(result.flags).toEqual([]);
  });

  it('flags non-USD prices and skips median typo warnings for them', () => {
    const result = computeServiceDrafts([
      { tmp_id: 'usd', title: 'USD', description: '', deliverables: ['Design'], price_usd: 450, price_currency: 'usd', deposit_pct: 50, lead_time_days: 7 },
      { tmp_id: 'unspecified', title: 'Unspecified', description: '', deliverables: ['Design'], price_usd: 450, price_currency: null, deposit_pct: 50, lead_time_days: 7 },
      { tmp_id: 'inr', title: 'INR', description: '', deliverables: ['Design'], price_usd: 15, price_currency: 'inr', deposit_pct: 50, lead_time_days: 7 }
    ]);

    expect(result.flags).toEqual([{
      tmp_id: 'inr',
      field: 'price_cents',
      severity: 'error',
      message: 'Written as INR 15. Payments are charged in USD, so enter the price in US dollars.'
    }]);
    expect(result.services.find((service) => service.tmp_id === 'inr')).not.toHaveProperty('price_currency');
  });

  it('returns a clear 502 when catalog parsing fails', async () => {
    const store = new Store(':memory:');
    const ai = new StubAI();
    const message = "The AI couldn't read this rate card. Try again, or paste fewer lines at a time.";
    vi.spyOn(ai, 'parseCatalog').mockRejectedValue(Object.assign(new Error(message), { status: 502 }));
    const { app } = appWith(store, ai);

    const response = await app.request('/api/catalog/parse', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ raw_text: 'A rate card' })
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: message });
    store.close();
  });

  it('uses exact integer cents and rounds half-cent deposits', () => {
    expect(calculateQuoteAmounts(120000, 50)).toEqual({ total_cents: 120000, deposit_cents: 60000, balance_cents: 60000 });
    expect(calculateQuoteAmounts(30000, 30)).toEqual({ total_cents: 30000, deposit_cents: 9000, balance_cents: 21000 });
    expect(calculateQuoteAmounts(101, 50)).toEqual({ total_cents: 101, deposit_cents: 51, balance_cents: 50 });
  });
});

describe('PayPal invoice links', () => {
  it('reads the payer URL from invoice detail metadata', () => {
    expect(payerLink([{
      detail: { metadata: { recipient_view_url: 'https://paypal.example/invoice' } }
    }])).toBe('https://paypal.example/invoice');
  });
});

describe('PayPal order branding', () => {
  it('sets the seller brand and no-shipping preference in the approval experience', async () => {
    vi.stubEnv('PAYPAL_CLIENT_ID', 'unit-test-client');
    vi.stubEnv('PAYPAL_CLIENT_SECRET', 'unit-test-secret');
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith('/v1/oauth2/token')) {
        return new Response(JSON.stringify({ access_token: 'unit-test-token', expires_in: 3600 }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: 'ORDER-TEST' }), { status: 201 });
    };
    const paypal = new PayPalService(fetcher);

    await paypal.createOrder('quote-test', 22500, 'Logo deposit', 'http://localhost:8080/q/quote-test', 'request-test', 'Maya Rao Studio');

    const orderRequest = requests.find((request) => request.url.endsWith('/v2/checkout/orders'));
    const body = JSON.parse(String(orderRequest?.init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      application_context: {
        brand_name: 'Maya Rao Studio',
        user_action: 'PAY_NOW',
        shipping_preference: 'NO_SHIPPING'
      }
    });
    expect(body).not.toHaveProperty('payment_source');
  });
});

describe('quotes and deposit state machine', () => {
  it('defaults public quote source to web and only accepts public sources', async () => {
    const store = new Store(':memory:');
    const { app } = appWith(store);
    const input = {
      service_id: 'svc_logo_design',
      client_name: 'Casey Client',
      client_email: 'casey@example.com',
      brief: 'A modern logo for my bakery.'
    };
    const postQuote = (body: Record<string, unknown>) => app.request('/api/public/maya-rao-studio/quotes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });

    const defaulted = await postQuote(input);
    expect(defaulted.status).toBe(201);
    expect((await defaulted.json() as { source: string }).source).toBe('web');

    const webmcp = await postQuote({ ...input, source: 'webmcp' });
    expect(webmcp.status).toBe(201);
    expect((await webmcp.json() as { source: string }).source).toBe('webmcp');

    expect((await postQuote({ ...input, source: 'mcp' })).status).toBe(400);
    expect((await postQuote({ ...input, source: 'agent_sim' })).status).toBe(400);
  });

  it('uses the seller business name on balance invoices without adding an invoicer email', async () => {
    const store = new Store(':memory:');
    const { app, paypal } = appWith(store);
    const quote = makeQuote({ status: 'deposit_paid' });
    store.saveQuote(quote);

    const response = await app.request(`/api/quotes/${quote.id}/deliver`, { method: 'POST' });

    expect(response.status).toBe(200);
    const payload = paypal.invoiceCreatePayload as { invoicer?: Record<string, unknown> };
    expect(payload.invoicer).toEqual({ business_name: store.getSellerById('seller_maya')?.name });
    expect(payload.invoicer).not.toHaveProperty('email_address');
    store.close();
  });

  it('rejects delivery before deposit, rejects mismatched capture, and is idempotent after confirmation', async () => {
    const store = new Store(':memory:');
    const { app, paypal } = appWith(store);
    const created = await app.request('/api/public/maya-rao-studio/quotes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        service_id: 'svc_logo_design',
        client_name: 'Casey Client',
        client_email: 'casey@example.com',
        brief: 'A modern logo for my bakery.',
        source: 'web'
      })
    });
    expect(created.status).toBe(201);
    const quote = await created.json() as Quote;
    expect(quote.line_items).toEqual([{ label: 'Logo design', amount_cents: 45000 }]);
    expect(quote.total_cents).toBe(45000);
    expect(quote.deposit_cents).toBe(22500);
    expect(quote.balance_cents).toBe(22500);

    const rejectedDelivery = await app.request(`/api/quotes/${quote.id}/deliver`, { method: 'POST' });
    expect(rejectedDelivery.status).toBe(409);
    const orderResponse = await app.request(`/api/quotes/${quote.id}/deposit/order`, { method: 'POST' });
    expect(orderResponse.status).toBe(200);
    expect(await orderResponse.json()).toEqual({ order_id: 'ORDER12345678901234' });
    expect(paypal.orderBrandName).toBe(store.getSellerById('seller_maya')?.name);

    const capture = {
      id: 'CAPTURE12345678901',
      status: 'COMPLETED',
      custom_id: quote.id,
      amount: { currency_code: 'USD', value: '225.00' }
    };
    const order = (customId: string, amount: string) => ({
      status: 'COMPLETED',
      purchase_units: [{
        custom_id: customId,
        amount: { currency_code: 'USD', value: amount },
        payments: { captures: [{ ...capture, amount: { currency_code: 'USD', value: amount } }] }
      }]
    });
    (paypal as StubPayPal).order = order('some-other-quote', '225.00');
    let captured = await app.request(`/api/quotes/${quote.id}/deposit/capture`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ order_id: 'ORDER12345678901234' })
    });
    expect(captured.status).toBe(400);
    (paypal as StubPayPal).order = order(quote.id, '200.00');
    captured = await app.request(`/api/quotes/${quote.id}/deposit/capture`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ order_id: 'ORDER12345678901234' })
    });
    expect(captured.status).toBe(400);
    (paypal as StubPayPal).order = order(quote.id, '225.00');
    captured = await app.request(`/api/quotes/${quote.id}/deposit/capture`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ order_id: 'ORDER12345678901234' })
    });
    expect(captured.status).toBe(200);
    expect((await captured.json() as Quote).status).toBe('deposit_paid');
    const captureCount = (paypal as StubPayPal).captureCount;
    captured = await app.request(`/api/quotes/${quote.id}/deposit/capture`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ order_id: 'ORDER12345678901234' })
    });
    expect(captured.status).toBe(200);
    expect((paypal as StubPayPal).captureCount).toBe(captureCount);
    store.close();
  });
});

describe('development sample quotes', () => {
  it('gates sample reset in production and seeds three local-only quote states', async () => {
    const store = new Store(':memory:');
    const { app } = appWith(store);
    store.saveQuote(makeQuote());
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ALLOW_DEMO_SAMPLES', '');

    const blocked = await app.request('/api/demo/reset?with_samples=1', { method: 'POST' });
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({ error: expect.stringContaining('disabled in production') });
    expect(store.listQuotes()).toHaveLength(1);

    vi.stubEnv('ALLOW_DEMO_SAMPLES', '1');
    const seeded = await app.request('/api/demo/reset?with_samples=1', { method: 'POST' });
    expect(seeded.status).toBe(200);
    const quotes = store.listQuotes();
    expect(quotes).toHaveLength(3);
    expect(quotes.map((quote) => quote.status).sort()).toEqual(['balance_invoiced', 'deposit_paid', 'quoted']);
    for (const quote of quotes) {
      expect(store.listEvents(quote.id).some((event) => event.demo_sample === true)).toBe(true);
      const payments = store.listPayments(quote.id);
      expect(payments.length).toBe(quote.status === 'balance_invoiced' ? 2 : 1);
      expect(payments.every((payment) => (
        payment.paypal_order_id === null
        && payment.paypal_capture_id === null
        && payment.paypal_invoice_id === null
      ))).toBe(true);
    }
    const statsResponse = await app.request('/api/stats');
    const stats = await statsResponse.json() as {
      by_status: Record<string, number>;
      deposits_collected_cents: number;
      owed_by_client: Array<{ client_name: string; quote_id: string }>;
    };
    expect(stats.by_status).toMatchObject({ quoted: 1, deposit_paid: 1, balance_invoiced: 1 });
    expect(stats.deposits_collected_cents).toBeGreaterThan(0);
    expect(stats.owed_by_client).toHaveLength(1);
    expect(stats.owed_by_client[0]?.client_name).toBe('Avery Brooks');

    const regularReset = await app.request('/api/demo/reset', { method: 'POST' });
    expect(regularReset.status).toBe(200);
    expect(store.listQuotes()).toHaveLength(0);
    store.close();
  });

  it('refuses PayPal, delivery, refresh and collections actions before provider calls', async () => {
    const store = new Store(':memory:');
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('ALLOW_DEMO_SAMPLES', '');
    const { app, paypal, toolkit } = appWith(store);
    const reset = await app.request('/api/demo/reset?with_samples=1', { method: 'POST' });
    expect(reset.status).toBe(200);
    const quotes = store.listQuotes();
    const quoted = quotes.find((quote) => quote.status === 'quoted')!;
    const depositPaid = quotes.find((quote) => quote.status === 'deposit_paid')!;
    const invoiced = quotes.find((quote) => quote.status === 'balance_invoiced')!;
    const proposal: Proposal = {
      ...makeReminderProposal(invoiced),
      status: 'pending'
    };
    store.saveProposal(proposal);

    const requests = await Promise.all([
      app.request(`/api/quotes/${quoted.id}?refresh=1`),
      app.request(`/api/quotes/${quoted.id}/deposit/order`, { method: 'POST' }),
      app.request(`/api/quotes/${quoted.id}/deposit/capture`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ order_id: 'ORDER-LOCAL-SAMPLE' })
      }),
      app.request(`/api/quotes/${depositPaid.id}/deliver`, { method: 'POST' }),
      app.request(`/api/quotes/${invoiced.id}/collections/run`, { method: 'POST' }),
      app.request(`/api/quotes/${invoiced.id}/replies`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from: 'client', text: 'I have a question about this sample.' })
      }),
      app.request(`/api/proposals/${proposal.id}/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ draft_message: 'A sample reminder.' })
      })
    ]);
    for (const response of requests) {
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: expect.stringContaining('development sample quote') });
    }
    expect(paypal.createOrderCount).toBe(0);
    expect(paypal.captureCount).toBe(0);
    expect(paypal.orderReadCount).toBe(0);
    expect(paypal.invoiceCreateCount).toBe(0);
    expect(paypal.invoiceSendCount).toBe(0);
    expect(paypal.invoiceReadCount).toBe(0);
    expect(toolkit.calls).toEqual([]);
    expect(store.listReplies(invoiced.id)).toHaveLength(0);
    expect(store.getProposal(proposal.id)?.status).toBe('pending');
    store.close();
  });
});

describe('Studio LLM proxy', () => {
  const request = (app: ReturnType<typeof createApp>, body: string | Record<string, unknown>) => app.request('/api/studio/llm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
  const validBody = { messages: [{ role: 'user', content: 'Say hello.' }] };

  it('proxies a valid chat-completions request through the server AI service', async () => {
    const store = new Store(':memory:');
    const ai = new StubAI();
    ai.completionQueue.push({
      id: 'studio-completion',
      created: 1_720_000_000,
      model: 'workers-ai/server-selected-model',
      object: 'chat.completion',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'Hello from the server.' } }]
    } as unknown as ChatCompletion);
    const { app } = appWith(store, ai);
    const response = await request(app, validBody);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: 'studio-completion',
      model: 'workers-ai/server-selected-model',
      choices: [{ message: { content: 'Hello from the server.' } }]
    });
    store.close();
  });

  it('omits empty tool configuration for text-only Studio prompts', async () => {
    const calls: unknown[] = [];
    const client = {
      chat: {
        completions: {
          create: async (params: unknown) => {
            calls.push(params);
            return {
              id: 'text-only',
              created: 1,
              model: 'workers-ai/primary-test',
              object: 'chat.completion',
              choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'Ready.' } }]
            };
          }
        }
      }
    } as unknown as OpenAI;
    const ai = new AIService(client, 'workers-ai/primary-test', 'workers-ai/fallback-test');
    await ai.chatCompletion([{ role: 'user', content: 'Reply ready.' }], []);
    expect(calls[0]).not.toHaveProperty('tools');
    expect(calls[0]).not.toHaveProperty('tool_choice');
    expect(calls[0]).toHaveProperty('max_tokens', 1024);
  });

  it('rejects malformed, oversized, over-tooled, and model-selecting bodies', async () => {
    const store = new Store(':memory:');
    const { app } = appWith(store);
    expect((await request(app, '{')).status).toBe(400);
    expect((await request(app, 'x'.repeat(200 * 1024 + 1))).status).toBe(413);
    expect((await request(app, {
      ...validBody,
      tools: Array.from({ length: 41 }, (_, index) => ({
        type: 'function',
        function: { name: `tool_${index}`, parameters: { type: 'object' } }
      }))
    })).status).toBe(400);
    expect((await request(app, { ...validBody, model: 'client-selected-model' })).status).toBe(400);
    store.close();
  });

  it('limits requests to 20 per minute and client IP', async () => {
    const store = new Store(':memory:');
    const { app } = appWith(store);
    const responses: Response[] = [];
    for (let index = 0; index < 21; index += 1) {
      responses.push(await app.request('/api/studio/llm', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.18' },
        body: JSON.stringify(validBody)
      }));
    }
    expect(responses.slice(0, 20).every((response) => response.status === 200)).toBe(true);
    expect(responses[20]?.status).toBe(429);
    store.close();
  });
});

describe('AI response safeguards', () => {
  it('caps forced tool calls at 4096 tokens and maps catalog failures to 502', async () => {
    const calls: unknown[] = [];
    const client = {
      chat: {
        completions: {
          create: async (params: unknown) => {
            calls.push(params);
            throw new Error('Model request failed.');
          }
        }
      }
    } as unknown as OpenAI;
    const ai = new AIService(client, 'workers-ai/primary-test', 'workers-ai/fallback-test');
    const message = "The AI couldn't read this rate card. Try again, or paste fewer lines at a time.";

    await expect(ai.parseCatalog('Rate card')).rejects.toMatchObject({ status: 502, message });
    expect(calls).toHaveLength(3);
    expect(calls.map((call) => (call as { max_tokens: number }).max_tokens)).toEqual([4096, 4096, 4096]);
  });

  it('classifies repetitive and low-letter outputs without rejecting short replies', () => {
    expect(isDegenerateText('!!!!!!!!!!!!!!!!!!!!')).toBe(true);
    expect(isDegenerateText('ok')).toBe(false);
    expect(isDegenerateText('!!!!!!!!!!!!')).toBe(true);
    expect(isDegenerateText('Invoice is SENT.')).toBe(false);
    expect(isDegenerateText('   ')).toBe(false);
  });

  it('retries degenerate primary replies before returning the fallback model response', async () => {
    const contents = ['!!!!!!!!!!!!!!!!!!!!', '!!!!!!!!!!!!!!!!!!!!', 'A useful fallback reply.'];
    const models: string[] = [];
    const client = {
      chat: {
        completions: {
          create: async (params: unknown) => {
            models.push((params as { model: string }).model);
            return {
              id: `completion-${models.length}`,
              created: 1,
              model: models.at(-1),
              object: 'chat.completion',
              choices: [{
                index: 0,
                finish_reason: 'stop',
                message: { role: 'assistant', content: contents.shift() }
              }]
            };
          }
        }
      }
    } as unknown as OpenAI;
    const ai = new AIService(client, 'workers-ai/primary-test', 'workers-ai/fallback-test');

    const response = await ai.chatCompletion([{ role: 'user', content: 'Respond briefly.' }], []);

    expect(models).toEqual([
      'workers-ai/primary-test',
      'workers-ai/primary-test',
      'workers-ai/fallback-test'
    ]);
    expect(response.choices[0]?.message.content).toBe('A useful fallback reply.');
  });

  it('returns a degenerate fallback response after both primary attempts fail', async () => {
    const contents = ['!!!!!!!!!!!!!!!!!!!!', '!!!!!!!!!!!!!!!!!!!!', '!!!!!!!!!!!!'];
    const client = {
      chat: {
        completions: {
          create: async (params: unknown) => ({
            id: 'completion',
            created: 1,
            model: (params as { model: string }).model,
            object: 'chat.completion',
            choices: [{
              index: 0,
              finish_reason: 'stop',
              message: { role: 'assistant', content: contents.shift() }
            }]
          })
        }
      }
    } as unknown as OpenAI;
    const ai = new AIService(client, 'workers-ai/primary-test', 'workers-ai/fallback-test');

    const response = await ai.chatCompletion([{ role: 'user', content: 'Respond briefly.' }], []);

    expect(response.choices[0]?.message.content).toBe('!!!!!!!!!!!!');
  });
});

describe('collections safeguards', () => {
  it('forces thank_and_close when real PayPal invoice status is PAID', async () => {
    const store = new Store(':memory:');
    const ai = new StubAI();
    const toolkit = new StubToolkit();
    toolkit.invoice = { id: 'INV-TEST', status: 'PAID' };
    ai.completionQueue.push(toolCall('get_invoice', { invoice_id: 'INV-TEST' }));
    ai.completionQueue.push(toolCall('propose_action', {
      action: 'send_reminder', reason: 'Model proposed reminder', draft_message: 'Please pay.'
    }));
    const { app } = appWith(store, ai, new StubPayPal(), toolkit);
    const quote = makeQuote();
    saveBalanceInvoice(store, quote);
    const response = await app.request(`/api/quotes/${quote.id}/collections/run`, { method: 'POST' });
    expect(response.status).toBe(200);
    const run = await response.json() as { proposal: Proposal };
    expect(run.proposal.action).toBe('thank_and_close');
    expect(run.proposal.evidence).toMatch(/PayPal invoice INV-TEST status: PAID, checked/);
    expect(toolkit.calls).toContain('get_invoice');
    store.close();
  });

  it('server-fetches a missing get_invoice and escalates after the reminder limit', async () => {
    const store = new Store(':memory:');
    const ai = new StubAI();
    const toolkit = new StubToolkit();
    ai.completionQueue.push(toolCall('propose_action', {
      action: 'send_reminder', reason: 'Send a friendly reminder.', draft_message: 'A friendly reminder.'
    }));
    const { app } = appWith(store, ai, new StubPayPal(), toolkit);
    const quote = makeQuote();
    saveBalanceInvoice(store, quote);
    store.saveProposal(makeReminderProposal(quote));
    store.saveProposal(makeReminderProposal(quote));
    const response = await app.request(`/api/quotes/${quote.id}/collections/run`, { method: 'POST' });
    expect(response.status).toBe(200);
    const run = await response.json() as { proposal: Proposal };
    expect(toolkit.calls).toContain('get_invoice');
    expect(run.proposal.action).toBe('escalate');
    expect(run.proposal.evidence).toContain('status: UNPAID');
    store.close();
  });

  it('allows a reminder when only one of two allowed reminders has executed', async () => {
    const store = new Store(':memory:');
    const ai = new StubAI();
    const toolkit = new StubToolkit();
    ai.completionQueue.push(toolCall('get_invoice', { invoice_id: 'INV-TEST' }));
    ai.completionQueue.push(toolCall('propose_action', {
      action: 'send_reminder', reason: 'A reminder is appropriate.', draft_message: 'A friendly reminder.'
    }));
    const { app } = appWith(store, ai, new StubPayPal(), toolkit);
    const quote = makeQuote();
    saveBalanceInvoice(store, quote);
    const seller = store.getSellerById('seller_maya')!;
    seller.rules.wait_days_before_nudge = 0;
    store.saveSeller(seller);
    store.saveProposal(makeReminderProposal(quote));
    const response = await app.request(`/api/quotes/${quote.id}/collections/run`, { method: 'POST' });
    expect(response.status).toBe(200);
    const run = await response.json() as { proposal: Proposal };
    expect(run.proposal.action).toBe('send_reminder');
    store.close();
  });

  it('waits until the configured whole days have elapsed after the balance invoice was sent', async () => {
    const store = new Store(':memory:');
    const ai = new StubAI();
    const toolkit = new StubToolkit();
    ai.completionQueue.push(toolCall('get_invoice', { invoice_id: 'INV-TEST' }));
    ai.completionQueue.push(toolCall('propose_action', {
      action: 'send_reminder',
      reason: 'A reminder is appropriate.',
      draft_message: 'A friendly reminder.'
    }));
    const { app } = appWith(store, ai, new StubPayPal(), toolkit);
    const quote = makeQuote();
    saveBalanceInvoice(store, quote);
    const payment = store.getPayment(quote.id, 'balance')!;
    payment.updated_at = timestamp();
    store.savePayment(quote.id, payment);
    const sentAt = new Date(Date.now() - 2 * 86_400_000).toISOString();
    store.saveEvent({
      ...createEvent('paypal', 'tool_call', quote.id, {
        tool: 'send_invoice',
        output: { invoice_id: 'INV-TEST' }
      }),
      created_at: sentAt
    });

    const response = await app.request(`/api/quotes/${quote.id}/collections/run`, { method: 'POST' });

    expect(response.status).toBe(200);
    const run = await response.json() as { proposal: Proposal };
    expect(run.proposal.action).toBe('wait');
    expect(run.proposal.reason).toBe(
      'The balance invoice was sent 2 days ago; your rule is to wait 3 days before a reminder.'
    );
    expect(run.proposal.draft_message).toBe('A friendly reminder.');
    store.close();
  });

  it('supersedes older pending proposals when collections runs again', async () => {
    const store = new Store(':memory:');
    const ai = new StubAI();
    const toolkit = new StubToolkit();
    for (const reason of ['First proposal.', 'Newer proposal.']) {
      ai.completionQueue.push(toolCall('get_invoice', { invoice_id: 'INV-TEST' }));
      ai.completionQueue.push(toolCall('propose_action', {
        action: 'send_reminder',
        reason,
        draft_message: 'A friendly reminder.'
      }));
    }
    const { app } = appWith(store, ai, new StubPayPal(), toolkit);
    const quote = makeQuote();
    saveBalanceInvoice(store, quote);

    for (let index = 0; index < 2; index += 1) {
      const response = await app.request(`/api/quotes/${quote.id}/collections/run`, { method: 'POST' });
      expect(response.status).toBe(200);
    }

    const proposals = store.listProposals(quote.id);
    expect(proposals.filter((proposal) => proposal.status === 'pending')).toHaveLength(1);
    expect(proposals.filter((proposal) => proposal.status === 'rejected')).toHaveLength(1);
    expect(store.listEvents().filter((event) => (
      event.actor === 'collections_agent' &&
      event.kind === 'decision' &&
      event.text === 'Superseded by a newer proposal after re-checking PayPal.'
    ))).toHaveLength(1);
    store.close();
  });

  it('rejects pending proposals when refresh confirms the balance invoice is paid', async () => {
    const store = new Store(':memory:');
    const paypal = new StubPayPal();
    paypal.invoice = { id: 'INV-TEST', status: 'PAID' };
    const quote = makeQuote();
    saveBalanceInvoice(store, quote);
    store.saveProposal(makePendingProposal(quote));
    store.saveProposal(makePendingProposal(quote));
    const { app } = appWith(store, new StubAI(), paypal);

    const response = await app.request(`/api/quotes/${quote.id}?refresh=1`);

    expect(response.status).toBe(200);
    expect(store.getQuote(quote.id)?.status).toBe('paid');
    expect(store.listProposals(quote.id).every((proposal) => proposal.status === 'rejected')).toBe(true);
    expect(store.listEvents().filter((event) => (
      event.actor === 'collections_agent' &&
      event.kind === 'decision' &&
      event.text === 'Closed: PayPal confirms the balance invoice is paid.'
    ))).toHaveLength(2);
    store.close();
  });

  it('rejects a reminder approval when PayPal now reports the invoice as paid', async () => {
    const store = new Store(':memory:');
    const paypal = new StubPayPal();
    paypal.invoice = { id: 'INV-TEST', status: 'PAID' };
    const toolkit = new StubToolkit();
    const quote = makeQuote();
    saveBalanceInvoice(store, quote);
    const proposal = makePendingProposal(quote);
    store.saveProposal(proposal);
    const { app } = appWith(store, new StubAI(), paypal, toolkit);

    const response = await app.request(`/api/proposals/${proposal.id}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ draft_message: proposal.draft_message })
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'PayPal shows this invoice is already paid, so no reminder was sent.'
    });
    expect(paypal.invoiceReadCount).toBe(1);
    expect(toolkit.calls).not.toContain('send_invoice_reminder');
    expect(store.getProposal(proposal.id)?.status).toBe('rejected');
    expect(store.getQuote(quote.id)?.status).toBe('paid');
    expect(store.listEvents().filter((event) => (
      event.actor === 'paypal' && event.kind === 'tool_call' && event.tool === 'get_invoice'
    ))).toHaveLength(2);
    expect(store.listEvents().some((event) => (
      event.actor === 'collections_agent' &&
      event.kind === 'decision' &&
      event.text === 'Closed: PayPal confirms the balance invoice is paid.'
    ))).toBe(true);
    store.close();
  });

  it('recovers with a forced proposal after text-only degeneracy and gives the model compact invoice state', async () => {
    const store = new Store(':memory:');
    const ai = new StubAI();
    const toolkit = new StubToolkit();
    toolkit.invoice = {
      id: 'INV-TEST',
      status: 'SENT',
      detail: {
        invoice_number: 'INV-NUMBER',
        currency_code: 'USD',
        viewed_by_recipient: true
      },
      amount: { value: '225.00' },
      due_amount: { value: '225.00' },
      payments: {
        paid_amount: { value: '0.00' },
        transactions: [
          { payment_date: '2025-02-01T12:00:00Z' },
          { payment_date: '2025-02-03T12:00:00Z' }
        ]
      }
    };
    const forcedProposal = {
      action: 'send_reminder',
      reason: 'Client says paid; PayPal shows SENT.',
      draft_message: 'Thanks Casey — PayPal does not show the payment yet. You can check or pay through the invoice link.'
    };
    ai.forcedToolResult = forcedProposal;
    ai.completionQueue.push(toolCall('get_invoice', { invoice_id: 'INV-TEST' }));
    ai.completionQueue.push({
      choices: [{ message: { role: 'assistant', content: '!!!!!!!!!!!!!!!!!!!!' } }]
    } as unknown as ChatCompletion);
    const { app } = appWith(store, ai, new StubPayPal(), toolkit);
    const quote = makeQuote({ client_name: 'Casey' });
    saveBalanceInvoice(store, quote);
    const seller = store.getSellerById('seller_maya')!;
    seller.rules.wait_days_before_nudge = 0;
    store.saveSeller(seller);

    const response = await app.request(`/api/quotes/${quote.id}/collections/run`, { method: 'POST' });

    expect(response.status).toBe(200);
    const run = await response.json() as { proposal: Proposal; summary: string };
    expect(run.proposal.action).toBe('send_reminder');
    expect(run.proposal.draft_message).not.toBe('');
    expect(run.summary).toBe(forcedProposal.reason);
    expect(ai.toolResultCalls).toHaveLength(1);
    expect(ai.toolResultCalls[0]?.system).toContain('PayPal invoice state (verified just now):');
    expect(ai.toolResultCalls[0]?.user).toBe('Propose the next action now.');

    const invoiceToolMessage = ai.messageHistory[1]?.find((message) => message.role === 'tool');
    expect(invoiceToolMessage?.role).toBe('tool');
    if (invoiceToolMessage?.role !== 'tool' || typeof invoiceToolMessage.content !== 'string') {
      throw new Error('Compact invoice tool message was not recorded.');
    }
    const compactState = JSON.parse(invoiceToolMessage.content) as Record<string, unknown>;
    expect(compactState).toEqual({
      invoice_id: 'INV-TEST',
      status: 'SENT',
      invoice_number: 'INV-NUMBER',
      currency_code: 'USD',
      total_value: '225.00',
      amount_due_value: '225.00',
      paid_value: '0.00',
      viewed_by_recipient: true,
      last_payment_date: '2025-02-03T12:00:00Z'
    });
    expect(compactState).not.toHaveProperty('detail');

    const fullInvoiceEvent = store.listEvents(quote.id).find((event) => event.actor === 'paypal' && event.tool === 'get_invoice');
    expect(fullInvoiceEvent?.output).toHaveProperty('detail');
    expect(store.listEvents(quote.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actor: 'collections_agent',
        kind: 'tool_call',
        tool: 'propose_action',
        input: forcedProposal
      })
    ]));
    store.close();
  });
});

describe('PayPal webhooks', () => {
  const event = (type: string) => ({
    id: 'WH-TEST-EVENT',
    event_type: type,
    resource: { id: 'INV-TEST', status: 'PAID' }
  });

  it('rejects unverified events and refuses operation without webhook id', async () => {
    vi.stubEnv('PAYPAL_WEBHOOK_ID', 'WH-ID');
    const store = new Store(':memory:');
    const paypal = new StubPayPal();
    paypal.verification = false;
    const { app } = appWith(store, new StubAI(), paypal);
    const unverified = await app.request('/api/paypal/webhook', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event('INVOICING.INVOICE.PAID'))
    });
    expect(unverified.status).toBe(400);
    vi.stubEnv('PAYPAL_WEBHOOK_ID', '');
    const missingId = await app.request('/api/paypal/webhook', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event('INVOICING.INVOICE.PAID'))
    });
    expect(missingId.status).toBe(503);
    store.close();
  });

  it('deduplicates and re-fetches invoice state before marking paid', async () => {
    vi.stubEnv('PAYPAL_WEBHOOK_ID', 'WH-ID');
    const store = new Store(':memory:');
    const paypal = new StubPayPal();
    paypal.invoice = { id: 'INV-TEST', status: 'PAID' };
    const { app } = appWith(store, new StubAI(), paypal);
    const quote = makeQuote();
    saveBalanceInvoice(store, quote);
    const first = await app.request('/api/paypal/webhook', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event('INVOICING.INVOICE.PAID'))
    });
    expect(first.status).toBe(200);
    expect(store.getQuote(quote.id)?.status).toBe('paid');
    const duplicate = await app.request('/api/paypal/webhook', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event('INVOICING.INVOICE.PAID'))
    });
    expect((await duplicate.json() as { duplicate: boolean }).duplicate).toBe(true);
    expect(paypal.invoiceReadCount).toBe(1);
    store.close();
  });

  it('does not mark paid when PayPal refetch reports UNPAID', async () => {
    vi.stubEnv('PAYPAL_WEBHOOK_ID', 'WH-ID');
    const store = new Store(':memory:');
    const paypal = new StubPayPal();
    paypal.invoice = { id: 'INV-TEST', status: 'UNPAID' };
    const { app } = appWith(store, new StubAI(), paypal);
    const quote = makeQuote();
    saveBalanceInvoice(store, quote);
    const response = await app.request('/api/paypal/webhook', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event('INVOICING.INVOICE.PAID'))
    });
    expect(response.status).toBe(200);
    expect(store.getQuote(quote.id)?.status).toBe('balance_invoiced');
    store.close();
  });
});

describe('agent simulator', () => {
  it('uses studio catalog context and returns an assistant answer after repeated tool calls', async () => {
    const store = new Store(':memory:');
    const ai = new StubAI();
    for (let index = 0; index < 5; index += 1) {
      ai.completionQueue.push(toolCall(
        'list_services',
        { seller_slug: 'maya-rao-studio' },
        `list-services-${index}`
      ));
    }
    const { app } = appWith(store, ai);
    const response = await app.request('/api/agent-sim/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'maya-rao-studio',
        messages: [{ role: 'user', content: 'I want a logo for my cafe.' }]
      })
    });

    expect(response.status).toBe(200);
    const result = await response.json() as { messages: Array<{ role: string; content?: string }> };
    expect(result.messages.at(-1)).toEqual({
      role: 'assistant',
      content: "Sorry, I couldn't finish that. Could you rephrase your request?"
    });
    expect(ai.toolChoiceHistory).toEqual(['auto', 'auto', 'auto', 'auto', 'none']);
    const systemMessage = ai.messageHistory[0]?.[0];
    expect(systemMessage).toMatchObject({
      role: 'system',
      content: expect.stringContaining('maya-rao-studio')
    });
    expect(systemMessage?.content).toContain('Logo design');
    store.close();
  });
});

describe('MCP client tools', () => {
  it('lists four tools and creates a quote through an in-process MCP client', async () => {
    const store = new Store(':memory:');
    const clientTools = new ClientTools({
      store,
      publicBaseUrl: 'http://localhost:8080',
      createQuote: async ({ service, client_name, client_email, brief, source }) => {
        const now = timestamp();
        const amounts = calculateQuoteAmounts(service.price_cents, service.deposit_pct);
        const quote: Quote = {
          id: createId('q'),
          seller_id: service.seller_id,
          service_id: service.id,
          service_title: service.title,
          client_name,
          client_email,
          brief,
          scope_summary: 'MCP quote scope.',
          line_items: [{ label: service.title, amount_cents: amounts.total_cents }],
          ...amounts,
          status: 'quoted',
          source: source as Source,
          approval_url: `http://localhost:8080/q/${createId('q')}`,
          created_at: now,
          updated_at: now
        };
        store.saveQuote(quote);
        return quote;
      }
    });
    const mcp = createMcpServer(clientTools);
    const client = new Client({ name: 'serviceready-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcp.connect(serverTransport);
    await client.connect(clientTransport);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      'get_quote_status', 'get_service', 'list_services', 'request_quote'
    ]);
    const result = await client.callTool({
      name: 'request_quote',
      arguments: {
        seller_slug: 'maya-rao-studio',
        service_id: 'svc_logo_design',
        client_name: 'Taylor Client',
        client_email: 'taylor@example.com',
        brief: 'A logo for my bakery'
      }
    });
    const contentItems = result.content as Array<{ type: string; text?: string }>;
    const content = contentItems[0];
    expect(content?.type).toBe('text');
    const output = JSON.parse(content?.type === 'text' ? content.text ?? '{}' : '{}') as { quote_id: string; note: string };
    expect(store.getQuote(output.quote_id)?.source).toBe('mcp');
    expect(output.note).toContain('A human must approve and pay the deposit');
    await client.close();
    await mcp.close();
    store.close();
  });
});
