import { createFileRoute } from "@tanstack/react-router";
import { dispatchApi } from "@/server/api-dispatch";

export const Route = createFileRoute("/api/seller")({
  server: {
    handlers: {
      GET: ({ request }) => dispatchApi(request),
    },
  },
});
