import type { Enums } from "@club/db";

import { humaniseEnum, poundsFromPence } from "./format";

/**
 * Shaping for the subs tab, over the `subscription_arrears` view (P4.1). The
 * view already nets refunds off and only reveals a name the caller is allowed
 * to see, so the app never recomputes money — it formats what the database
 * says. Pure; tested in lib/subs.test.ts.
 */

export interface ArrearsRow {
  subscription_id: string | null;
  person_id: string | null;
  person_name: string | null;
  payer_person_id: string | null;
  plan_id: string | null;
  plan_name: string | null;
  team_name: string | null;
  status: Enums<"subscription_status"> | null;
  amount_due_pence: number | null;
  paid_pence: number | null;
  outstanding_pence: number | null;
  days_since_start: number | null;
  started_at: string | null;
}

export interface Arrears {
  subscriptionId: string;
  personId: string | null;
  personName: string;
  planName: string;
  teamName: string | null;
  status: Enums<"subscription_status">;
  outstandingPence: number;
  paidPence: number;
  amountDuePence: number;
  daysSinceStart: number | null;
  /** True when the signed-in person is the one Stripe should charge. */
  payableByMe: boolean;
  /**
   * `stripe-checkout` only accepts a `pending` subscription, so the Pay button
   * is offered exactly when the Edge Function would accept it.
   */
  canCheckout: boolean;
}

/** Ordinary rows first (most overdue first), settled rows last. */
export function toArrears(
  rows: ArrearsRow[],
  myPersonId: string | null,
): Arrears[] {
  return rows
    .flatMap<Arrears>((row) => {
      if (!row.subscription_id) return [];
      const outstanding = row.outstanding_pence ?? 0;
      const status = row.status ?? "pending";
      const payableByMe =
        myPersonId !== null && row.payer_person_id === myPersonId;
      return [
        {
          subscriptionId: row.subscription_id,
          personId: row.person_id,
          personName: row.person_name ?? "A club member",
          planName: row.plan_name ?? "Subscription",
          teamName: row.team_name,
          status,
          outstandingPence: outstanding,
          paidPence: row.paid_pence ?? 0,
          amountDuePence: row.amount_due_pence ?? 0,
          daysSinceStart: row.days_since_start,
          payableByMe,
          canCheckout: payableByMe && status === "pending" && outstanding > 0,
        },
      ];
    })
    .sort((a, b) => {
      if (a.outstandingPence !== b.outstandingPence) {
        return b.outstandingPence - a.outstandingPence;
      }
      return (b.daysSinceStart ?? 0) - (a.daysSinceStart ?? 0);
    });
}

export function totalOutstandingPence(rows: Arrears[]): number {
  return rows.reduce((sum, row) => sum + Math.max(row.outstandingPence, 0), 0);
}

/** "£42.50 of £120.00 outstanding" / "Paid in full". */
export function describeArrears(row: Arrears): string {
  if (row.outstandingPence <= 0) return "Paid in full";
  return `${poundsFromPence(row.outstandingPence)} of ${poundsFromPence(
    row.amountDuePence,
  )} outstanding`;
}

/** "Past due · 41 days" — the status line under the plan name. */
export function describeStatus(row: Arrears): string {
  const parts = [humaniseEnum(row.status)];
  if (row.daysSinceStart !== null && row.outstandingPence > 0) {
    parts.push(`${row.daysSinceStart} days since start`);
  }
  return parts.join(" · ");
}

/**
 * Why the Pay button is not offered. Returning the reason rather than hiding
 * the row silently means a parent can see who to chase.
 */
export function checkoutBlockedReason(row: Arrears): string | null {
  if (row.canCheckout) return null;
  if (row.outstandingPence <= 0) return null;
  if (!row.payableByMe) {
    return "Only the registered payer can pay this from the app.";
  }
  if (row.status !== "pending") {
    return `This subscription is ${humaniseEnum(
      row.status,
    ).toLowerCase()}, so it is settled with the club rather than in the app.`;
  }
  return null;
}
