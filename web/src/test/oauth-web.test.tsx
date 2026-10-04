import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type AuthSession } from "@/lib/api";
import type { PublicStore } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  assign: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const React = await import("react");
  return {
    createFileRoute: () => (options: Record<string, unknown>) => ({
      ...options,
      options,
      useSearch: () => ({ request: "oar_test" }),
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
    useNavigate: () => mocks.navigate,
  };
});

import { Route as AuthorizeRoute } from "@/routes/authorize";
import { Route as ConnectRoute } from "@/routes/app.connect";

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

const store: PublicStore = {
  seller: { name: "Example Studio", slug: "example-studio", tagline: "Studio work" },
  services: [],
  agent: { mcp_url: "https://example.test/mcp", webmcp_tools: [] },
};

function renderRoute(route: { options: { component?: unknown } }) {
  const Component = route.options.component as ComponentType;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Component />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("location", { assign: mocks.assign });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("OAuth web flows", () => {
  it("assigns the authorization redirect URL after allowing consent", async () => {
    vi.spyOn(api.auth, "me").mockResolvedValue(session);
    vi.spyOn(api.oauth, "getRequest").mockResolvedValue({
      client_name: "Claude",
      redirect_host: "claude.ai",
      studio_name: "Example Studio",
      scopes: ["studio", "offline_access"],
    });
    vi.spyOn(api.oauth, "decideRequest").mockResolvedValue({
      redirect_url: "https://claude.ai/api/mcp/auth_callback?code=approved",
    });

    renderRoute(AuthorizeRoute);

    expect(await screen.findByRole("heading", { name: /Claude wants full control of Example Studio/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));

    await waitFor(() => {
      expect(mocks.assign).toHaveBeenCalledWith(
        "https://claude.ai/api/mcp/auth_callback?code=approved",
      );
    });
  });

  it("shows seller and public MCP connection sections", async () => {
    vi.spyOn(api, "getSeller").mockResolvedValue(session.seller);
    vi.spyOn(api, "getPublicStore").mockResolvedValue(store);
    vi.spyOn(api.oauth, "listGrants").mockResolvedValue([]);

    renderRoute(ConnectRoute);

    expect(
      await screen.findByRole("heading", { name: "Manage your studio from Claude (sign-in)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Let clients' assistants book you (no sign-in)" }),
    ).toBeInTheDocument();
    expect(screen.getByText("No assistants connected yet.")).toBeInTheDocument();
    expect(screen.getByText("https://example.test/mcp/seller")).toBeInTheDocument();
    expect(screen.getByText("https://example.test/mcp")).toBeInTheDocument();
  });
});
