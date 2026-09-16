import { describe, expect, it } from "vitest";

import {
  bookingMoney,
  bookingNeedsTerms,
  bookingNextAction,
  paymentRail,
  type BookingFacts,
  type BookingLedgerRow,
  type BookingNextActionInput,
} from "@/lib/booking-next-action";

// A Saturday-night hire in November, so every deadline in the fixtures below
// sits either side of a "now" that is easy to read. October and November are
// deliberate: en-GB abbreviates September as "Sept", which is a moving target
// between ICU versions and not what these assertions are about.
const NOW = new Date("2026-10-16T10:00:00Z");

const BOOKING: BookingFacts = {
  status: "confirmed",
  starts_at: "2026-11-07T18:00:00Z",
  ends_at: "2026-11-07T23:00:00Z",
  total_pence: 26000,
  deposit_pence: 10000,
  deposit_due_date: "2026-10-23",
  balance_due_date: "2026-10-24",
  security_deposit_pence: 10000,
  security_deposit_returned_at: null,
  quote_accepted_at: null,
  chaser_sent_at: null,
  final_chaser_sent_at: null,
};

function input(
  booking: Partial<BookingFacts> = {},
  payments: BookingLedgerRow[] = [],
  clashes: BookingNextActionInput["clashes"] = [],
): BookingNextActionInput {
  return { booking: { ...BOOKING, ...booking }, payments, clashes };
}

const paid = (
  amount: number,
  purpose: string | null = null,
  at = "2026-10-10T12:00:00Z",
): BookingLedgerRow => ({ amount_pence: amount, purpose, paid_at: at });

/** Everything paid: the £260 hire and the £100 security deposit. */
const SETTLED: BookingLedgerRow[] = [paid(26000, "deposit"), paid(10000, "security_deposit")];

