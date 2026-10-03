import OpenAI from 'openai';
import type {
  ChatCompletion,
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionToolChoiceOption
} from 'openai/resources';
import { z } from 'zod';
import { computeServiceDrafts, serviceDraftInput } from './core.js';
import type { ServiceDraft } from './types.js';

export const PRIMARY_MODEL = 'workers-ai/@cf/openai/gpt-oss-120b';
export const FALLBACK_MODEL = 'workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast';

export function isDegenerateText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const letterCount = (trimmed.match(/[A-Za-z]/g) ?? []).length;
  return /(.)\1{15,}/.test(trimmed) || (trimmed.length >= 10 && letterCount < 3);
}

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
    try {
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
                price_currency: { type: ['string', 'null'] },
                deposit_pct: { type: 'number' },
                lead_time_days: { type: ['integer', 'null'] }
              },
              required: ['tmp_id', 'title', 'description', 'deliverables', 'price_usd', 'price_currency', 'deposit_pct', 'lead_time_days'],
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
      const system = [
        `Extract each priced service package from the seller's rate card.`,
        `Rules:`,
        `- Never invent or convert a price. Copy each number exactly as written into price_usd, and put the currency as written into price_currency as an ISO 4217 code (USD for $, INR for ₹ or Rs, EUR for €, GBP for £). Use null only if no currency is shown.`,
        `- Only create a package for a line that sells a deliverable at its own price. Add-ons, surcharges, revision policies and payment terms (for example urgent-delivery fees, extra-revision fees, included revisions, upfront percentages) are not packages: mention them briefly in the description of each package they apply to.`,
        `- deposit_pct: the upfront percentage stated for that package, else the general payment terms if they apply to every package, else 50.`,
        `- If a price is a starting price (onwards, from, starting at), use the stated number and begin the description with "Starting price."`,
        `- lead_time_days: only if stated, otherwise null.`,
        `- Include deliverables only when stated or plainly implied.`
      ].join('\n') + '\n';
      const result = await this.toolResult<{ services: unknown[] }>(
        system,
        rawText,
        tool,
        (value) => z.object({ services: z.array(serviceDraftInput) }).strict().parse(value)
      );
      return computeServiceDrafts(result.services);
    } catch {
      throw Object.assign(
        new Error("The AI couldn't read this rate card. Try again, or paste fewer lines at a time."),
        { status: 502 }
      );
    }
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
        max_tokens: 4096,
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
    toolChoice: ChatCompletionToolChoiceOption = 'auto'
  ): Promise<ChatCompletion> {
    const requestMessages = messages.map((message): ChatCompletionMessageParam => {
      if (message.role !== 'assistant') return message;
      return {
        role: 'assistant',
        content: message.content ?? '',
        ...('tool_calls' in message && message.tool_calls ? { tool_calls: message.tool_calls } : {})
      };
    });
    const attempt = async (model: string, checkDegenerateText = true): Promise<ChatCompletion> => {
      const response = await this.client.chat.completions.create({
        model,
        max_tokens: 4096,
        messages: requestMessages,
        ...(tools.length > 0 ? { tools, tool_choice: toolChoice } : {})
      });
      const message = response.choices[0]?.message;
      if (
        checkDegenerateText &&
        message &&
        !message.tool_calls?.length &&
        typeof message.content === 'string' &&
        isDegenerateText(message.content)
      ) {
        throw new Error('Model returned degenerate text.');
      }
      return response;
    };
    try {
      return await attempt(this.primaryModel);
    } catch {
      try {
        return await attempt(this.primaryModel);
      } catch {
        return attempt(this.fallbackModel, false);
      }
    }
  }
}

export function jsonSchemaTool(name: string, description: string, schema: Record<string, unknown>): ChatCompletionTool {
  return { type: 'function', function: { name, description, strict: true, parameters: schema } };
}
