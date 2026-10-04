import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type AuthSession } from "@/lib/api";

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));

vi.mock("@tanstack/react-router", async () => {
  const React = await import("react");
  return {
    createFileRoute: () => (options: Record<string, unknown>) => ({
      ...options,
      options,
      useSearch: () => ({}),
    }),
    Link: ({
      to,
      children,
      ...props
    }: {
      to: unknown;
      children: ReactNode;
      [key: string]: unknown;
    }) =>
      React.createElement(
        "a",
        { ...props, href: typeof to === "string" ? to : "/" },
        children,
      ),
    Outlet: () => null,
    useLocation: () => ({ pathname: "/app" }),
    useNavigate: () => navigateMock,
  };
});

import { Route as HomeRoute } from "@/routes/index";
import { Route as LoginRoute } from "@/routes/login";
import { Route as AppRoute } from "@/routes/app";

const session = {
  user: { id: "user-1", email: "studio@example.com", is_demo: false },
  seller: {
    id: "seller-1",
    name: "Example Studio",
    slug: "example-studio",
    tagline: "",
    email: "studio@example.com",
    currency: "USD",
    rules: {
      default_deposit_pct: 50,
      reminder_tone: "friendly",
      max_reminders: 2,
      wait_days_before_nudge: 3,
    },
  },
} as AuthSession;

function renderRoute(route: { options: { component?: unknown } }) {
  const Component = route.options.component as ComponentType;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Component />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  navigateMock.mockReset();
});

describe("session-aware routes", () => {
  it("shows studio links instead of login on the landing page when authenticated", async () => {
    vi.spyOn(api.auth, "me").mockResolvedValue(session);

    renderRoute(HomeRoute);

    const studioLinks = await screen.findAllByRole("link", { name: /Open my studio/ });
    expect(studioLinks[0]).toHaveAttribute("href", "/app");
    expect(screen.queryByRole("link", { name: "Log in" })).not.toBeInTheDocument();
  });

  it("redirects an authenticated login page visit to the studio", async () => {
    vi.spyOn(api.auth, "me").mockResolvedValue(session);

    renderRoute(LoginRoute);

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({ to: "/app", replace: true });
    });
  });

  it("shows a retry on app auth-check failure without redirecting to login", async () => {
    const me = vi
      .spyOn(api.auth, "me")
      .mockRejectedValueOnce(new Error("Network unavailable"))
      .mockResolvedValue(null);

    renderRoute(AppRoute);

    expect(await screen.findByText("We couldn't check your login.")).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ to: "/login" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(me).toHaveBeenCalledTimes(2));
  });
});
