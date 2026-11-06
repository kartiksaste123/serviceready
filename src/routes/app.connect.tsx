import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Globe, ShieldCheck } from "lucide-react";
import { api, USE_MOCKS } from "@/lib/api";
import { CopyButton, ErrorState, PageHeader } from "@/components/kit";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/app/connect")({
  head: () => ({
    meta: [
      { title: "Connect AI assistants — ServiceReady" },
      {
        name: "description",
        content: "Connect Claude, ChatGPT and browsers to your services via MCP and WebMCP.",
      },
      { property: "og:title", content: "Connect AI assistants — ServiceReady" },
      { property: "og:description", content: "MCP and WebMCP setup." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Connect,
});

const TOOLS: [string, string][] = [
  ["list_services", "List published services with price, deposit % and lead time."],
  ["get_service", "Get full details and deliverables for one service."],
  [
    "request_quote",
    "Create a quote for a client. Returns an approval link — the client pays the deposit themselves.",
  ],
  ["get_quote_status", "Check where a quote is: awaiting deposit, deposit paid, invoiced or paid."],
  [
    "create_deposit_link",
    "Create the real PayPal sandbox deposit order and return its approval link. The client still pays.",
  ],
];

function Connect() {
  const seller = useQuery({ queryKey: ["seller"], queryFn: api.getSeller });
  const slug = seller.data?.slug;
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["public", slug],
    queryFn: () => api.getPublicStore(slug!),
    enabled: !!slug,
  });
  const url = data?.agent.mcp_url ?? "";
  const name = slug ?? "serviceready";
  const claude = JSON.stringify(
    { mcpServers: { [name]: { command: "npx", args: ["-y", "mcp-remote", url] } } },
    null,
    2,
  );
  const codex = `[mcp_servers.${name}]\nurl = "${url}"`;
  return (
    <>
      <PageHeader
        title="AI assistants"
        sub="Let Claude, ChatGPT or a browser assistant quote your services for clients."
      />
      {isLoading || seller.isLoading ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : isError || seller.isError || !data ? (
        <ErrorState
          title="Couldn't load your connection details"
          onRetry={() => {
            seller.refetch();
            refetch();
          }}
        />
      ) : (
        <div className="space-y-5">
          {USE_MOCKS && (
            <p className="rounded-lg border border-border bg-muted p-4 text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">Mock mode.</span> The MCP server runs
              on the live deploy; this local preview shows the same configuration.
            </p>
          )}
          <section className="glass-card p-5" aria-labelledby="c1">
            <h2 id="c1" className="text-sm font-semibold">
              1. Copy your service connection
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              This MCP server address lets an assistant read your services and request quotes.
            </p>
            <div className="glass-row mt-3 flex items-center gap-2 p-2 pl-4 font-mono text-sm">
              <span className="min-w-0 truncate text-link" title={url}>
                {url}
              </span>
              <CopyButton text={url} label="Copy" className="ml-auto shrink-0" />
            </div>
          </section>
          <section aria-labelledby="c2">
            <h2 id="c2" className="mb-3 text-sm font-semibold">
              2. Add it to your assistant
            </h2>
            <div className="grid gap-5 lg:grid-cols-2">
              {(
                [
                  ["Claude Desktop", "claude_desktop_config.json", claude],
                  ["ChatGPT / Codex", "config.toml", codex],
                ] as const
              ).map(([t, f, c]) => (
                <section key={t} className="glass-card min-w-0 p-5">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold">
                      {t}{" "}
                      <span className="font-mono text-xs font-normal text-muted-foreground">
                        · {f}
                      </span>
                    </h3>
                    <CopyButton text={c} label={`Copy ${t} config`} iconOnly />
                  </div>
                  <pre
                    tabIndex={0}
                    aria-label={`${t} configuration example`}
                    className="overflow-auto rounded-xl bg-muted p-4 font-mono text-sm leading-relaxed text-foreground ringline"
                  >
                    {c}
                  </pre>
                </section>
              ))}
            </div>
          </section>
          <section className="glass-card p-5" aria-labelledby="c3">
            <h2 id="c3" className="mb-1 font-semibold">
              3. What assistants can do
            </h2>
            <p className="mb-3 text-sm text-muted-foreground">
              These are the only actions your connection exposes. Assistants can't change prices,
              move money or message clients.
            </p>
            <div className="divide-y divide-border">
              {TOOLS.map(([n, d]) => (
                <div key={n} className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-6">
                  <code className="w-44 shrink-0 font-mono text-sm text-link">{n}</code>
                  <span className="text-sm text-muted-foreground">{d}</span>
                </div>
              ))}
            </div>
          </section>
          <div className="grid gap-5 lg:grid-cols-2">
            <section className="glass-card flex gap-3 p-5">
              <span className="icon-tile">
                <Globe className="size-4" aria-hidden="true" />
              </span>
              <div>
                <h2 className="font-semibold">Browser assistants work automatically</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Your storefront registers these tools with WebMCP-capable browsers
                  (navigator.modelContext): {data.agent.webmcp_tools.join(", ")}.
                </p>
              </div>
            </section>
            <section className="glass-card flex gap-3 p-5">
              <span className="icon-tile">
                <ShieldCheck className="size-4" aria-hidden="true" />
              </span>
              <div>
                <h2 className="font-semibold">Clients always pay themselves</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Quotes created by assistants link to a secure page where the client reviews scope
                  and pays the PayPal deposit directly.
                </p>
              </div>
            </section>
          </div>
        </div>
      )}
    </>
  );
}
