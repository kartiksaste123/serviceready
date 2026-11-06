/**
 * Deposit intent policy (shared by server + mock backend).
 * Large deposits are AUTHORIZED (funds held by PayPal) and only captured when the seller
 * starts work; small deposits are captured immediately. Cancel before start = void (no refund needed).
 */
export type DepositIntent = "CAPTURE" | "AUTHORIZE";

/** Deposits at or above this are held with intent=AUTHORIZE. Override server-side with DEPOSIT_AUTHORIZE_MIN_USD. */
export const DEFAULT_AUTHORIZE_MIN_DEPOSIT_CENTS = 500_00;

export function depositIntentFor(
  depositCents: number,
  minCents: number = DEFAULT_AUTHORIZE_MIN_DEPOSIT_CENTS,
): DepositIntent {
  return minCents > 0 && depositCents >= minCents ? "AUTHORIZE" : "CAPTURE";
}
