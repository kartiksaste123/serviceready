import { paypalEnv } from "./env";
import { HttpError } from "./http";

type TokenCache = { accessToken: string; expiresAt: number };
let tokenCache: TokenCache | null = null;

async function getAccessToken(): Promise<{ token: string; apiBase: string; clientId: string }> {
  const { clientId, clientSecret, apiBase } = paypalEnv();
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 60_000) {
    return { token: tokenCache.accessToken, apiBase, clientId };
  }
  const basic = (() => {
    const raw = `${clientId}:${clientSecret}`;
    if (typeof Buffer !== "undefined") return Buffer.from(raw).toString("base64");
    // Cloudflare Workers / browsers
    return btoa(raw);
  })();
  const res = await fetch(`${apiBase}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[paypal] token failed", res.status, body.slice(0, 200));
    throw new HttpError("PayPal authentication failed", 502);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: now + (data.expires_in ?? 30000) * 1000,
  };
  return { token: data.access_token, apiBase, clientId };
}

async function paypalFetch<T>(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const { token, apiBase } = await getAccessToken();
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...extraHeaders,
    },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(`${apiBase}${path}`, init);
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  if (!res.ok) {
    const msg =
      typeof data === "object" && data && "message" in data
        ? String((data as { message: unknown }).message)
        : typeof data === "object" && data && "name" in data
          ? String((data as { name: unknown }).name)
          : `PayPal ${res.status}`;
    console.error("[paypal]", method, path, res.status, msg);
    throw new HttpError(msg || `PayPal request failed (${res.status})`, 502);
  }
  return data as T;
}

export async function getPublicClientId(): Promise<{ client_id: string; env: "sandbox" | "live" }> {
  const { clientId, env } = paypalEnv();
  return { client_id: clientId, env };
}

export function centsToUsd(cents: number): string {
  return (cents / 100).toFixed(2);
}

export async function createOrder(opts: {
  amountCents: number;
  currency?: string;
  customId: string;
  description?: string;
  requestId: string;
  /** Where PayPal sends the buyer after approving outside the JS SDK popup (MCP / agent links). */
  returnUrl?: string;
  cancelUrl?: string;
  brandName?: string;
}): Promise<{ id: string; status: string; approveUrl?: string }> {
  const value = centsToUsd(opts.amountCents);
  const order = await paypalFetch<{
    id: string;
    status: string;
    links?: Array<{ rel: string; href: string }>;
  }>(
    "POST",
    "/v2/checkout/orders",
    {
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: { currency_code: opts.currency ?? "USD", value },
          custom_id: opts.customId,
          description: opts.description?.slice(0, 127),
        },
      ],
      application_context: {
        shipping_preference: "NO_SHIPPING",
        user_action: "PAY_NOW",
        ...(opts.brandName ? { brand_name: opts.brandName.slice(0, 127) } : {}),
        ...(opts.returnUrl ? { return_url: opts.returnUrl } : {}),
        ...(opts.cancelUrl ? { cancel_url: opts.cancelUrl } : {}),
      },
    },
    { "PayPal-Request-Id": opts.requestId },
  );
  const approveUrl = order.links?.find(
    (l) => l.rel === "approve" || l.rel === "payer-action",
  )?.href;
  return { id: order.id, status: order.status, ...(approveUrl ? { approveUrl } : {}) };
}

/** Orders v2 GET — used by webhooks and agent tools to read PayPal's source of truth. */
export async function getOrder(orderId: string): Promise<{
  id: string;
  status: string;
  customId?: string;
  approveUrl?: string;
}> {
  const o = await paypalFetch<{
    id: string;
    status: string;
    purchase_units?: Array<{ custom_id?: string }>;
    links?: Array<{ rel: string; href: string }>;
  }>("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
  const approveUrl = o.links?.find((l) => l.rel === "approve" || l.rel === "payer-action")?.href;
  const customId = o.purchase_units?.[0]?.custom_id;
  return {
    id: o.id,
    status: o.status,
    ...(customId ? { customId } : {}),
    ...(approveUrl ? { approveUrl } : {}),
  };
}

/**
 * Verify a webhook delivery with PayPal (POST /v1/notifications/verify-webhook-signature).
 * Returns "SUCCESS" | "FAILURE".
 */
export async function verifyWebhookSignature(opts: {
  webhookId: string;
  headers: Headers;
  event: unknown;
}): Promise<string> {
  const h = (k: string) => opts.headers.get(k) ?? "";
  const res = await paypalFetch<{ verification_status?: string }>(
    "POST",
    "/v1/notifications/verify-webhook-signature",
    {
      auth_algo: h("paypal-auth-algo"),
      cert_url: h("paypal-cert-url"),
      transmission_id: h("paypal-transmission-id"),
      transmission_sig: h("paypal-transmission-sig"),
      transmission_time: h("paypal-transmission-time"),
      webhook_id: opts.webhookId,
      webhook_event: opts.event,
    },
  );
  return res.verification_status ?? "FAILURE";
}

export async function captureOrder(orderId: string): Promise<{
  id: string;
  status: string;
  captureId?: string;
  amountCents?: number;
  currency?: string;
  customId?: string;
}> {
  const result = await paypalFetch<{
    id: string;
    status: string;
    purchase_units?: Array<{
      custom_id?: string;
      payments?: {
        captures?: Array<{
          id: string;
          status: string;
          amount?: { value: string; currency_code: string };
        }>;
      };
    }>;
  }>("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {});

  const unit = result.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];
  const amountCents = capture?.amount?.value
    ? Math.round(parseFloat(capture.amount.value) * 100)
    : undefined;
  const out: {
    id: string;
    status: string;
    captureId?: string;
    amountCents?: number;
    currency?: string;
    customId?: string;
  } = { id: result.id, status: result.status };
  if (capture?.id) out.captureId = capture.id;
  if (amountCents !== undefined) out.amountCents = amountCents;
  if (capture?.amount?.currency_code) out.currency = capture.amount.currency_code;
  if (unit?.custom_id) out.customId = unit.custom_id;
  return out;
}

export async function createAndSendInvoice(opts: {
  amountCents: number;
  currency?: string;
  recipientEmail: string;
  recipientName: string;
  itemName: string;
  note?: string;
  invoiceNumber?: string;
  businessName?: string;
}): Promise<{ invoiceId: string; status: string; href?: string }> {
  const value = centsToUsd(opts.amountCents);
  const currency = opts.currency ?? "USD";
  const created = await paypalFetch<{ id: string; status?: string; href?: string }>(
    "POST",
    "/v2/invoicing/invoices",
    {
      detail: {
        currency_code: currency,
        invoice_number: opts.invoiceNumber,
        note: opts.note?.slice(0, 4000),
        payment_term: { term_type: "DUE_ON_RECEIPT" },
      },
      invoicer: {
        // Sandbox merchant identity comes from the app credentials; keep minimal.
        business_name: (opts.businessName ?? "ServiceReady").slice(0, 300),
      },
      primary_recipients: [
        {
          billing_info: {
            email_address: opts.recipientEmail,
            name: { full_name: opts.recipientName.slice(0, 300) },
          },
        },
      ],
      items: [
        {
          name: opts.itemName.slice(0, 200),
          quantity: "1",
          unit_amount: { currency_code: currency, value },
        },
      ],
    },
  );

  const invoiceId = created.id;
  // Send to recipient (sandbox emails the sandbox buyer if linked)
  const sent = await paypalFetch<{ href?: string } | Record<string, unknown>>(
    "POST",
    `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/send`,
    { send_to_recipient: true, send_to_invoicer: false },
  );

  const href =
    (typeof sent === "object" && sent && "href" in sent && typeof sent.href === "string"
      ? sent.href
      : undefined) ??
    created.href ??
    `https://www.sandbox.paypal.com/invoice/p/#${invoiceId}`;

  return { invoiceId, status: "SENT", href };
}

