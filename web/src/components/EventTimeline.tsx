import { Bot, CreditCard, User } from "lucide-react";
import type { AgentEvent } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import { JsonBlock } from "./kit";

const who = (actor: AgentEvent["actor"]) =>
  actor === "paypal"
    ? "PayPal"
    : actor === "seller"
      ? "You"
      : actor === "client"
        ? "Client"
        : actor === "system"
          ? "ServiceReady"
          : actor === "seller_agent"
            ? "Seller assistant"
            : actor === "client_agent"
              ? "Client assistant"
              : "Collections assistant";
const icon = (actor: AgentEvent["actor"]) =>
  actor === "paypal" ? CreditCard : actor === "seller" || actor === "client" ? User : Bot;
const plain = (kind: string) => kind.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
export function EventTimeline({ events }: { events: AgentEvent[] }) {
  return (
    <ol className="divide-y divide-border">
      {events.map((e) => {
        const Icon = icon(e.actor);
        return (
          <li key={e.id} className="flex gap-3 py-4 first:pt-0 last:pb-0">
            <span className="icon-tile">
              <Icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-semibold">{who(e.actor)}</span>
                <span className="text-sm text-muted-foreground">{plain(e.kind)}</span>
                <time className="ml-auto text-xs text-muted-foreground">
                  {fmtDate(e.created_at)}
                </time>
              </div>
              {e.text && (
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{e.text}</p>
              )}
              <div className="mt-2 flex gap-4">
                <JsonBlock
                  label="Details"
                  value={{ input: e.input, output: e.output, tool: e.tool }}
                />
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
