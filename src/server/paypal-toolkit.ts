/**
 * Official PayPal Agent Toolkit (@paypal/agent-toolkit/ai-sdk) wrapper.
 * Used by collections / payment-check, invoice reminders, and deposit refunds.
 * Human approval still gates any remind/send — tools that write money or message
 * clients are only invoked from approveProposal / cancelQuote, not from drafts.
 */
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
import { paypalEnv } from "./env";
import { HttpError } from "./http";

export type ToolkitCallResult = {
  tool: string;
  input: Record<string, unknown>;
  output: unknown;
  ok: boolean;
  error?: string;
};

let cached: PayPalAgentToolkit | null = null;

function toolkit(): PayPalAgentToolkit {
  if (cached) return cached;
  const { clientId, clientSecret, env } = paypalEnv();
  cached = new PayPalAgentToolkit({
    clientId,
    clientSecret,
    configuration: {
      context: { sandbox: env === "sandbox" },
      actions: {
        invoices: {
          get: true,
          list: true,
          sendReminder: true,
          send: true,
        },
        orders: {
          create: true,
          get: true,
        },
        payments: {
          createRefund: true,
          getRefunds: true,
        },
      },
    },
  });
  return cached;
}

/** Tool names enabled for ServiceReady (subset of Agent Toolkit). */
export const TOOLKIT_TOOL_NAMES = [
  "get_invoice",
  "list_invoices",
  "send_invoice_reminder",
  "get_order",
  "create_order",
  "create_refund",
  "get_refund",
] as const;

export type ToolkitToolName = (typeof TOOLKIT_TOOL_NAMES)[number];

function parseToolOutput(raw: unknown): unknown {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return { raw };
    }
  }
  return raw;
}

/**
 * Execute one Agent Toolkit tool by name. Returns a timeline-ready trace object.
 * Never throws for tool-level PayPal errors — sets ok:false so collections can fall back.
 */
export async function callToolkitTool(
  name: ToolkitToolName,
  input: Record<string, unknown>,
): Promise<ToolkitCallResult> {
  const tools = toolkit().getTools() as unknown as Record<
    string,
    {
      execute?: (
        args: Record<string, unknown>,
        opts: { toolCallId: string; messages: [] },
      ) => PromiseLike<unknown>;
    }
  >;
  const tool = tools[name];
  if (!tool?.execute) {
    return {
      tool: `paypal.agent_toolkit.${name}`,
      input,
      output: null,
      ok: false,
      error: `Agent Toolkit tool "${name}" is not enabled`,
    };
  }
  try {
    const raw = await tool.execute(input, {
      toolCallId: `sr_${name}_${Date.now().toString(36)}`,
      messages: [],
    });
    return {
      tool: `paypal.agent_toolkit.${name}`,
      input,
      output: parseToolOutput(raw),
      ok: true,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[paypal-toolkit]", name, msg);
    return {
      tool: `paypal.agent_toolkit.${name}`,
      input,
      output: null,
      ok: false,
      error: msg,
    };
  }
}

/** Read invoice status via Agent Toolkit (preferred collections path). */
export async function toolkitGetInvoice(invoiceId: string): Promise<{
  status: string;
  raw: unknown;
  trace: ToolkitCallResult;
}> {
  const trace = await callToolkitTool("get_invoice", { invoice_id: invoiceId });
  if (!trace.ok) throw new HttpError(trace.error ?? "Agent Toolkit get_invoice failed", 502);
  const out = trace.output as { status?: string; id?: string } | null;
  const status =
    out && typeof out === "object" && typeof out.status === "string"
      ? out.status
      : "UNKNOWN";
  return { status, raw: trace.output, trace };
}

/** Read order via Agent Toolkit. */
export async function toolkitGetOrder(orderId: string): Promise<{
  status: string;
  raw: unknown;
  trace: ToolkitCallResult;
}> {
  const trace = await callToolkitTool("get_order", { id: orderId });
  if (!trace.ok) throw new HttpError(trace.error ?? "Agent Toolkit get_order failed", 502);
  const out = trace.output as { status?: string } | null;
  const status =
    out && typeof out === "object" && typeof out.status === "string"
      ? out.status
      : "UNKNOWN";
  return { status, raw: trace.output, trace };
}

/** Full capture refund via Agent Toolkit create_refund. */
export async function toolkitCreateRefund(opts: {
  captureId: string;
  noteToPayer?: string;
  amountCents?: number;
  currency?: string;
}): Promise<{ refundId?: string; status?: string; raw: unknown; trace: ToolkitCallResult }> {
  const input: Record<string, unknown> = {
    capture_id: opts.captureId,
    note_to_payer: opts.noteToPayer ?? "ServiceReady booking cancelled — deposit refunded",
  };
  if (opts.amountCents !== undefined) {
    input["amount"] = {
      currency_code: opts.currency ?? "USD",
      value: (opts.amountCents / 100).toFixed(2),
    };
  }
  const trace = await callToolkitTool("create_refund", input);
  if (!trace.ok) throw new HttpError(trace.error ?? "Agent Toolkit create_refund failed", 502);
  const out = trace.output as { id?: string; status?: string } | null;
  const result: { refundId?: string; status?: string; raw: unknown; trace: ToolkitCallResult } = {
    raw: trace.output,
    trace,
  };
  if (out && typeof out === "object" && out.id) result.refundId = out.id;
  if (out && typeof out === "object" && out.status) result.status = out.status;
  return result;
}

/** Send invoice reminder via Agent Toolkit (only after human approval). */
export async function toolkitSendInvoiceReminder(opts: {
  invoiceId: string;
  subject?: string;
  note?: string;
}): Promise<ToolkitCallResult> {
  const trace = await callToolkitTool("send_invoice_reminder", {
    invoice_id: opts.invoiceId,
    subject: opts.subject ?? "Reminder from ServiceReady",
    note: opts.note,
  });
  if (!trace.ok) throw new HttpError(trace.error ?? "Agent Toolkit send_invoice_reminder failed", 502);
  return trace;
}

/** Names of toolkit tools for seller Ask AI / docs disclosure. */
export function listEnabledToolkitTools(): string[] {
  try {
    return Object.keys(toolkit().getTools());
  } catch {
    return [...TOOLKIT_TOOL_NAMES];
  }
}
