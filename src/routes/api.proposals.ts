import { createFileRoute } from "@tanstack/react-router";
import { dispatchApi } from "@/server/api-dispatch";

export const Route = createFileRoute("/api/proposals")({
  server: {
    handlers: {
      GET: ({ request }) => dispatchApi(request),
    },
  },
});
