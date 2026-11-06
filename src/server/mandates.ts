/**
 * Client/agent payment mandates for MCP create_deposit_link.
 * Spend limit + revocable key — agent can only mint PayPal approve links
 * within the remaining budget. Persisted via agent_events (no new table).
 */
import { createHash, randomBytes } from "node:crypto";
import { db } from "./db";
import { HttpError } from "./http";
import * as paypal from "./paypal";

export type MandatePublic = {
  mandate_id: string;
  mandate_key: string;
  spend_limit_usd: number;
  spent_usd: number;
  remaining_usd: number;
  revoked: boolean;
  label: string | null;
  created_at: string;
  /** PayPal Vault (v3) payment token attached after the client approved "save PayPal". */
  saved_paypal: { vaulted: boolean; payer_email: string | null; vaulted_at: string | null };
};

type MandateRow = {
  mandate_id: string;
  seller_id: string;
  key_hash: string;
  spend_limit_cents: number;
  spent_cents: number;
  revoked: boolean;
  label: string | null;
  created_at: string;
};

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function mintKey(): string {
  return `sr_mandate_${randomBytes(24).toString("base64url")}`;
}

async function loadByHash(keyHash: string): Promise<MandateRow | null> {
  const { data, error } = await db()
    .from("agent_events")
    .select("*")
    .eq("tool", "payment_mandate")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new HttpError(error.message, 500);
  for (const row of data ?? []) {
    const input = (row as { input?: Record<string, unknown> }).input ?? {};
    const output = (row as { output?: Record<string, unknown> }).output ?? {};
    if (input["key_hash"] !== keyHash) continue;
    return {
      mandate_id: String(output["mandate_id"] ?? row.id),
      seller_id: String((row as { seller_id?: string }).seller_id ?? ""),
      key_hash: keyHash,
      spend_limit_cents: Number(input["spend_limit_cents"] ?? 0),
      spent_cents: Number(output["spent_cents"] ?? 0),
      revoked: Boolean(output["revoked"]),
      label: typeof input["label"] === "string" ? input["label"] : null,
      created_at: String((row as { created_at?: string }).created_at ?? new Date().toISOString()),
    };
  }
  return null;
}

async function writeMandate(row: MandateRow, plaintextKey?: string): Promise<void> {
  const { error } = await db().from("agent_events").insert({
    quote_id: null,
    seller_id: row.seller_id || null,
    actor: "system",
    kind: "tool_call",
    tool: "payment_mandate",
    input: {
      key_hash: row.key_hash,
      spend_limit_cents: row.spend_limit_cents,
      label: row.label,
      ...(plaintextKey ? { key_prefix: plaintextKey.slice(0, 18) + "…" } : {}),
    },
    output: {
      mandate_id: row.mandate_id,
      spent_cents: row.spent_cents,
      revoked: row.revoked,
    },
    text: row.revoked
      ? "Payment mandate revoked"
      : plaintextKey
        ? `Payment mandate created (limit $${(row.spend_limit_cents / 100).toFixed(2)})`
        : `Payment mandate spent updated ($${(row.spent_cents / 100).toFixed(2)} used)`,
  });
  if (error) throw new HttpError(error.message, 500);
}

type VaultLink = { vault_id: string; payer_email: string | null; vaulted_at: string };

async function loadVault(keyHash: string): Promise<VaultLink | null> {
  const { data, error } = await db()
    .from("agent_events")
    .select("input, output, created_at")
    .eq("tool", "payment_mandate.vault")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new HttpError(error.message, 500);
  for (const row of data ?? []) {
    const input = (row as { input?: Record<string, unknown> }).input ?? {};
    const output = (row as { output?: Record<string, unknown> }).output ?? {};
    if (input["key_hash"] !== keyHash || !output["vault_id"]) continue;
    return {
      vault_id: String(output["vault_id"]),
      payer_email: typeof output["payer_email"] === "string" ? output["payer_email"] : null,
      vaulted_at: String((row as { created_at?: string }).created_at ?? ""),
    };
  }
  return null;
}