describe("the branch the desk lands on", () => {
  it("replies with alternatives when a clash outranks everything", () => {
    // A quote about a night somebody else is holding: confirming would be
    // refused by the overlap constraint, so nothing else matters yet.
    const action = bookingNextAction(
      input({ status: "quoted", quote_accepted_at: "2026-10-14T09:00:00Z" }, [], [
        { id: "other", status: "confirmed" },
      ]),
      { now: NOW },
    );
    expect(action.key).toBe("reply-alternatives");
    expect(action.label).toBe("Reply with alternatives");
    expect(action.tone).toBe("error");
    expect(action.mode).toBe("email");
  });

  it("leaves a clash alone when this booking is the one holding the room", () => {
    const action = bookingNextAction(input({}, SETTLED, [{ id: "other", status: "enquiry" }]), {
      now: NOW,
    });
    expect(action.key).not.toBe("reply-alternatives");
  });

  it("quotes an enquiry", () => {
    const action = bookingNextAction(input({ status: "enquiry" }), { now: NOW });
    expect(action.key).toBe("send-quote");
    expect(action.label).toBe("Send a quote");
    expect(action.mode).toBe("quote");
  });

  it("confirms a quote the booker has accepted", () => {
    const action = bookingNextAction(
      input({ status: "quoted", quote_accepted_at: "2026-10-15T20:00:00Z" }),
      { now: NOW },
    );
    expect(action.key).toBe("confirm-accepted");
    expect(action.label).toBe("Confirm & notify the booker");
    expect(action.mode).toBe("confirm");
  });

  it("chases a quote nobody has answered", () => {
    const action = bookingNextAction(input({ status: "quoted" }), { now: NOW });
    expect(action.key).toBe("send-chaser");
    expect(action.label).toBe("Send a chaser");
    expect(action.mode).toBe("chase");
  });

  it("makes the final offer once the chaser has gone", () => {
    const action = bookingNextAction(
      input({ status: "quoted", chaser_sent_at: "2026-10-12T09:00:00Z" }),
      { now: NOW },
    );
    expect(action.key).toBe("final-offer");
    expect(action.label).toBe("Final offer — half off room hire");
  });

  it("does not offer the final offer twice", () => {
    const action = bookingNextAction(
      input({
        status: "quoted",
        chaser_sent_at: "2026-10-12T09:00:00Z",
        final_chaser_sent_at: "2026-10-14T09:00:00Z",
      }),
      { now: NOW },
    );
    expect(action.key).not.toBe("final-offer");
  });

  it("confirms a pending request", () => {
    const action = bookingNextAction(input({ status: "pending" }), { now: NOW });
    expect(action.key).toBe("confirm-booking");
    expect(action.label).toBe("Confirm the booking");
  });

  it("sets the price and terms on a confirmation that never got any", () => {
    const action = bookingNextAction(
      input({ deposit_due_date: null, balance_due_date: null }),
      { now: NOW },
    );
    expect(action.key).toBe("set-terms");
    expect(action.label).toBe("Set the price and terms");
    expect(action.tone).toBe("error");
  });

  it("waits on a deposit that is not due yet, and chases one that is late", () => {
    const waiting = bookingNextAction(input(), { now: NOW });
    expect(waiting.key).toBe("await-deposit");
    expect(waiting.tone).toBe("waiting");

    const late = bookingNextAction(input({ deposit_due_date: "2026-10-12" }), { now: NOW });
    expect(late.key).toBe("chase-deposit");
    expect(late.label).toBe("Chase the deposit");
    expect(late.tone).toBe("error");
  });

  it("waits on a balance that is not due yet", () => {
    const action = bookingNextAction(input({}, [paid(10000, "deposit")]), { now: NOW });
    expect(action.key).toBe("await-balance");
    expect(action.tone).toBe("waiting");
    expect(action.why).toContain("two weeks before the event");
  });

  it("chases the balance once the deposit is in and the day has gone", () => {
    const action = bookingNextAction(
      input({ balance_due_date: "2026-10-12" }, [paid(10000, "deposit")]),
      { now: NOW },
    );
    expect(action.key).toBe("chase-balance");
    expect(action.label).toBe("Chase the balance");
    expect(action.why).toContain("£160.00");
  });

  it("counts the security deposit apart from the hire", () => {
    // The hire is settled; only the refundable £100 is still to come in.
    const action = bookingNextAction(
      input({ balance_due_date: "2026-10-12" }, [paid(26000, "balance")]),
      { now: NOW },
    );
    expect(action.key).toBe("chase-balance");
    expect(action.why).toContain("security deposit of £100.00");
  });

  it("asks for the security deposit back once the event has been", () => {
    const action = bookingNextAction(input({}, SETTLED), {
      now: new Date("2026-11-08T09:00:00Z"),
    });
    expect(action.key).toBe("return-security");
    expect(action.label).toBe("Mark the deposit returned");
    expect(action.mode).toBe("security");
  });

  it("goes quiet when everything is paid", () => {
    const action = bookingNextAction(input(), { now: NOW });
    expect(action.key).toBe("await-deposit");

    const settled = bookingNextAction(input({}, SETTLED), { now: NOW });
    expect(settled.key).toBe("paid-in-full");
    expect(settled.tone).toBe("done");
    expect(settled.label).toBe("Email the booker");
    expect(settled.why).toBe("Paid in full · security deposit held");
  });

  it("yields no primary action when the booking is paid in full", () => {
    // "Quiet" means the only door left is the ordinary one: an email. There
    // is nothing for the desk to chase, confirm or return.
    const settled = bookingNextAction(
      input({ security_deposit_pence: 0 }, [paid(26000, "balance")]),
      { now: NOW },
    );
    expect(settled.key).toBe("paid-in-full");
    expect(settled.tone).toBe("done");
    expect(settled.why).toBe("Paid in full. Nothing is outstanding on this booking.");
  });

  it("re-quotes a cancelled booking", () => {
    const action = bookingNextAction(input({ status: "cancelled" }), { now: NOW });
    expect(action.key).toBe("re-quote");
    expect(action.label).toBe("Re-quote & reopen");
    expect(action.mode).toBe("quote");
  });
});

describe("the same answer, in the booker's voice", () => {
  // The bug this module exists to stop: the portal offering to pay for
  // something the desk does not think is owed. Same input, same key.
  const cases: { name: string; input: BookingNextActionInput; now?: Date }[] = [
    { name: "a clash", input: input({ status: "quoted" }, [], [{ id: "x", status: "confirmed" }]) },
    { name: "an enquiry", input: input({ status: "enquiry" }) },
    {
      name: "an accepted quote",
      input: input({ status: "quoted", quote_accepted_at: "2026-10-15T20:00:00Z" }),
    },
    { name: "an unanswered quote", input: input({ status: "quoted" }) },
    {
      name: "a chased quote",
      input: input({ status: "quoted", chaser_sent_at: "2026-10-12T09:00:00Z" }),
    },
    { name: "a pending request", input: input({ status: "pending" }) },
    { name: "a confirmation with no terms", input: input({ deposit_due_date: null }) },
    { name: "a deposit still to come", input: input() },
    { name: "a late deposit", input: input({ deposit_due_date: "2026-10-12" }) },
    { name: "a balance to come", input: input({}, [paid(10000, "deposit")]) },
    { name: "a paid booking", input: input({}, SETTLED) },
    { name: "a cancelled booking", input: input({ status: "cancelled" }) },
    {
      name: "a security deposit still held",
      input: input({}, SETTLED),
      now: new Date("2026-11-08T09:00:00Z"),
    },
  ];

  for (const testCase of cases) {
    it(`agrees about ${testCase.name}`, () => {
      const now = testCase.now ?? NOW;
      const desk = bookingNextAction(testCase.input, { voice: "desk", now });
      const booker = bookingNextAction(testCase.input, { voice: "booker", now });
      expect(booker.key).toBe(desk.key);
      expect(booker.tone).toBe(desk.tone);
      expect(booker.label).not.toBe("");
    });
  }

  it("names the deposit, the amount and the day", () => {
    const action = bookingNextAction(input(), { voice: "booker", now: NOW });
    expect(action.label).toBe("Pay the £100.00 deposit by 23 Oct");
    expect(action.purpose).toBe("deposit");
    expect(action.amountPence).toBe(10000);
    expect(action.mode).toBe("pay");
  });

  it("offers to accept a quote that is waiting on the booker", () => {
    const action = bookingNextAction(input({ status: "quoted" }), { voice: "booker", now: NOW });
    expect(action.label).toBe("Accept the quote");
    expect(action.mode).toBe("accept");
  });

  it("goes quiet when nothing is owed", () => {
    const action = bookingNextAction(input({}, SETTLED), { voice: "booker", now: NOW });
    expect(action.key).toBe("paid-in-full");
    expect(action.tone).toBe("done");
    expect(action.purpose).toBeUndefined();
  });

  it("never hands the desk a payment purpose", () => {
    const action = bookingNextAction(input(), { voice: "desk", now: NOW });
    expect(action.purpose).toBeUndefined();
  });
});

