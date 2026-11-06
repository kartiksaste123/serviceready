import { createFileRoute } from "@tanstack/react-router";
import { dispatchApi } from "@/server/api-dispatch";

/** Preferred storefront agent endpoint. `/api/agent-sim/chat` remains an alias. */
export const Route = createFileRoute("/api/agent/chat")({
  server: {
    handlers: {
      POST: ({ request }) => dispatchApi(request),
    },
  },
});
