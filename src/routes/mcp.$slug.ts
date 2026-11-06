import { createFileRoute } from "@tanstack/react-router";
import { handleMcp } from "@/server/mcp";

/** MCP Streamable HTTP endpoint for AI agents (Claude, ChatGPT, Cursor…). */
export const Route = createFileRoute("/mcp/$slug")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleMcp(request, params.slug),
      POST: ({ request, params }) => handleMcp(request, params.slug),
      OPTIONS: ({ request, params }) => handleMcp(request, params.slug),
    },
  },
});
