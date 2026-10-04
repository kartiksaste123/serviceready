import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { AuthShell } from "@/components/AuthShell";
import { Skeleton } from "@/components/ui/skeleton";
import { api, safeRedirect } from "@/lib/api";

export const Route = createFileRoute("/authorize")({
  validateSearch: (search: Record<string, unknown>): { request?: string } => {
    const request = search["request"];
    return typeof request === "string" ? { request } : {};
  },
  head: () => ({ meta: [{ title: "Connect Claude — ServiceReady" }] }),
  component: Authorize,
});

function Authorize() {
  const navigate = useNavigate();
  const { request } = Route.useSearch();
  const account = useQuery({ queryKey: ["me"], queryFn: api.auth.me });
  const consent = useQuery({
    queryKey: ["oauth-request", request],
    queryFn: () => api.oauth.getRequest(request!),
    enabled: Boolean(request && account.data),
    retry: false,
  });
  const decision = useMutation({
    mutationFn: (allow: boolean) => api.oauth.decideRequest(request!, allow),
    onSuccess: ({ redirect_url }) => window.location.assign(redirect_url),
  });

  useEffect(() => {
    if (account.data !== null || !request) return;
    const redirect = safeRedirect(`/authorize?request=${encodeURIComponent(request)}`);
    void navigate({
      to: "/login",
      ...(redirect ? { search: { redirect } } : {}),
      replace: true,
    });
  }, [account.data, navigate, request]);

  const redirectHost = (value: string) => value;

  return (
    <AuthShell>
      {account.isLoading ? (
        <Skeleton className="h-72 rounded-xl" />
      ) : account.isError ? (
        <div className="space-y-3 text-center">
          <h1 className="text-xl font-semibold">Couldn&apos;t check your sign-in</h1>
          <p className="text-sm text-muted-foreground">Please reload this page and try again.</p>
        </div>
      ) : account.data === null ? (
        <Skeleton className="h-72 rounded-xl" />
      ) : consent.isLoading ? (
        <Skeleton className="h-72 rounded-xl" />
      ) : !request || consent.isError || !consent.data ? (
        <div className="space-y-3 text-center">
          <h1 className="text-xl font-semibold">Connection link expired</h1>
          <p className="text-sm text-muted-foreground">
            This sign-in link expired. Start the connection again from Claude.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              ServiceReady authorization
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">
              <span className="font-bold">{consent.data.client_name}</span> wants full control of{" "}
              <span className="font-bold">{consent.data.studio_name}</span>
            </h1>
          </div>
          <section className="rounded-xl border border-border bg-muted p-4">
            <h2 className="text-sm font-semibold">With your permission, Claude can</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>Read your bookings and payment progress.</li>
              <li>Approve or reject suggestions.</li>
              <li>Mark work delivered, send balance invoices, and run collection checks.</li>
              <li>Record client replies, create quotes, edit and publish services, and update studio rules.</li>
            </ul>
          </section>
          <section className="space-y-2 text-sm text-muted-foreground">
            <p>Claude never sees card or bank details.</p>
            <p>Clients still pay you through PayPal.</p>
            <p>Redirects to {redirectHost(consent.data.redirect_host)}.</p>
          </section>
          {decision.isError && (
            <p className="text-sm text-danger" role="alert">
              {decision.error instanceof Error ? decision.error.message : "Couldn't save your decision."}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              className="btn-glass"
              disabled={decision.isPending}
              onClick={() => decision.mutate(false)}
            >
              Cancel
            </button>
            <button
              className="btn-primary"
              disabled={decision.isPending}
              onClick={() => decision.mutate(true)}
            >
              {decision.isPending ? "Connecting…" : "Allow"}
            </button>
          </div>
        </div>
      )}
    </AuthShell>
  );
}
