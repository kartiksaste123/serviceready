import { createFileRoute } from "@tanstack/react-router";
import { dispatchApi } from "@/server/api-dispatch";

export const Route = createFileRoute("/api/demo/quotes/$id/pay-balance")({
  server: {
    handlers: {
      POST: ({ request }) => dispatchApi(request),
    },
  },
});
