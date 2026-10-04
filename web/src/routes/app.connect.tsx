import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Globe, Unplug } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/kit";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/app/connect")({
  head: () => ({
    meta: [
      { title: "Connect agents — ServiceReady" },
      { name: "description", content: "Connect Claude to manage your studio or share a public booking link." },
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

const copy = (text: string) => {
  void navigator.clipboard.writeText(text);
  toast.success("Copied");
};

function when(value: string | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function Connect() {
  const queryClient = useQueryClient();
  const { data: seller, isLoading: sellerLoading } = useQuery({
    queryKey: ["seller"],
    queryFn: api.getSeller,
  });
  const { data, isLoading } = useQuery({
    queryKey: ["public", seller?.slug],
    queryFn: () => api.getPublicStore(seller!.slug),
    enabled: Boolean(seller?.slug),
  });
  const grants = useQuery({
    queryKey: ["oauth-grants"],
    queryFn: api.oauth.listGrants,
  });
  const disconnect = useMutation({
    mutationFn: api.oauth.revokeGrant,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["oauth-grants"] });
      toast.success("Assistant disconnected");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Couldn't disconnect assistant."),
  });

  const publicUrl = data?.agent.mcp_url ?? "";
  const sellerUrl = publicUrl ? `${publicUrl.replace(/\/+$/, "")}/seller` : "";
  const slug = seller?.slug ?? "studio";
  const sellerCodex = `[mcp_servers.${slug}_seller]\nurl = "${sellerUrl}"`;
  const publicCodex = `[mcp_servers.${slug}_public]\nurl = "${publicUrl}"`;
  const codex = `${sellerCodex}\n\n${publicCodex}`;
  const prompts = [
    "Who owes me money?",
    "Approve the pending reminder",
    "Change the Logo price to $500",
  ];
  const clientPrompts = [`What services does ${seller?.name ?? "my studio"} offer?`, ...PROMPTS];

  return (
    <>
      <PageHeader
        title="Connect AI assistants"
        sub="Choose whether an assistant manages your studio or helps clients request quotes."
      />
      {sellerLoading || isLoading ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : (
        <div className="min-w-0 space-y-5">
          <section className="glass-card min-w-0 space-y-4 p-5">
            <div>
              <h2 className="font-semibold">Manage your studio from Claude (sign-in)</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Claude can manage only your studio after you sign in and approve access.
              </p>
            </div>
            <div className="glass-row flex min-w-0 items-center gap-2 p-2 pl-4 font-mono text-sm">
              <span className="min-w-0 flex-1 break-all text-link">{sellerUrl}</span>
              <button className="btn-glass btn-sm ml-auto shrink-0" onClick={() => copy(sellerUrl)}>
                <Copy className="size-3.5" />
                Copy
              </button>
            </div>
            <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
              <li>
                In Claude, open <span className="font-medium text-foreground">Customize → Connectors → Add custom connector</span> and paste this URL.
              </li>
              <li>
                Choose Authentication: <span className="font-medium text-foreground">Sign in now</span>. For OAuth client, choose <span className="font-medium text-foreground">Use Claude&apos;s published identity</span>, then click Add and Connect.
              </li>
              <li>
                Sign in to ServiceReady with your email code, review the access, and click Allow.
              </li>
            </ol>
            <div>
              <p className="text-sm font-medium">Try asking Claude</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {prompts.map((prompt) => (
                  <button
                    key={prompt}
                    className="glass-row px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => copy(prompt)}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Claude Desktop uses the same connector settings as claude.ai.
            </p>
          </section>

          <section className="glass-card min-w-0 p-5">
            <div className="mb-3">
              <h2 className="font-semibold">Connected assistants</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Disconnect an assistant at any time to revoke its access tokens.
              </p>
            </div>
            {grants.isLoading ? (
              <Skeleton className="h-20 rounded-xl" />
            ) : grants.data?.length ? (
              <div className="divide-y divide-border">
                {grants.data.map((grant) => (
                  <div
                    key={grant.id}
                    className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">{grant.client_name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Connected {when(grant.created_at)} · Last used {when(grant.last_used_at)}
                      </p>
                    </div>
                    <button
                      className="btn-glass btn-sm self-start sm:self-auto"
                      disabled={disconnect.isPending}
                      onClick={() => disconnect.mutate(grant.id)}
                    >
                      <Unplug className="size-3.5" />
                      Disconnect
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-xl border border-border bg-muted px-4 py-5 text-sm text-muted-foreground">
                No assistants connected yet.
              </p>
            )}
          </section>

          <section className="glass-card min-w-0 space-y-4 p-5">
            <div>
              <h2 className="font-semibold">Let clients&apos; assistants book you (no sign-in)</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Share this public link so clients&apos; assistants can find services and request quotes. They cannot manage your studio.
              </p>
            </div>
            <div className="glass-row flex min-w-0 items-center gap-2 p-2 pl-4 font-mono text-sm">
              <span className="min-w-0 flex-1 break-all text-link">{publicUrl}</span>
              <button className="btn-glass btn-sm ml-auto shrink-0" onClick={() => copy(publicUrl)}>
                <Copy className="size-3.5" />
                Copy
              </button>
            </div>
            <p className="text-sm text-muted-foreground">
              Add the connector with Authentication: <span className="font-medium text-foreground">No sign-in</span>.
            </p>
            <div className="divide-y divide-border">
              {TOOLS.map(([name, description]) => (
                <div key={name} className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-6">
                  <span className="w-44 shrink-0 font-mono text-sm text-link">{name}</span>
                  <span className="text-sm text-muted-foreground">{description}</span>
                </div>
              ))}
            </div>
            <div>
              <p className="text-sm font-medium">Example client prompts</p>
              <div className="mt-2 space-y-2">
                {clientPrompts.map((prompt) => (
                  <div key={prompt} className="glass-row flex items-center gap-2 p-3">
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
            </div>
          </section>

          <section className="glass-card min-w-0 p-5">
            <div className="mb-2 flex items-center gap-2">
              <Globe className="size-4" />
              <h2 className="font-semibold">Codex / ChatGPT · config.toml</h2>
            </div>
            <p className="mb-3 text-sm text-muted-foreground">
              Keep both MCP servers configured. The seller URL signs in; the public URL does not.
            </p>
            <div className="relative">
              <button className="btn-glass btn-sm absolute right-2 top-2" onClick={() => copy(codex)}>
                <Copy className="size-3.5" />
                Copy
              </button>
              <pre className="code-box max-w-full overflow-x-auto pr-24 leading-relaxed">
                {codex}
              </pre>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
