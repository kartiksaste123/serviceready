export class HttpError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export function errResponse(e: unknown): Response {
  if (e instanceof HttpError) return json({ error: e.message }, e.status);
  const msg = e instanceof Error ? e.message : "Internal server error";
  // Don't leak stack / secrets
  console.error("[api]", msg);
  const status = /not found/i.test(msg) ? 404 : /not configured/i.test(msg) ? 503 : 500;
  return json({ error: msg }, status);
}

export async function readJson<T = unknown>(request: Request): Promise<T> {
  const text = await request.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError("Invalid JSON body", 400);
  }
}
