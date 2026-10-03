import type {
  AgAiConversationItem,
  AgAiEvent,
  AgAiOutputItem,
  AgLlmAdapter,
  AgLlmRequest,
  AgLlmResponse,
} from 'ag-studio';
import { api, type StudioLlmMessage, type StudioLlmRequest, type StudioLlmResponse, type StudioLlmTool } from './api';

function messageText(content: Array<{ type: string; text?: string; refusal?: string }>): string {
  return content.map((part) => part.type === 'text' ? part.text ?? '' : part.refusal ?? '').join('');
}

function mapConversation(input: AgAiConversationItem[], instructions?: string): StudioLlmMessage[] {
  const messages: StudioLlmMessage[] = instructions ? [{ role: 'system', content: instructions }] : [];
  for (let index = 0; index < input.length; index += 1) {
    const item = input[index];
    if (!item) continue;
    if (item.type === 'message' && item.kind === 'input') {
      const content = item.content.map((part) => {
        if (part.type === 'text') return part.text;
        if (part.type === 'image') return `[Attached image${part.imageUrl ? `: ${part.imageUrl}` : ''}]`;
        return `[Attached file${part.filename ? `: ${part.filename}` : ''}]`;
      }).join('\n');
      messages.push({ role: item.role, content });
    } else if (item.type === 'message' && item.kind === 'output') {
      messages.push({ role: 'assistant', content: messageText(item.content) });
    } else if (item.type === 'function_call') {
      const calls = [item];
      while (input[index + 1]?.type === 'function_call') {
        index += 1;
        const next = input[index];
        if (next?.type === 'function_call') calls.push(next);
      }
      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: calls.map((call) => ({
          id: call.callId,
          type: 'function',
          function: { name: call.name, arguments: call.arguments },
        })),
      });
    } else if (item.type === 'function_call_output') {
      messages.push({ role: 'tool', tool_call_id: item.callId, content: item.output });
    }
  }
  return messages;
}

function mapTools(tools: NonNullable<AgLlmRequest['tools']>): StudioLlmTool[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as Record<string, unknown>,
      strict: true,
    },
  }));
}

function mapToolChoice(choice: AgLlmRequest['toolChoice']): StudioLlmRequest['tool_choice'] {
  if (choice === undefined) return undefined;
  if (typeof choice === 'string') return choice;
  return { type: 'function', function: { name: choice.name } };
}

function buildResponse(result: StudioLlmResponse): { response: AgLlmResponse; events: AgAiEvent[] } {
  const message = result.choices[0]?.message;
  if (!message) throw new Error('The AI service returned no message.');
  const text = message.content ?? message.refusal ?? '';
  const timestamp = Date.now();
  const events: AgAiEvent[] = [];
  const output: AgAiOutputItem[] = [];
  const messageId = `${result.id}-message`;
  if (text) {
    events.push(
      { type: 'TEXT_MESSAGE_START', timestamp, messageId, role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', timestamp, messageId, delta: text },
      { type: 'TEXT_MESSAGE_END', timestamp, messageId },
    );
    output.push({
      id: messageId,
      kind: 'output',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'text', text, annotations: [] }],
    });
  }
  for (const [index, call] of (message.tool_calls ?? []).entries()) {
    const callId = call.id || `${result.id}-tool-${index}`;
    events.push(
      { type: 'TOOL_CALL_START', timestamp, toolCallId: callId, toolCallName: call.function.name, ...(text ? { parentMessageId: messageId } : {}) },
      { type: 'TOOL_CALL_ARGS', timestamp, toolCallId: callId, delta: call.function.arguments },
      { type: 'TOOL_CALL_END', timestamp, toolCallId: callId },
    );
    output.push({
      id: callId,
      kind: 'output',
      type: 'function_call',
      callId,
      name: call.function.name,
      arguments: call.function.arguments,
      status: 'completed',
    });
  }
  return {
    response: { id: result.id, createdAt: result.created * 1000, output, status: 'completed', model: result.model },
    events,
  };
}

function mapRequest(request: AgLlmRequest): StudioLlmRequest {
  const messages = mapConversation(request.input, request.instructions);
  if (request.responseFormat.type === 'json') {
    messages.unshift({
      role: 'system',
      content: `Return only valid JSON matching this schema: ${JSON.stringify(request.responseFormat.schema)}`,
    });
  }
  const tools = request.tools?.length ? mapTools(request.tools) : undefined;
  const tool_choice = mapToolChoice(request.toolChoice);
  return {
    messages,
    ...(tools ? { tools } : {}),
    ...(tool_choice ? { tool_choice } : {}),
  };
}

export function createStudioAiAdapter(): AgLlmAdapter {
  return {
    executeTurn(request, options) {
      const completion = api.studioLlm(mapRequest(request), options?.signal).then(buildResponse);
      return {
        stream: {
          async *[Symbol.asyncIterator]() {
            const result = await completion;
            yield* result.events;
          },
        },
        complete: completion.then(({ response }) => response),
      };
    },
  };
}

const studioAiAdapter = createStudioAiAdapter();

export function getStudioAiAdapter(): AgLlmAdapter {
  return studioAiAdapter;
}

export function getStudioNudgeTools(studioApi: import('ag-studio').AgStudioApi) {
  return [
    studioApi.defineAiTool({
      name: 'list_unpaid',
      description: 'List open balances from invoices awaiting payment.',
      params: (shape) => shape.object({}),
      execute: async (_args, context) => {
        try {
          const stats = await api.getStats();
          const owed = stats.owed_by_client.map((row) => ({
            client_name: row.client_name,
            quote_id: row.quote_id,
            outstanding_cents: row.outstanding_cents,
            days_since_invoice: row.days_since_invoice,
          }));
          return context.success(JSON.stringify(owed), owed);
        } catch (error) {
          return context.error(error instanceof Error ? error.message : 'Could not load unpaid invoices.');
        }
      },
    }),
    studioApi.defineAiTool({
      name: 'check_paypal_and_draft_nudge',
      description: 'Check PayPal and propose a friendly nudge for seller approval.',
      params: (shape) => shape.object({ quote_id: shape.string() }),
      execute: async ({ quote_id }, context) => {
        try {
          const run = await api.runCollections(quote_id);
          if (!run.proposal) return context.error('No collection proposal was returned.');
          const proposal = {
            action: run.proposal.action,
            evidence: run.proposal.evidence,
            draft: run.proposal.draft_message,
            note: 'This draft is waiting for seller approval in /app/approvals. Nothing has been sent.',
          };
          return context.success(JSON.stringify(proposal), proposal);
        } catch (error) {
          return context.error(error instanceof Error ? error.message : 'Could not check PayPal or draft a nudge.');
        }
      },
    }),
  ];
}
