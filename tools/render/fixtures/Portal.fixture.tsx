/**
 * `/portal` — the hirer's own page, in the five states a hirer ever opens it in.
 *
 * The cases build a real `BookingFacts` row and a real ledger and then ask the
 * same three pure functions the page asks — `bookingNextAction()` in the
 * booker's voice, `bookingMoney()` and `paymentRail()` — so what is
 * photographed is the state machine's answer, not a hand-written screenshot of
 * what it is supposed to say. `NOW` is fixed so the "due by" and "overdue"
 * wording cannot drift with the calendar.
 *
 * Everything the club has committed to commercially is on these shots: the
 * deposit is non-refundable and paid first, the balance and the refundable
 * security deposit are due two weeks before, and an enquiry or a quote does
 * NOT hold the room.
 */

import { useEffect } from "react";

import { PortalBookings, type PortalBooking } from "@/app/portal/booking-sheet";
import {
  bookingMoney,
  bookingNextAction,
  paymentRail,
  type BookingFacts,
  type BookingLedgerRow,
  type BookingNextActionInput,
} from "@/lib/booking-next-action";
import { formatBookingDate, formatBookingDateShort } from "@/lib/booking-time";
import { hireTermsSummary } from "@/lib/hire-terms";

import type { Fixture } from "./contract";

/** Seven weeks before the event: the deposit is due next week, the balance in November. */
const NOW = new Date("2026-10-01T12:00:00Z");

const TERMS = hireTermsSummary({ percent: 50, capPence: 10000 });

const STATUS: Record<string, { label: string; tone: PortalBooking["statusTone"] }> = {
  confirmed: { label: "Confirmed", tone: "success" },
  pending: { label: "Awaiting confirmation", tone: "warning" },
  enquiry: { label: "Enquiry — room not held", tone: "warning" },
  quoted: { label: "Quoted — waiting for you", tone: "warning" },
};

function booking(
  facts: Partial<BookingFacts> & Pick<BookingFacts, "status">,
  payments: BookingLedgerRow[] = [],
  extra: Partial<PortalBooking> = {},
): PortalBooking {
  const row: BookingFacts = {
    starts_at: "2026-11-21T19:00:00Z",
    ends_at: "2026-11-21T23:00:00Z",
    total_pence: 26000,
    deposit_pence: 10000,
    deposit_due_date: "2026-10-08",
    // Two weeks before the event, which is the club's rule.
    balance_due_date: "2026-11-07",
    security_deposit_pence: 10000,
    security_deposit_returned_at: null,
    quote_accepted_at: null,
    chaser_sent_at: null,
    final_chaser_sent_at: null,
    ...facts,
  };
  const input: BookingNextActionInput = { booking: row, payments, clashes: [] };
  const money = bookingMoney(input);
  const status = STATUS[row.status] ?? { label: row.status, tone: "muted" as const };

  return {
    id: `booking-${row.status}-${money.hirePaidPence}`,
    roomName: "The Function Room",
    dateLabel: formatBookingDate("2026-11-21"),
    shortDateLabel: formatBookingDateShort("2026-11-21"),
    timeLabel: "19:00–23:00",
    occasion: "50th birthday",
    status: row.status,
    statusLabel: status.label,
    statusTone: status.tone,
    extras: "Bar staff · Buffet (hot)",
    roomNotHeld: row.status === "enquiry" || row.status === "quoted",
    termsSummary: TERMS,
    action: bookingNextAction(input, { voice: "booker", now: NOW }),
    money,
    rail: paymentRail(input, NOW),
    priced: row.status === "confirmed" && money.totalPence > 0,
    note: null,
    ...extra,
  };
}

/** The page's own column, so the cards are measured at the width they ship at. */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/20">
      <div className="mx-auto max-w-3xl px-4 py-6 lg:py-8">{children}</div>
    </div>
  );
}

/** A sheet opens on a press, and the harness cannot press — so the fixture does. */
function OpenOnMount({ selector }: { selector: string }) {
  useEffect(() => {
    document.querySelector<HTMLButtonElement>(selector)?.click();
  }, [selector]);
  return null;
}

const paid = (amount: number, purpose: string): BookingLedgerRow => ({
  amount_pence: amount,
  refunded_pence: 0,
  purpose,
});

const fixture: Fixture = {
  cases: {
    /** Confirmed, nothing paid: the deposit is the whole page. */
    unpaidDeposit: () => (
      <Frame>
        <PortalBookings bookings={[booking({ status: "confirmed" })]} sumupEnabled />
      </Frame>
    ),

    /** The deposit is in, so the balance and the security deposit come forward. */
    partPaid: () => (
      <Frame>
        <PortalBookings
          bookings={[booking({ status: "confirmed" }, [paid(10000, "deposit")])]}
          sumupEnabled
        />
      </Frame>
    ),

    /** Everything settled: the bar goes quiet, the rail is three green chips. */
    paidInFull: () => (
      <Frame>
        <PortalBookings
          bookings={[
            booking({ status: "confirmed" }, [
              paid(10000, "deposit"),
              paid(16000, "balance"),
              paid(10000, "security_deposit"),
            ]),
          ]}
          sumupEnabled
        />
      </Frame>
    ),

    /** A quote waits on the hirer — and the date is not held while it does. */
    quoteAwaitingAcceptance: () => (
      <Frame>
        <PortalBookings
          bookings={[booking({ status: "quoted", deposit_due_date: null, balance_due_date: null })]}
          sumupEnabled
        />
      </Frame>
    ),

    /**
     * The sheet a tap on a booking opens. It is portalled to <body>, so the
     * harness's own assertions (scoped to #root) do not see inside it — this
     * case is here for the picture and for the console-error check.
     */
    sheetOpen: () => (
      <>
        <Frame>
          <PortalBookings
            bookings={[booking({ status: "confirmed" }, [paid(10000, "deposit")])]}
            sumupEnabled
          />
        </Frame>
        <OpenOnMount selector="article button" />
      </>
    ),

    /** An enquiry: no price, no hold, and the page says both. */
    enquiry: () => (
      <Frame>
        <PortalBookings
          bookings={[
            booking({
              status: "enquiry",
              total_pence: null,
              deposit_pence: null,
              deposit_due_date: null,
              balance_due_date: null,
              security_deposit_pence: null,
            }),
          ]}
          sumupEnabled
        />
      </Frame>
    ),
  },
};

export default fixture;
