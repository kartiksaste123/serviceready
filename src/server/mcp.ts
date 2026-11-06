/**
 * ServiceReady MCP server — Streamable HTTP transport (stateless, JSON responses).
 * POST /mcp/:slug with JSON-RPC 2.0. Lets Claude / ChatGPT / any MCP client discover
 * a seller's services, request a quote and get a real PayPal sandbox deposit link.
 */
import * as live from "./live";
import { HttpError } from "./http";

const PROTOCOL_VERSION = "2025-06-18";

type JsonRpcReq = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

const TOOLS = [
  {
    name: "list_services",
    description: "List the seller's published services with price, deposit % and turnaround.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_service",
    description: "Get one service's full details (deliverables, deposit, lead time).",
    inputSchema: {
      type: "object",
      properties: { service_id: { type: "string" } },
      required: ["service_id"],
    },
  },
  {
    name: "request_quote",
    description:
      "Create a quote for a client. Returns totals, the deposit due now and a quote page where the client pays the deposit with PayPal.",
    inputSchema: {
      type: "object",
      properties: {
        service_id: { type: "string" },
        client_name: { type: "string" },
        client_email: { type: "string", format: "email" },
        brief: { type: "string", description: "What the client needs and by when" },
      },
      required: ["service_id", "client_name", "client_email"],
    },
  },
  {
    name: "get_quote_status",
    description:
      "Read a quote's status (quoted, deposit_paid, balance_invoiced, paid…). Status only changes on PayPal evidence.",
    inputSchema: {
      type: "object",
      properties: { quote_id: { type: "string" } },
      required: ["quote_id"],
    },
  },
  {
    name: "create_deposit_link",
    description:
      "Create (or reuse) the PayPal Orders v2 deposit order for a quote and return the PayPal approval link. The client pays; the agent never pays on their behalf.",
    inputSchema: {
      type: "object",
      properties: { quote_id: { type: "string" } },
      required: ["quote_id"],
    },
  },
];

function str(v: unknown, name: string): string {
  if (typeof v !== "string" || !v.trim()) throw new HttpError(`${name} is required`, 400);
  return v.trim();
}

async function callTool(
  slug: string,
  name: string,
  args: Record<string, unknown>,
  request: Request,
) {
  switch (name) {
    case "list_services": {
      const store = await live.getPublic(slug, request);
      return {
        seller: store.seller,
        services: store.services.map((s) => ({
          id: s.id,
          title: s.title,
          price_usd: s.price_cents / 100,
          deposit_pct: s.deposit_pct,
          lead_time_days: s.lead_time_days,
        })),
      };
    }
    case "get_service": {
      const id = str(args["service_id"], "service_id");
      const store = await live.getPublic(slug, request);
      const svc = store.services.find((s) => s.id === id);
      if (!svc) throw new HttpError("Service not found", 404);
      return svc;
    }
    case "request_quote": {
      const q = await live.postPublicQuote(
        slug,
        {
          service_id: str(args["service_id"], "service_id"),
          client_name: str(args["client_name"], "client_name"),
          client_email: str(args["client_email"], "client_email"),
          brief: typeof args["brief"] === "string" ? args["brief"] : "",
          source: "mcp",
        },
        request,
      );
      return {
        quote_id: q.id,
        service: q.service_title,
        total_usd: q.total_cents / 100,
        deposit_due_now_usd: q.deposit_cents / 100,
        balance_on_delivery_usd: q.balance_cents / 100,
        status: q.status,
        quote_url: q.approval_url,
        next_step:
          "Share quote_url (or call create_deposit_link) so the client pays the deposit with PayPal.",
      };
    }
    case "get_quote_status": {
      const d = await live.getQuote(str(args["quote_id"], "quote_id"));
      return {
        quote_id: d.quote.id,
        status: d.quote.status,
        deposit_usd: d.quote.deposit_cents / 100,
        balance_usd: d.quote.balance_cents / 100,
        payments: d.payments.map((p) => ({
          kind: p.kind,
          status: p.status,
          paypal_order_id: p.paypal_order_id,
          paypal_invoice_id: p.paypal_invoice_id,
        })),
      };
    }
    case "create_deposit_link": {
      const r = await live.createDepositOrder(str(args["quote_id"], "quote_id"), request);
      return {
        paypal_order_id: r.order_id,
        paypal_approve_url: r.approve_url ?? null,
        quote_url: r.quote_url,
        note: "PayPal sandbox. After approval the buyer returns to quote_url, where ServiceReady captures the order server-side.",
      };
    }
    default:
      throw new HttpError(`Unknown tool: ${name}`, 404);
  }
}

function rpcResult(id: JsonRpcReq["id"], result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}
function rpcError(id: JsonRpcReq["id"], code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

async function handleOne(slug: string, msg: JsonRpcReq, request: Request): Promise<unknown | null> {
  const id = msg.id;
  const isNotification = id === undefined;
  switch (msg.method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion:
          typeof msg.params?.["protocolVersion"] === "string"
            ? msg.params["protocolVersion"]
            : PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: `serviceready-${slug}`, version: "1.0.0" },
        instructions:
          "Book this freelancer: list_services → request_quote → create_deposit_link. Deposits are real PayPal sandbox orders; quote status only changes from PayPal evidence.",
      });
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: TOOLS });
    case "tools/call": {
      const name = String(msg.params?.["name"] ?? "");
      const args = (msg.params?.["arguments"] ?? {}) as Record<string, unknown>;
      try {
        const out = await callTool(slug, name, args, request);
        return rpcResult(id, {
          content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
          structuredContent: out,
          isError: false,
        });
      } catch (e) {
        return rpcResult(id, {
          content: [{ type: "text", text: e instanceof Error ? e.message : "Tool failed" }],
          isError: true,
        });
      }
    }
    default:
      if (isNotification) return null; // e.g. notifications/initialized
      return rpcError(id, -32601, `Method not found: ${msg.method}`);
  }
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, accept, mcp-session-id, mcp-protocol-version",
};

export async function handleMcp(request: Request, slug: string): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (method === "GET") {
    // Human-readable discovery (no SSE stream offered — stateless server).
    return new Response(
      JSON.stringify({
        name: `serviceready-${slug}`,
        transport: "streamable-http",
        usage: "POST JSON-RPC 2.0 (initialize, tools/list, tools/call) to this URL",
        tools: TOOLS.map((t) => t.name),
      }),
      { status: 200, headers: { "content-type": "application/json", ...CORS } },
    );
  }
  if (method !== "POST") return new Response("Method not allowed", { status: 405, headers: CORS });

  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return new Response(JSON.stringify(rpcError(null, -32700, "Parse error")), {
      status: 400,
      headers: { "content-type": "application/json", ...CORS },
    });
  }
  // Confirm the seller exists up front so clients get a clean error.
  try {
    await live.getPublic(slug, request);
  } catch {
    return new Response(JSON.stringify(rpcError(null, -32004, `Unknown storefront: ${slug}`)), {
      status: 404,
      headers: { "content-type": "application/json", ...CORS },
    });
  }

  const batch = Array.isArray(body) ? (body as JsonRpcReq[]) : [body as JsonRpcReq];
  const results = (await Promise.all(batch.map((m) => handleOne(slug, m, request)))).filter(
    (r) => r !== null,
  );
  if (!results.length) return new Response(null, { status: 202, headers: CORS });
  return new Response(JSON.stringify(Array.isArray(body) ? results : results[0]), {
    status: 200,
    headers: { "content-type": "application/json", ...CORS },
  });
}
