import { createFileRoute } from "@tanstack/react-router";
import { dispatchApi } from "@/server/api-dispatch";

export const Route = createFileRoute("/api/paypal/webhook")({
  server: {
    handlers: {
      GET: ({ request }) => dispatchApi(request),
      POST: ({ request }) => dispatchApi(request),
    },
  },
});
