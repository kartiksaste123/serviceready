import { createFileRoute } from "@tanstack/react-router";
import { dispatchApi } from "@/server/api-dispatch";

export const Route = createFileRoute("/api/proposals/$id/reject")({
  server: {
    handlers: {
      POST: ({ request }) => dispatchApi(request),
    },
  },
});
