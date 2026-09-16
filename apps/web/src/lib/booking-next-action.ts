/**
 * The one thing a room hire needs next, worked out once and said in two
 * voices (P8.1 / P8.9).
 *
 * The desk and the hirer are looking at the same booking from opposite sides
 * of the counter, and until now each screen worked the answer out for itself:
 * `/room-bookings/[id]` from the buttons `status-form.tsx` happened to render,
 * `/portal` from a prose `<ol>` and three `PayButton`s. The two could
 * disagree — the portal would offer "Pay deposit" on a booking the desk had
 * never given terms to — and neither could be tested.
 *
 * So the state machine lives here, once. `bookingNextAction()` returns the
 * SAME `key` whichever voice asks; only the wording, the sheet mode and (for
 * the hirer) the payment purpose change. A test asserts that, because the two
 * voices contradicting each other is the bug this module exists to stop.
 *
 * THE CLUB'S TERMS (Adam, 2026-09-13 and 2026-09-15), which the branches
 * below encode and `lib/hire-terms.ts` does the arithmetic for:
 *
 *   1. A non-refundable deposit — half the TOTAL, capped at £100 — is paid
 *      first and is what secures the room.
 *   2. The balance, plus any refundable security deposit, is due at least two
 *      weeks before the event; it is chased two weeks out, one week out and
 *      on the day, and an unpaid balance cancels the booking the next morning.
 *   3. The security deposit is HELD, not earned: it never counts towards the
 *      hire being paid, and it is returned after the event.
 *
 * Pure: no Supabase client, no server-only import, no `Date` read that is not
 * handed in. Safe to import from a server page and from a `"use client"`
 * component alike.
 */

import type { Database } from "@club/db";

import { londonToday } from "@/lib/booking-time";
import { sumHirePaid, sumSecurityPaid, type LedgerRow, type PaymentPurpose } from "@/lib/hire-terms";
import { formatCurrency } from "@/lib/utils";

type BookingRow = Database["public"]["Tables"]["bookings"]["Row"];

/** Exactly the columns the answer depends on — nothing here widens the row. */
export type BookingFacts = Pick<
  BookingRow,
  | "status"
  | "starts_at"
  | "ends_at"
  | "total_pence"
  | "deposit_pence"
  | "deposit_due_date"
  | "balance_due_date"
  | "security_deposit_pence"
  | "security_deposit_returned_at"
  | "quote_accepted_at"
  | "chaser_sent_at"
  | "final_chaser_sent_at"
>;

/**
 * A ledger row with the day it was paid — `lib/hire-terms.ts` needs only the
 * money, the payment rail also wants to say "paid 3 Sep".
 */
export type BookingLedgerRow = LedgerRow & { paid_at?: string | null };

/**
 * A row `booking_conflicts()` returned: another booking on the same room over
 * the same window. Only its status matters here.
 */
export type BookingClash = { id: string; status: string };

export type BookingNextActionInput = {
  booking: BookingFacts;
  payments: readonly BookingLedgerRow[];
  clashes: readonly BookingClash[];
};

/**
 * How loud the bar is.
 *   · `idle`    — nothing is wrong and nothing is urgent
 *   · `pending` — the desk's own move, in hand
 *   · `waiting` — waiting on somebody else (the booker, the post, the event)
 *   · `done`    — settled; the bar is quiet and says so
 *   · `error`   — a clash, a deadline gone by, or terms that never went out
 */
export type BookingTone = "idle" | "waiting" | "done" | "error" | "pending";

export type BookingVoice = "desk" | "booker";

/** The `BookingSheet` mode a button opens (P8.1's mode list, plus the portal's). */
export type BookingSheetMode =
  | "quote"
  | "confirm"
  | "chase"
  | "cancel"
  | "payment"
  | "security"
  | "email"
  | "accept"
  | "pay"
  | "view";

export type BookingActionKey =
  | "reply-alternatives"
  | "send-quote"
  | "confirm-accepted"
  | "send-chaser"
  | "final-offer"
  | "confirm-booking"
  | "set-terms"
  | "chase-deposit"
  | "await-deposit"
  | "chase-balance"
  | "await-balance"
  | "return-security"
  | "paid-in-full"
  | "re-quote";

