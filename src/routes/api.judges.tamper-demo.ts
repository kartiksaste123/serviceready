import { createFileRoute } from "@tanstack/react-router";
import { dispatchApi } from "@/server/api-dispatch";

export const Route = createFileRoute("/api/judges/tamper-demo")({
  server: {
    handlers: {
      GET: ({ request }) => dispatchApi(request),
      POST: ({ request }) => dispatchApi(request),
    },
  },
});
