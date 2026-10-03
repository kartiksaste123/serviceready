import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type OpenAI from 'openai';
import type { ChatCompletion, ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources';
import { AIService } from '../src/ai.js';
import { createApp } from '../src/app.js';
import { ClientTools } from '../src/client-tools.js';
import { calculateQuoteAmounts, computeServiceDrafts } from '../src/core.js';
import { createEvent, createId, Store, timestamp } from '../src/db.js';
import { createMcpServer } from '../src/mcp.js';
import { PayPalService, payerLink } from '../src/paypal.js';
import type { Payment, Proposal, Quote, Source } from '../src/types.js';

class StubAI extends AIService {
  readonly completionQueue: ChatCompletion[] = [];
  async quoteScope(): Promise<string> {
    return 'A concise scope summary. Fit check: Good fit.';
  }
  async chatCompletion(_messages: ChatCompletionMessageParam[], _tools: ChatCompletionTool[]): Promise<ChatCompletion> {
    return this.completionQueue.shift() ?? {
      choices: [{ message: { role: 'assistant', content: 'Please share your project details.' } }]
    } as unknown as ChatCompletion;
  }
}

class StubPayPal extends PayPalService {
  verification = true;
  invoice: Record<string, unknown> = { id: 'INV-TEST', status: 'UNPAID' };
  order: Record<string, unknown> = {};
  captureCount = 0;
  invoiceReadCount = 0;

  async createOrder(): Promise<{ id: string }> {
    return { id: 'ORDER12345678901234' };
  }
  async captureOrder(): Promise<Record<string, unknown>> {
    this.captureCount += 1;
    return { status: 'COMPLETED' };
  }
  async getOrder(): Promise<Record<string, unknown>> {
    return this.order;
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
  return { app, ai, paypal, toolkit };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('catalog flags and quote amounts', () => {
  it('computes positive-price outliers and all requested input flags in code', () => {
    const result = computeServiceDrafts([
      { tmp_id: 'median-a', title: 'A', description: '', deliverables: ['Design'], price_usd: 450, deposit_pct: 50, lead_time_days: 7 },
      { tmp_id: 'median-b', title: 'B', description: '', deliverables: ['Design'], price_usd: 450, deposit_pct: 50, lead_time_days: 7 },
      { tmp_id: 'low', title: 'Low', description: '', deliverables: [], price_usd: 15, deposit_pct: 10, lead_time_days: null },
      { tmp_id: 'zero', title: 'Zero', description: '', deliverables: ['Something'], price_usd: 0, deposit_pct: 101, lead_time_days: 5 }
    ]);
    expect(result.flags).toEqual(expect.arrayContaining([
      expect.objectContaining({ tmp_id: 'low', field: 'price_usd', severity: 'warning', message: '$15.00 is 30× below your median — typo?' }),
      expect.objectContaining({ tmp_id: 'low', field: 'deposit_pct', severity: 'warning' }),
      expect.objectContaining({ tmp_id: 'low', field: 'deliverables', severity: 'warning' }),
      expect.objectContaining({ tmp_id: 'low', field: 'lead_time_days', severity: 'warning' }),
      expect.objectContaining({ tmp_id: 'zero', field: 'price_usd', severity: 'error' }),
      expect.objectContaining({ tmp_id: 'zero', field: 'deposit_pct', severity: 'warning' })
    ]));
    expect(result.services.find((service) => service.tmp_id === 'low')?.price_cents).toBe(1500);
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
    store.saveProposal(makeReminderProposal(quote));
    const response = await app.request(`/api/quotes/${quote.id}/collections/run`, { method: 'POST' });
    expect(response.status).toBe(200);
    const run = await response.json() as { proposal: Proposal };
    expect(run.proposal.action).toBe('send_reminder');
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
