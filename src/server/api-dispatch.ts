/**
 * Path+method dispatcher for /api/* live endpoints.
 */
import * as live from "./live";
import { errResponse, HttpError, json, readJson } from "./http";
import { completeMandateVault } from "./mandates";

function htmlPage(title: string, body: string, status = 200): Response {
  const esc = (t: string) => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><body style="font-family:system-ui;max-width:520px;margin:12vh auto;padding:0 20px;line-height:1.5"><h1 style="font-size:22px">${esc(title)}</h1><p>${esc(body)}</p><p><a href="/">Back to ServiceReady</a></p></body>`,
    {
      status,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    },
  );
}

function pathOf(request: Request): string {
  return new URL(request.url).pathname.replace(/\/+$/, "") || "/";
}

export async function dispatchApi(request: Request): Promise<Response> {
  try {
    const method = request.method.toUpperCase();
    const path = pathOf(request);
    const url = new URL(request.url);

    // PayPal public config
    if (method === "GET" && path === "/api/paypal/config") {
      return json(await live.paypalConfig());
    }

    if (method === "GET" && path === "/api/paypal/client-token") {
      return json(await live.paypalClientToken(request));
    }

    // PayPal Vault v3 return (client approved "save PayPal" for a mandate)
    if (method === "GET" && path === "/api/vault/return") {
      const mandateId = url.searchParams.get("mandate_id") ?? "";
      const setupTokenId =
        url.searchParams.get("approval_token_id") ?? url.searchParams.get("token") ?? "";
      if (!mandateId || !setupTokenId) {
        return htmlPage("PayPal not saved", "Missing mandate or approval token.", 400);
      }
      try {
        const r = await completeMandateVault({ mandateId, setupTokenId });
        return htmlPage(
          "PayPal saved for rebooking",
          `Your PayPal${r.payer_email ? ` (${r.payer_email})` : ""} is saved to this agent mandate. Future deposits can be paid without a popup, only inside the mandate's spend limit — and you can revoke it anytime.`,
        );
      } catch (e) {
        return htmlPage("PayPal not saved", e instanceof Error ? e.message : "Vault failed", 400);
      }
    }

    if (method === "GET" && path === "/api/health") {
      return json(await live.health());
    }

    // PayPal webhooks (signature-verified when PAYPAL_WEBHOOK_ID is set; always re-read from PayPal)
    if (path === "/api/paypal/webhook") {
      if (method === "POST") return json(await live.handlePaypalWebhook(request));
      if (method === "GET") {
        return json({
          ok: true,
          accepts: "POST",
          events: [
            "CHECKOUT.ORDER.APPROVED",
            "PAYMENT.AUTHORIZATION.CREATED",
            "PAYMENT.CAPTURE.COMPLETED",
            "INVOICING.INVOICE.PAID",
            "INVOICING.INVOICE.UPDATED",
          ],
        });
      }
    }

    if (method === "GET" && path === "/api/seller") {
      return json(await live.getSeller(request));
    }
    if (method === "POST" && path === "/api/seller/bootstrap") {
      const body = await readJson<{ name?: string; tagline?: string }>(request);
      return json(await live.bootstrapSeller(request, body ?? {}));
    }
    if (method === "PUT" && path === "/api/seller/rules") {
      const body = await readJson(request);
      return json(await live.putRules(body as Parameters<typeof live.putRules>[0], request));
    }

    if (method === "POST" && path === "/api/catalog/parse") {
      const body = await readJson<{ raw_text?: string }>(request);
      return json(await live.parseCatalog(body.raw_text ?? "", request));
    }
    if (method === "POST" && path === "/api/catalog/publish") {
      const body = await readJson<{ services?: Parameters<typeof live.publishCatalog>[0] }>(
        request,
      );
      return json(await live.publishCatalog(body.services ?? [], request));
    }

    if (method === "GET" && path === "/api/services") {
      return json(await live.listServices(request));
    }
    if (method === "POST" && path === "/api/services/image") {
      const body = await readJson<{
        title?: string;
        description?: string;
        deliverables?: string[];
        data_url?: string;
        mode?: "upload" | "generate" | "clear";
        service_id?: string;
      }>(request);
      return json(await live.setServiceImage(request, body ?? {}));
    }

    {
      const m = path.match(/^\/api\/public\/([^/]+)$/);
      if (m && method === "GET") {
        return json(await live.getPublic(decodeURIComponent(m[1]!), request));
      }
    }
    {
      const m = path.match(/^\/api\/public\/([^/]+)\/quotes$/);
      if (m && method === "POST") {
        const body = await readJson(request);
        return json(
          await live.postPublicQuote(
            decodeURIComponent(m[1]!),
            body as Parameters<typeof live.postPublicQuote>[1],
            request,
          ),
        );
      }
    }

    if (method === "GET" && path === "/api/quotes") {
      return json(await live.listQuotes(request));
    }

    {
      const m = path.match(/^\/api\/quotes\/([^/]+)$/);
      if (m && method === "GET") {
        const refresh = url.searchParams.get("refresh") === "1";
        return json(await live.getQuote(decodeURIComponent(m[1]!), refresh));
      }
    }
    {
      const m = path.match(/^\/api\/quotes\/([^/]+)\/deposit\/order$/);
      if (m && method === "POST") {
        return json(await live.createDepositOrder(decodeURIComponent(m[1]!), request));
      }
    }
    {
      const m = path.match(/^\/api\/quotes\/([^/]+)\/deposit\/capture$/);
      if (m && method === "POST") {
        const body = await readJson<{ order_id?: string }>(request);
        if (!body.order_id) throw new HttpError("order_id is required", 400);
        return json(await live.captureDeposit(decodeURIComponent(m[1]!), body.order_id));
      }
    }
    {
      const m = path.match(/^\/api\/quotes\/([^/]+)\/start-work$/);
      if (m && method === "POST") {
        return json(await live.startWork(decodeURIComponent(m[1]!), request));
      }
    }
    {
      const m = path.match(/^\/api\/quotes\/([^/]+)\/deliver$/);
      if (m && method === "POST") {
        return json(await live.deliver(decodeURIComponent(m[1]!), request));
      }
    }
    {
      const m = path.match(/^\/api\/quotes\/([^/]+)\/invoice$/);
      if (m && (method === "GET" || method === "POST")) {
        return json(await live.refreshInvoiceStatus(decodeURIComponent(m[1]!)));
      }
    }
    {
      const m = path.match(/^\/api\/quotes\/([^/]+)\/cancel$/);
      if (m && method === "POST") {
        const body = await readJson<{ reason?: string }>(request).catch(() => ({}));
        return json(await live.cancelQuote(decodeURIComponent(m[1]!), request, body ?? {}));
      }
    }
    {
      const m = path.match(/^\/api\/quotes\/([^/]+)\/replies$/);
      if (m && method === "POST") {
        const body = await readJson<{ text?: string; from?: "client" | "seller" }>(request);
        return json(
          await live.postReply(decodeURIComponent(m[1]!), {
            text: body.text ?? "",
            from: body.from === "seller" ? "seller" : "client",
          }),
        );
      }
    }
    {
      const m = path.match(/^\/api\/quotes\/([^/]+)\/collections\/run$/);
      if (m && method === "POST") {
        return json(await live.runCollections(decodeURIComponent(m[1]!), undefined, request));
      }
    }

    {
      const m = path.match(/^\/api\/quotes\/([^/]+)\/tip$/);
      if (m && method === "POST") {
        const body = await readJson<{ tip_cents?: unknown; tip_pct?: unknown }>(request);
        return json(await live.setTip(decodeURIComponent(m[1]!), body ?? {}));
      }
    }
    if ((method === "GET" || method === "POST") && path === "/api/judges/tamper-demo") {
      const qid = url.searchParams.get("quote_id") ?? undefined;
      return json(await live.tamperDemo(qid || undefined));
    }

    if (method === "GET" && path === "/api/proposals") {
      const status = url.searchParams.get("status") ?? undefined;
      return json(await live.listProposals(status, request));
    }
    {
      const m = path.match(/^\/api\/proposals\/([^/]+)\/approve$/);
      if (m && method === "POST") {
        const body = await readJson<{ draft_message?: string }>(request);
        return json(
          await live.approveProposal(decodeURIComponent(m[1]!), body.draft_message ?? "", request),
        );
      }
    }
    {
      const m = path.match(/^\/api\/proposals\/([^/]+)\/reject$/);
      if (m && method === "POST") {
        return json(await live.rejectProposal(decodeURIComponent(m[1]!), request));
      }
    }

    if (method === "GET" && path === "/api/events") {
      const actor = url.searchParams.get("actor") ?? undefined;
      return json(await live.listEvents(actor, request));
    }
    if (method === "GET" && path === "/api/stats") {
      return json(await live.getStats(request));
    }

    if (method === "POST" && (path === "/api/agent/chat" || path === "/api/agent-sim/chat")) {
      const body = await readJson<{
        slug?: string;
        messages?: Parameters<typeof live.agentChat>[1];
      }>(request);
      return json(
        await live.agentChat(body.slug ?? "maya-rao-studio", body.messages ?? [], request),
      );
    }

    if (method === "POST" && path === "/api/demo/reset") {
      return json(await live.resetDemo(request));
    }

    // Demo simulate-balance is intentionally unavailable in live mode
    if (method === "POST" && /^\/api\/demo\/quotes\/[^/]+\/pay-balance$/.test(path)) {
      throw new HttpError(
        "Simulate balance is disabled in live sandbox mode — pay the PayPal invoice with the sandbox buyer, then refresh invoice status.",
        400,
      );
    }

    throw new HttpError(`No route for ${method} ${path}`, 404);
  } catch (e) {
    return errResponse(e);
  }
}
