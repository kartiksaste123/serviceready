import { createFileRoute } from "@tanstack/react-router";
import { dispatchApi } from "@/server/api-dispatch";

export const Route = createFileRoute("/api/quotes/$id/deposit/capture")({
  server: {
    handlers: {
      POST: ({ request }) => dispatchApi(request),
    },
  },
});
