/**
 * Path+method dispatcher for /api/* live endpoints.
 */
import * as live from "./live";
import { errResponse, HttpError, json, readJson } from "./http";

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

    if (method === "GET" && path === "/api/seller") {
      return json(await live.getSeller());
    }
    if (method === "PUT" && path === "/api/seller/rules") {
      const body = await readJson(request);
      return json(await live.putRules(body as Parameters<typeof live.putRules>[0]));
    }

    if (method === "POST" && path === "/api/catalog/parse") {
      const body = await readJson<{ raw_text?: string }>(request);
      return json(await live.parseCatalog(body.raw_text ?? ""));
    }
    if (method === "POST" && path === "/api/catalog/publish") {
      const body = await readJson<{ services?: Parameters<typeof live.publishCatalog>[0] }>(request);
      return json(await live.publishCatalog(body.services ?? []));
    }

    if (method === "GET" && path === "/api/services") {
      return json(await live.listServices());
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
      return json(await live.listQuotes());
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
        return json(await live.createDepositOrder(decodeURIComponent(m[1]!)));
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
      const m = path.match(/^\/api\/quotes\/([^/]+)\/deliver$/);
      if (m && method === "POST") {
        return json(await live.deliver(decodeURIComponent(m[1]!)));
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
        return json(await live.cancelQuote(decodeURIComponent(m[1]!)));
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
        return json(await live.runCollections(decodeURIComponent(m[1]!)));
      }
    }

    if (method === "GET" && path === "/api/proposals") {
      const status = url.searchParams.get("status") ?? undefined;
      return json(await live.listProposals(status));
    }
    {
      const m = path.match(/^\/api\/proposals\/([^/]+)\/approve$/);
      if (m && method === "POST") {
        const body = await readJson<{ draft_message?: string }>(request);
        return json(
          await live.approveProposal(decodeURIComponent(m[1]!), body.draft_message ?? ""),
        );
      }
    }
    {
      const m = path.match(/^\/api\/proposals\/([^/]+)\/reject$/);
      if (m && method === "POST") {
        return json(await live.rejectProposal(decodeURIComponent(m[1]!)));
      }
    }

    if (method === "GET" && path === "/api/events") {
      const actor = url.searchParams.get("actor") ?? undefined;
      return json(await live.listEvents(actor));
    }
    if (method === "GET" && path === "/api/stats") {
      return json(await live.getStats());
    }

    if (
      method === "POST" &&
      (path === "/api/agent/chat" || path === "/api/agent-sim/chat")
    ) {
      const body = await readJson<{ slug?: string; messages?: Parameters<typeof live.agentChat>[1] }>(
        request,
      );
      return json(await live.agentChat(body.slug ?? "maya-rao-studio", body.messages ?? []));
    }

    if (method === "POST" && path === "/api/demo/reset") {
      return json(await live.resetDemo());
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
