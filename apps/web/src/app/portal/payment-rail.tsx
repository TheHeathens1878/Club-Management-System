/**
 * The three steps of a hire, in the order they are paid (P8.9).
 *
 * This replaces the prose `<ol>` the portal used to carry — two numbered
 * paragraphs that restated the club's terms in full every time, said "1." in
 * green or amber depending on an inline arithmetic expression, and left the
 * hirer to work out which figure was the one being asked for now. The rail
 * says the same three things as three chips: what each step is, what it
 * costs, where it stands, and — on the one that is owed — the button that
 * pays it.
 *
 * The states come from `paymentRail()` in `lib/booking-next-action.ts`, so
 * the desk's cost card and the hirer's rail cannot disagree about what has
 * been paid. The terms themselves (Adam, 2026-09-13 and 2026-09-15) are the
 * sub-lines, which is where the commercial commitments live: the deposit is
 * NON-REFUNDABLE and secures the room, the balance is due at least two weeks
 * before the event, and the security deposit is REFUNDABLE and comes back
 * after the event if all is well.
 *
 * No `"use client"` of its own: it draws nothing interactive itself, so it
 * renders on the server inside the page and on the client inside the sheet.
 * `PayButton`, which is a client component, is an island inside it either way.
 */

import { Check, CircleDashed, Clock3, Minus } from "lucide-react";

import { formatBookingDateShort } from "@/lib/booking-time";
import type { PaymentStep, PaymentStepState } from "@/lib/booking-next-action";
import type { PaymentPurpose } from "@/lib/hire-terms";
import { formatCurrency } from "@/lib/utils";

import { PayButton } from "./pay-button";

/** The short button wording for each purpose; `PayButton` adds the figure. */
export const PAY_LABEL: Record<PaymentPurpose, string> = {
  deposit: "Pay deposit",
  balance: "Pay balance",
  security_deposit: "Pay security deposit",
};

/** What each step is, in the club's words. The terms live here. */
const TERMS: Record<PaymentPurpose, string> = {
  deposit: "Non-refundable. It secures the room and is paid first.",
  balance: "Due at least two weeks before your event.",
  security_deposit: "Refundable — returned after the event if all is well.",
};

/**
 * Three tones, not five: paid is settled, due and overdue are both "this is
 * the one you are being asked for", and a step whose turn has not come (or
 * which this booking does not have) is quiet.
 */
const CHIP: Record<PaymentStepState, string> = {
  paid: "border-success/25 bg-success-tint",
  due: "border-warning/25 bg-warning-tint",
  overdue: "border-warning/25 bg-warning-tint",
  later: "border-transparent bg-muted/40",
  "not-needed": "border-transparent bg-muted/40",
};

const INK: Record<PaymentStepState, string> = {
  paid: "text-success",
  due: "text-warning",
  overdue: "text-warning",
  later: "text-muted-foreground",
  "not-needed": "text-muted-foreground",
};

function mark(state: PaymentStepState) {
  if (state === "paid") return <Check className="h-4 w-4" aria-hidden />;
  if (state === "due" || state === "overdue") return <Clock3 className="h-4 w-4" aria-hidden />;
  if (state === "not-needed") return <Minus className="h-4 w-4" aria-hidden />;
  return <CircleDashed className="h-4 w-4" aria-hidden />;
}

/** Where this step stands, in a few words. */
function stateWords(step: PaymentStep): string {
  switch (step.state) {
    case "paid":
      return step.paidOn ? `Paid ${formatBookingDateShort(step.paidOn)}` : "Paid";
    case "overdue":
      return step.dueOn ? `Overdue — was due ${formatBookingDateShort(step.dueOn)}` : "Overdue";
    case "due":
      return step.dueOn ? `Due by ${formatBookingDateShort(step.dueOn)}` : "Due now";
    case "later":
      return step.dueOn ? `Due ${formatBookingDateShort(step.dueOn)}` : "Not yet due";
    default:
      return "Not needed for this booking";
  }
}

export function PaymentRail({
  bookingId,
  steps,
  sumupEnabled,
  /** The sheet shows every step; the card hides the ones this booking has not got. */
  showNotNeeded = false,
  /**
   * The step the status bar above is already offering. Its chip keeps its
   * figure and its state but not a second button — one press per screen is
   * the whole point of the bar.
   */
  primaryPurpose,
}: {
  bookingId: string;
  steps: readonly PaymentStep[];
  sumupEnabled: boolean;
  showNotNeeded?: boolean;
  primaryPurpose?: PaymentPurpose;
}) {
  const shown = showNotNeeded ? steps : steps.filter((step) => step.state !== "not-needed");
  if (shown.length === 0) return null;

  return (
    <ol className="space-y-2">
      {shown.map((step, index) => {
        const owed =
          (step.state === "due" || step.state === "overdue") && step.purpose !== primaryPurpose;
        return (
          <li
            key={step.purpose}
            className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2 ${CHIP[step.state]}`}
          >
            <span className={`flex-none ${INK[step.state]}`} aria-hidden>
              {mark(step.state)}
            </span>
            <span className="min-w-0 flex-1 basis-40">
              <span className="block text-list font-semibold">
                <span className="text-muted-foreground">{index + 1}. </span>
                {step.label}
                {step.state === "not-needed" ? null : (
                  <span className="tabular-nums"> · {formatCurrency(step.amountPence)}</span>
                )}
              </span>
              <span className={`block text-2xs ${INK[step.state]}`}>{stateWords(step)}</span>
              <span className="block text-2xs text-muted-foreground">{TERMS[step.purpose]}</span>
            </span>
            {owed ? (
              <PayButton
                bookingId={bookingId}
                amountPence={step.amountPence}
                label={PAY_LABEL[step.purpose]}
                purpose={step.purpose}
                sumupEnabled={sumupEnabled}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