export type BookingNextAction = {
  key: BookingActionKey;
  /** The button, in this voice. */
  label: string;
  /** One sentence of why, in this voice. */
  why: string;
  tone: BookingTone;
  /** The sheet mode the button opens, where there is a button to press. */
  mode?: BookingSheetMode;
  /** Booker voice only: what a `PayButton` here would charge. */
  purpose?: PaymentPurpose;
  /** Booker voice only: what that button would charge, in pence. */
  amountPence?: number;
};

export type BookingNextActionOptions = {
  voice?: BookingVoice;
  /** The instant the answer is "now" at. Handed in so the answer is testable. */
  now?: Date;
};

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/**
 * "12 Sep" — a due date the way a status bar says it.
 *
 * `deposit_due_date` and `balance_due_date` are `date` columns, so they are
 * already London calendar days; reading one at noon UTC is what keeps it that
 * day in every zone the reader's browser might be in. The app's longer
 * `formatBookingDate` says the weekday and the year, which is more than a
 * one-line bar has room for.
 */
function dueDayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
  });
}

/** True when a `date` column names a day already gone by in London. */
function isPast(date: string | null, today: string): boolean {
  return date !== null && date < today;
}

// ---------------------------------------------------------------------------
// The money on a booking
// ---------------------------------------------------------------------------

export type BookingMoney = {
  totalPence: number;
  depositPence: number;
  /** Net hire money in: the deposit and the balance, never the security deposit. */
  hirePaidPence: number;
  /** Net security deposit held. */
  securityPaidPence: number;
  securityDepositPence: number;
  depositOutstandingPence: number;
  /** What is left of the hire once the deposit is out of the way. */
  balancePence: number;
  balanceOutstandingPence: number;
  securityOutstandingPence: number;
  outstandingPence: number;
};

/**
 * The figures every branch below and the payment rail both need.
 *
 * The balance arithmetic is `/portal`'s, unchanged: hire money pays the
 * deposit off first, so the balance still owed is the total less whichever of
 * "paid so far" and "the deposit" is larger.
 */
export function bookingMoney(input: BookingNextActionInput): BookingMoney {
  const totalPence = Number(input.booking.total_pence ?? 0);
  const depositPence = Number(input.booking.deposit_pence ?? 0);
  const securityDepositPence = Number(input.booking.security_deposit_pence ?? 0);
  const hirePaidPence = sumHirePaid(input.payments);
  const securityPaidPence = sumSecurityPaid(input.payments);

  return {
    totalPence,
    depositPence,
    hirePaidPence,
    securityPaidPence,
    securityDepositPence,
    depositOutstandingPence: Math.max(0, depositPence - hirePaidPence),
    balancePence: Math.max(0, totalPence - depositPence),
    balanceOutstandingPence: Math.max(0, totalPence - Math.max(hirePaidPence, depositPence)),
    securityOutstandingPence: Math.max(0, securityDepositPence - securityPaidPence),
    outstandingPence: Math.max(0, totalPence - hirePaidPence),
  };
}

/**
 * Confirmed, but never given its terms — no deposit deadline, so no
 * confirmation email went, no reminder will, and the auto-cancel does not
 * apply. The desk's own "add a booking" makes these (Lyndsey, September 2026).
 *
 * Exactly the expression `/room-bookings/[id]/page.tsx` already passes to
 * `StatusForm` as `needsTerms`, moved here so both screens agree.
 */
export function bookingNeedsTerms(booking: BookingFacts, now: Date = new Date()): boolean {
  return (
    booking.status === "confirmed" &&
    !booking.deposit_due_date &&
    booking.starts_at > now.toISOString()
  );
}

/** The event is over: the room has been used and the night cannot be sold again. */
function eventHasPassed(booking: BookingFacts, now: Date): boolean {
  return Date.parse(booking.ends_at) <= now.getTime();
}

/**
 * A booking holding the room is one the no-overlap constraint arbitrates.
 * An enquiry or a quote is not holding it — asking is free (2026-09-11) — and
 * that is the difference that decides whether a clash is this desk's problem.
 */
function holdsRoom(booking: BookingFacts): boolean {
  return booking.status === "confirmed" || booking.status === "pending";
}

// ---------------------------------------------------------------------------
// The payment rail (P8.9)
// ---------------------------------------------------------------------------

export type PaymentStepState = "paid" | "due" | "overdue" | "later" | "not-needed";

export type PaymentStep = {
  purpose: PaymentPurpose;
  label: string;
  /**
   * What a Pay button here would charge — or, once the step is settled, what
   * was paid, so the chip always has a figure to show.
   */
  amountPence: number;
  state: PaymentStepState;
  /** The `date` column this step is due on, where the booking has one. */
  dueOn?: string;
  /** The day the step was settled, from the ledger. */
  paidOn?: string;
};