export async function getInvoice(invoiceId: string): Promise<{
  id: string;
  status: string;
  href?: string;
  amountCents?: number;
}> {
  const inv = await paypalFetch<{
    id: string;
    status: string;
    detail?: { metadata?: { recipient_view_url?: string } };
    amount?: { value?: string; currency_code?: string };
    links?: Array<{ rel: string; href: string }>;
  }>("GET", `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}`);

  const href =
    inv.detail?.metadata?.recipient_view_url ??
    inv.links?.find((l) => l.rel === "payer-view" || l.rel === "recipient_view")?.href;

  const amountCents = inv.amount?.value
    ? Math.round(parseFloat(inv.amount.value) * 100)
    : undefined;

  const out: { id: string; status: string; href?: string; amountCents?: number } = {
    id: inv.id,
    status: inv.status,
  };
  if (href) out.href = href;
  if (amountCents !== undefined) out.amountCents = amountCents;
  return out;
}

export async function remindInvoice(invoiceId: string, subject?: string, note?: string) {
  await paypalFetch("POST", `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/remind`, {
    subject: subject ?? "Reminder: invoice still open",
    note: note?.slice(0, 4000),
    send_to_recipient: true,
  });
  return { ok: true as const };
}

/** Payments v2 refund on a capture id (fallback if Agent Toolkit is unavailable). */
export async function refundCapture(opts: {
  captureId: string;
  amountCents?: number;
  currency?: string;
  noteToPayer?: string;
  requestId: string;
}): Promise<{ id: string; status: string }> {
  const body: Record<string, unknown> = {};
  if (opts.amountCents !== undefined) {
    body["amount"] = {
      currency_code: opts.currency ?? "USD",
      value: centsToUsd(opts.amountCents),
    };
  }
  if (opts.noteToPayer) body["note_to_payer"] = opts.noteToPayer.slice(0, 255);
  const result = await paypalFetch<{ id: string; status: string }>(
    "POST",
    `/v2/payments/captures/${encodeURIComponent(opts.captureId)}/refund`,
    body,
    { "PayPal-Request-Id": opts.requestId },
  );
  return { id: result.id, status: result.status };
}