function toPublic(row: MandateRow, plaintextKey: string, vault?: VaultLink | null): MandatePublic {
  const remaining = Math.max(0, row.spend_limit_cents - row.spent_cents);
  return {
    mandate_id: row.mandate_id,
    mandate_key: plaintextKey,
    spend_limit_usd: row.spend_limit_cents / 100,
    spent_usd: row.spent_cents / 100,
    remaining_usd: remaining / 100,
    revoked: row.revoked,
    label: row.label,
    created_at: row.created_at,
    saved_paypal: {
      vaulted: Boolean(vault),
      payer_email: vault?.payer_email ?? null,
      vaulted_at: vault?.vaulted_at ?? null,
    },
  };
}

/** Create a revocable spend-limited mandate for an outside agent. */
export async function createMandate(opts: {
  sellerId: string;
  spendLimitUsd: number;
  label?: string;
}): Promise<MandatePublic> {
  const limitCents = Math.round(opts.spendLimitUsd * 100);
  if (!Number.isFinite(limitCents) || limitCents < 100) {
    throw new HttpError("spend_limit_usd must be at least 1.00", 400);
  }
  if (limitCents > 50_000_00) {
    throw new HttpError("spend_limit_usd too large for demo (max 50000)", 400);
  }
  const key = mintKey();
  const row: MandateRow = {
    mandate_id: `man_${randomBytes(8).toString("hex")}`,
    seller_id: opts.sellerId,
    key_hash: hashKey(key),
    spend_limit_cents: limitCents,
    spent_cents: 0,
    revoked: false,
    label: opts.label?.slice(0, 120) ?? null,
    created_at: new Date().toISOString(),
  };
  await writeMandate(row, key);
  return toPublic(row, key);
}

/** Revoke so create_deposit_link rejects the key. */
export async function revokeMandate(mandateKey: string): Promise<MandatePublic> {
  const row = await loadByHash(hashKey(mandateKey));
  if (!row) throw new HttpError("Unknown mandate_key", 404);
  if (row.revoked) return toPublic(row, mandateKey);
  row.revoked = true;
  await writeMandate(row);
  return toPublic(row, mandateKey);
}

export async function getMandateStatus(mandateKey: string): Promise<MandatePublic> {
  const keyHash = hashKey(mandateKey);
  const [row, vault] = await Promise.all([loadByHash(keyHash), loadVault(keyHash)]);
  if (!row) throw new HttpError("Unknown mandate_key", 404);
  return toPublic(row, mandateKey, vault);
}

/**
 * Returning-client Vault: mint a PayPal Vault v3 setup token bound to this mandate.
 * The client approves once at PayPal; /api/vault/return exchanges it for a payment token.
 */
export async function startMandateVault(opts: {
  mandateKey: string;
  sellerId: string;
  origin: string;
  brandName?: string;
}): Promise<{ approve_url: string; setup_token_id: string; mandate_id: string }> {
  const keyHash = hashKey(opts.mandateKey);
  const row = await loadByHash(keyHash);
  if (!row) throw new HttpError("Unknown mandate_key", 404);
  if (row.seller_id && row.seller_id !== opts.sellerId) {
    throw new HttpError("mandate_key does not belong to this storefront", 403);
  }
  if (row.revoked) throw new HttpError("mandate_key has been revoked", 403);
  const st = await paypal.createVaultSetupToken({
    returnUrl: `${opts.origin}/api/vault/return?mandate_id=${encodeURIComponent(row.mandate_id)}`,
    cancelUrl: `${opts.origin}/?vault=cancelled`,
    requestId: `vault-setup-${row.mandate_id}-${Date.now()}`,
    ...(opts.brandName ? { brandName: opts.brandName } : {}),
  });
  if (!st.approveUrl) throw new HttpError("PayPal did not return a Vault approval link", 502);
  const { error } = await db().from("agent_events").insert({
    quote_id: null,
    seller_id: row.seller_id || null,
    actor: "client_agent",
    kind: "tool_call",
    tool: "payment_mandate.vault_setup",
    input: { key_hash: keyHash, mandate_id: row.mandate_id },
    output: { setup_token_id: st.id, status: st.status },
    text: "PayPal Vault setup token created — client approves once to save PayPal for rebooking",
  });
  if (error) throw new HttpError(error.message, 500);
  return { approve_url: st.approveUrl, setup_token_id: st.id, mandate_id: row.mandate_id };
}

