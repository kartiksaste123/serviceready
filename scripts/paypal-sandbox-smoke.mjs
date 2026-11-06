#!/usr/bin/env node
/**
 * PayPal sandbox smoke: client_credentials → create $1.00 CAPTURE order.
 * Reads PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET from env, or .paypal-sandbox-secret.txt
 * Prints only order id + status. Never logs secrets.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function loadCreds() {
  let id = process.env.PAYPAL_CLIENT_ID;
  let secret = process.env.PAYPAL_CLIENT_SECRET;
  const f = resolve(root, ".paypal-sandbox-secret.txt");
  if ((!id || !secret) && existsSync(f)) {
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const [k, ...rest] = line.split("=");
      const v = rest.join("=").trim();
      if (k === "client_id") id = v;
      if (k === "secret") secret = v;
    }
  }
  if (!id || !secret) throw new Error("Missing PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET");
  return { id, secret };
}

const { id, secret } = loadCreds();
const basic = Buffer.from(`${id}:${secret}`).toString("base64");
const tokRes = await fetch("https://api-m.sandbox.paypal.com/v1/oauth2/token", {
  method: "POST",
  headers: {
    Authorization: `Basic ${basic}`,
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: "grant_type=client_credentials",
});
if (!tokRes.ok) {
  console.error("token_failed", tokRes.status);
  process.exit(1);
}
const { access_token } = await tokRes.json();
const orderRes = await fetch("https://api-m.sandbox.paypal.com/v2/checkout/orders", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${access_token}`,
    "Content-Type": "application/json",
    "PayPal-Request-Id": `serviceready-smoke-${Date.now()}`,
  },
  body: JSON.stringify({
    intent: "CAPTURE",
    purchase_units: [
      { amount: { currency_code: "USD", value: "1.00" }, custom_id: "smoke-test" },
    ],
    application_context: { shipping_preference: "NO_SHIPPING" },
  }),
});
const order = await orderRes.json();
if (!orderRes.ok) {
  console.error("order_failed", orderRes.status, order?.name || order?.message || "");
  process.exit(1);
}
console.log(JSON.stringify({ order_id: order.id, status: order.status }));