/** The latest `paid_at` day among the rows that pay for a given step. */
function lastPaidDay(
  rows: readonly BookingLedgerRow[],
  wantSecurity: boolean,
): string | undefined {
  let latest: string | undefined;
  for (const row of rows) {
    const isSecurity = row.purpose === "security_deposit";
    if (isSecurity !== wantSecurity) continue;
    const at = row.paid_at;
    if (!at) continue;
    const day = at.slice(0, 10);
    if (!latest || day > latest) latest = day;
  }
  return latest;
}

/**
 * The three steps of the club's terms, in the order they are paid, for
 * `/portal`'s rail and for the desk's cost card.
 *
 * `later` is not "cannot be paid" — the portal has always let a hirer pay in
 * full in one go. It means this step's turn has not come: the deposit secures
 * the room and is paid first, so while it is outstanding the balance and the
 * security deposit are not what the booker is being asked for.
 */
export function paymentRail(
  input: BookingNextActionInput,
  now: Date = new Date(),
): PaymentStep[] {
  const today = londonToday(now);
  const money = bookingMoney(input);
  const confirmed = input.booking.status === "confirmed";

  const step = (
    purpose: PaymentPurpose,
    label: string,
    stepPence: number,
    outstandingPence: number,
    dueOn: string | null,
    turnHasCome: boolean,
    paidOn: string | undefined,
  ): PaymentStep => {
    let state: PaymentStepState;
    if (stepPence <= 0) state = "not-needed";
    else if (outstandingPence <= 0) state = "paid";
    else if (!confirmed || !turnHasCome) state = "later";
    else if (isPast(dueOn, today)) state = "overdue";
    else state = "due";

    return {
      purpose,
      label,
      amountPence: state === "paid" ? stepPence : outstandingPence,
      state,
      ...(dueOn ? { dueOn } : {}),
      ...(state === "paid" && paidOn ? { paidOn } : {}),
    };
  };

  const hirePaidDay = lastPaidDay(input.payments, false);
  const securityPaidDay = lastPaidDay(input.payments, true);
  const depositSettled = money.depositOutstandingPence <= 0;

  return [
    step(
      "deposit",
      "Deposit",
      money.depositPence,
      money.depositOutstandingPence,
      input.booking.deposit_due_date,
      true,
      hirePaidDay,
    ),
    step(
      "balance",
      "Balance",
      money.balancePence,
      money.balanceOutstandingPence,
      input.booking.balance_due_date,
      depositSettled,
      hirePaidDay,
    ),
    step(
      "security_deposit",
      "Security deposit",
      money.securityDepositPence,
      money.securityOutstandingPence,
      input.booking.balance_due_date,
      depositSettled,
      securityPaidDay,
    ),
  ];
}

// ---------------------------------------------------------------------------
// The next action
// ---------------------------------------------------------------------------

type Branch = {
  key: BookingActionKey;
  tone: BookingTone;
  desk: { label: string; why: string; mode?: BookingSheetMode };
  booker: {
    label: string;
    why: string;
    mode?: BookingSheetMode;
    purpose?: PaymentPurpose;
    amountPence?: number;
  };
};

/**
 * The one thing this booking needs next.
 *
 * The branches are in priority order and the FIRST match wins, so a clash
 * outranks everything: confirming a booking over one that is already holding
 * the room would be refused by `bookings_no_overlap`, and finding that out
 * from a constraint error is the worse way to find out.
 */
export function bookingNextAction(
  input: BookingNextActionInput,
  options: BookingNextActionOptions = {},
): BookingNextAction {
  const voice = options.voice ?? "desk";
  const now = options.now ?? new Date();
  const today = londonToday(now);
  const money = bookingMoney(input);
  const branch = chooseBranch(input, money, now, today);

  const side = voice === "booker" ? branch.booker : branch.desk;
  const action: BookingNextAction = {
    key: branch.key,
    label: side.label,
    why: side.why,
    tone: branch.tone,
  };
  if (side.mode) action.mode = side.mode;
  // The purpose and the amount are a Pay button's arguments, so they belong
  // to the booker's side of the counter and nowhere else.
  if (voice === "booker") {
    const booker = branch.booker;
    if (booker.purpose) action.purpose = booker.purpose;
    if (booker.amountPence !== undefined) action.amountPence = booker.amountPence;
  }
  return action;
}

