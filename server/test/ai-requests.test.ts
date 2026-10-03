import { APIConnectionTimeoutError } from 'openai';
import type OpenAI from 'openai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionTool
} from 'openai/resources';
import { AIService } from '../src/ai.js';

interface CapturedCall {
  body: ChatCompletionCreateParamsNonStreaming;
  options?: { timeout?: number };
}

function createFakeClient(responses: Array<ChatCompletion | Error>) {
  const calls: CapturedCall[] = [];
  const client = {
    chat: {
      completions: {
        create: async (
          body: ChatCompletionCreateParamsNonStreaming,
          options?: { timeout?: number }
        ) => {
          calls.push({ body, options });
          const next = responses.shift();
          if (next instanceof Error) throw next;
          if (!next) throw new Error('No fake response configured.');
          return next;
        }
      }
    }
  } as unknown as OpenAI;
  return { client, calls };
}

function completion(
  finishReason: string,
  argumentsJson = '{"ok":true}',
  functionName = 'submit_payload'
): ChatCompletion {
  return {
    id: 'fake-completion',
    created: 1,
    model: 'fake-model',
    object: 'chat.completion',
    usage: { completion_tokens: 23, prompt_tokens: 10, total_tokens: 33 },
    choices: [{
      index: 0,
      finish_reason: finishReason,
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'fake-call',
          type: 'function',
          function: { name: functionName, arguments: argumentsJson }
        }]
      }
    }]
  } as unknown as ChatCompletion;
}

function textCompletion(): ChatCompletion {
  return {
    id: 'fake-completion',
    created: 1,
    model: 'fake-model',
    object: 'chat.completion',
    usage: { completion_tokens: 4, prompt_tokens: 10, total_tokens: 14 },
    choices: [{
      index: 0,
      finish_reason: 'stop',
      message: { role: 'assistant', content: 'A short response.' }
    }]
  } as unknown as ChatCompletion;
}

const tool: ChatCompletionTool = {
  type: 'function',
  function: { name: 'submit_payload', description: 'Submit a payload.', parameters: { type: 'object' } }
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AI request retry limits', () => {
  it('uses the fallback immediately after a primary timeout', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { client, calls } = createFakeClient([
      new APIConnectionTimeoutError({ message: 'Timed out.' }),
      completion('tool_calls')
    ]);
    const ai = new AIService(client, 'workers-ai/primary-test', 'workers-ai/fallback-test');

    await expect(ai.toolResult('system', 'user', tool)).resolves.toEqual({ ok: true });

    expect(calls.map((call) => call.body.model)).toEqual([
      'workers-ai/primary-test',
      'workers-ai/fallback-test'
    ]);
  });

  it('uses the fallback immediately when the primary reaches its token limit', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { client, calls } = createFakeClient([
      completion('length', 'not valid json'),
      completion('tool_calls')
    ]);
    const ai = new AIService(client, 'workers-ai/primary-test', 'workers-ai/fallback-test');

    await expect(ai.toolResult('system', 'user', tool)).resolves.toEqual({ ok: true });

    expect(calls.map((call) => call.body.model)).toEqual([
      'workers-ai/primary-test',
      'workers-ai/fallback-test'
    ]);
  });

  it('retries other primary failures once before using the fallback', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { client, calls } = createFakeClient([
      completion('tool_calls', '{"ok":false}'),
      completion('tool_calls', '{"ok":false}'),
      completion('tool_calls')
    ]);
    const ai = new AIService(client, 'workers-ai/primary-test', 'workers-ai/fallback-test');
    const validate = (value: unknown) => {
      if ((value as { ok: boolean }).ok !== true) throw new Error('Invalid payload.');
      return value;
    };

    await expect(ai.toolResult('system', 'user', tool, validate)).resolves.toEqual({ ok: true });

    expect(calls.map((call) => call.body.model)).toEqual([
      'workers-ai/primary-test',
      'workers-ai/primary-test',
      'workers-ai/fallback-test'
    ]);
  });

  it('passes the catalog and chat token and timeout limits to the OpenAI client', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const catalog = createFakeClient([completion('tool_calls', '{"services":[]}', 'submit_services')]);
    const catalogAI = new AIService(catalog.client, 'workers-ai/primary-test', 'workers-ai/fallback-test');
    await catalogAI.parseCatalog('A rate card with no priced services.');

    expect(catalog.calls[0]?.body.max_tokens).toBe(4096);
    expect(catalog.calls[0]?.options?.timeout).toBe(30_000);

    const chat = createFakeClient([textCompletion()]);
    const chatAI = new AIService(chat.client, 'workers-ai/primary-test', 'workers-ai/fallback-test');
    await chatAI.chatCompletion([{ role: 'user', content: 'Reply briefly.' }], []);

    expect(chat.calls[0]?.body.max_tokens).toBe(1024);
    expect(chat.calls[0]?.options?.timeout).toBe(15_000);
  });
});
