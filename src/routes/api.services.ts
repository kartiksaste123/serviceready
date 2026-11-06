import { createFileRoute } from "@tanstack/react-router";
import { dispatchApi } from "@/server/api-dispatch";

export const Route = createFileRoute("/api/services")({
  server: {
    handlers: {
      GET: ({ request }) => dispatchApi(request),
    },
  },
});
