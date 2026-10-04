import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { dueBalance } from './core.js';
import type { Proposal, Quote, Service, ServiceDraft, SellerRules } from './types.js';
import { z } from 'zod';

export type SellerApiCall = (
  method: string,
  path: string,
  body?: unknown
) => Promise<Response>;

type ApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

const quoteStatuses = ['quoted', 'deposit_paid', 'delivered', 'balance_invoiced', 'paid', 'cancelled'] as const;
const serviceDraftSchema = z.object({
  tmp_id: z.string().min(1).max(100),
  title: z.string().trim().min(1).max(160),
  description: z.string().max(2000),
  deliverables: z.array(z.string().max(240)).max(40),
  price_cents: z.number().int(),
  deposit_pct: z.number(),
  lead_time_days: z.number().int().positive().nullable()
}).strict();
const replySchema = z.object({
  text: z.string().trim().min(1).max(4000),
  from: z.enum(['client', 'seller'])
}).strict();
type ReplyInput = z.infer<typeof replySchema>;
const rulesSchema = z.object({
  default_deposit_pct: z.number().int().min(20).max(100),
  reminder_tone: z.enum(['friendly', 'neutral', 'firm']),
  max_reminders: z.number().int().min(0).max(20),
  wait_days_before_nudge: z.number().int().min(0).max(365)
}).strict();
const quoteInputSchema = z.object({
  service_id: z.string().min(1),
  client_name: z.string().trim().min(1).max(120),
  client_email: z.string().email().max(254),
  brief: z.string().trim().min(1).max(4000)
}).strict();
const servicePatchSchema = z.object({
  service_id: z.string().min(1),
  title: z.string().trim().min(1).max(160).optional(),
  description: z.string().max(2000).optional(),
  deliverables: z.array(z.string().max(240)).max(40).optional(),
  price_cents: z.number().int().optional(),
  deposit_pct: z.number().optional(),
  lead_time_days: z.number().int().positive().nullable().optional()
}).strict();

const readOnly = { readOnlyHint: true } as const;
const externalMutation = { destructiveHint: true, openWorldHint: true } as const;

function toolText(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}

function toolError(message: string) {
  return { isError: true, content: [{ type: 'text' as const, text: message }] };
}

async function callApi<T>(api: SellerApiCall, method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await api(method, path, body);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'ServiceReady API request failed.' };
  }
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json() as { error?: unknown; message?: unknown };
      if (typeof body.error === 'string') message = body.error;
      else if (typeof body.message === 'string') message = body.message;
    } catch {
    }
    return { ok: false, message };
  }
  if (response.status === 204) return { ok: true, value: undefined as T };
  try {
    return { ok: true, value: await response.json() as T };
  } catch {
    return { ok: false, message: 'ServiceReady returned an invalid response.' };
  }
}

async function verifyOwnedQuote(api: SellerApiCall, quoteId: string): Promise<string | null> {
  const bookings = await callApi<Quote[]>(api, 'GET', '/api/quotes');
  if (!bookings.ok) return bookings.message;
  return bookings.value.some((quote) => quote.id === quoteId) ? null : 'Booking not found.';
}

function serviceAsDraft(service: Service): ServiceDraft {
  return {
    tmp_id: service.id,
    title: service.title,
    description: service.description,
    deliverables: service.deliverables,
    price_cents: service.price_cents,
    deposit_pct: service.deposit_pct,
    lead_time_days: service.lead_time_days > 0 ? service.lead_time_days : null
  };
}

