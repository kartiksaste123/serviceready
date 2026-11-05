import { Link } from "@tanstack/react-router";
import { Bot, CreditCard, Store, User } from "lucide-react";
import type { AgentEvent } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import { actorLabel } from "@/lib/labels";
import { JsonBlock } from "./kit";

const icon = (actor: AgentEvent["actor"]) =>
  actor === "paypal"
    ? CreditCard
    : actor === "seller" || actor === "client"
      ? User
      : actor === "system"
        ? Store
        : Bot;
const kindLabel: Record<AgentEvent["kind"], string> = {
  tool_call: "used a tool",
  message: "message",
  webhook: "notification",
  decision: "decision",
  approval: "action",
};

export function EventTimeline({
  events,
  showQuoteLink = false,
}: {
  events: AgentEvent[];
  showQuoteLink?: boolean;
}) {
  return (
    <ol className="divide-y divide-border">
      {events.map((e) => {
        const Icon = icon(e.actor);
        const hasDetails = e.input !== undefined || e.output !== undefined;
        return (
          <li key={e.id} className="flex gap-3 py-4 first:pt-0 last:pb-0">
            <span className="icon-tile">
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="font-semibold">{actorLabel[e.actor]}</span>
                <span className="text-sm text-muted-foreground">{kindLabel[e.kind]}</span>
                {e.tool && (
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                    {e.tool}
                  </code>
                )}
                <time dateTime={e.created_at} className="ml-auto text-xs text-muted-foreground">
                  {fmtDate(e.created_at)}
                </time>
              </div>
              {e.text && (
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                  {e.text}
                </p>
              )}
              {(hasDetails || (showQuoteLink && e.quote_id)) && (
                <div className="mt-2 flex flex-wrap items-center gap-4">
                  {hasDetails && (
                    <JsonBlock
                      label="details"
                      value={{ tool: e.tool, input: e.input, output: e.output }}
                    />
                  )}
                  {showQuoteLink && e.quote_id && (
                    <Link
                      to="/app/quotes/$id"
                      params={{ id: e.quote_id }}
                      className="text-xs font-medium text-link underline underline-offset-4"
                    >
                      Open booking
                    </Link>
                  )}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
