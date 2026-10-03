import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Copy, Globe } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/kit";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/app/connect")({
  head: () => ({
    meta: [
      { title: "Connect agents — ServiceReady" },
      { name: "description", content: "Connect AI assistants to your services over MCP." },
      { property: "og:title", content: "Connect agents — ServiceReady" },
      { property: "og:description", content: "MCP setup for AI assistants." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Connect,
});

const TOOLS = [
  ["list_services", "List published services with price, deposit % and lead time."],
  ["get_service", "Get full details and deliverables for one service."],
  [
    "request_quote",
    "Create a quote for a client. Returns an approval URL — the client pays themselves.",
  ],
  ["get_quote_status", "Check where a quote is: quoted, deposit paid, invoiced, paid."],
];

const PROMPTS = [
  "Get me a quote for a logo for my bakery. My email is sam@bakery.com",
  "What's the status of my quote?",
];

const copy = (t: string) => {
  navigator.clipboard.writeText(t);
  toast.success("Copied");
};

function Connect() {
  const { data: seller, isLoading: sellerLoading } = useQuery({
    queryKey: ["seller"],
    queryFn: api.getSeller,
  });
  const { data, isLoading } = useQuery({
    queryKey: ["public", seller?.slug],
    queryFn: () => api.getPublicStore(seller!.slug),
    enabled: Boolean(seller?.slug),
  });
  const url = data?.agent.mcp_url ?? "";
  const slug = seller?.slug ?? "studio";
  const prompts = [`What services does ${seller?.name ?? "my studio"} offer?`, ...PROMPTS];
  const claude = JSON.stringify(
    { mcpServers: { [slug]: { command: "npx", args: ["-y", "mcp-remote", url] } } },
    null,
    2,
  );
  const codex = `[mcp_servers.${slug}]\nurl = "${url}"`;
  return (
    <>
      <PageHeader
        title="Connect AI assistants"
        sub="Give Claude, ChatGPT or a browser assistant access to your published services."
      />
      {sellerLoading || isLoading ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : (
        <div className="min-w-0 space-y-5">
          <section className="glass-card min-w-0 p-5">
            <p className="text-sm font-semibold">1. Copy your service connection</p>
            <p className="mt-1 text-sm text-muted-foreground">
              This MCP address lets an assistant read your services and prepare quotes.
            </p>
            <div className="glass-row mt-3 flex min-w-0 items-center gap-2 p-2 pl-4 font-mono text-sm">
              <span className="min-w-0 flex-1 break-all text-link">{url}</span>
              <button className="btn-glass btn-sm ml-auto" onClick={() => copy(url)}>
                <Copy className="size-3.5" />
                Copy
              </button>
            </div>
          </section>
          <section>
            <h2 className="mb-3 text-sm font-semibold">2. Add it to your assistant</h2>
            <div className="grid min-w-0 gap-5 lg:grid-cols-2">
              <section className="glass-card min-w-0 p-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="min-w-0 text-sm font-semibold">
                    Claude Desktop · claude_desktop_config.json
                  </h2>
                  <button className="btn-glass btn-sm shrink-0" onClick={() => copy(claude)}>
                    <Copy className="size-3.5" />
                  </button>
                </div>
                <pre className="code-box min-w-0 max-w-full overflow-x-auto leading-relaxed">
                  {claude}
                </pre>
              </section>
              <div className="grid min-w-0 content-start gap-5">
                <section className="glass-card min-w-0 p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-sm font-semibold">ChatGPT / Codex · config.toml</h2>
                    <button className="btn-glass btn-sm" onClick={() => copy(codex)}>
                      <Copy className="size-3.5" />
                    </button>
                  </div>
                  <pre className="code-box min-w-0 max-w-full overflow-x-auto leading-relaxed">
                    {codex}
                  </pre>
                </section>
                <section className="glass-card min-w-0 p-5">
                  <h2 className="font-semibold">Try it</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Copy a prompt into your connected assistant.
                  </p>
                  <div className="mt-3 space-y-2">
                    {prompts.map((prompt) => (
                      <div
                        key={prompt}
                        className="glass-row flex min-w-0 items-center gap-2 p-3"
                      >
                        <p className="min-w-0 flex-1 break-words text-sm">{prompt}</p>
                        <button
                          className="btn-glass btn-sm shrink-0"
                          aria-label="Copy prompt"
                          onClick={() => copy(prompt)}
                        >
                          <Copy className="size-3.5" />
                          <span className="sr-only">Copy</span>
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </div>
          </section>
          <section className="glass-card min-w-0 p-5">
            <h2 className="mb-1 font-semibold">3. Choose what assistants can do</h2>
            <p className="mb-3 text-sm text-muted-foreground">
              These MCP actions are available to connected assistants. Clients still pay for
              themselves.
            </p>
            <div className="divide-y divide-border">
              {TOOLS.map(([n, d]) => (
                <div key={n} className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-6">
                  <span className="w-44 shrink-0 font-mono text-sm text-link">{n}</span>
                  <span className="text-sm text-muted-foreground">{d}</span>
                </div>
              ))}
            </div>
          </section>
          <section className="glass-card flex min-w-0 gap-3 p-5">
            <span className="icon-tile">
              <Globe className="size-4" />
            </span>
            <div className="min-w-0">
              <h2 className="font-semibold">Browser assistants</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                WebMCP tool registration is not implemented yet. Connect browser assistants through
                the MCP URL above.
              </p>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
