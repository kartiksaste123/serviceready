import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BookingsGrid } from "@/components/BookingsGrid";
import { StatusTracker } from "@/components/StatusTracker";
import { PayPalDepositButton } from "@/components/PayPalDepositButton";
import { ProposalCard } from "@/components/ProposalCard";
import * as mock from "@/lib/mock";

afterEach(cleanup);
beforeEach(() => mock.__resetForTests());

describe("booking accessibility", () => {
  it("supports keyboard opening a booking table row", async () => {
    const q = (await mock.getQuote("q_jordan")).quote;
    const open = vi.fn();
    render(<BookingsGrid rows={[q]} onOpen={open} />);
    fireEvent.keyDown(screen.getByRole("row", { name: /Open booking for Jordan/ }), {
      key: "Enter",
    });
    expect(open).toHaveBeenCalledWith(q.id);
  });
  it("makes cancellation explicit, not a normal progress tracker", () => {
    render(<StatusTracker status="cancelled" />);
    expect(screen.getByRole("status")).toHaveTextContent("Cancelled");
    expect(screen.queryByRole("list", { name: "Booking progress" })).not.toBeInTheDocument();
  });
  it("marks the active booking step for assistive technology", () => {
    render(<StatusTracker status="deposit_paid" />);
    expect(screen.getByText("Deposit paid", { exact: false }).closest("li")).toHaveAttribute(
      "aria-current",
      "step",
    );
  });
});

describe("PayPal buyer approval", () => {
  it("never captures before the buyer approves the checkout", async () => {
    const onPaid = vi.fn();
    render(<PayPalDepositButton quoteId="q_jordan" onPaid={onPaid} />);
    fireEvent.click(screen.getByRole("button", { name: "Pay deposit with PayPal" }));
    await screen.findByRole("dialog");
    expect((await mock.getQuote("q_jordan")).quote.status).toBe("quoted");
    fireEvent.click(screen.getByRole("button", { name: "Approve & pay" }));
    await waitFor(() => expect(onPaid).toHaveBeenCalledOnce());
    expect((await mock.getQuote("q_jordan")).quote.status).toBe("deposit_paid");
  });
  it("allows cancellation without taking the deposit", async () => {
    render(<PayPalDepositButton quoteId="q_jordan" />);
    fireEvent.click(screen.getByRole("button", { name: "Pay deposit with PayPal" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect((await mock.getQuote("q_jordan")).quote.status).toBe("quoted");
  });
});

describe("approval safety", () => {
  it("blocks approving an empty client message", async () => {
    const p = (await mock.listProposals("pending"))[0]!;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ProposalCard p={p} showClient={false} />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Approve & send" })).toBeDisabled();
  });
});
