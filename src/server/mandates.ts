/**
 * Client/agent payment mandates for MCP create_deposit_link.
 * Spend limit + revocable key — agent can only mint PayPal approve links
 * within the remaining budget. Persisted via agent_events (no new table).
 */
import { createHash, randomBytes } from "node:crypto";
import { db } from "./db";
import { HttpError } from "./http";

export type MandatePublic = {
  mandate_id: string;
  mandate_key: string;
  spend_limit_usd: number;
  spent_usd: number;
  remaining_usd: number;
  revoked: boolean;
  label: string | null;
  created_at: string;
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

function toPublic(row: MandateRow, plaintextKey: string): MandatePublic {
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
  const row = await loadByHash(hashKey(mandateKey));
  if (!row) throw new HttpError("Unknown mandate_key", 404);
  return toPublic(row, mandateKey);
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
