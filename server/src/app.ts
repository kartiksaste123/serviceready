import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { Hono } from 'hono';
import { z } from 'zod';
import { AIService, isDegenerateText, jsonSchemaTool } from './ai.js';
import { ClientTools, toolSchemas } from './client-tools.js';
import { calculateQuoteAmounts, computeServiceDrafts, isCompletedCapture } from './core.js';
import { createEvent, createId, Store, timestamp } from './db.js';
import { createMcpServer } from './mcp.js';
import { centsFromAmount, invoiceIdFrom, PayPalService, payerLink } from './paypal.js';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionToolChoiceOption
} from 'openai/resources';
import type {
  AgentEvent,
  AgentRun,
  ChatMsg,
  Payment,
  Proposal,
  PublicStore,
  Quote,
  QuoteDetail,
  QuoteStatus,
  Service,
  ServiceDraft,
  SellerRules,
  Source,
  ToolTrace
} from './types.js';

const quoteInput = z.object({
  service_id: z.string().min(1),
  client_name: z.string().trim().min(1).max(120),
  client_email: z.string().email().max(254),
  brief: z.string().trim().min(1).max(4000),
  source: z.enum(['web', 'webmcp']).default('web')
}).strict();
const publishDraftSchema = z.object({
  tmp_id: z.string().min(1).max(100),
  title: z.string().trim().min(1).max(160),
  description: z.string().max(2000),
  deliverables: z.array(z.string().max(240)).max(40),
  price_cents: z.number().int(),
  deposit_pct: z.number(),
  lead_time_days: z.number().int().positive().nullable()
}).strict();
const rulesSchema = z.object({
  default_deposit_pct: z.number().int().min(20).max(100),
  reminder_tone: z.enum(['friendly', 'neutral', 'firm']),
  max_reminders: z.number().int().min(0).max(20),
  wait_days_before_nudge: z.number().int().min(0).max(365)
}).strict();
const captureSchema = z.object({ order_id: z.string().trim().min(1).max(64) }).strict();
const replySchema = z.object({
  text: z.string().trim().min(1).max(4000),
  from: z.enum(['client', 'seller'])
}).strict();
const approveSchema = z.object({ draft_message: z.string().trim().min(1).max(4000) }).strict();
const agentSimSchema = z.object({
  slug: z.string().min(1),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(4000)
  }).strict()).min(1).max(40)
}).strict();
const studioLlmContentPartSchema = z.union([
  z.object({ type: z.literal('text'), text: z.string() }).strict(),
  z.object({
    type: z.literal('image_url'),
    image_url: z.object({
      url: z.string().min(1),
      detail: z.enum(['auto', 'low', 'high']).optional()
    }).strict()
  }).strict()
]);
const studioLlmMessageSchema = z.object({
  role: z.enum(['system', 'developer', 'user', 'assistant', 'tool']),
  content: z.union([z.string(), z.array(studioLlmContentPartSchema), z.null()]).optional(),
  name: z.string().optional(),
  tool_call_id: z.string().optional(),
  tool_calls: z.array(z.object({
    id: z.string(),
    type: z.literal('function'),
    function: z.object({ name: z.string(), arguments: z.string() }).strict()
  }).strict()).optional()
}).strict()
  .refine((message) => (message.content !== undefined && message.content !== null)
    || (message.role === 'assistant' && (message.tool_calls?.length ?? 0) > 0))
  .refine((message) => message.role === 'tool' ? Boolean(message.tool_call_id) : message.tool_call_id === undefined)
  .refine((message) => message.role === 'assistant' || message.tool_calls === undefined);
const studioLlmToolSchema = z.object({
  type: z.literal('function'),
  function: z.object({
    name: z.string().min(1).max(64),
    description: z.string().optional(),
    parameters: z.record(z.string(), z.unknown()),
    strict: z.boolean().optional()
  }).strict()
}).strict();
const studioLlmSchema = z.object({
  messages: z.array(studioLlmMessageSchema).min(1).max(100),
  tools: z.array(studioLlmToolSchema).max(40).optional(),
  tool_choice: z.union([
    z.enum(['none', 'auto', 'required']),
    z.object({
      type: z.literal('function'),
      function: z.object({ name: z.string().min(1).max(64) }).strict()
    }).strict()
  ]).optional()
}).strict();
const STUDIO_LLM_MAX_BODY_BYTES = 200 * 1024;
const proposalActionSchema = z.object({
  action: z.enum(['wait', 'send_reminder', 'thank_and_close', 'escalate']),
  reason: z.string().trim().min(1).max(1000),
  draft_message: z.string().trim().max(4000)
}).strict();
const quoteStatusSchema = z.enum(['quoted', 'deposit_paid', 'delivered', 'balance_invoiced', 'paid', 'cancelled']);
const actorSchema = z.enum(['seller_agent', 'client_agent', 'collections_agent', 'system', 'seller', 'client', 'paypal']);

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function parseBody<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, result.error.issues[0]?.message ?? 'Invalid request body.');
  return result.data;
}

