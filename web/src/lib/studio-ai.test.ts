import type { AgLlmRequest } from 'ag-studio';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStudioAiAdapter } from './studio-ai';

afterEach(() => vi.unstubAllGlobals());

describe('Studio LLM adapter', () => {
  it('maps Studio history, instructions, tools, tool choice, and completion events', async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'completion-1',
      created: 1_720_000_000,
      model: 'workers-ai/test',
      choices: [{
        message: {
          content: 'I checked the invoice.',
          tool_calls: [{
            id: 'call-1',
            type: 'function',
            function: { name: 'list_unpaid', arguments: '{}' },
          }],
        },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchStub);
    const request = {
      instructions: 'Keep replies friendly.',
      input: [
        { id: 'user-1', kind: 'input', type: 'message', role: 'user', status: 'completed', content: [{ type: 'text', text: 'Who is unpaid?' }] },
        { id: 'call-0', kind: 'output', type: 'function_call', callId: 'call-0', name: 'previous_tool', arguments: '{"a":1}' },
        { id: 'result-0', kind: 'input', type: 'function_call_output', callId: 'call-0', output: '{"ok":true}', status: 'completed' },
      ],
      tools: [{
        name: 'list_unpaid',
        description: 'List unpaid invoices.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        kind: 'client',
      }],
      toolChoice: { name: 'list_unpaid' },
      responseFormat: { type: 'text' },
    } as AgLlmRequest;
    const handler = createStudioAiAdapter().executeTurn(request);
    const events = [];
    for await (const event of handler.stream) events.push(event);
    const response = await handler.complete;

    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub.mock.calls[0]?.[0]).toBe('/api/studio/llm');
    const body = JSON.parse(String(fetchStub.mock.calls[0]?.[1]?.body)) as {
      messages: { role: string; content?: string | null; tool_calls?: { id: string }[]; tool_call_id?: string }[];
      tools: { type: string; function: { name: string; parameters: unknown } }[];
      tool_choice: unknown;
    };
    expect(body.messages).toEqual([
      { role: 'system', content: 'Keep replies friendly.' },
      { role: 'user', content: 'Who is unpaid?' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'call-0', type: 'function', function: { name: 'previous_tool', arguments: '{"a":1}' } }] },
      { role: 'tool', tool_call_id: 'call-0', content: '{"ok":true}' },
    ]);
    expect(body.tools[0]?.function.name).toBe('list_unpaid');
    expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'list_unpaid' } });
    expect(events.map((event) => event.type)).toEqual([
      'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END',
      'TOOL_CALL_START', 'TOOL_CALL_ARGS', 'TOOL_CALL_END',
    ]);
    expect(response.output).toHaveLength(2);
    expect(response.status).toBe('completed');
  });
});
