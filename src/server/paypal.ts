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
    const base =
      typeof data === "object" && data && "message" in data
        ? String((data as { message: unknown }).message)
        : typeof data === "object" && data && "name" in data
          ? String((data as { name: unknown }).name)
          : `PayPal ${res.status}`;
    // PayPal puts the useful part (which field, why) in details[] — surface it.
    const details =
      typeof data === "object" && data && Array.isArray((data as { details?: unknown }).details)
        ? ((data as { details: Array<{ field?: string; issue?: string; description?: string }> })
            .details)
        : [];
    const why = details
      .map((d) => [d.field, d.description ?? d.issue].filter(Boolean).join(": "))
      .filter(Boolean)
      .join("; ");
    const msg = why ? `${base} (${why})` : base;
    console.error("[paypal]", method, path, res.status, msg, JSON.stringify(details));
    const err = new HttpError(msg || `PayPal request failed (${res.status})`, 502) as HttpError & {
      paypalDetails?: typeof details;
    };
    err.paypalDetails = details;
    throw err;
  }
  return data as T;
}

export async function getPublicClientId(): Promise<{ client_id: string; env: "sandbox" | "live" }> {
  const { clientId, env } = paypalEnv();
  return { client_id: clientId, env };
}

export type DepositIntent = "CAPTURE" | "AUTHORIZE";

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
  /** CAPTURE (pay now) or AUTHORIZE (hold funds, capture when work starts). */
  intent?: DepositIntent;
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
      intent: opts.intent ?? "CAPTURE",
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
  intent?: DepositIntent;
  customId?: string;
  approveUrl?: string;
  authorizationId?: string;
  authorizationStatus?: string;
  captureId?: string;
  amountCents?: number;
  currency?: string;
}> {
  const o = await paypalFetch<{
    id: string;
    status: string;
    intent?: DepositIntent;
    purchase_units?: Array<{
      custom_id?: string;
      amount?: { value?: string; currency_code?: string };
      payments?: {
        authorizations?: Array<{ id: string; status: string }>;
        captures?: Array<{ id: string; status: string }>;
      };
    }>;
    links?: Array<{ rel: string; href: string }>;
  }>("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
  const approveUrl = o.links?.find((l) => l.rel === "approve" || l.rel === "payer-action")?.href;
  const unit = o.purchase_units?.[0];
  const customId = unit?.custom_id;
  const auth = unit?.payments?.authorizations?.[0];
  const cap = unit?.payments?.captures?.[0];
  return {
    id: o.id,
    status: o.status,
    ...(o.intent ? { intent: o.intent } : {}),
    ...(customId ? { customId } : {}),
    ...(approveUrl ? { approveUrl } : {}),
    ...(auth ? { authorizationId: auth.id, authorizationStatus: auth.status } : {}),
    ...(cap ? { captureId: cap.id } : {}),
    ...(unit?.amount?.value ? { amountCents: Math.round(parseFloat(unit.amount.value) * 100) } : {}),
    ...(unit?.amount?.currency_code ? { currency: unit.amount.currency_code } : {}),
  };
}

/** Orders v2 authorize — buyer approved an intent=AUTHORIZE order; hold the funds. */
export async function authorizeOrder(orderId: string, requestId?: string): Promise<{
  id: string;
  status: string;
  authorizationId?: string;
  authorizationStatus?: string;
  amountCents?: number;
  customId?: string;
  expiresAt?: string;
}> {
  const r = await paypalFetch<{
    id: string;
    status: string;
    purchase_units?: Array<{
      custom_id?: string;
      payments?: {
        authorizations?: Array<{
          id: string;
          status: string;
          amount?: { value: string; currency_code: string };
          expiration_time?: string;
          custom_id?: string;
        }>;
      };
    }>;
  }>("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, {}, {
    "PayPal-Request-Id": requestId ?? `authorize-${orderId}`,
  });
  const unit = r.purchase_units?.[0];
  const a = unit?.payments?.authorizations?.[0];
  const out: Awaited<ReturnType<typeof authorizeOrder>> = { id: r.id, status: r.status };
  if (a?.id) out.authorizationId = a.id;
  if (a?.status) out.authorizationStatus = a.status;
  if (a?.amount?.value) out.amountCents = Math.round(parseFloat(a.amount.value) * 100);
  const cid = unit?.custom_id ?? a?.custom_id;
  if (cid) out.customId = cid;
  if (a?.expiration_time) out.expiresAt = a.expiration_time;
  return out;
}

