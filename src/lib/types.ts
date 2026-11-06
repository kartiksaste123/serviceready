import type { CancelPolicy } from "./cancel-policy";
export type QuoteStatus =
  "quoted" | "deposit_paid" | "delivered" | "balance_invoiced" | "paid" | "cancelled";
export type Source = "web" | "mcp" | "webmcp" | "agent_sim";
export interface SellerRules {
  default_deposit_pct: number;
  reminder_tone: "friendly" | "neutral" | "firm";
  max_reminders: number;
  wait_days_before_nudge: number;
  /** Deterministic cancellation / no-show policy (src/lib/cancel-policy.ts). */
  cancel_policy?: CancelPolicy;
}
export interface Seller {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  email: string;
  currency: "USD";
  rules: SellerRules;
}
export interface Service {
  id: string;
  title: string;
  description: string;
  deliverables: string[];
  price_cents: number;
  deposit_pct: number;
  lead_time_days: number;
  status: "published" | "draft";
  image_url?: string | null;
}
export interface ServiceDraft {
  tmp_id: string;
  title: string;
  description: string;
  deliverables: string[];
  price_cents: number;
  deposit_pct: number;
  lead_time_days: number | null;
  image_url?: string | null;
}
export interface Flag {
  tmp_id: string;
  field: string;
  severity: "warning" | "error";
  message: string;
}
export interface LineItem {
  label: string;
  amount_cents: number;
}
export interface Quote {
  id: string;
  service_id: string;
  service_title: string;
  client_name: string;
  client_email: string;
  brief: string;
  scope_summary: string;
  line_items: LineItem[];
  total_cents: number;
  deposit_cents: number;
  balance_cents: number;
  status: QuoteStatus;
  source: Source;
  approval_url: string;
  created_at: string;
  updated_at: string;
  /** How the deposit is taken: CAPTURE now, or AUTHORIZE (held) and captured when work starts. */
  deposit_intent?: "CAPTURE" | "AUTHORIZE";
  /** Client-chosen tip added to the final bill (cents). */
  tip_cents?: number;
  /** Policy snapshot taken when the quote was priced — later rule edits never apply retroactively. */
  cancel_policy?: CancelPolicy;
  deposit_paid_at?: string | null;
  work_started_at?: string | null;
  /** "signed" when the server HMAC over the amounts verifies. */
  integrity?: "signed" | "unsigned" | "tampered";
}
export interface Payment {
  id: string;
  kind: "deposit" | "balance";
  amount_cents: number;
  status: string;
  paypal_order_id?: string;
  paypal_capture_id?: string;
  paypal_authorization_id?: string;
  /** Orders v2 intent for deposits (CAPTURE | AUTHORIZE). */
  intent?: "CAPTURE" | "AUTHORIZE";
  paypal_invoice_id?: string;
  invoice_url?: string;
  /** Short prefix of the server order fingerprint (HMAC) — full value never leaves the server. */
  fingerprint_short?: string;
  /** Cancellation outcome: what the seller kept vs. what went back to the client. */
  kept_cents?: number;
  refunded_cents?: number;
  updated_at: string;
}
export interface AgentEvent {
  id: string;
  quote_id: string | null;
  actor:
    | "seller_agent"
    | "client_agent"
    | "collections_agent"
    | "system"
    | "seller"
    | "client"
    | "paypal";
  kind: "tool_call" | "message" | "webhook" | "decision" | "approval";
  tool?: string;
  input?: unknown;
  output?: unknown;
  text?: string;
  created_at: string;
}
export interface Proposal {
  id: string;
  quote_id: string;
  client_name: string;
  action: "wait" | "send_reminder" | "thank_and_close" | "escalate";
  reason: string;
  evidence: string;
  draft_message: string;
  status: "pending" | "approved" | "rejected" | "executed" | "failed";
  created_at: string;
}
export interface Reply {
  id: string;
  quote_id: string;
  from: "client" | "seller";
  text: string;
  created_at: string;
}
export interface AgentRun {
  id: string;
  quote_id: string;
  summary: string;
  steps: AgentEvent[];
  proposal: Proposal | null;
}
export interface QuoteDetail {
  quote: Quote;
  payments: Payment[];
  events: AgentEvent[];
  replies: Reply[];
  proposals: Proposal[];
}
export interface Stats {
  deposits_collected_cents: number;
  outstanding_cents: number;
  paid_cents: number;
  avg_days_to_pay: number | null;
  by_status: Record<QuoteStatus, number>;
  owed_by_client: {
    client_name: string;
    quote_id: string;
    outstanding_cents: number;
    days_since_invoice: number;
    /** Deterministic collections risk (src/lib/risk.ts). */
    risk?: { score: number; band: "low" | "medium" | "high"; tone: "warm" | "firm" | "final"; factors: string[] };
  }[];
}
export interface PublicStore {
  seller: Pick<Seller, "name" | "slug" | "tagline">;
  services: Service[];
  agent: { mcp_url: string; webmcp_tools: string[] };
  cancel_policy?: CancelPolicy & { summary: string };
}
export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}
export interface ToolTrace {
  tool: string;
  input: unknown;
  output: unknown;
}