async function readLimitedJson(request: Request, maxBytes: number): Promise<unknown> {
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null) {
    const length = Number(contentLength);
    if (!Number.isSafeInteger(length) || length < 0) throw new HttpError(400, 'Invalid content length.');
    if (length > maxBytes) throw new HttpError(413, 'Request body is too large.');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'Request body is required.');
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new HttpError(413, 'Request body is too large.');
    }
    chunks.push(value);
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(body)) as unknown;
  } catch {
    throw new HttpError(400, 'Malformed JSON request body.');
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function getNestedOrder(value: unknown): Record<string, unknown> {
  return asObject(value);
}

function findPurchaseUnit(order: Record<string, unknown>): Record<string, unknown> | null {
  const units = order.purchase_units;
  return Array.isArray(units) && units.length > 0 ? asObject(units[0]) : null;
}

function findCapture(value: unknown): Record<string, unknown> | null {
  const obj = asObject(value);
  const unit = findPurchaseUnit(obj);
  const payments = asObject(unit?.payments);
  const captures = payments.captures;
  return Array.isArray(captures) && captures.length > 0 ? asObject(captures[0]) : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected error.';
}

function detail(store: Store, quoteId: string): QuoteDetail {
  const quote = store.getQuote(quoteId);
  if (!quote) throw new HttpError(404, 'Quote not found.');
  return {
    quote,
    payments: store.listPayments(quoteId),
    events: store.listEvents(quoteId),
    replies: store.listReplies(quoteId),
    proposals: store.listProposals(quoteId)
  };
}

function seedDemoSamples(store: Store, baseUrl: string): void {
  const samples = [
    {
      serviceId: 'svc_logo_design',
      clientName: 'Riley Chen',
      clientEmail: 'riley@example.invalid',
      brief: 'A fresh, versatile logo for a neighborhood bakery.',
      status: 'quoted',
      quoteAgeDays: 1
    },
    {
      serviceId: 'svc_social_templates',
      clientName: 'Morgan Lee',
      clientEmail: 'morgan@example.invalid',
      brief: 'Reusable social templates for a small ceramics studio.',
      status: 'deposit_paid',
      quoteAgeDays: 3
    },
    {
      serviceId: 'svc_brand_identity_kit',
      clientName: 'Avery Brooks',
      clientEmail: 'avery@example.invalid',
      brief: 'A complete identity for a community coffee shop.',
      status: 'balance_invoiced',
      quoteAgeDays: 8
    }
  ] as const;

  for (const sample of samples) {
    const service = store.getService(sample.serviceId);
    if (!service) throw new Error(`Demo sample service "${sample.serviceId}" is missing.`);
    const amounts = calculateQuoteAmounts(service.price_cents, service.deposit_pct);
    const quoteId = createId('q');
    const createdAt = new Date(Date.now() - sample.quoteAgeDays * 86_400_000).toISOString();
    const quote: Quote = {
      id: quoteId,
      service_id: service.id,
      service_title: service.title,
      client_name: sample.clientName,
      client_email: sample.clientEmail,
      brief: sample.brief,
      scope_summary: `A focused ${service.title.toLowerCase()} project, shaped around the client's goals and audience.`,
      line_items: [{ label: service.title, amount_cents: amounts.total_cents }],
      ...amounts,
      status: sample.status,
      source: 'web',
      approval_url: `${baseUrl.replace(/\/+$/, '')}/q/${quoteId}`,
      created_at: createdAt,
      updated_at: createdAt
    };
    store.saveQuote(quote);
    store.savePayment(quoteId, {
      id: createId('pay'),
      kind: 'deposit',
      amount_cents: quote.deposit_cents,
      status: sample.status === 'quoted' ? 'PENDING' : 'COMPLETED',
      paypal_order_id: null,
      paypal_capture_id: null,
      paypal_invoice_id: null,
      updated_at: createdAt
    });
    if (sample.status === 'balance_invoiced') {
      store.savePayment(quoteId, {
        id: createId('pay'),
        kind: 'balance',
        amount_cents: quote.balance_cents,
        status: 'SENT',
        paypal_order_id: null,
        paypal_capture_id: null,
        paypal_invoice_id: null,
        updated_at: new Date(Date.now() - 6 * 86_400_000).toISOString()
      });
    }
    store.saveEvent(createEvent('system', 'approval', quoteId, {
      text: 'Development sample quote seeded.',
      demo_sample: true
    }));
  }
}

function publicUrl(path: string): string {
  return `${(process.env.PUBLIC_BASE_URL ?? 'http://localhost:8080').replace(/\/+$/, '')}${path}`;
}

function saveEvent(store: Store, event: AgentEvent): AgentEvent {
  store.saveEvent(event);
  return event;
}

function invoiceStatus(payload: Record<string, unknown>): string {
  return typeof payload.status === 'string' ? payload.status.toUpperCase() : 'UNKNOWN';
}

function invoiceToolPayload(content: unknown): Record<string, unknown> {
  if (typeof content === 'string') {
    try {
      return asObject(JSON.parse(content) as unknown);
    } catch {
      return { result: content };
    }
  }
  return asObject(content);
}

function compactInvoiceState(payload: Record<string, unknown>): Record<string, unknown> {
  const detail = asObject(payload.detail);
  const amount = asObject(payload.amount);
  const dueAmount = asObject(payload.due_amount);
  const payments = asObject(payload.payments);
  const paidAmount = asObject(payments.paid_amount);
  const transactions = Array.isArray(payments.transactions) ? payments.transactions : [];
  let lastPaymentDate: string | null = null;
  let lastPaymentTimestamp = Number.NEGATIVE_INFINITY;
  for (const transaction of transactions) {
    const paymentDate = asObject(transaction).payment_date;
    if (typeof paymentDate !== 'string') continue;
    const paymentTimestamp = Date.parse(paymentDate);
    if (!Number.isFinite(paymentTimestamp) || paymentTimestamp < lastPaymentTimestamp) continue;
    lastPaymentDate = paymentDate;
    lastPaymentTimestamp = paymentTimestamp;
  }
  return {
    invoice_id: payload.id ?? null,
    status: payload.status ?? null,
    invoice_number: detail.invoice_number ?? null,
    currency_code: detail.currency_code ?? null,
    total_value: amount.value ?? null,
    amount_due_value: dueAmount.value ?? null,
    paid_value: paidAmount.value ?? null,
    viewed_by_recipient: detail.viewed_by_recipient ?? null,
    last_payment_date: lastPaymentDate
  };
}

function userSuppliedDetails(messages: ChatMsg[], args: {
  client_name: string;
  client_email: string;
  brief: string;
}): boolean {
  const userText = messages.filter((message) => message.role === 'user').map((message) => message.content).join('\n').toLowerCase();
  const briefTerms = args.brief.toLowerCase().split(/\W+/).filter((term) => term.length > 2);
  const matchingBriefTerms = briefTerms.filter((term) => userText.includes(term));
  return userText.includes(args.client_name.toLowerCase()) &&
    userText.includes(args.client_email.toLowerCase()) &&
    briefTerms.length > 0 &&
    matchingBriefTerms.length / briefTerms.length >= 0.6;
}

export interface AppOptions {
  store?: Store;
  ai?: AIService;
  paypal?: PayPalService;
  toolkitFactory?: () => ReturnType<PayPalService['toolkit']>;
  publicBaseUrl?: string;
}

export function createApp(options: AppOptions = {}): Hono {
  const app = new Hono();
  const store = options.store ?? new Store();
  const ai = options.ai ?? new AIService();
  const paypal = options.paypal ?? new PayPalService();
  const toolkitFactory = options.toolkitFactory ?? (() => paypal.toolkit());
  const baseUrl = options.publicBaseUrl ?? process.env.PUBLIC_BASE_URL ?? 'http://localhost:8080';
  const isDemoSampleQuote = (quoteId: string): boolean =>
    store.listEvents(quoteId).some((event) => event.demo_sample === true);
  const assertNotDemoSampleQuote = (quoteId: string): void => {
    if (isDemoSampleQuote(quoteId)) {
      throw new HttpError(409, 'This development sample quote cannot use PayPal or collections actions.');
    }
  };
  const rateLimit = new Map<string, number[]>();

  app.use('/api/*', async (c, next) => {
    const aiPath = /^\/api\/(catalog\/parse|public\/[^/]+\/quotes|quotes\/[^/]+\/replies|quotes\/[^/]+\/collections\/run|agent-sim\/chat|studio\/llm)$/.test(c.req.path);
    if (!aiPath) return next();
    const now = Date.now();
    const ip = c.req.header('fly-client-ip')?.trim()
      || c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
      || c.req.header('x-real-ip')?.trim()
      || 'unknown';
    const requests = (rateLimit.get(ip) ?? []).filter((started) => now - started < 60_000);
    if (requests.length >= 20) return c.json({ error: 'Too many AI requests; try again in a minute.' }, 429);
    requests.push(now);
    rateLimit.set(ip, requests);
    await next();
  });

  const createQuote = async (input: {
    service: Service;
    client_name: string;
    client_email: string;
    brief: string;
    source: Source;
  }): Promise<Quote> => {
    if (input.service.deposit_pct < 20 || input.service.deposit_pct > 100) {
      throw new HttpError(400, 'Service deposit percentage must be between 20% and 100%.');
    }
    const seller = store.getSeller();
    if (!seller) throw new HttpError(500, 'Seller configuration is missing.');
    const amounts = calculateQuoteAmounts(input.service.price_cents, input.service.deposit_pct);
    const id = createId('q');
    const scopeSummary = await ai.quoteScope(input.service.title, input.service.description, input.brief);
    const now = timestamp();
    const quote: Quote = {
      id,
      service_id: input.service.id,
      service_title: input.service.title,
      client_name: input.client_name,
      client_email: input.client_email,
      brief: input.brief,
      scope_summary: scopeSummary,
      line_items: [{ label: input.service.title, amount_cents: amounts.total_cents }],
      ...amounts,
      status: 'quoted',
      source: input.source,
      approval_url: `${baseUrl.replace(/\/+$/, '')}/q/${id}`,
      created_at: now,
      updated_at: now
    };
    store.saveQuote(quote);
    saveEvent(store, createEvent('seller_agent', 'tool_call', quote.id, {
      tool: 'submit_quote_scope',
      input: { service_id: input.service.id, brief: input.brief },
      output: scopeSummary
    }));
    saveEvent(store, createEvent('system', 'decision', quote.id, { text: 'Quote created using the published service price.' }));
    return quote;
  };

  const clientTools = new ClientTools({
    store,
    publicBaseUrl: baseUrl,
    createQuote
  });

  app.get('/api/health', (c) => c.json({ ok: true }));

  app.post('/api/studio/llm', async (c) => {
    const input = parseBody(studioLlmSchema, await readLimitedJson(c.req.raw, STUDIO_LLM_MAX_BODY_BYTES));
    const completion = await ai.chatCompletion(
      input.messages as ChatCompletionMessageParam[],
      (input.tools ?? []) as ChatCompletionTool[],
      (input.tool_choice ?? 'auto') as ChatCompletionToolChoiceOption
    );
    return c.json(completion);
  });

  app.get('/api/seller', (c) => {
    const seller = store.getSeller();
    if (!seller) throw new HttpError(500, 'Seller configuration is missing.');
    return c.json(seller);
  });

  app.put('/api/seller/rules', async (c) => {
    const rules = parseBody(rulesSchema, await c.req.json()) as SellerRules;
    const seller = store.getSeller();
    if (!seller) throw new HttpError(500, 'Seller configuration is missing.');
    seller.rules = rules;
    store.saveSeller(seller);
    saveEvent(store, createEvent('seller', 'approval', null, { text: 'Seller rules updated.', input: rules }));
    return c.json(seller);
  });

  app.post('/api/catalog/parse', async (c) => {
    const input = parseBody(z.object({ raw_text: z.string().trim().min(1).max(20_000) }).strict(), await c.req.json());
    const result = await ai.parseCatalog(input.raw_text);
    saveEvent(store, createEvent('seller_agent', 'tool_call', null, {
      tool: 'submit_services',
      input: { raw_text: input.raw_text },
      output: result
    }));
    return c.json(result);
  });

  app.post('/api/catalog/publish', async (c) => {
    const input = parseBody(z.object({ services: z.array(publishDraftSchema).min(1).max(100) }).strict(), await c.req.json());
    const services: Service[] = input.services.map((draft: ServiceDraft) => {
      if (draft.price_cents <= 0) throw new HttpError(400, `Service "${draft.title}" must have a positive price.`);
      return {
        id: createId('svc'),
        title: draft.title,
        description: draft.description,
        deliverables: draft.deliverables,
        price_cents: draft.price_cents,
        deposit_pct: draft.deposit_pct,
        lead_time_days: draft.lead_time_days ?? 0,
        status: draft.lead_time_days === null ? 'draft' : 'published'
      };
    });
    store.replaceServices(services);
    saveEvent(store, createEvent('seller', 'approval', null, { text: `${services.length} services published.` }));
    return c.json(services);
  });

  app.get('/api/services', (c) => c.json(store.listServices()));

  app.get('/api/public/:slug', (c) => {
    const seller = store.getSeller();
    if (!seller || seller.slug !== c.req.param('slug')) throw new HttpError(404, 'Store not found.');
    const publicStore: PublicStore = {
      seller: { name: seller.name, slug: seller.slug, tagline: seller.tagline },
      services: store.listServices('published'),
      agent: {
        mcp_url: `${baseUrl.replace(/\/+$/, '')}/mcp`,
        webmcp_tools: ['list_services', 'get_service', 'request_quote', 'get_quote_status']
      }
    };
    return c.json(publicStore);
  });

  app.post('/api/public/:slug/quotes', async (c) => {
    const input = parseBody(quoteInput, await c.req.json());
    const seller = store.getSeller();
    if (!seller || seller.slug !== c.req.param('slug')) throw new HttpError(404, 'Store not found.');
    const service = store.getService(input.service_id);
    if (!service || service.status !== 'published') throw new HttpError(404, 'Service not found.');
    const quote = await createQuote({ ...input, service, source: input.source ?? 'web' });
    saveEvent(store, createEvent('client', 'message', quote.id, { text: `Quote requested by ${quote.client_name}.` }));
    return c.json(quote, 201);
  });

  app.get('/api/quotes', (c) => c.json(store.listQuotes()));

  const reconcileOrder = async (quote: Quote, orderId: string): Promise<boolean> => {
    const order = getNestedOrder(await paypal.getOrder(orderId));
    const unit = findPurchaseUnit(order);
    const capture = findCapture(order);
    const customId = typeof unit?.custom_id === 'string' ? unit.custom_id : undefined;
    if (!capture || !isCompletedCapture(capture, quote.id, quote.deposit_cents, customId)) return false;
    const unitAmount = centsFromAmount(unit?.amount);
    if (unitAmount !== quote.deposit_cents) return false;
    const payment = store.getPayment(quote.id, 'deposit') ?? {
      id: createId('pay'),
      kind: 'deposit' as const,
      amount_cents: quote.deposit_cents,
      status: 'COMPLETED',
      paypal_order_id: orderId,
      updated_at: timestamp()
    };
    payment.status = 'COMPLETED';
    payment.paypal_capture_id = typeof capture.id === 'string' ? capture.id : undefined;
    payment.updated_at = timestamp();
    store.savePayment(quote.id, payment);
    if (quote.status !== 'deposit_paid' && quote.status !== 'delivered' && quote.status !== 'balance_invoiced' && quote.status !== 'paid') {
      quote.status = 'deposit_paid';
      quote.updated_at = timestamp();
      store.saveQuote(quote);
    }
    return true;
  };

  const reconcileInvoice = async (quote: Quote, invoiceId: string): Promise<string> => {
    const invoice = await paypal.getInvoice(invoiceId);
    const status = invoiceStatus(invoice);
    const payment = store.getPayment(quote.id, 'balance');
    if (payment) {
      payment.status = status;
      payment.updated_at = timestamp();
      payment.invoice_url = payerLink([invoice]) ?? payment.invoice_url;
      store.savePayment(quote.id, payment);
    }
    if (status === 'PAID' && quote.status !== 'paid') {
      quote.status = 'paid';
      quote.updated_at = timestamp();
      store.saveQuote(quote);
    }
    return status;
  };

  app.get('/api/quotes/:id', async (c) => {
    const quote = store.getQuote(c.req.param('id'));
    if (!quote) throw new HttpError(404, 'Quote not found.');
    if (c.req.query('refresh') === '1') {
      assertNotDemoSampleQuote(quote.id);
      const deposit = store.getPayment(quote.id, 'deposit');
      const balance = store.getPayment(quote.id, 'balance');
      if (deposit?.paypal_order_id) {
        saveEvent(store, createEvent('paypal', 'tool_call', quote.id, {
          tool: 'get_order',
          input: { order_id: deposit.paypal_order_id }
        }));
        await reconcileOrder(quote, deposit.paypal_order_id);
      }
      if (balance?.paypal_invoice_id) {
        saveEvent(store, createEvent('paypal', 'tool_call', quote.id, {
          tool: 'get_invoice',
          input: { invoice_id: balance.paypal_invoice_id }
        }));
        await reconcileInvoice(quote, balance.paypal_invoice_id);
      }
    }
    return c.json(detail(store, quote.id));
  });

  app.post('/api/quotes/:id/deposit/order', async (c) => {
    const quote = store.getQuote(c.req.param('id'));
    if (!quote) throw new HttpError(404, 'Quote not found.');
    assertNotDemoSampleQuote(quote.id);
    if (quote.status !== 'quoted') throw new HttpError(409, 'A deposit order can only be created for a quoted request.');
    const existing = store.getPayment(quote.id, 'deposit');
    if (existing?.paypal_order_id) return c.json({ order_id: existing.paypal_order_id });
    const seller = store.getSeller();
    if (!seller) throw new HttpError(500, 'Seller configuration is missing.');
    saveEvent(store, createEvent('paypal', 'tool_call', quote.id, {
      tool: 'create_order',
      input: { quote_id: quote.id, amount_cents: quote.deposit_cents }
    }));
    const order = await paypal.createOrder(
      quote.id,
      quote.deposit_cents,
      `${quote.service_title} deposit`,
      quote.approval_url,
      `deposit-${quote.id}`,
      seller.name
    );
    if (!order.id) throw new HttpError(502, 'PayPal did not return an order id.');
    const payment: Payment = {
      id: createId('pay'),
      kind: 'deposit',
      amount_cents: quote.deposit_cents,
      status: 'CREATED',
      paypal_order_id: order.id,
      updated_at: timestamp()
    };
    store.savePayment(quote.id, payment);
    saveEvent(store, createEvent('paypal', 'tool_call', quote.id, { tool: 'create_order', output: { order_id: order.id } }));
    return c.json({ order_id: order.id });
  });

  app.post('/api/quotes/:id/deposit/capture', async (c) => {
    const input = parseBody(captureSchema, await c.req.json());
    const quote = store.getQuote(c.req.param('id'));
    if (!quote) throw new HttpError(404, 'Quote not found.');
    assertNotDemoSampleQuote(quote.id);
    const existing = store.getPayment(quote.id, 'deposit');
    if (existing?.status === 'COMPLETED' && existing.paypal_order_id === input.order_id) {
      return c.json(quote);
    }
    if (!existing?.paypal_order_id || existing.paypal_order_id !== input.order_id) {
      throw new HttpError(400, 'Order does not belong to this quote.');
    }
    saveEvent(store, createEvent('paypal', 'tool_call', quote.id, {
      tool: 'capture_order',
      input: { order_id: input.order_id }
    }));
    try {
      const captured = await paypal.captureOrder(input.order_id);
      saveEvent(store, createEvent('paypal', 'tool_call', quote.id, {
        tool: 'capture_order',
        output: { status: asObject(captured).status }
      }));
    } catch (error) {
      if (!/already|captured|422/i.test(errorMessage(error))) throw error;
    }
    const success = await reconcileOrder(quote, input.order_id);
    if (!success) throw new HttpError(400, 'PayPal capture is not a completed payment for this quote and deposit amount.');
    saveEvent(store, createEvent('system', 'decision', quote.id, { text: 'Deposit capture confirmed by PayPal.' }));
    return c.json(store.getQuote(quote.id));
  });

  app.post('/api/quotes/:id/deliver', async (c) => {
    const quote = store.getQuote(c.req.param('id'));
    if (!quote) throw new HttpError(404, 'Quote not found.');
    assertNotDemoSampleQuote(quote.id);
    if (quote.status === 'balance_invoiced' || quote.status === 'paid') return c.json(detail(store, quote.id));
    if (quote.status !== 'deposit_paid') throw new HttpError(409, 'Delivery is only available after the deposit has been paid.');
    const seller = store.getSeller();
    if (!seller) throw new HttpError(500, 'Seller configuration is missing.');
    let payment = store.getPayment(quote.id, 'balance');
    if (!payment?.paypal_invoice_id) {
      const [givenName, ...surnameParts] = quote.client_name.split(/\s+/);
      const payload = {
        invoicer: { business_name: seller.name },
        detail: {
          currency_code: 'USD',
          note: `Balance for ${quote.service_title}. ${quote.scope_summary}`,
          reference: quote.id
        },
        primary_recipients: [{
          billing_info: {
            name: { given_name: givenName, surname: surnameParts.join(' ') || givenName },
            email_address: quote.client_email
          }
        }],
        items: [{
          name: `${quote.service_title} — balance`,
          quantity: '1',
          unit_amount: { currency_code: 'USD', value: (quote.balance_cents / 100).toFixed(2) },
          unit_of_measure: 'QUANTITY'
        }]
      };
      saveEvent(store, createEvent('paypal', 'tool_call', quote.id, {
        tool: 'create_invoice',
        input: { invoice_amount_cents: quote.balance_cents, recipient: quote.client_email }
      }));
      const created = await paypal.createInvoice(payload);
      const invoiceId = invoiceIdFrom(created) ?? null;
      if (!invoiceId) throw new HttpError(502, 'PayPal did not return an invoice id.');
      payment = {
        id: createId('pay'),
        kind: 'balance',
        amount_cents: quote.balance_cents,
        status: typeof created.status === 'string' ? created.status : 'DRAFT',
        paypal_invoice_id: invoiceId,
        invoice_url: payerLink([created]),
        updated_at: timestamp()
      };
      store.savePayment(quote.id, payment);
      saveEvent(store, createEvent('paypal', 'tool_call', quote.id, { tool: 'create_invoice', output: { invoice_id: invoiceId } }));
    }
    saveEvent(store, createEvent('paypal', 'tool_call', quote.id, {
      tool: 'send_invoice',
      input: { invoice_id: payment.paypal_invoice_id }
    }));
    const sent = await paypal.sendInvoice(payment.paypal_invoice_id!, `Balance payment for ${quote.service_title}.`);
    const invoice = await paypal.getInvoice(payment.paypal_invoice_id!);
    payment.invoice_url = payerLink([sent, invoice]) ?? payment.invoice_url;
    payment.status = typeof invoice.status === 'string' ? invoice.status : typeof sent.status === 'string' ? sent.status : 'SENT';
    payment.updated_at = timestamp();
    store.savePayment(quote.id, payment);
    quote.status = 'balance_invoiced';
    quote.updated_at = timestamp();
    store.saveQuote(quote);
    saveEvent(store, createEvent('paypal', 'tool_call', quote.id, {
      tool: 'send_invoice',
      output: { invoice_id: payment.paypal_invoice_id, invoice_url: payment.invoice_url }
    }));
    saveEvent(store, createEvent('seller', 'approval', quote.id, { text: 'Seller marked the work delivered; balance invoice sent.' }));
    return c.json(detail(store, quote.id));
  });

  app.post('/api/paypal/webhook', async (c) => {
    const webhookId = process.env.PAYPAL_WEBHOOK_ID;
    if (!webhookId) throw new HttpError(503, 'PayPal webhook verification is not configured.');
    const rawBody = await c.req.text();
    let event: unknown;
    try {
      event = JSON.parse(rawBody) as unknown;
    } catch {
      throw new HttpError(400, 'Webhook body must be valid JSON.');
    }
    let verified = false;
    try {
      verified = await paypal.verifyWebhook(c.req.raw.headers, webhookId, event);
    } catch {
      throw new HttpError(400, 'PayPal webhook signature could not be verified.');
    }
    if (!verified) throw new HttpError(400, 'PayPal webhook signature is invalid.');
    const webhook = z.object({
      id: z.string().min(1),
      event_type: z.string().min(1),
      resource: z.record(z.string(), z.unknown())
    }).safeParse(event);
    if (!webhook.success) throw new HttpError(400, 'Invalid PayPal webhook event.');
    const { id: eventId, event_type: type, resource } = webhook.data;
    if (store.hasWebhookEvent(eventId)) return c.json({ ok: true, duplicate: true });
    store.recordWebhookEvent(eventId);
    let quoteId: string | null = null;
    if (type === 'PAYMENT.CAPTURE.COMPLETED') {
      const captureId = typeof resource.id === 'string' ? resource.id : undefined;
      const customId = typeof resource.custom_id === 'string' ? resource.custom_id : undefined;
      const relatedOrderId = asObject(asObject(resource.supplementary_data).related_ids).order_id;
      const orderId = typeof relatedOrderId === 'string' ? relatedOrderId : undefined;
      let resolvedCustomId = customId;
      if (!resolvedCustomId && orderId) {
        const order = await paypal.getOrder(orderId);
        const unit = findPurchaseUnit(order);
        resolvedCustomId = typeof unit?.custom_id === 'string' ? unit.custom_id : undefined;
      }
      if (resolvedCustomId) {
        const quote = store.getQuote(resolvedCustomId);
        if (quote && !isDemoSampleQuote(quote.id)) {
          quoteId = quote.id;
          if (orderId) await reconcileOrder(quote, orderId);
          else if (resource.status === 'COMPLETED' && centsFromAmount(resource.amount) === quote.deposit_cents) {
            const payment = store.getPayment(quote.id, 'deposit');
            if (payment && payment.status !== 'COMPLETED') {
              payment.status = 'COMPLETED';
              payment.paypal_capture_id = captureId;
              payment.updated_at = timestamp();
              store.savePayment(quote.id, payment);
              if (quote.status === 'quoted') {
                quote.status = 'deposit_paid';
                quote.updated_at = timestamp();
                store.saveQuote(quote);
              }
            }
          }
        }
      }
    } else if (type === 'INVOICING.INVOICE.PAID' || type === 'INVOICING.INVOICE.CANCELLED') {
      const invoiceId = typeof resource.id === 'string' ? resource.id : undefined;
      const match = invoiceId
        ? store.listQuotes().find((quote) => store.getPayment(quote.id, 'balance')?.paypal_invoice_id === invoiceId)
        : undefined;
      if (match && invoiceId) {
        quoteId = match.id;
        if (type === 'INVOICING.INVOICE.PAID') {
          await reconcileInvoice(match, invoiceId);
        } else {
          const payment = store.getPayment(match.id, 'balance');
          if (payment) {
            payment.status = 'CANCELLED';
            payment.updated_at = timestamp();
            store.savePayment(match.id, payment);
          }
        }
      }
    }
    saveEvent(store, createEvent('paypal', 'webhook', quoteId, {
      tool: type,
      input: { event_id: eventId },
      output: { received: true }
    }));
    return c.json({ ok: true, duplicate: false });
  });

  const runCollections = async (quoteId: string): Promise<AgentRun> => {
    const quote = store.getQuote(quoteId);
    if (!quote) throw new HttpError(404, 'Quote not found.');
    assertNotDemoSampleQuote(quote.id);
    if (quote.status !== 'balance_invoiced') throw new HttpError(409, 'Collections runs require an outstanding balance invoice.');
    const payment = store.getPayment(quote.id, 'balance');
    if (!payment?.paypal_invoice_id) throw new HttpError(409, 'Quote has no PayPal balance invoice.');
    const seller = store.getSeller();
    if (!seller) throw new HttpError(500, 'Seller configuration is missing.');
    const replies = store.listReplies(quote.id);
    const eventStart = store.listEvents(quote.id).length;
    const toolkit = toolkitFactory();
    const paypalTools = toolkit.getTools();
    const invoiceTool = paypalTools.find((tool) => tool.type === 'function' && tool.function.name === 'get_invoice');
    const reminderTool = paypalTools.find((tool) => tool.type === 'function' && tool.function.name === 'send_invoice_reminder');
    if (!invoiceTool || !reminderTool) throw new HttpError(500, 'PayPal invoice tools are unavailable.');
    const proposalTool = jsonSchemaTool('propose_action', 'Propose the next seller-approved collections action.', {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['wait', 'send_reminder', 'thank_and_close', 'escalate'] },
        reason: { type: 'string' },
        draft_message: { type: 'string' }
      },
      required: ['action', 'reason', 'draft_message'],
      additionalProperties: false
    });
    const systemPrompt = `You are the collections agent for ${seller.name}. Seller tone: ${seller.rules.reminder_tone}. Quote: ${quote.service_title}; total $${(quote.total_cents / 100).toFixed(2)}; balance $${(quote.balance_cents / 100).toFixed(2)}; client ${quote.client_name}; invoice ${payment.paypal_invoice_id}. Reply history: ${JSON.stringify(replies)}. You must call get_invoice before proposing any action and never state payment status without calling get_invoice. Use propose_action once you have checked the invoice. Send nothing; your draft requires seller approval.`;
    const messages: import('openai/resources').ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Check the current PayPal balance invoice status and propose the appropriate next action.' }
    ];
    const stepEvents: AgentEvent[] = [];
    let calledGetInvoice = false;
    let invoiceData: Record<string, unknown> | null = null;
    let proposed: z.infer<typeof proposalActionSchema> | null = null;
    let summary = 'Invoice checked and collections action proposed.';
    for (let step = 0; step < 4 && !proposed; step += 1) {
      const response = await ai.chatCompletion(messages, [invoiceTool, proposalTool], 'auto');
      const assistant = response.choices[0]?.message;
      if (!assistant) break;
      messages.push(assistant);
      const toolCalls = assistant.tool_calls ?? [];
      if (toolCalls.length === 0) {
        if (assistant.content) summary = assistant.content;
        break;
      }
      for (const toolCall of toolCalls) {
        let args: unknown;
        try {
          args = JSON.parse(toolCall.function.arguments) as unknown;
        } catch {
          args = {};
        }
        const event = saveEvent(store, createEvent('collections_agent', 'tool_call', quote.id, {
          tool: toolCall.function.name,
          input: args
        }));
        stepEvents.push(event);
        if (toolCall.function.name === 'get_invoice') {
          const verifiedArgs = z.object({ invoice_id: z.string().min(1) }).safeParse(args);
          const invoiceId = verifiedArgs.success ? verifiedArgs.data.invoice_id : payment.paypal_invoice_id;
          const result = await toolkit.handleToolCall({
            id: toolCall.id,
            type: 'function',
            function: { name: 'get_invoice', arguments: JSON.stringify({ invoice_id: invoiceId }) }
          });
          calledGetInvoice = true;
          invoiceData = invoiceToolPayload(result.content);
          const toolEvent = saveEvent(store, createEvent('paypal', 'tool_call', quote.id, {
            tool: 'get_invoice',
            input: { invoice_id: invoiceId },
            output: invoiceData
          }));
          stepEvents.push(toolEvent);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(compactInvoiceState(invoiceData))
          });
        } else if (toolCall.function.name === 'propose_action') {
          const parsed = proposalActionSchema.safeParse(args);
          if (parsed.success) {
            proposed = parsed.data;
            summary = parsed.data.reason;
            messages.push({ role: 'tool', tool_call_id: toolCall.id, content: 'Proposal recorded for seller approval.' });
          } else {
            messages.push({ role: 'tool', tool_call_id: toolCall.id, content: 'Invalid action proposal. Use the required action, reason, and draft_message fields.' });
          }
        } else {
          messages.push({ role: 'tool', tool_call_id: toolCall.id, content: 'Tool is not available.' });
        }
      }
    }
    if (!calledGetInvoice) {
      saveEvent(store, createEvent('collections_agent', 'tool_call', quote.id, {
        tool: 'get_invoice',
        input: { invoice_id: payment.paypal_invoice_id, reason: 'Server-side required status guard' }
      }));
      const result = await toolkit.handleToolCall({
        id: createId('tool'),
        type: 'function',
        function: { name: 'get_invoice', arguments: JSON.stringify({ invoice_id: payment.paypal_invoice_id }) }
      });
      invoiceData = invoiceToolPayload(result.content);
      calledGetInvoice = true;
      const event = saveEvent(store, createEvent('paypal', 'tool_call', quote.id, {
        tool: 'get_invoice',
        input: { invoice_id: payment.paypal_invoice_id },
        output: invoiceData
      }));
      stepEvents.push(event);
    }
    if (!invoiceData || Object.keys(invoiceData).length === 0) {
      throw new HttpError(502, 'PayPal invoice status could not be read.');
    }
    const checkedAt = timestamp();
    const status = invoiceStatus(invoiceData);
    const evidence = `PayPal invoice ${payment.paypal_invoice_id} status: ${status}, checked ${checkedAt}`;
    if (status === 'PAID') {
      proposed = {
        action: 'thank_and_close',
        reason: 'PayPal confirms the balance invoice is paid.',
        draft_message: `Thanks, ${quote.client_name} — PayPal confirms your balance is paid.`
      };
    }
    if (!proposed && status !== 'PAID') {
      const recoverySystem = `${systemPrompt}\n\nPayPal invoice state (verified just now): ${JSON.stringify(compactInvoiceState(invoiceData))}. Invoice payer link: ${payment.invoice_url ?? 'not available'}. Pick exactly one action. If the client says they paid but PayPal is not PAID, do not accuse them: thank them, say PayPal doesn't show it yet, and include that they can pay or check via the invoice link. draft_message must be a short friendly message to the client in the seller's tone.`;
      try {
        proposed = await ai.toolResult(
          recoverySystem,
          'Propose the next action now.',
          proposalTool,
          (value) => proposalActionSchema.parse(value)
        );
        summary = proposed.reason;
        stepEvents.push(saveEvent(store, createEvent('collections_agent', 'tool_call', quote.id, {
          tool: 'propose_action',
          input: proposed
        })));
      } catch {
      }
    }
    if (!proposed) {
      proposed = {
        action: 'wait',
        reason: 'The invoice status was checked; no further action was proposed.',
        draft_message: ''
      };
    }
    const priorReminders = store.listProposals(quote.id).filter((proposal) => (
      proposal.action === 'send_reminder' && proposal.status === 'executed'
    )).length;
    if (proposed.action === 'send_reminder' && priorReminders >= seller.rules.max_reminders) {
      proposed = {
        action: 'escalate',
        reason: `The maximum of ${seller.rules.max_reminders} reminders has already been sent.`,
        draft_message: proposed.draft_message
      };
    }
    const proposal: Proposal = {
      id: createId('prop'),
      quote_id: quote.id,
      client_name: quote.client_name,
      action: proposed.action,
      reason: proposed.reason,
      evidence,
      draft_message: proposed.draft_message,
      status: 'pending',
      created_at: timestamp()
    };
    if (!summary.trim() || isDegenerateText(summary)) summary = proposal.reason;
    store.saveProposal(proposal);
    const decisionEvent = saveEvent(store, createEvent('collections_agent', 'decision', quote.id, {
      output: proposal,
      text: proposed.reason
    }));
    stepEvents.push(decisionEvent);
    return {
      id: createId('run'),
      quote_id: quote.id,
      summary,
      steps: stepEvents,
      proposal
    };
  };

  app.post('/api/quotes/:id/collections/run', async (c) => c.json(await runCollections(c.req.param('id'))));

  app.post('/api/quotes/:id/replies', async (c) => {
    const input = parseBody(replySchema, await c.req.json());
    const quote = store.getQuote(c.req.param('id'));
    if (!quote) throw new HttpError(404, 'Quote not found.');
    if (quote.status === 'balance_invoiced') assertNotDemoSampleQuote(quote.id);
    const reply = {
      id: createId('reply'),
      quote_id: quote.id,
      from: input.from,
      text: input.text,
      created_at: timestamp()
    } as const;
    store.saveReply(reply);
    saveEvent(store, createEvent(input.from === 'client' ? 'client' : 'seller', 'message', quote.id, { text: input.text }));
    const agentRun = quote.status === 'balance_invoiced' ? await runCollections(quote.id) : null;
    return c.json({ reply, agent_run: agentRun });
  });

  app.get('/api/proposals', (c) => {
    const statusQuery = c.req.query('status');
    const status = statusQuery ? parseBody(z.enum(['pending', 'approved', 'rejected', 'executed', 'failed']), statusQuery) : undefined;
    return c.json(store.listProposals(undefined, status));
  });

  app.post('/api/proposals/:id/approve', async (c) => {
    const input = parseBody(approveSchema, await c.req.json());
    const proposal = store.getProposal(c.req.param('id'));
    if (!proposal) throw new HttpError(404, 'Proposal not found.');
    if (proposal.status !== 'pending') throw new HttpError(409, 'Proposal is no longer pending.');
    const quote = store.getQuote(proposal.quote_id);
    if (!quote) throw new HttpError(404, 'Quote not found.');
    assertNotDemoSampleQuote(quote.id);
    const payment = store.getPayment(quote.id, 'balance');
    if (!payment?.paypal_invoice_id && proposal.action !== 'wait' && proposal.action !== 'escalate') {
      throw new HttpError(409, 'Quote has no balance invoice.');
    }
    proposal.draft_message = input.draft_message;
    proposal.status = 'approved';
    store.saveProposal(proposal);
    saveEvent(store, createEvent('seller', 'approval', quote.id, {
      tool: 'approve_proposal',
      input: { proposal_id: proposal.id, action: proposal.action },
      text: input.draft_message
    }));
    try {
      if (proposal.action === 'send_reminder') {
        const toolkit = toolkitFactory();
        const reminderTool = toolkit.getTools().find((tool) => tool.type === 'function' && tool.function.name === 'send_invoice_reminder');
        if (!reminderTool) throw new Error('PayPal reminder tool is unavailable.');
        const synthetic = {
          id: createId('tool'),
          type: 'function' as const,
          function: {
            name: 'send_invoice_reminder',
            arguments: JSON.stringify({
              invoice_id: payment!.paypal_invoice_id,
              subject: `Balance reminder for ${quote.service_title}`,
              note: input.draft_message
            })
          }
        };
        saveEvent(store, createEvent('paypal', 'tool_call', quote.id, {
          tool: 'send_invoice_reminder',
          input: { invoice_id: payment!.paypal_invoice_id, subject: `Balance reminder for ${quote.service_title}`, note: input.draft_message }
        }));
        const response = await toolkit.handleToolCall(synthetic);
        saveEvent(store, createEvent('paypal', 'tool_call', quote.id, {
          tool: 'send_invoice_reminder',
          output: response.content
        }));
      } else if (proposal.action === 'thank_and_close') {
        if (!payment?.paypal_invoice_id) throw new Error('Quote has no balance invoice.');
        saveEvent(store, createEvent('paypal', 'tool_call', quote.id, {
          tool: 'get_invoice',
          input: { invoice_id: payment.paypal_invoice_id }
        }));
        const invoice = await paypal.getInvoice(payment.paypal_invoice_id);
        saveEvent(store, createEvent('paypal', 'tool_call', quote.id, {
          tool: 'get_invoice',
          output: { status: invoiceStatus(invoice) }
        }));
        if (invoiceStatus(invoice) !== 'PAID') throw new Error('PayPal does not confirm that the invoice is paid.');
        quote.status = 'paid';
        quote.updated_at = timestamp();
        store.saveQuote(quote);
      }
      proposal.status = 'executed';
    } catch (error) {
      proposal.status = 'failed';
      proposal.reason = `${proposal.reason} Execution failed: ${errorMessage(error)}`;
    }
    store.saveProposal(proposal);
    saveEvent(store, createEvent('seller', 'approval', quote.id, {
      tool: proposal.action,
      output: { status: proposal.status },
      text: proposal.reason
    }));
    return c.json(proposal);
  });

  app.post('/api/proposals/:id/reject', (c) => {
    const proposal = store.getProposal(c.req.param('id'));
    if (!proposal) throw new HttpError(404, 'Proposal not found.');
    if (proposal.status !== 'pending') throw new HttpError(409, 'Proposal is no longer pending.');
    proposal.status = 'rejected';
    store.saveProposal(proposal);
    saveEvent(store, createEvent('seller', 'approval', proposal.quote_id, {
      tool: 'reject_proposal',
      input: { proposal_id: proposal.id }
    }));
    return c.json(proposal);
  });

  app.get('/api/events', (c) => {
    const actorQuery = c.req.query('actor');
    const actor = actorQuery ? parseBody(actorSchema, actorQuery) : undefined;
    return c.json(store.listEvents(undefined, actor));
  });

  app.get('/api/stats', (c) => {
    const quotes = store.listQuotes();
    const byStatus: Record<QuoteStatus, number> = {
      quoted: 0, deposit_paid: 0, delivered: 0, balance_invoiced: 0, paid: 0, cancelled: 0
    };
    for (const quote of quotes) byStatus[quote.status] += 1;
    const deposits = quotes.reduce((sum, quote) => {
      const payment = store.getPayment(quote.id, 'deposit');
      return sum + (payment?.status === 'COMPLETED' ? payment.amount_cents : 0);
    }, 0);
    const outstandingQuotes = quotes.filter((quote) => ['deposit_paid', 'delivered', 'balance_invoiced'].includes(quote.status));
    const outstanding = outstandingQuotes.reduce((sum, quote) => sum + quote.balance_cents, 0);
    const paidQuotes = quotes.filter((quote) => quote.status === 'paid');
    const avgDays = paidQuotes.length
      ? paidQuotes.reduce((sum, quote) => sum + (Date.parse(quote.updated_at) - Date.parse(quote.created_at)) / 86_400_000, 0) / paidQuotes.length
      : null;
    return c.json({
      deposits_collected_cents: deposits,
      outstanding_cents: outstanding,
      paid_cents: paidQuotes.reduce((sum, quote) => sum + quote.total_cents, 0),
      avg_days_to_pay: avgDays === null ? null : Math.max(0, Math.round(avgDays * 10) / 10),
      by_status: byStatus,
      owed_by_client: quotes.filter((quote) => quote.status === 'balance_invoiced').map((quote) => {
        const payment = store.getPayment(quote.id, 'balance');
        const invoiceSince = payment ? Date.parse(payment.updated_at) : Date.parse(quote.updated_at);
        return {
          client_name: quote.client_name,
          quote_id: quote.id,
          outstanding_cents: quote.balance_cents,
          days_since_invoice: Math.max(0, Math.floor((Date.now() - invoiceSince) / 86_400_000))
        };
      })
    });
  });

  app.post('/api/agent-sim/chat', async (c) => {
    const input = parseBody(agentSimSchema, await c.req.json());
    const seller = store.getSeller();
    if (!seller || seller.slug !== input.slug) throw new HttpError(404, 'Store not found.');
    const schemas = [
      jsonSchemaTool('list_services', 'List published services for a seller.', {
        type: 'object', properties: { seller_slug: { type: 'string' } }, required: ['seller_slug'], additionalProperties: false
      }),
      jsonSchemaTool('get_service', 'Get one published service.', {
        type: 'object', properties: { seller_slug: { type: 'string' }, service_id: { type: 'string' } }, required: ['seller_slug', 'service_id'], additionalProperties: false
      }),
      jsonSchemaTool('request_quote', 'Request a quote. Only use after the client has provided name, email, and brief.', {
        type: 'object',
        properties: {
          seller_slug: { type: 'string' }, service_id: { type: 'string' }, client_name: { type: 'string' },
          client_email: { type: 'string' }, brief: { type: 'string' }
        },
        required: ['seller_slug', 'service_id', 'client_name', 'client_email', 'brief'],
        additionalProperties: false
      }),
      jsonSchemaTool('get_quote_status', 'Get the status of a quote.', {
        type: 'object', properties: { quote_id: { type: 'string' } }, required: ['quote_id'], additionalProperties: false
      })
    ];
    const messages: import('openai/resources').ChatCompletionMessageParam[] = [{
      role: 'system',
      content: `You are a client's personal assistant helping explore ${seller.name}. Use only the listed client tools for service details or quotes. Ask for any missing client name, email, or project brief before calling request_quote. Do not pay or claim to pay. A human must approve the quote and deposit. Reply in short plain sentences or simple bullet lists, never markdown tables or HTML.`
    }, ...input.messages.map((message) => ({ role: message.role, content: message.content }))];
    const transcript: ChatMsg[] = [...input.messages];
    const toolCalls: ToolTrace[] = [];
    let quote: Quote | null = null;
    let requestedQuote = false;
    for (let step = 0; step < 5; step += 1) {
      const response = await ai.chatCompletion(messages, schemas, 'auto');
      const assistant = response.choices[0]?.message;
      if (!assistant) break;
      messages.push(assistant);
      if (assistant.content) transcript.push({ role: 'assistant', content: assistant.content });
      const calls = assistant.tool_calls ?? [];
      if (!calls.length) break;
      for (const call of calls) {
        let args: unknown;
        try {
          args = JSON.parse(call.function.arguments) as unknown;
        } catch {
          args = {};
        }
        if (call.function.name === 'request_quote') {
          const checked = toolSchemas.request_quote.safeParse(args);
          if (!checked.success || !userSuppliedDetails(input.messages, checked.data)) {
            const missing = !checked.success
              ? 'Please provide your name, email address, and a brief project description before I request the quote.'
              : 'Please provide your name, email address, and brief directly in the conversation before I request a quote.';
            toolCalls.push({ tool: call.function.name, input: args, output: { error: missing } });
            messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: missing }) });
            continue;
          }
          if (requestedQuote) {
            const output = quote ? { quote_id: quote.id, approval_url: quote.approval_url } : { error: 'A quote request was already attempted.' };
            toolCalls.push({ tool: call.function.name, input: args, output });
            messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(output) });
            continue;
          }
          requestedQuote = true;
        }
        try {
          const output = await clientTools.execute(call.function.name, args, 'agent_sim');
          if (call.function.name === 'request_quote' && typeof output === 'object' && output !== null && 'quote_id' in output) {
            quote = store.getQuote(String((output as { quote_id: unknown }).quote_id));
          }
          toolCalls.push({ tool: call.function.name, input: args, output });
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(output) });
        } catch (error) {
          const output = { error: errorMessage(error) };
          toolCalls.push({ tool: call.function.name, input: args, output });
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(output) });
        }
      }
    }
    return c.json({ messages: transcript, tool_calls: toolCalls, quote });
  });

  app.get('/api/paypal/config', (c) => c.json({ client_id: process.env.PAYPAL_CLIENT_ID ?? '', env: 'sandbox' as const }));

  app.post('/api/demo/reset', (c) => {
    const withSamples = c.req.query('with_samples') === '1';
    if (withSamples && process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SAMPLES !== '1') {
      throw new HttpError(403, 'Development sample data is disabled in production.');
    }
    store.reset();
    if (withSamples) seedDemoSamples(store, baseUrl);
    return c.json({ ok: true as const });
  });

  app.all('/mcp', async (c) => {
    const { WebStandardStreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js');
    const mcp = createMcpServer(clientTools);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });
    await mcp.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      await mcp.close();
    }
  });

  app.get('/api/*', (c) => c.json({ error: 'Not found.' }, 404));
  app.post('/api/*', (c) => c.json({ error: 'Not found.' }, 404));
  app.put('/api/*', (c) => c.json({ error: 'Not found.' }, 404));

  const webDist = resolve(process.cwd(), process.env.WEB_DIST || 'web/dist/client');
  app.get('*', (c) => {
    if (!existsSync(webDist)) return c.text('ServiceReady API is running.');
    const requested = c.req.path === '/' ? '/index.html' : c.req.path;
    const filePath = resolve(webDist, `.${requested}`);
    const safePath = filePath.startsWith(`${webDist}/`) && existsSync(filePath) && statSync(filePath).isFile()
      ? filePath
      : resolve(webDist, 'index.html');
    if (!existsSync(safePath)) return c.text('ServiceReady API is running.');
    const mime: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.webp': 'image/webp',
      '.ico': 'image/x-icon',
      '.woff2': 'font/woff2',
      '.json': 'application/json; charset=utf-8',
      '.txt': 'text/plain; charset=utf-8',
      '.map': 'application/json; charset=utf-8'
    };
    return new Response(readFileSync(safePath), {
      headers: { 'Content-Type': mime[extname(safePath)] ?? 'application/octet-stream' }
    });
  });

  app.onError((error, c) => {
    if (error instanceof HttpError) return c.json({ error: error.message }, error.status as 400);
    if (error instanceof z.ZodError) return c.json({ error: error.issues[0]?.message ?? 'Invalid input.' }, 400);
    const status = (error as { status?: number }).status;
    if (typeof status === 'number' && status >= 400 && status < 600) {
      return c.json({ error: errorMessage(error) }, status as 400);
    }
    return c.json({ error: 'Internal server error.' }, 500);
  });

  return app;
}
