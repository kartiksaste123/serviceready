import { createFileRoute } from "@tanstack/react-router";
import { dispatchApi } from "@/server/api-dispatch";

export const Route = createFileRoute("/api/stats")({
  server: {
    handlers: {
      GET: ({ request }) => dispatchApi(request),
    },
  },
});