function chooseBranch(
  input: BookingNextActionInput,
  money: BookingMoney,
  now: Date,
  today: string,
): Branch {
  const booking = input.booking;
  const status = booking.status;

  // 1. A clash on a booking that is NOT holding the room. Asking about a
  //    taken night is allowed by design, but the desk must see it before it
  //    reaches for Confirm.
  if (input.clashes.length > 0 && !holdsRoom(booking)) {
    return {
      key: "reply-alternatives",
      tone: "error",
      desk: {
        label: "Reply with alternatives",
        why:
          status === "cancelled"
            ? "The night has gone to another booking, so this one cannot be re-quoted as it stands."
            : "The room is already taken that night, so confirming this would be refused. Offer other dates, or cancel the other booking first.",
        mode: "email",
      },
      booker: {
        label: "Read the club's reply",
        why: "The club is not able to hold that date, and will write with other dates you could have.",
        mode: "view",
      },
    };
  }

  // 2. An enquiry has no price on it yet.
  if (status === "enquiry") {
    return {
      key: "send-quote",
      tone: "pending",
      desk: {
        label: "Send a quote",
        why: "The booker has asked but has no price. A quote does not hold the room; confirming does.",
        mode: "quote",
      },
      booker: {
        label: "Wait for the club's quote",
        why: "The club has your enquiry and will send you a price. The room is not held for you yet.",
        mode: "view",
      },
    };
  }

  // 3. The booker has accepted the quote in their portal — the desk's move.
  if (status === "quoted" && booking.quote_accepted_at) {
    return {
      key: "confirm-accepted",
      tone: "pending",
      desk: {
        label: "Confirm & notify the booker",
        why: "The booker accepted the quote in their portal. Confirming takes the date and sends them the terms.",
        mode: "confirm",
      },
      booker: {
        label: "Wait for the club to confirm",
        why: "You have accepted the quote. The club will confirm the booking and send you the terms.",
        mode: "view",
      },
    };
  }

  // 4 and 5. A quote nobody has answered: chase once, then the final offer.
  //    Both sit on the same state — the desk's move is to chase, the booker's
  //    is to accept — so they share a key and part company only in wording.
  if (status === "quoted" && !booking.chaser_sent_at) {
    return {
      key: "send-chaser",
      tone: "waiting",
      desk: {
        label: "Send a chaser",
        why: "The quote has gone and nothing has come back. Ask whether they still want the room; nothing is held.",
        mode: "chase",
      },
      booker: {
        label: "Accept the quote",
        why: "The date is not held by a quote. Accepting it confirms the booking, subject to the deposit.",
        mode: "accept",
      },
    };
  }
  if (status === "quoted" && booking.chaser_sent_at && !booking.final_chaser_sent_at) {
    return {
      key: "final-offer",
      tone: "waiting",
      desk: {
        label: "Final offer — half off room hire",
        why: "The chaser has already gone. The final offer amends the quote to half the room hire and can only be sent once.",
        mode: "chase",
      },
      booker: {
        label: "Accept the quote",
        why: "The date is not held by a quote. Accepting it confirms the booking, subject to the deposit.",
        mode: "accept",
      },
    };
  }

  // 6. A request the desk has not answered at all.
  if (status === "pending") {
    return {
      key: "confirm-booking",
      tone: "pending",
      desk: {
        label: "Confirm the booking",
        why: "The booker is waiting on an answer. Confirming is the act that takes the date.",
        mode: "confirm",
      },
      booker: {
        label: "Wait for the club to confirm",
        why: "The club will confirm your booking and the total cost soon; you can pay here once it is confirmed.",
        mode: "view",
      },
    };
  }

  if (status === "cancelled") {
    return {
      key: "re-quote",
      tone: "idle",
      desk: {
        label: "Re-quote & reopen",
        why: "Re-quoting reopens it. The room is not held again until it is confirmed, and the old deadline is cleared.",
        mode: "quote",
      },
      booker: {
        label: "Ask the club again",
        why: "This booking was cancelled. The club can re-quote it if the date is still free.",
        mode: "view",
      },
    };
  }

  // 7. Confirmed but never given its terms: no deadline, no confirmation
  //    email, no reminders and no auto-cancel. Worse than a missed deadline,
  //    because nobody has been told there is one.
  if (bookingNeedsTerms(booking, now)) {
    return {
      key: "set-terms",
      tone: "error",
      desk: {
        label: "Set the price and terms",
        why: "Confirmed with no deposit deadline, so no confirmation went out and no reminder will. Setting the terms sends both, from today.",
        mode: "confirm",
      },
      booker: {
        label: "Wait for the club's terms",
        why: "Your booking is confirmed. The club will send the price and how to pay.",
        mode: "view",
      },
    };
  }

  const dueLabel = (date: string | null): string => (date ? ` by ${dueDayLabel(date)}` : "");

  // 8. The deposit — paid first, and what secures the room.
  if (money.depositOutstandingPence > 0) {
    const overdue = isPast(booking.deposit_due_date, today);
    const amount = formatCurrency(money.depositOutstandingPence);
    return {
      key: overdue ? "chase-deposit" : "await-deposit",
      tone: overdue ? "error" : "waiting",
      desk: {
        label: overdue ? "Chase the deposit" : "Waiting on the deposit",
        why: overdue
          ? `The ${amount} deposit was due${dueLabel(booking.deposit_due_date)} and has not arrived. The confirmation is subject to it.`
          : `The ${amount} deposit is due${dueLabel(booking.deposit_due_date)}. It secures the room and is paid first.`,
        mode: overdue ? "chase" : "payment",
      },
      booker: {
        label: `Pay the ${amount} deposit${dueLabel(booking.deposit_due_date)}`,
        why: overdue
          ? "This non-refundable deposit was due and secures the room; the booking is confirmed subject to it."
          : "This non-refundable deposit secures the room and is paid first.",
        mode: "pay",
        purpose: "deposit",
        amountPence: money.depositOutstandingPence,
      },
    };
  }

  // 9. The balance, and the refundable security deposit that falls due with
  //    it. Both are owed two weeks before the event.
  const balanceOwed = money.balanceOutstandingPence + money.securityOutstandingPence;
  if (balanceOwed > 0) {
    const overdue = isPast(booking.balance_due_date, today);
    const payBalance = money.balanceOutstandingPence > 0;
    const amount = formatCurrency(payBalance ? money.balanceOutstandingPence : money.securityOutstandingPence);
    const what = payBalance ? "balance" : "security deposit";
    return {
      key: overdue ? "chase-balance" : "await-balance",
      tone: overdue ? "error" : "waiting",
      desk: {
        label: overdue ? "Chase the balance" : "Waiting on the balance",
        why: overdue
          ? `The ${what} of ${amount} was due${dueLabel(booking.balance_due_date)} and has not arrived.`
          : `The ${what} of ${amount} is due${dueLabel(booking.balance_due_date)}, two weeks before the event.`,
        mode: overdue ? "chase" : "payment",
      },
      booker: {
        label: payBalance
          ? `Pay the ${amount} balance${dueLabel(booking.balance_due_date)}`
          : `Pay the ${amount} security deposit${dueLabel(booking.balance_due_date)}`,
        why: payBalance
          ? "The balance is due at least two weeks before your event, with any refundable security deposit."
          : "This security deposit is refundable and comes back after the event if all is well.",
        mode: "pay",
        purpose: payBalance ? "balance" : "security_deposit",
        amountPence: payBalance ? money.balanceOutstandingPence : money.securityOutstandingPence,
      },
    };
  }

  // 10. The event is over and the club is still holding somebody's money.
  if (
    eventHasPassed(booking, now) &&
    money.securityPaidPence > 0 &&
    !booking.security_deposit_returned_at
  ) {
    return {
      key: "return-security",
      tone: "pending",
      desk: {
        label: "Mark the deposit returned",
        why: `The event has been and ${formatCurrency(money.securityPaidPence)} of security deposit is still held. Record its return once it has gone back.`,
        mode: "security",
      },
      booker: {
        label: "Waiting on your security deposit",
        why: "Your event has passed. The club will return the refundable security deposit if all is well.",
        mode: "view",
      },
    };
  }

  // 11. Nothing owed. The bar goes quiet and says so.
  const held = money.securityPaidPence > 0 && !booking.security_deposit_returned_at;
  return {
    key: "paid-in-full",
    tone: "done",
    desk: {
      label: "Email the booker",
      why: held ? "Paid in full · security deposit held" : "Paid in full. Nothing is outstanding on this booking.",
      mode: "email",
    },
    booker: {
      label: "View your booking",
      why: held
        ? "Paid in full, and your security deposit is held until after the event — thank you."
        : "Paid in full — thank you. Nothing is outstanding.",
      mode: "view",
    },
  };
}
