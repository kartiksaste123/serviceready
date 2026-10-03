import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Copy, Globe } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/kit";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/app/connect")({
  head: () => ({ meta: [{ title: "Connect agents — ServiceReady" }, { name: "description", content: "Connect Claude, ChatGPT and browsers to your services via MCP and WebMCP." }, { property: "og:title", content: "Connect agents — ServiceReady" }, { property: "og:description", content: "MCP and WebMCP setup." }] }),
  component: Connect,
});

const TOOLS = [
  ["list_services", "List published services with price, deposit % and lead time."],
  ["get_service", "Get full details and deliverables for one service."],
  ["request_quote", "Create a quote for a client. Returns an approval URL — the client pays themselves."],
  ["get_quote_status", "Check where a quote is: quoted, deposit paid, invoiced, paid."],
];

const copy = (t: string) => { navigator.clipboard.writeText(t); toast.success("Copied"); };

function Connect() {
  const { data, isLoading } = useQuery({ queryKey: ["public", "maya-rao-studio"], queryFn: () => api.getPublicStore("maya-rao-studio") });
  const url = data?.agent.mcp_url ?? "";
  const claude = JSON.stringify({ mcpServers: { "maya-rao-studio": { command: "npx", args: ["-y", "mcp-remote", url] } } }, null, 2);
  const codex = `[mcp_servers.maya-rao-studio]\nurl = "${url}"`;
  return (
    <>
      <PageHeader title="Connect agents" sub="Let AI assistants discover, quote and book your services." />
      {isLoading ? <Skeleton className="h-96 rounded-2xl" /> : (
        <div className="space-y-5">
          <section className="glass-card p-5">
            <p className="text-[11px] uppercase tracking-wider text-cream/55">MCP server URL</p>
            <div className="glass-row mt-2 flex items-center gap-2 p-2 pl-4 font-mono text-[13px]"><span className="truncate text-mint">{url}</span><button className="btn-glass btn-sm ml-auto" onClick={() => copy(url)}><Copy className="size-3.5" />Copy</button></div>
          </section>
          <div className="grid gap-5 lg:grid-cols-2">
            {[["Claude Desktop · claude_desktop_config.json", claude], ["ChatGPT / Codex · config.toml", codex]].map(([t, c]) => (
              <section key={t} className="glass-card p-5">
                <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">{t}</h2><button className="btn-glass btn-sm" onClick={() => copy(c ?? '')}><Copy className="size-3.5" /></button></div>
                <pre className="overflow-auto rounded-xl bg-deep-950/80 p-4 font-mono text-[12px] leading-relaxed text-cream/85 ringline">{c}</pre>
              </section>
            ))}
          </div>
          <section className="glass-card p-5">
            <h2 className="mb-3 font-semibold">Tools agents can call</h2>
            <div className="divide-y divide-cream/10">{TOOLS.map(([n, d]) => <div key={n} className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-6"><span className="w-44 shrink-0 font-mono text-[13px] text-mint">{n}</span><span className="text-sm text-cream/70">{d}</span></div>)}</div>
          </section>
          <section className="glass-card flex gap-3 p-5"><span className="icon-tile"><Globe className="size-4" /></span><div><h2 className="font-semibold">WebMCP</h2><p className="mt-1 text-sm text-cream/65">Your public storefront registers the same tools with <span className="font-mono text-[12px]">navigator.modelContext</span>, so browser-based agents can use them directly on the page — no setup needed.</p></div></section>
        </div>
      )}
    </>
  );
}
