/**
 * ServiceReady MCP server — Streamable HTTP transport (stateless, JSON responses).
 * POST /mcp/:slug with JSON-RPC 2.0. Lets Claude / ChatGPT / any MCP client discover
 * a seller's services, request a quote and get a real PayPal sandbox deposit link
 * gated by a client/agent payment mandate (spend limit + revocable key).
 */
import * as live from "./live";
import {
  createMandate,
  getMandateStatus,
  revokeMandate,
  consumeMandateForDeposit,
  startMandateVault,
  mandateVaultId,
} from "./mandates";
import { publicOrigin } from "./env";
import { HttpError } from "./http";
import { findPriceOverrides, GUARDRAIL_MESSAGE } from "../lib/guardrails";

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
      "Create a quote for a client. Returns totals, the deposit due now and a quote page where the client pays the deposit with PayPal. AI never invents prices — amounts come from the published catalog.",
    inputSchema: {
      type: "object",
      properties: {
        service_id: { type: "string" },
        client_name: { type: "string" },
        client_email: { type: "string", format: "email" },
        brief: { type: "string", description: "What the client needs and by when" },
      },
      required: ["service_id", "client_name", "client_email"],
      additionalProperties: false,
    },
  },
  {
    name: "get_quote_status",
    description:
      "Read a quote's status (quoted, deposit_paid, balance_invoiced, paid…). Status only changes on PayPal evidence — client claims are never trusted over PayPal.",
    inputSchema: {
      type: "object",
      properties: { quote_id: { type: "string" } },
      required: ["quote_id"],
    },
  },
  {
    name: "create_payment_mandate",
    description:
      "Create a revocable client/agent payment mandate with a hard spend limit (USD). Required before create_deposit_link. The agent can only mint PayPal deposit approve links within the remaining budget.",
    inputSchema: {
      type: "object",
      properties: {
        spend_limit_usd: {
          type: "number",
          description: "Maximum total deposit USD this agent key may authorize",
          minimum: 1,
        },
        label: { type: "string", description: "Optional label e.g. client or agent name" },
      },
      required: ["spend_limit_usd"],
    },
  },
  {
    name: "get_payment_mandate",
    description: "Inspect a mandate: limit, spent, remaining, revoked.",
    inputSchema: {
      type: "object",
      properties: { mandate_key: { type: "string" } },
      required: ["mandate_key"],
    },
  },
  {
    name: "revoke_payment_mandate",
    description: "Revoke a mandate_key immediately. Subsequent create_deposit_link calls with that key fail.",
    inputSchema: {
      type: "object",
      properties: { mandate_key: { type: "string" } },
      required: ["mandate_key"],
    },
  },
  {
    name: "create_deposit_link",
    description:
      "Create (or reuse) the PayPal Orders v2 deposit order for a quote and return the PayPal approval link. Requires a valid mandate_key whose remaining spend covers the deposit. The client pays; the agent never pays on their behalf.",
    inputSchema: {
      type: "object",
      properties: {
        quote_id: { type: "string" },
        mandate_key: {
          type: "string",
          description: "Revocable spend-limited key from create_payment_mandate",
        },
      },
      required: ["quote_id", "mandate_key"],
      additionalProperties: false,
    },
  },
  {
    name: "save_paypal_for_mandate",
    description:
      "Returning-client fast path (PayPal Vault v3). Returns a PayPal approval link; the client approves once and their PayPal is saved to this mandate. Later deposits can use pay_deposit_with_saved_paypal — still capped by the mandate spend limit and revocable.",
    inputSchema: {
      type: "object",
      properties: { mandate_key: { type: "string" } },
      required: ["mandate_key"],
      additionalProperties: false,
    },
  },
  {
    name: "pay_deposit_with_saved_paypal",
    description:
      "Pay a quote's deposit with the PayPal saved via save_paypal_for_mandate (no popup). Amount is the catalog deposit — never pass an amount. Counts against the mandate spend limit.",
    inputSchema: {
      type: "object",
      properties: { quote_id: { type: "string" }, mandate_key: { type: "string" } },
      required: ["quote_id", "mandate_key"],
      additionalProperties: false,
    },
  },
];

function str(v: unknown, name: string): string {
  if (typeof v !== "string" || !v.trim()) throw new HttpError(`${name} is required`, 400);
  return v.trim();
}

function num(v: unknown, name: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new HttpError(`${name} must be a number`, 400);
  return v;
}

async function sellerIdForSlug(slug: string, _request: Request): Promise<string> {
  return live.getSellerIdBySlug(slug);
}

