import { createFileRoute } from "@tanstack/react-router";
import { dispatchApi } from "@/server/api-dispatch";

export const Route = createFileRoute("/api/agent-sim/chat")({
  server: {
    handlers: {
      POST: ({ request }) => dispatchApi(request),
    },
  },
});
