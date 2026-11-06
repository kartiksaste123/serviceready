import { createFileRoute } from "@tanstack/react-router";
import { dispatchApi } from "@/server/api-dispatch";

export const Route = createFileRoute("/api/public/$slug")({
  server: {
    handlers: {
      GET: ({ request }) => dispatchApi(request),
    },
  },
});
