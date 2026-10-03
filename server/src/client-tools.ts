import { z } from 'zod';
import { createEvent, Store } from './db.js';
import type { Quote, Service, Source } from './types.js';

export const toolSchemas = {
  list_services: z.object({ seller_slug: z.string().min(1) }).strict(),
  get_service: z.object({ seller_slug: z.string().min(1), service_id: z.string().min(1) }).strict(),
  request_quote: z.object({
    seller_slug: z.string().min(1),
    service_id: z.string().min(1),
    client_name: z.string().trim().min(1).max(120),
    client_email: z.string().email().max(254),
    brief: z.string().trim().min(1).max(4000)
  }).strict(),
  get_quote_status: z.object({ quote_id: z.string().min(1) }).strict()
};

export interface ClientToolDeps {
  store: Store;
  publicBaseUrl: string;
  createQuote: (args: {
    service: Service;
    client_name: string;
    client_email: string;
    brief: string;
    source: Source;
  }) => Promise<Quote>;
}

export class ClientTools {
  constructor(private readonly deps: ClientToolDeps) {}

  async execute(name: string, input: unknown, source: Extract<Source, 'mcp' | 'agent_sim'>): Promise<unknown> {
    let output: unknown;
    let eventInput: unknown;
    if (name === 'list_services') {
      const args = toolSchemas.list_services.parse(input);
      eventInput = args;
      const seller = this.deps.store.getSeller();
      if (!seller || seller.slug !== args.seller_slug) throw new Error('Seller not found.');
      output = this.deps.store.listServices('published');
    } else if (name === 'get_service') {
      const args = toolSchemas.get_service.parse(input);
      eventInput = args;
      const seller = this.deps.store.getSeller();
      if (!seller || seller.slug !== args.seller_slug) throw new Error('Seller not found.');
      const service = this.deps.store.getService(args.service_id);
      if (!service || service.status !== 'published') throw new Error('Service not found.');
      output = service;
    } else if (name === 'request_quote') {
      const args = toolSchemas.request_quote.parse(input);
      eventInput = args;
      const seller = this.deps.store.getSeller();
      if (!seller || seller.slug !== args.seller_slug) throw new Error('Seller not found.');
      const service = this.deps.store.getService(args.service_id);
      if (!service || service.status !== 'published') throw new Error('Service not found.');
      const quote = await this.deps.createQuote({ ...args, service, source });
      output = {
        quote_id: quote.id,
        total: quote.total_cents,
        deposit: quote.deposit_cents,
        balance: quote.balance_cents,
        approval_url: quote.approval_url,
        note: `A human must approve and pay the deposit on PayPal at ${quote.approval_url}`
      };
    } else if (name === 'get_quote_status') {
      const args = toolSchemas.get_quote_status.parse(input);
      eventInput = args;
      const quote = this.deps.store.getQuote(args.quote_id);
      if (!quote) throw new Error('Quote not found.');
      output = { quote_id: quote.id, status: quote.status, total: quote.total_cents, deposit: quote.deposit_cents, balance: quote.balance_cents };
    } else {
      throw new Error('Unknown client tool.');
    }
    this.deps.store.saveEvent(createEvent(source === 'mcp' ? 'client_agent' : 'client_agent', 'tool_call', typeof output === 'object' && output && 'quote_id' in output ? String((output as { quote_id: unknown }).quote_id) : null, {
      tool: name,
      input: eventInput,
      output
    }));
    return output;
  }
}
