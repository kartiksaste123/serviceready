import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type AuthChallenge, type AuthSession } from "@/lib/api";
import type { PublicStore } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  getTourStage: vi.fn(),
  setTourStage: vi.fn(),
  startOnboardTour: vi.fn(),
  startStudioTour: vi.fn(),
  driver: { destroy: vi.fn() },
}));

vi.mock("@tanstack/react-router", async () => {
  const React = await import("react");
  return {
    createFileRoute: () => (options: Record<string, unknown>) => ({
      ...options,
      options,
      useSearch: () => ({}),
      useParams: () => ({ slug: "maya-rao-studio" }),
    }),
    Link: ({
      to,
      children,
      activeOptions: _activeOptions,
      activeProps: _activeProps,
      ...props
    }: {
      to: unknown;
      children: ReactNode;
      activeOptions?: unknown;
      activeProps?: unknown;
      [key: string]: unknown;
    }) =>
      React.createElement(
        "a",
        { ...props, href: typeof to === "string" ? to : "/" },
        children,
      ),
    Outlet: () => null,
    useLocation: () => ({ pathname: "/app" }),
    useNavigate: () => mocks.navigate,
  };
});

vi.mock("@/lib/tour", () => ({
  getTourStage: mocks.getTourStage,
  setTourStage: mocks.setTourStage,
  startOnboardTour: mocks.startOnboardTour,
  startStudioTour: mocks.startStudioTour,
}));

vi.mock("@/components/AuthCode", async () => {
  const React = await import("react");
  return {
    AuthCode: ({ onSubmit }: { onSubmit: (code: string) => Promise<void> }) =>
      React.createElement(
        "button",
        { onClick: () => void onSubmit("123456") },
        "Submit code",
      ),
  };
});

import { Route as AppRoute } from "@/routes/app";
import { Route as SignupRoute } from "@/routes/signup";
import { Route as StorefrontRoute } from "@/routes/s.$slug";

function session(isDemo: boolean): AuthSession {
  return {
    user: { id: isDemo ? "user_demo" : "user-new", email: "studio@example.com", is_demo: isDemo },
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
  };
}

function renderRoute(route: { options: { component?: unknown } }) {
  const Component = route.options.component as ComponentType;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Component />
    </QueryClientProvider>,
  );
}

const store: PublicStore = {
  seller: { name: "Maya Rao Studio", slug: "maya-rao-studio", tagline: "Brand design" },
  services: [
    {
      id: "svc-logo",
      title: "Logo design",
      description: "A custom logo",
      deliverables: ["Logo files"],
      price_cents: 45000,
      deposit_pct: 50,
      lead_time_days: 7,
      status: "published",
    },
  ],
  agent: { mcp_url: "https://example.test/mcp", webmcp_tools: [] },
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.startStudioTour.mockReturnValue(mocks.driver);
});

describe("tutorial triggers", () => {
  it("sets the onboarding stage for the user returned from signup verification", async () => {
    const challenge: AuthChallenge = {
      challenge_id: "challenge-1",
      purpose: "verify",
      email_hint: "st***@example.com",
    };
    vi.spyOn(api.auth, "me").mockResolvedValue(null);
    vi.spyOn(api.auth, "signup").mockResolvedValue(challenge);
    vi.spyOn(api.auth, "verify").mockResolvedValue(session(false));

    renderRoute(SignupRoute);

    fireEvent.change(screen.getByLabelText("Studio or business name"), {
      target: { value: "Example Studio" },
    });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "studio@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/Password/), {
      target: { value: "a-strong-password" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Create account" }).closest("form")!);
    fireEvent.click(await screen.findByRole("button", { name: "Submit code" }));

    await waitFor(() => expect(mocks.setTourStage).toHaveBeenCalledWith("user-new", "onboard"));
  });

  it("does not auto-start the studio tour for the demo account", async () => {
    vi.spyOn(api.auth, "me").mockResolvedValue(session(true));
    mocks.getTourStage.mockReturnValue(null);

    renderRoute(AppRoute);

    await screen.findAllByRole("button", { name: "Show tutorial" });
    expect(mocks.startStudioTour).not.toHaveBeenCalled();
  });

  it("auto-starts the studio tour for a non-demo account at the studio stage", async () => {
    vi.spyOn(api.auth, "me").mockResolvedValue(session(false));
    vi.spyOn(api, "listProposals").mockResolvedValue([]);
    vi.spyOn(api, "getStats").mockResolvedValue({
      deposits_collected_cents: 0,
      outstanding_cents: 0,
      paid_cents: 0,
      avg_days_to_pay: null,
      by_status: {
        quoted: 0,
        deposit_paid: 0,
        delivered: 0,
        balance_invoiced: 0,
        paid: 0,
        cancelled: 0,
      },
      owed_by_client: [],
    });
    mocks.getTourStage.mockReturnValue("studio");

    renderRoute(AppRoute);

    await waitFor(() => expect(mocks.startStudioTour).toHaveBeenCalledOnce());
    expect(mocks.startStudioTour).toHaveBeenCalledWith(expect.objectContaining({ onDone: expect.any(Function) }));
  });

  it("starts the studio tour from the sidebar launcher for the demo account", async () => {
    vi.spyOn(api.auth, "me").mockResolvedValue(session(true));
    mocks.getTourStage.mockReturnValue(null);

    renderRoute(AppRoute);

    const launchers = await screen.findAllByRole("button", { name: "Show tutorial" });
    fireEvent.click(launchers[0]!);

    expect(mocks.startStudioTour).toHaveBeenCalledOnce();
    expect(mocks.setTourStage).not.toHaveBeenCalled();
  });

  it("shows the mobile assistant shortcut after storefront services load", async () => {
    vi.spyOn(api, "getPublicStore").mockResolvedValue(store);

    renderRoute(StorefrontRoute);

    expect(
      await screen.findByRole("button", { name: "Ask the AI assistant" }),
    ).toBeInTheDocument();
  });
});
