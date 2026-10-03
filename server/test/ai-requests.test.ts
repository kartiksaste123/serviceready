import { APIConnectionTimeoutError } from 'openai';
import type OpenAI from 'openai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionTool
} from 'openai/resources';
import { AIService, normalizeCatalogOutput } from '../src/ai.js';

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

describe('catalog output normalization', () => {
  it('fills absent non-money fields and keeps required money fields absent', () => {
    const normalized = normalizeCatalogOutput({
      services: [{ title: 'Logo design', price_usd: 150, deposit_pct: 50 }]
    });

    expect(normalized).toEqual({
      services: [{
        tmp_id: 'svc_1',
        title: 'Logo design',
        description: '',
        deliverables: [],
        price_usd: 150,
        price_currency: null,
        deposit_pct: 50,
        lead_time_days: null
      }]
    });
  });

  it('de-duplicates service ids, drops unknown keys, and leaves malformed roots unchanged', () => {
    const malformed = { services: 'not-an-array' };
    const normalized = normalizeCatalogOutput({
      services: [
        { tmp_id: 'logo', title: 'Logo', price_usd: 150, deposit_pct: 50, ignored: true },
        { tmp_id: 'logo', title: 'Brand kit', price_usd: 300, deposit_pct: 50, extra: 'drop' }
      ]
    }) as { services: Array<Record<string, unknown>> };

    expect(normalized.services.map((service) => service.tmp_id)).toEqual(['logo', 'svc_2']);
    expect(Object.keys(normalized.services[0] ?? {}).sort()).toEqual([
      'deliverables',
      'deposit_pct',
      'description',
      'lead_time_days',
      'price_currency',
      'price_usd',
      'title',
      'tmp_id'
    ]);
    expect(normalized.services[0]).not.toHaveProperty('ignored');
    expect(normalizeCatalogOutput(malformed)).toBe(malformed);
  });

  it('accepts a catalog missing deliverables on its first model call', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { client, calls } = createFakeClient([
      completion('tool_calls', JSON.stringify({
        services: [{ title: 'Logo design', price_usd: 150, deposit_pct: 50 }]
      }), 'submit_services')
    ]);
    const ai = new AIService(client, 'workers-ai/primary-test', 'workers-ai/fallback-test');

    const parsed = await ai.parseCatalog('A logo design rate card.');

    expect(calls).toHaveLength(1);
    expect(parsed.services).toMatchObject([{
      tmp_id: 'svc_1',
      title: 'Logo design',
      description: '',
      deliverables: [],
      price_cents: 15000,
      lead_time_days: null
    }]);
  });

  it.each(['price_usd', 'deposit_pct'] as const)(
    'retries catalog output that is missing required %s',
    async (missingField) => {
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const incomplete: Record<string, unknown> = {
        tmp_id: 'logo',
        title: 'Logo design',
        description: '',
        deliverables: ['Final logo files'],
        price_usd: 150,
        price_currency: 'USD',
        deposit_pct: 50,
        lead_time_days: 7
      };
      delete incomplete[missingField];
      const complete = {
        ...incomplete,
        [missingField]: missingField === 'price_usd' ? 150 : 50
      };
      const { client, calls } = createFakeClient([
        completion('tool_calls', JSON.stringify({ services: [incomplete] }), 'submit_services'),
        completion('tool_calls', JSON.stringify({ services: [complete] }), 'submit_services')
      ]);
      const ai = new AIService(client, 'workers-ai/primary-test', 'workers-ai/fallback-test');

      await expect(ai.parseCatalog('A logo design rate card.')).resolves.toMatchObject({
        services: [expect.objectContaining({ title: 'Logo design' })]
      });

      expect(calls).toHaveLength(2);
      expect(calls.map((call) => call.body.model)).toEqual([
        'workers-ai/primary-test',
        'workers-ai/primary-test'
      ]);
    }
  );
});
