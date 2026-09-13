/**
 * The club's room-hire payment terms, in one place (Adam, 2026-09-13):
 *
 *   1. A NON-REFUNDABLE deposit secures the room: half the room hire, capped
 *      (£100 by default). It is paid first — the confirmation is subject to
 *      it, and a confirmed booking whose deposit is not paid by its deadline
 *      is cancelled.
 *   2. The BALANCE, plus any REFUNDABLE security deposit (an 18th birthday
 *      carries one), is due at least two weeks before the event.
 *
 * Money against a booking is one ledger (`payments`), and since
 * 20260913140000 each row says what it was for (`purpose`): the security
 * deposit is held, not earned, so it never counts towards the hire being
 * paid, and the hire never counts towards the security deposit being held.
 *
 * Pure functions, shared by the portal, the desk, the cron and the emails.
 */

import { formatCurrency } from "@/lib/utils";

export type PaymentPurpose = "deposit" | "balance" | "security_deposit";

export const PAYMENT_PURPOSES: readonly PaymentPurpose[] = ["deposit", "balance", "security_deposit"];

export function isPaymentPurpose(value: unknown): value is PaymentPurpose {
  return typeof value === "string" && (PAYMENT_PURPOSES as readonly string[]).includes(value);
}

export type LedgerRow = {
  amount_pence: number | null;
  refunded_pence?: number | null;
  purpose?: string | null;
};

/** Net money paid towards the HIRE — the deposit and the balance, not the security deposit. */
export function sumHirePaid(rows: readonly LedgerRow[]): number {
  return rows.reduce(
    (acc, p) =>
      p.purpose === "security_deposit"
        ? acc
        : acc + Number(p.amount_pence ?? 0) - Number(p.refunded_pence ?? 0),
    0,
  );
}

/** Net security deposit held — paid in, less anything refunded on the row. */
export function sumSecurityPaid(rows: readonly LedgerRow[]): number {
  return rows.reduce(
    (acc, p) =>
      p.purpose === "security_deposit"
        ? acc + Number(p.amount_pence ?? 0) - Number(p.refunded_pence ?? 0)
        : acc,
    0,
  );
}

export type DepositRule = {
  /** Share of the room hire the deposit is, in whole percent (50 = half). */
  percent: number;
  /** The most the deposit can be, in pence (10000 = £100). 0 = no cap. */
  capPence: number;
};

/**
 * The deposit for a booking: `percent` of the room hire, no more than the
 * cap. The room hire is `base_hire_pence` where the public form recorded it;
 * an older row, or one the desk priced by hand, has only a total, and that
 * stands in. Whole pence, never negative.
 */
export function bookingDepositPence(
  booking: { base_hire_pence?: number | null; total_pence?: number | null },
  rule: DepositRule,
): number {
  const hire =
    Number(booking.base_hire_pence ?? 0) > 0 ? Number(booking.base_hire_pence) : Number(booking.total_pence ?? 0);
  if (hire <= 0) return 0;
  const pct = Number.isFinite(rule.percent) ? Math.min(100, Math.max(0, rule.percent)) : 0;
  const share = Math.round((hire * pct) / 100);
  return rule.capPence > 0 ? Math.min(share, rule.capPence) : share;
}

/** "half the room hire, up to £100" — the rule in words. */
export function depositRuleLabel(rule: DepositRule): string {
  const share =
    rule.percent === 50
      ? "half the room hire"
      : rule.percent === 100
        ? "the room hire in full"
        : `${rule.percent}% of the room hire`;
  return rule.capPence > 0 ? `${share}, up to ${formatCurrency(rule.capPence)}` : share;
}

/**
 * The rule in one sentence, for a quote, the public form and the portal —
 * before there is a figure to put on it.
 */
export function hireTermsSummary(rule: DepositRule): string {
  return (
    `To secure the room a non-refundable deposit of ${depositRuleLabel(rule)} is paid first. ` +
    "The balance, plus any refundable security deposit, is due at least two weeks before the event."
  );
}

/** The club's deposit rule, read from its settings. */
export function depositRuleFrom(settings: { deposit_percent: string; deposit_default_pence: string }): DepositRule {
  return {
    percent: Number(settings.deposit_percent) || 0,
    capPence: Number(settings.deposit_default_pence) || 0,
  };
}

/**
 * The terms as one paragraph, for the confirmation email and the portal.
 * Says only what applies: a booking with no security deposit is not told
 * about one, and a deposit already paid is not asked for again.
 */
export function paymentTermsText(input: {
  depositPence: number;
  depositDueLabel: string | null;
  depositPaid: boolean;
  balancePence: number;
  balanceDueLabel: string | null;
  securityDepositPence: number;
}): string {
  const parts: string[] = [];
  if (input.depositPence > 0) {
    parts.push(
      input.depositPaid
        ? `Your non-refundable deposit of ${formatCurrency(input.depositPence)} has been received — the room is secured for you.`
        : `A non-refundable deposit of ${formatCurrency(input.depositPence)} secures the room${
            input.depositDueLabel ? ` and is due by ${input.depositDueLabel}` : ""
          }; the booking is confirmed subject to it.`,
    );
  }
  const owed: string[] = [];
  if (input.balancePence > 0) owed.push(`the balance of ${formatCurrency(input.balancePence)}`);
  if (input.securityDepositPence > 0) {
    owed.push(`a refundable security deposit of ${formatCurrency(input.securityDepositPence)}, returned after the event if all is well`);
  }
  if (owed.length > 0) {
    parts.push(
      `${owed.join(", plus ")} ${owed.length > 1 ? "are" : "is"} due${
        input.balanceDueLabel ? ` by ${input.balanceDueLabel}` : ""
      }, at least two weeks before your event.`,
    );
  }
  return parts.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(" ");
}