/** PayPal redirect target: exchange the approved setup token for a reusable payment token. */
export async function completeMandateVault(opts: {
  mandateId: string;
  setupTokenId: string;
}): Promise<{ mandate_id: string; payer_email: string | null }> {
  const { data, error } = await db()
    .from("agent_events")
    .select("input, output, seller_id")
    .eq("tool", "payment_mandate.vault_setup")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new HttpError(error.message, 500);
  const setup = (data ?? []).find((r) => {
    const o = (r as { output?: Record<string, unknown> }).output ?? {};
    const i = (r as { input?: Record<string, unknown> }).input ?? {};
    return o["setup_token_id"] === opts.setupTokenId && i["mandate_id"] === opts.mandateId;
  }) as { input: Record<string, unknown>; seller_id: string | null } | undefined;
  if (!setup) throw new HttpError("Unknown Vault setup for this mandate", 404);
  const token = await paypal.createVaultPaymentToken({
    setupTokenId: opts.setupTokenId,
    requestId: `vault-token-${opts.setupTokenId}`,
  });
  const { error: wErr } = await db().from("agent_events").insert({
    quote_id: null,
    seller_id: setup.seller_id,
    actor: "paypal",
    kind: "webhook",
    tool: "payment_mandate.vault",
    input: { key_hash: setup.input["key_hash"], mandate_id: opts.mandateId },
    output: {
      vault_id: token.id,
      customer_id: token.customerId ?? null,
      payer_email: token.payerEmail ?? null,
    },
    text: "PayPal saved to mandate via Vault — returning-client deposits need no popup (still inside the spend limit)",
  });
  if (wErr) throw new HttpError(wErr.message, 500);
  return { mandate_id: opts.mandateId, payer_email: token.payerEmail ?? null };
}

/** Vault id for a mandate (server-only; never returned to agents). */
export async function mandateVaultId(mandateKey: string): Promise<string | null> {
  return (await loadVault(hashKey(mandateKey)))?.vault_id ?? null;
}

/**
 * Authorize a deposit against a mandate. Throws if revoked or over limit.
 * On success, records the spend (idempotent if same quote already counted — caller responsibility).
 */
export async function consumeMandateForDeposit(opts: {
  mandateKey: string;
  sellerId: string;
  amountCents: number;
  quoteId: string;
}): Promise<MandatePublic> {
  const row = await loadByHash(hashKey(opts.mandateKey));
  if (!row) throw new HttpError("mandate_key required — call create_payment_mandate first", 401);
  if (row.seller_id && row.seller_id !== opts.sellerId) {
    throw new HttpError("mandate_key does not belong to this storefront", 403);
  }
  if (row.revoked) throw new HttpError("mandate_key has been revoked", 403);
  const remaining = row.spend_limit_cents - row.spent_cents;
  // Idempotent: if this quote was already authorized under this mandate, do not double-count.
  const { data: prior } = await db()
    .from("agent_events")
    .select("id")
    .eq("quote_id", opts.quoteId)
    .eq("tool", "payment_mandate.authorize")
    .limit(1);
  if (prior && prior.length > 0) {
    return toPublic(row, opts.mandateKey);
  }
  if (opts.amountCents > remaining) {
    throw new HttpError(
      `Deposit $${(opts.amountCents / 100).toFixed(2)} exceeds mandate remaining $${(remaining / 100).toFixed(2)} (limit $${(row.spend_limit_cents / 100).toFixed(2)}). Raise the mandate or revoke and create a new one.`,
      402,
    );
  }
  row.spent_cents += opts.amountCents;
  await writeMandate(row);
  // Audit on the quote timeline
  await db().from("agent_events").insert({
    quote_id: opts.quoteId,
    seller_id: opts.sellerId,
    actor: "client_agent",
    kind: "tool_call",
    tool: "payment_mandate.authorize",
    input: {
      mandate_id: row.mandate_id,
      amount_cents: opts.amountCents,
      remaining_after_cents: row.spend_limit_cents - row.spent_cents,
    },
    output: { ok: true },
    text: `Agent mandate authorized $${(opts.amountCents / 100).toFixed(2)} deposit (remaining $${((row.spend_limit_cents - row.spent_cents) / 100).toFixed(2)})`,
  });
  return toPublic(row, opts.mandateKey);
}