export function createSellerMcpServer(api: SellerApiCall): McpServer {
  const server = new McpServer({ name: 'serviceready-seller', version: '1.0.0' });

  server.registerTool('get_studio', {
    description: 'Read the signed-in seller’s studio profile, rules, slug, and contact details.',
    inputSchema: {},
    annotations: readOnly
  }, async () => {
    const result = await callApi(api, 'GET', '/api/seller');
    return result.ok ? toolText(result.value) : toolError(result.message);
  });

  server.registerTool('list_bookings', {
    description: 'List this studio’s bookings. Optionally filter by booking status.',
    inputSchema: { status: z.enum(quoteStatuses).optional() },
    annotations: readOnly
  }, async ({ status }) => {
    const result = await callApi<Quote[]>(api, 'GET', '/api/quotes');
    if (!result.ok) return toolError(result.message);
    return toolText(status ? result.value.filter((quote) => quote.status === status) : result.value);
  });

  server.registerTool('get_booking', {
    description: 'Read a booking, its payments, client replies, activity, and suggestions.',
    inputSchema: { quote_id: z.string().min(1) },
    annotations: readOnly
  }, async ({ quote_id }) => {
    const ownershipError = await verifyOwnedQuote(api, quote_id);
    if (ownershipError) return toolError(ownershipError);
    const result = await callApi(api, 'GET', `/api/quotes/${encodeURIComponent(quote_id)}`);
    return result.ok ? toolText(result.value) : toolError(result.message);
  });

  server.registerTool('list_pending_approvals', {
    description: 'List suggestions that are waiting for the studio owner to approve or reject.',
    inputSchema: {},
    annotations: readOnly
  }, async () => {
    const result = await callApi(api, 'GET', '/api/proposals?status=pending');
    return result.ok ? toolText(result.value) : toolError(result.message);
  });

  server.registerTool('who_owes_what', {
    description: 'Show bookings with a balance due, the amount owed, and days since the balance invoice was sent.',
    inputSchema: {},
    annotations: readOnly
  }, async () => {
    const bookings = await callApi<Quote[]>(api, 'GET', '/api/quotes');
    if (!bookings.ok) return toolError(bookings.message);
    const owing: Array<Record<string, unknown>> = [];
    for (const quote of bookings.value) {
      const amountDue = dueBalance(quote);
      if (amountDue <= 0) continue;
      const detail = await callApi<{
        quote: Quote;
        payments?: Array<{ kind: string; paypal_invoice_id?: string | null; updated_at: string }>;
        events?: Array<{ actor: string; tool?: string; output?: unknown; created_at: string }>;
      }>(api, 'GET', `/api/quotes/${encodeURIComponent(quote.id)}`);
      if (!detail.ok) return toolError(detail.message);
      const balancePayment = detail.value.payments?.find((payment) => payment.kind === 'balance');
      const sendEvent = detail.value.events?.filter((event) => {
        if (event.actor !== 'paypal' || event.tool !== 'send_invoice') return false;
        const output = event.output as Record<string, unknown> | undefined;
        return !balancePayment?.paypal_invoice_id || output?.invoice_id === balancePayment.paypal_invoice_id;
      }).sort((left, right) => right.created_at.localeCompare(left.created_at))[0];
      const sentAt = sendEvent?.created_at ?? balancePayment?.updated_at;
      const sentTimestamp = sentAt ? Date.parse(sentAt) : Number.NaN;
      owing.push({
        quote_id: quote.id,
        client_name: quote.client_name,
        service_title: quote.service_title,
        amount_due_cents: amountDue,
        amount_due_usd: Number((amountDue / 100).toFixed(2)),
        currency: 'USD',
        days_since_invoice_sent: Number.isFinite(sentTimestamp)
          ? Math.max(0, Math.floor((Date.now() - sentTimestamp) / 86_400_000))
          : null
      });
    }
    return toolText(owing);
  });

  server.registerTool('list_services', {
    description: 'List the services currently published in this studio.',
    inputSchema: {},
    annotations: readOnly
  }, async () => {
    const result = await callApi(api, 'GET', '/api/services');
    return result.ok ? toolText(result.value) : toolError(result.message);
  });

  server.registerTool('get_activity_log', {
    description: 'Read the activity log for this studio.',
    inputSchema: {},
    annotations: readOnly
  }, async () => {
    const result = await callApi(api, 'GET', '/api/events');
    return result.ok ? toolText(result.value) : toolError(result.message);
  });

  server.registerTool('get_stats', {
    description: 'Read booking and payment statistics for this studio.',
    inputSchema: {},
    annotations: readOnly
  }, async () => {
    const result = await callApi(api, 'GET', '/api/stats');
    return result.ok ? toolText(result.value) : toolError(result.message);
  });

  server.registerTool('approve_suggestion', {
    description: 'Approve a pending suggestion. Leave draft_message empty to send the suggested message as written, or pass an edited message. This may send a reminder or otherwise act through PayPal.',
    inputSchema: {
      proposal_id: z.string().min(1),
      draft_message: z.string().trim().min(1).max(4000).optional()
    },
    annotations: externalMutation
  }, async ({ proposal_id, draft_message }) => {
    let message = draft_message;
    if (!message) {
      const pending = await callApi<Proposal[]>(api, 'GET', '/api/proposals');
      if (!pending.ok) return toolError(pending.message);
      message = pending.value.find((proposal) => proposal.id === proposal_id)?.draft_message;
      if (!message) return toolError('Suggestion not found.');
    }
    const result = await callApi(api, 'POST', `/api/proposals/${encodeURIComponent(proposal_id)}/approve`, { draft_message: message });
    return result.ok ? toolText(result.value) : toolError(result.message);
  });

  server.registerTool('reject_suggestion', {
    description: 'Reject a pending suggestion without contacting the client.',
    inputSchema: { proposal_id: z.string().min(1) }
  }, async ({ proposal_id }) => {
    const result = await callApi(api, 'POST', `/api/proposals/${encodeURIComponent(proposal_id)}/reject`);
    return result.ok ? toolText(result.value) : toolError(result.message);
  });

  server.registerTool('mark_delivered_and_send_balance_invoice', {
    description: 'Mark the work as delivered and send the client the balance invoice through PayPal.',
    inputSchema: { quote_id: z.string().min(1) },
    annotations: externalMutation
  }, async ({ quote_id }) => {
    const result = await callApi(api, 'POST', `/api/quotes/${encodeURIComponent(quote_id)}/deliver`);
    return result.ok ? toolText(result.value) : toolError(result.message);
  });

  server.registerTool('run_collections_check', {
    description: 'Re-check a booking’s balance invoice in PayPal and create a collections suggestion for review.',
    inputSchema: { quote_id: z.string().min(1) },
    annotations: externalMutation
  }, async ({ quote_id }) => {
    const result = await callApi(api, 'POST', `/api/quotes/${encodeURIComponent(quote_id)}/collections/run`);
    return result.ok ? toolText(result.value) : toolError(result.message);
  });

  server.registerTool('record_client_reply', {
    description: 'Record a client or seller reply on one of this studio’s bookings.',
    inputSchema: {
      quote_id: z.string().min(1),
      ...replySchema.shape
    },
    annotations: externalMutation
  }, async ({ quote_id, text, from }: { quote_id: string } & ReplyInput) => {
    const ownershipError = await verifyOwnedQuote(api, quote_id);
    if (ownershipError) return toolError(ownershipError);
    const result = await callApi(api, 'POST', `/api/quotes/${encodeURIComponent(quote_id)}/replies`, { text, from });
    return result.ok ? toolText(result.value) : toolError(result.message);
  });

  server.registerTool('parse_rate_card', {
    description: 'Turn pasted rate-card text into draft services. This does not publish anything; show the drafts and confirm all prices and deposits with the seller before publishing.',
    inputSchema: { raw_text: z.string().trim().min(1).max(20_000) },
    annotations: readOnly
  }, async ({ raw_text }) => {
    const result = await callApi(api, 'POST', '/api/catalog/parse', { raw_text });
    return result.ok ? toolText(result.value) : toolError(result.message);
  });

  server.registerTool('publish_services', {
    description: 'Publish services after the seller reviews them. This REPLACES the entire published service list; include every service that should remain published.',
    inputSchema: { services: z.array(serviceDraftSchema).min(1).max(100) },
    annotations: externalMutation
  }, async ({ services }) => {
    const result = await callApi(api, 'POST', '/api/catalog/publish', { services });
    return result.ok ? toolText(result.value) : toolError(result.message);
  });

  server.registerTool('update_service', {
    description: 'Update one published service. The full current published list is re-published, so no other service is removed.',
    inputSchema: servicePatchSchema,
    annotations: externalMutation
  }, async ({ service_id, ...patch }) => {
    const listed = await callApi<Service[]>(api, 'GET', '/api/services');
    if (!listed.ok) return toolError(listed.message);
    const services = listed.value.filter((service) => service.status === 'published');
    const index = services.findIndex((service) => service.id === service_id);
    if (index < 0) return toolError('Published service not found.');
    const updated = { ...services[index]!, ...patch } as Service;
    const drafts = services.map((service, serviceIndex) =>
      serviceIndex === index ? serviceAsDraft(updated) : serviceAsDraft(service));
    const validDrafts = z.array(serviceDraftSchema).safeParse(drafts);
    if (!validDrafts.success) return toolError(validDrafts.error.issues[0]?.message ?? 'Updated service is invalid.');
    const result = await callApi(api, 'POST', '/api/catalog/publish', { services: validDrafts.data });
    return result.ok ? toolText(result.value) : toolError(result.message);
  });

  server.registerTool('update_rules', {
    description: 'Update the studio’s deposit and collections reminder rules.',
    inputSchema: rulesSchema,
    annotations: externalMutation
  }, async (rules: SellerRules) => {
    const result = await callApi(api, 'PUT', '/api/seller/rules', rules);
    return result.ok ? toolText(result.value) : toolError(result.message);
  });

  server.registerTool('create_quote', {
    description: 'Create a quote for one of this studio’s published services using a client’s name, email, and brief.',
    inputSchema: quoteInputSchema,
    annotations: externalMutation
  }, async (input) => {
    const studio = await callApi<{ slug: string }>(api, 'GET', '/api/seller');
    if (!studio.ok) return toolError(studio.message);
    const result = await callApi(api, 'POST', `/api/public/${encodeURIComponent(studio.value.slug)}/quotes`, {
      ...input,
      source: 'webmcp'
    });
    return result.ok ? toolText(result.value) : toolError(result.message);
  });

  return server;
}
