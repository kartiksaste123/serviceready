/**
 * OpenAI-compatible chat client (server-only).
 * Uses OPENAI_API_KEY (+ optional OPENAI_BASE_URL / OPENAI_MODEL).
 * Never expose these via VITE_*.
 */
import { z } from "zod";

function read(name: string): string | undefined {
  try {
    const v = (typeof process !== "undefined" ? process.env?.[name] : undefined) as
      | string
      | undefined;
    const t = v?.trim();
    return t || undefined;
  } catch {
    return undefined;
  }
}

export type LlmConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

/** True when a server-side model key is configured. */
export function hasLlm(): boolean {
  return Boolean(read("OPENAI_API_KEY") || read("XAI_API_KEY"));
}

export function llmConfig(): LlmConfig | null {
  const openai = read("OPENAI_API_KEY");
  const xai = read("XAI_API_KEY");
  if (openai) {
    return {
      apiKey: openai,
      baseUrl: (read("OPENAI_BASE_URL") ?? "https://api.openai.com/v1").replace(/\/$/, ""),
      model: read("OPENAI_MODEL") ?? "gpt-4o-mini",
    };
  }
  if (xai) {
    return {
      apiKey: xai,
      baseUrl: (read("OPENAI_BASE_URL") ?? "https://api.x.ai/v1").replace(/\/$/, ""),
      model: read("OPENAI_MODEL") ?? "grok-2-latest",
    };
  }
  return null;
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export class LlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmError";
  }
}

/** Raw chat completion; returns assistant text. */
export async function chatCompletion(
  messages: ChatMessage[],
  opts?: { temperature?: number; json?: boolean; timeoutMs?: number },
): Promise<string> {
  const cfg = llmConfig();
  if (!cfg) throw new LlmError("No OPENAI_API_KEY (or XAI_API_KEY) configured");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 45_000);
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: opts?.temperature ?? 0.2,
        ...(opts?.json ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new LlmError(`LLM HTTP ${res.status}: ${body.slice(0, 240)}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new LlmError("LLM returned empty content");
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

/** Chat + parse JSON, optionally validate with Zod. Falls through on parse errors. */
export async function chatJson<T>(
  messages: ChatMessage[],
  schema: z.ZodType<T>,
  opts?: { temperature?: number; timeoutMs?: number },
): Promise<T> {
  const raw = await chatCompletion(messages, { ...opts, json: true });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Some models wrap JSON in fences
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new LlmError("LLM did not return JSON");
    parsed = JSON.parse(m[0]!);
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new LlmError(`LLM JSON failed validation: ${result.error.message.slice(0, 200)}`);
  }
  return result.data;
}

/** Public label for README / Devpost (never the key). */
export function llmDisclosure(): { provider: string; model: string } | null {
  const cfg = llmConfig();
  if (!cfg) return null;
  const provider = cfg.baseUrl.includes("x.ai")
    ? "xAI"
    : cfg.baseUrl.includes("openai.com")
      ? "OpenAI"
      : "OpenAI-compatible";
  return { provider, model: cfg.model };
}
