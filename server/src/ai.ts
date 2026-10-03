import OpenAI from 'openai';
import type { ChatCompletion, ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources';
import { z } from 'zod';
import { computeServiceDrafts, serviceDraftInput } from './core.js';
import type { ServiceDraft } from './types.js';

export const PRIMARY_MODEL = 'workers-ai/@cf/openai/gpt-oss-120b';
export const FALLBACK_MODEL = 'workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast';

export class AIService {
  private readonly client: OpenAI;
  private readonly primaryModel: string;
  private readonly fallbackModel: string;

  constructor(client?: OpenAI, primaryModel = PRIMARY_MODEL, fallbackModel = FALLBACK_MODEL) {
    this.client = client ?? new OpenAI({
      baseURL: `https://gateway.ai.cloudflare.com/v1/${process.env.CLOUDFLARE_ACCOUNT_ID ?? ''}/${process.env.AI_GATEWAY ?? 'paypal-hackathon'}/compat`,
      apiKey: process.env.CLOUDFLARE_API_TOKEN ?? 'missing-cloudflare-token'
    });
    this.primaryModel = primaryModel;
    this.fallbackModel = fallbackModel;
  }

  async parseCatalog(rawText: string): Promise<{ services: ServiceDraft[]; flags: ReturnType<typeof computeServiceDrafts>['flags'] }> {
    const schema = {
      type: 'object',
      properties: {
        services: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              tmp_id: { type: 'string' },
              title: { type: 'string' },
              description: { type: 'string' },
              deliverables: { type: 'array', items: { type: 'string' } },
              price_usd: { type: 'number' },
              deposit_pct: { type: 'number' },
              lead_time_days: { type: ['integer', 'null'] }
            },
            required: ['tmp_id', 'title', 'description', 'deliverables', 'price_usd', 'deposit_pct', 'lead_time_days'],
            additionalProperties: false
          }
        }
      },
      required: ['services'],
      additionalProperties: false
    };
    const tool: ChatCompletionTool = {
      type: 'function',
      function: {
        name: 'submit_services',
        description: 'Return service packages parsed from the seller rate card. Preserve stated prices and terms.',
        strict: true,
        parameters: schema
      }
    };
    const result = await this.toolResult<{ services: unknown[] }>(
      'Extract each priced service package. Never invent a price or lead time. Use a null lead_time_days if it is absent. Include deliverables only when stated or plainly implied.',
      rawText,
      tool,
      (value) => z.object({ services: z.array(serviceDraftInput) }).strict().parse(value)
    );
    const computed = computeServiceDrafts(result.services);
    return computed;
  }

  async quoteScope(serviceTitle: string, description: string, brief: string): Promise<string> {
    const schema = {
      type: 'object',
      properties: {
        scope_summary: { type: 'string' },
        fit_check: { type: 'string' }
      },
      required: ['scope_summary', 'fit_check'],
      additionalProperties: false
    };
    const tool: ChatCompletionTool = {
      type: 'function',
      function: {
        name: 'submit_quote_scope',
        description: 'Write the scope summary and a brief fit check without altering price or payment terms.',
        strict: true,
        parameters: schema
      }
    };
    try {
      const result = await this.toolResult<{ scope_summary: string; fit_check: string }>(
        'Describe work scope in plain language, and state whether the service fits the client brief. Do not invent deliverables, prices, or commitments.',
        JSON.stringify({ service_title: serviceTitle, service_description: description, client_brief: brief }),
        tool,
        (value) => z.object({
          scope_summary: z.string().min(1),
          fit_check: z.string().min(1)
        }).strict().parse(value)
      );
      return `${result.scope_summary.trim()} Fit check: ${result.fit_check.trim()}`;
    } catch {
      return `${serviceTitle} includes work tailored to your brief: “${brief.trim()}”. We’ll confirm the details together before work begins.`;
    }
  }

  async toolResult<T>(
    system: string,
    user: string,
    tool: ChatCompletionTool,
    validate: (value: unknown) => T = (value) => value as T
  ): Promise<T> {
    const attempt = async (model: string): Promise<T> => {
      const response = await this.client.chat.completions.create({
        model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        tools: [tool],
        tool_choice: { type: 'function', function: { name: tool.function.name } }
      });
      const call = response.choices[0]?.message.tool_calls?.find((entry) => entry.function.name === tool.function.name);
      if (!call) throw new Error(`Missing forced tool call: ${tool.function.name}`);
      return validate(JSON.parse(call.function.arguments) as unknown);
    };
    try {
      return await attempt(this.primaryModel);
    } catch {
      try {
        return await attempt(this.primaryModel);
      } catch {
        return attempt(this.fallbackModel);
      }
    }
  }

  async chatCompletion(
    messages: ChatCompletionMessageParam[],
    tools: ChatCompletionTool[],
    toolChoice: 'auto' | 'required' = 'auto'
  ): Promise<ChatCompletion> {
    const requestMessages = messages.map((message): ChatCompletionMessageParam => {
      if (message.role !== 'assistant') return message;
      return {
        role: 'assistant',
        content: message.content ?? '',
        ...('tool_calls' in message && message.tool_calls ? { tool_calls: message.tool_calls } : {})
      };
    });
    const attempt = (model: string): Promise<ChatCompletion> => this.client.chat.completions.create({
      model,
      messages: requestMessages,
      tools,
      tool_choice: toolChoice
    });
    try {
      return await attempt(this.primaryModel);
    } catch {
      try {
        return await attempt(this.primaryModel);
      } catch {
        return attempt(this.fallbackModel);
      }
    }
  }
}

export function jsonSchemaTool(name: string, description: string, schema: Record<string, unknown>): ChatCompletionTool {
  return { type: 'function', function: { name, description, strict: true, parameters: schema } };
}