/** Payments v2 — capture a held authorization (seller starts work). */
export async function captureAuthorization(opts: {
  authorizationId: string;
  requestId: string;
  finalCapture?: boolean;
  /** Partial capture (cancellation policy). Omit to capture the full authorized amount. */
  amountCents?: number;
  currency?: string;
  noteToPayer?: string;
}): Promise<{ id: string; status: string; amountCents?: number }> {
  const r = await paypalFetch<{ id: string; status: string; amount?: { value: string } }>(
    "POST",
    `/v2/payments/authorizations/${encodeURIComponent(opts.authorizationId)}/capture`,
    {
      final_capture: opts.finalCapture ?? true,
      ...(opts.amountCents !== undefined
        ? { amount: { currency_code: opts.currency ?? "USD", value: centsToUsd(opts.amountCents) } }
        : {}),
      ...(opts.noteToPayer ? { note_to_payer: opts.noteToPayer.slice(0, 255) } : {}),
    },
    { "PayPal-Request-Id": opts.requestId },
  );
  return {
    id: r.id,
    status: r.status,
    ...(r.amount?.value ? { amountCents: Math.round(parseFloat(r.amount.value) * 100) } : {}),
  };
}

/** Payments v2 — void a held authorization (cancel before work starts; nothing to refund). */
export async function voidAuthorization(
  authorizationId: string,
  requestId?: string,
): Promise<{ ok: true }> {
  await paypalFetch(
    "POST",
    `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`,
    undefined,
    { "PayPal-Request-Id": requestId ?? `void-${authorizationId}` },
  );
  return { ok: true };
}

/**
 * Browser-safe client token for the PayPal JS SDK v6 (`createInstance({ clientToken })`).
 * Never exposes the secret; scoped to sdk_init for the given domains.
 */