describe("the payment rail", () => {
  it("has three steps, in the order the club is paid", () => {
    const rail = paymentRail(input(), NOW);
    expect(rail.map((step) => step.purpose)).toEqual(["deposit", "balance", "security_deposit"]);
    expect(rail.map((step) => step.label)).toEqual(["Deposit", "Balance", "Security deposit"]);
  });

  it("puts the balance and the security deposit behind the deposit", () => {
    const rail = paymentRail(input(), NOW);
    expect(rail[0]).toMatchObject({ state: "due", amountPence: 10000, dueOn: "2026-10-23" });
    expect(rail[1]).toMatchObject({ state: "later", amountPence: 16000 });
    expect(rail[2]).toMatchObject({ state: "later", amountPence: 10000 });
  });

  it("opens the balance once the deposit is settled, and dates it", () => {
    const rail = paymentRail(input({}, [paid(10000, "deposit")]), NOW);
    expect(rail[0]).toMatchObject({ state: "paid", amountPence: 10000, paidOn: "2026-10-10" });
    // The balance fell due on 24 October and today is the 16th.
    expect(rail[1]).toMatchObject({ state: "due", amountPence: 16000, dueOn: "2026-10-24" });
  });

  it("calls a step overdue once its day has gone by in London", () => {
    const rail = paymentRail(
      input({ balance_due_date: "2026-10-12" }, [paid(10000, "deposit")]),
      NOW,
    );
    expect(rail[1]?.state).toBe("overdue");
    expect(rail[2]?.state).toBe("overdue");
  });

  it("says a step is not needed rather than showing a zero", () => {
    const rail = paymentRail(
      input({ security_deposit_pence: 0, deposit_pence: 0 }, []),
      NOW,
    );
    expect(rail[0]).toMatchObject({ state: "not-needed", amountPence: 0 });
    expect(rail[2]).toMatchObject({ state: "not-needed", amountPence: 0 });
  });

  it("holds everything back until the booking is confirmed", () => {
    const rail = paymentRail(input({ status: "quoted" }), NOW);
    expect(rail.map((step) => step.state)).toEqual(["later", "later", "later"]);
  });

  it("never lets hire money pay for the security deposit", () => {
    const rail = paymentRail(input({}, [paid(26000, "balance")]), NOW);
    expect(rail[0]?.state).toBe("paid");
    expect(rail[1]?.state).toBe("paid");
    expect(rail[2]).toMatchObject({ state: "due", amountPence: 10000 });
  });

  it("owes the deposit again when a payment is refunded", () => {
    const rail = paymentRail(
      input({}, [{ amount_pence: 10000, refunded_pence: 10000, purpose: "deposit" }]),
      NOW,
    );
    expect(rail[0]).toMatchObject({ state: "due", amountPence: 10000 });
  });
});

describe("the figures behind the words", () => {
  it("counts the hire and the security deposit apart", () => {
    const money = bookingMoney(input({}, SETTLED));
    expect(money.hirePaidPence).toBe(26000);
    expect(money.securityPaidPence).toBe(10000);
    expect(money.outstandingPence).toBe(0);
  });

  it("knows a confirmation that was never given its terms", () => {
    expect(bookingNeedsTerms({ ...BOOKING, deposit_due_date: null }, NOW)).toBe(true);
    expect(bookingNeedsTerms(BOOKING, NOW)).toBe(false);
    // A past event is nobody's confirmation email any more.
    expect(
      bookingNeedsTerms({ ...BOOKING, deposit_due_date: null }, new Date("2026-12-01T09:00:00Z")),
    ).toBe(false);
  });
});
