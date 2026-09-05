// The arithmetic and the decisions behind a stored-card collection, kept pure
// so they can be tested without SumUp or a database. `sumup-finance.ts` does
// the talking; this file decides what is owed and what an old attempt means.

/** SumUp's UK minimum card transaction is £1.00. */
export const MIN_CARD_PENCE = 100;

/**
 * How long a started attempt is presumed to still be running. A run that
 * claimed an attempt and has not finished inside this window is taken to
 * have died; after it, a PENDING checkout is abandoned (nobody will complete
 * it, so it cannot charge anyone) and a fresh attempt may begin.
 */
export const IN_FLIGHT_WINDOW_MS = 15 * 60 * 1000;

export type PaymentLine = { amount_pence: number; refunded_pence: number | null };

/** What is still owed on a charge: its amount less every payment net of refunds. */
export function outstandingPence(amountPence: number, payments: PaymentLine[]): number {
  const paid = payments.reduce((acc, p) => acc + p.amount_pence - (p.refunded_pence ?? 0), 0);
  return amountPence - paid;
}

/** The deterministic reference for an attempt, unique per (charge, attempt). */
export function collectionReference(chargeId: string, attemptNo: number): string {
  return `charge:${chargeId}:auto:${attemptNo}`;
}

export type CheckoutSnapshot = {
  status?: string;
  transactions?: { status?: string }[];
} | null;

/** PAID, or a SUCCESSFUL transaction — the two ways SumUp says "taken". */
export function checkoutIsPaid(checkout: CheckoutSnapshot): boolean {
  if (!checkout) return false;
  const txnSuccessful = (checkout.transactions ?? []).some(
    (t) => (t.status ?? "").toUpperCase() === "SUCCESSFUL",
  );
  return (checkout.status ?? "").toUpperCase() === "PAID" || txnSuccessful;
}

export type AttemptDisposition = "paid" | "failed" | "in_flight" | "abandoned";

/**
 * What an earlier, unfinished attempt turned out to be.
 *
 *   paid       the card was charged; record it, do not charge again
 *   failed     SumUp says FAILED or EXPIRED; the card was not charged
 *   in_flight  not settled and recent — another run may still be on it
 *   abandoned  not settled and old — nobody is completing it; move on
 *
 * `checkout` is null when SumUp holds nothing for the attempt (the run died
 * before the checkout was created), which is decided by age alone.
 */
export function attemptDisposition(params: {
  checkout: CheckoutSnapshot;
  startedAt: string;
  now: number;
}): AttemptDisposition {
  if (checkoutIsPaid(params.checkout)) return "paid";
  const status = (params.checkout?.status ?? "").toUpperCase();
  if (status === "FAILED" || status === "EXPIRED") return "failed";
  const age = params.now - new Date(params.startedAt).getTime();
  return age < IN_FLIGHT_WINDOW_MS ? "in_flight" : "abandoned";
}