export async function createSdkClientToken(domains: string[]): Promise<{
  client_token: string;
  expires_in: number;
}> {
  const { clientId, clientSecret, apiBase } = paypalEnv();
  const raw = `${clientId}:${clientSecret}`;
  const basic = typeof Buffer !== "undefined" ? Buffer.from(raw).toString("base64") : btoa(raw);
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    response_type: "client_token",
    intent: "sdk_init",
  });
  for (const d of domains) params.append("domains[]", d);
  const res = await fetch(`${apiBase}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  if (!res.ok) throw new HttpError("PayPal client token failed", 502);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  return { client_token: data.access_token, expires_in: data.expires_in ?? 900 };
}

/** Vault v3 — setup token so a returning client can save PayPal (buyer approves once). */
export async function createVaultSetupToken(opts: {
  returnUrl: string;
  cancelUrl: string;
  requestId: string;
  brandName?: string;
}): Promise<{ id: string; status: string; approveUrl?: string }> {
  const r = await paypalFetch<{
    id: string;
    status: string;
    links?: Array<{ rel: string; href: string }>;
  }>(
    "POST",
    "/v3/vault/setup-tokens",
    {
      payment_source: {
        paypal: {
          usage_type: "MERCHANT",
          usage_pattern: "IMMEDIATE",
          permit_multiple_payment_tokens: true,
          experience_context: {
            return_url: opts.returnUrl,
            cancel_url: opts.cancelUrl,
            shipping_preference: "NO_SHIPPING",
            vault_instruction: "ON_PAYER_APPROVAL",
            ...(opts.brandName ? { brand_name: opts.brandName.slice(0, 127) } : {}),
          },
        },
      },
    },
    { "PayPal-Request-Id": opts.requestId },
  );
  const approveUrl = r.links?.find((l) => l.rel === "approve")?.href;
  return { id: r.id, status: r.status, ...(approveUrl ? { approveUrl } : {}) };
}

export async function getVaultSetupToken(id: string): Promise<{ id: string; status: string }> {
  const r = await paypalFetch<{ id: string; status: string }>(
    "GET",
    `/v3/vault/setup-tokens/${encodeURIComponent(id)}`,
  );
  return { id: r.id, status: r.status };
}

/** Vault v3 — exchange an approved setup token for a reusable payment token. */
export async function createVaultPaymentToken(opts: {
  setupTokenId: string;
  requestId: string;
}): Promise<{ id: string; customerId?: string; payerEmail?: string }> {
  const r = await paypalFetch<{
    id: string;
    customer?: { id?: string };
    payment_source?: { paypal?: { email_address?: string } };
  }>(
    "POST",
    "/v3/vault/payment-tokens",
    { payment_source: { token: { id: opts.setupTokenId, type: "SETUP_TOKEN" } } },
    { "PayPal-Request-Id": opts.requestId },
  );
  return {
    id: r.id,
    ...(r.customer?.id ? { customerId: r.customer.id } : {}),
    ...(r.payment_source?.paypal?.email_address
      ? { payerEmail: r.payment_source.paypal.email_address }
      : {}),
  };
}

/**
 * Orders v2 with a vaulted PayPal payment token — merchant-initiated deposit for a returning
 * client who already approved Vault. No popup; PayPal completes the capture in one call.
 */
export async function createVaultedCaptureOrder(opts: {
  amountCents: number;
  customId: string;
  description?: string;
  vaultId: string;
  requestId: string;
}): Promise<{ id: string; status: string; captureId?: string; amountCents?: number }> {
  const r = await paypalFetch<{
    id: string;
    status: string;
    purchase_units?: Array<{
      payments?: { captures?: Array<{ id: string; status: string; amount?: { value: string } }> };
    }>;
  }>(
    "POST",
    "/v2/checkout/orders",
    {
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: { currency_code: "USD", value: centsToUsd(opts.amountCents) },
          custom_id: opts.customId,
          description: opts.description?.slice(0, 127),
        },
      ],
      payment_source: { paypal: { vault_id: opts.vaultId } },
    },
    { "PayPal-Request-Id": opts.requestId },
  );
  const cap = r.purchase_units?.[0]?.payments?.captures?.[0];
  return {
    id: r.id,
    status: r.status,
    ...(cap?.id ? { captureId: cap.id } : {}),
    ...(cap?.amount?.value ? { amountCents: Math.round(parseFloat(cap.amount.value) * 100) } : {}),
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

export async function captureOrder(orderId: string, requestId?: string): Promise<{
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
  }>("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {}, {
    "PayPal-Request-Id": requestId ?? `capture-${orderId}`,
  });

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
  /** Extra invoice lines (e.g. a client-chosen tip). */
  extraItems?: Array<{ name: string; amountCents: number }>;
  /** Let the payer add a tip in PayPal's invoice UI (Invoicing v2 configuration.allow_tip). */
  allowTip?: boolean;
  requestId?: string;
}): Promise<{ invoiceId: string; status: string; href?: string; allowTip: boolean }> {
  const value = centsToUsd(opts.amountCents);
  const currency = opts.currency ?? "USD";
  const reqId =
    opts.requestId ?? `invoice-${opts.invoiceNumber ?? `${opts.recipientEmail}-${value}`}`;
  const buildBody = (allowTip: boolean) => ({
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
        ...(opts.extraItems ?? [])
          .filter((i) => i.amountCents > 0)
          .map((i) => ({
            name: i.name.slice(0, 200),
            quantity: "1",
            unit_amount: { currency_code: currency, value: centsToUsd(i.amountCents) },
          })),
      ],
      ...(allowTip ? { configuration: { allow_tip: true } } : {}),
  });
  type Created = {
    id: string;
    status?: string;
    href?: string;
    detail?: { metadata?: { recipient_view_url?: string } };
  };
  let created: Created;
  let tipEnabled = !!opts.allowTip;
  try {
    created = await paypalFetch<Created>("POST", "/v2/invoicing/invoices", buildBody(tipEnabled), {
      "PayPal-Request-Id": reqId,
    });
  } catch (e) {
    // Some merchant countries (incl. many sandbox accounts) reject allow_tip:
    // "Tip option are not available in your country." Retry once without it so the
    // final bill still goes out — the client-chosen tip line is unaffected.
    const det = (e as { paypalDetails?: Array<{ field?: string }> }).paypalDetails ?? [];
    if (!tipEnabled || !det.some((d) => d.field?.includes("allow_tip"))) throw e;
    console.warn("[paypal] allow_tip rejected for this merchant — resending invoice without it");
    tipEnabled = false;
    created = await paypalFetch<Created>("POST", "/v2/invoicing/invoices", buildBody(false), {
      "PayPal-Request-Id": `${reqId}-notip`,
    });
  }

  const invoiceId = created.id;
  // Send to recipient (sandbox emails the sandbox buyer if linked)
  const sent = await paypalFetch<{ href?: string } | Record<string, unknown>>(
    "POST",
    `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/send`,
    { send_to_recipient: true, send_to_invoicer: false },
    { "PayPal-Request-Id": `invoice-send-${invoiceId}` },
  );

  const href =
    created.detail?.metadata?.recipient_view_url ??
    (typeof sent === "object" && sent && "href" in sent && typeof sent.href === "string"
      ? sent.href
      : undefined) ??
    created.href ??
    `https://www.sandbox.paypal.com/invoice/p/#${invoiceId}`;

  return { invoiceId, status: "SENT", href, allowTip: tipEnabled };
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

export async function remindInvoice(
  invoiceId: string,
  subject?: string,
  note?: string,
  requestId?: string,
) {
  await paypalFetch(
    "POST",
    `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/remind`,
    {
      subject: subject ?? "Reminder: invoice still open",
      note: note?.slice(0, 4000),
      send_to_recipient: true,
    },
    requestId ? { "PayPal-Request-Id": requestId } : undefined,
  );
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


/**
 * Payouts API (sandbox) — tip out a contractor / freelancer from the seller's
 * PayPal balance. Uses POST /v1/payments/payouts. Some sandbox merchant countries
 * return PAYOUT_NOT_AVAILABLE; callers should surface that clearly.
 */
export async function createPayout(opts: {
  amountCents: number;
  currency?: string;
  receiverEmail: string;
  note?: string;
  emailSubject?: string;
  senderBatchId: string;
  senderItemId?: string;
  requestId?: string;
}): Promise<{
  batchId: string;
  batchStatus: string;
  payoutItemId?: string;
  raw: unknown;
}> {
  const value = centsToUsd(opts.amountCents);
  const currency = opts.currency ?? "USD";
  const body = {
    sender_batch_header: {
      sender_batch_id: opts.senderBatchId.slice(0, 256),
      email_subject: (opts.emailSubject ?? "ServiceReady contractor tip-out").slice(0, 255),
      email_message: (opts.note ?? "Sandbox tip-out from ServiceReady").slice(0, 1000),
    },
    items: [
      {
        recipient_type: "EMAIL",
        amount: { value, currency },
        note: (opts.note ?? "ServiceReady contractor tip-out").slice(0, 1000),
        sender_item_id: (opts.senderItemId ?? opts.senderBatchId).slice(0, 127),
        receiver: opts.receiverEmail,
      },
    ],
  };
  const r = await paypalFetch<{
    batch_header?: {
      payout_batch_id?: string;
      batch_status?: string;
    };
    items?: Array<{ payout_item_id?: string }>;
  }>("POST", "/v1/payments/payouts", body, {
    "PayPal-Request-Id": opts.requestId ?? opts.senderBatchId,
  });
  return {
    batchId: r.batch_header?.payout_batch_id ?? "",
    batchStatus: r.batch_header?.batch_status ?? "UNKNOWN",
    ...(r.items?.[0]?.payout_item_id ? { payoutItemId: r.items[0].payout_item_id } : {}),
    raw: r,
  };
}

export async function getPayoutBatch(batchId: string): Promise<{
  batchId: string;
  batchStatus: string;
  items: Array<{
    payoutItemId?: string;
    transactionStatus?: string;
    receiver?: string;
    amountCents?: number;
  }>;
}> {
  const r = await paypalFetch<{
    batch_header?: { payout_batch_id?: string; batch_status?: string };
    items?: Array<{
      payout_item_id?: string;
      transaction_status?: string;
      payout_item?: {
        receiver?: string;
        amount?: { value?: string };
      };
    }>;
  }>("GET", `/v1/payments/payouts/${encodeURIComponent(batchId)}`);
  return {
    batchId: r.batch_header?.payout_batch_id ?? batchId,
    batchStatus: r.batch_header?.batch_status ?? "UNKNOWN",
    items: (r.items ?? []).map((it) => ({
      ...(it.payout_item_id ? { payoutItemId: it.payout_item_id } : {}),
      ...(it.transaction_status ? { transactionStatus: it.transaction_status } : {}),
      ...(it.payout_item?.receiver ? { receiver: it.payout_item.receiver } : {}),
      ...(it.payout_item?.amount?.value
        ? { amountCents: Math.round(parseFloat(it.payout_item.amount.value) * 100) }
        : {}),
    })),
  };
}
