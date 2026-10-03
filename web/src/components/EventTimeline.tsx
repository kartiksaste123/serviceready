import { Bot, CreditCard, Server, User, UserCheck, Users } from "lucide-react";
import type { AgentEvent } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import { JsonBlock } from "./kit";

const actorIcon: Record<AgentEvent["actor"], typeof Bot> = {
  seller_agent: Bot, client_agent: Users, collections_agent: Bot, system: Server, seller: UserCheck, client: User, paypal: CreditCard,
};

export function EventTimeline({ events }: { events: AgentEvent[] }) {
  return (
    <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-[17px] before:top-2 before:w-px before:bg-cream/10">
      {events.map((e) => {
        const I = actorIcon[e.actor];
        const agent = e.actor.endsWith("agent") || e.actor === "paypal";
        return (
          <li key={e.id} className="relative flex gap-3">
            <span className={`relative z-10 grid size-9 shrink-0 place-items-center rounded-full ${agent ? "bg-deep-800 text-mint" : "bg-deep-700 text-cream"} ringline`}><I className="size-4" /></span>
            <div className="min-w-0 flex-1 pt-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
                <span className="font-semibold">{e.actor.replace("_", " ")}</span>
                <span className="rounded bg-cream/[0.06] px-1.5 text-[11px] text-cream/65">{e.kind}</span>
                {e.tool && <span className="font-mono text-[12px] text-mint">{e.tool}</span>}
                <span className="ml-auto tabular-nums text-cream/45">{fmtDate(e.created_at)}</span>
              </div>
              {e.text && <p className="mt-1 whitespace-pre-wrap text-sm text-cream/80">{e.text}</p>}
              <div className="mt-1 flex flex-wrap gap-4"><JsonBlock label="input" value={e.input} /><JsonBlock label="output" value={e.output} /></div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
