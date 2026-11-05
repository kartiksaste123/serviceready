import type { AgentEvent, QuoteStatus } from "./types";

export const statusLabel: Record<QuoteStatus, string> = {
  quoted: "Awaiting deposit",
  deposit_paid: "Deposit paid",
  delivered: "Work delivered",
  balance_invoiced: "Balance due",
  paid: "Fully paid",
  cancelled: "Cancelled",
};

export const actorLabel: Record<AgentEvent["actor"], string> = {
  paypal: "PayPal",
  seller: "You",
  client: "Client",
  system: "ServiceReady",
  seller_agent: "Seller assistant",
  client_agent: "Client's AI assistant",
  collections_agent: "Payment assistant",
};