async function callTool(
  slug: string,
  name: string,
  args: Record<string, unknown>,
  request: Request,
) {
  // Hard money guardrail: only the catalog sets prices. Applies to every money-moving tool.
  if (name === "request_quote" || name === "create_deposit_link" || name === "pay_deposit_with_saved_paypal") {
    const fields = findPriceOverrides(args);
    if (fields.length) {
      await live.logGuardrailBlock({
        slug,
        tool: name,
        fields,
        actor: "client_agent",
        quote_id: typeof args["quote_id"] === "string" ? args["quote_id"] : null,
      });
      throw new HttpError(`${GUARDRAIL_MESSAGE} (rejected: ${fields.join(", ")})`, 400);
    }
  }
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
        agentic_commerce: {
          next: "create_payment_mandate → request_quote → create_deposit_link(mandate_key)",
          note: "Deposit amounts come from the catalog; AI never sets prices. PayPal evidence beats client claims.",
        },
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
          "Call create_payment_mandate (if you don't have a key), then create_deposit_link with mandate_key so the client pays the deposit with PayPal.",
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
        source_of_truth: "PayPal — client claims are never trusted over PayPal evidence",
      };
    }
    case "create_payment_mandate": {
      const sellerId = await sellerIdForSlug(slug, request);
      const label = typeof args["label"] === "string" ? args["label"] : undefined;
      const m = await createMandate({
        sellerId,
        spendLimitUsd: num(args["spend_limit_usd"], "spend_limit_usd"),
        ...(label ? { label } : {}),
      });
      return {
        ...m,
        note: "Store mandate_key securely. Pass it to create_deposit_link. Call revoke_payment_mandate to kill the key.",
      };
    }
    case "get_payment_mandate": {
      return getMandateStatus(str(args["mandate_key"], "mandate_key"));
    }
    case "revoke_payment_mandate": {
      return revokeMandate(str(args["mandate_key"], "mandate_key"));
    }
    case "create_deposit_link": {
      const quoteId = str(args["quote_id"], "quote_id");
      const mandateKey = str(args["mandate_key"], "mandate_key");
      const d = await live.getQuote(quoteId);
      const sellerId = await sellerIdForSlug(slug, request);
      if (d.quote.status !== "quoted") {
        throw new HttpError("Deposit already handled or quote cancelled", 400);
      }
      // Authorize against mandate BEFORE creating a PayPal order.
      const mandate = await consumeMandateForDeposit({
        mandateKey,
        sellerId,
        amountCents: d.quote.deposit_cents,
        quoteId,
      });
      const r = await live.createDepositOrder(quoteId, request);
      return {
        paypal_order_id: r.order_id,
        paypal_approve_url: r.approve_url ?? null,
        quote_url: r.quote_url,
        mandate: {
          mandate_id: mandate.mandate_id,
          remaining_usd: mandate.remaining_usd,
          spend_limit_usd: mandate.spend_limit_usd,
        },
        note: "PayPal sandbox. After approval the buyer returns to quote_url, where ServiceReady captures the order server-side. Agent never pays — client approves within mandate limit.",
      };
    }
    case "save_paypal_for_mandate": {
      const sellerId = await sellerIdForSlug(slug, request);
      const store = await live.getPublic(slug, request);
      const r = await startMandateVault({
        mandateKey: str(args["mandate_key"], "mandate_key"),
        sellerId,
        origin: publicOrigin(request),
        brandName: store.seller.name,
      });
      return {
        ...r,
        note: "Send approve_url to the client. After they approve at PayPal, pay_deposit_with_saved_paypal works without a popup — still inside the mandate limit.",
      };
    }
    case "pay_deposit_with_saved_paypal": {
      const quoteId = str(args["quote_id"], "quote_id");
      const mandateKey = str(args["mandate_key"], "mandate_key");
      const sellerId = await sellerIdForSlug(slug, request);
      const vaultId = await mandateVaultId(mandateKey);
      if (!vaultId) {
        throw new HttpError(
          "No saved PayPal on this mandate — call save_paypal_for_mandate and have the client approve first",
          400,
        );
      }
      const d = await live.getQuote(quoteId);
      if (d.quote.status !== "quoted") throw new HttpError("Deposit already handled or quote cancelled", 400);
      const mandate = await consumeMandateForDeposit({
        mandateKey,
        sellerId,
        amountCents: d.quote.deposit_cents,
        quoteId,
      });
      const q = await live.payDepositWithVault(quoteId, vaultId);
      return {
        quote_id: q.id,
        status: q.status,
        deposit_paid_usd: q.deposit_cents / 100,
        mandate: { mandate_id: mandate.mandate_id, remaining_usd: mandate.remaining_usd },
        source_of_truth: "PayPal capture on a Vault payment token",
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
        serverInfo: { name: `serviceready-${slug}`, version: "1.2.0" },
        instructions:
          "Book this freelancer with agentic commerce guardrails: create_payment_mandate (spend limit) → list_services → request_quote → create_deposit_link(mandate_key). Deposits are real PayPal sandbox orders inside the mandate. Quote status only changes from PayPal evidence. Revoke the mandate anytime.",
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
      if (isNotification) return null;
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
    return new Response(
      JSON.stringify({
        name: `serviceready-${slug}`,
        transport: "streamable-http",
        usage: "POST JSON-RPC 2.0 (initialize, tools/list, tools/call) to this URL",
        tools: TOOLS.map((t) => t.name),
        agentic_commerce: "create_payment_mandate → create_deposit_link(mandate_key)",
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
