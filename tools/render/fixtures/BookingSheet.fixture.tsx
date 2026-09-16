/**
 * The booking sheet, one case per door (P8.1b).
 *
 * The five named cases are the five states the desk meets a hire in, each
 * opened on the mode that state's status bar actually offers — an enquiry on
 * the quote form, an accepted quote on confirm, a confirmed hire on its
 * payments, a settled one on its security deposit, a cancelled one on the
 * reply. The four after them are the doors no status bar ever proposes but the
 * desk still needs: chase, cancel, edit (super user) and delete (committee).
 *
 * A `Sheet` is portalled to <body>, so how much of the harness reaches inside
 * one is worth knowing before you read a PASS here. Its tap-target check asks
 * for `#root button, a[href], [role=button], input, select, textarea, summary`
 * — and a comma ends the descendant combinator, so only `button` is actually
 * scoped to `#root`. Every FIELD in these sheets is measured (that is how the
 * 16px membership checkbox in the confirm form was caught, and why it is a
 * `ToggleChip` now); the sheet's own BUTTONS and everything the overflow and
 * palette checks look at are not. So these cases earn their keep on the
 * SCREENSHOTS, on the fields, and on the console-error check: a portal that
 * fails to mount, a form that throws on its first render, or a drawer that
 * comes out as a full-screen modal on a desk all show up in the picture.
 *
 * The page behind is drawn as a plain card so the scrim and the elevation have
 * something to sit over.
 *
 * The forms import `./actions`, which the harness swaps for its no-op shim, so
 * every field is real and every button is live but nothing is sent. What cannot
 * be photographed: the spinner on a submit, a server's error message under a
 * form, and "Sent — it is in the email log below".
 */

import {
  BookingSheet,
  type BookingSheetBooking,
  type BookingSheetMode,
  type BookingSheetProps,
} from "@/app/(app)/room-bookings/booking-sheet";
import type { PaymentRow } from "@/app/(app)/room-bookings/payments-panel";
import { bookingMoney } from "@/lib/booking-next-action";

import type { Fixture } from "./contract";

const BOOKING_ID = "7f3c2a10-0000-4000-8000-000000000001";

const BASE: BookingSheetBooking = {
  status: "enquiry",
  kind: "public",
  booker_email: "jane.metcalfe@example.com",
  total_pence: 48000,
  security_deposit_pence: null,
  security_deposit_returned_at: null,
  security_deposit_returned_method: null,
  security_deposit_returned_note: null,
  is_member: false,
  membership_type: null,
  member_number: null,
  chaser_sent_at: null,
  final_chaser_sent_at: null,
  final_chaser_discount_pence: null,
};

function payment(over: Partial<PaymentRow> & Pick<PaymentRow, "id" | "amount_pence" | "paid_at">): PaymentRow {
  return {
    method: "bank_transfer",
    reference: null,
    source: "manual",
    authorised_by_name: "Lyndsey",
    note: null,
    purpose: null,
    ...over,
  };
}

/** The record page behind the sheet, enough of it for the scrim to sit over. */
function Page() {
  return (
    <div className="space-y-3 p-4">
      <h1 className="font-display text-xl font-semibold">Booking #7F3C2A10</h1>
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <p className="text-row font-medium">The Function Room · Saturday, 14 November 2026</p>
        <p className="text-list text-muted-foreground">19:00–00:00 · 80 guests · 60th birthday party</p>
      </div>
    </div>
  );
}

function sheet(
  mode: BookingSheetMode,
  booking: BookingSheetBooking,
  over: Partial<BookingSheetProps> = {},
  depositPence = 0,
): BookingSheetProps {
  const payments = over.payments ?? [];
  const money = bookingMoney({
    booking: {
      status: booking.status,
      starts_at: "2026-11-14T19:00:00.000Z",
      ends_at: "2026-11-15T00:00:00.000Z",
      total_pence: booking.total_pence,
      deposit_pence: depositPence || null,
      deposit_due_date: null,
      balance_due_date: null,
      security_deposit_pence: booking.security_deposit_pence,
      security_deposit_returned_at: booking.security_deposit_returned_at,
      quote_accepted_at: null,
      chaser_sent_at: booking.chaser_sent_at,
      final_chaser_sent_at: booking.final_chaser_sent_at,
    },
    payments,
    clashes: [],
  });

  return {
    bookingId: BOOKING_ID,
    mode,
    onClose: () => {},
    booking,
    roomName: "The Function Room",
    when: { date: "2026-11-14", startTime: "19:00", endTime: "00:00" },
    money,
    payments,
    securityPaidPence: money.securityPaidPence,
    rooms: [
      { id: "room-1", name: "The Function Room" },
      { id: "room-2", name: "The Lounge" },
    ],
    editInitial: {
      resource_id: "room-1",
      date: "2026-11-14",
      start_time: "19:00",
      end_time: "00:00",
      booker_first_name: "Jane",
      booker_last_name: "Metcalfe",
      booker_email: "jane.metcalfe@example.com",
      booker_phone: "07700 900123",
      occasion: "60th birthday party",
      estimated_guests: "80",
      notes: "Hoping to get in from 6pm to decorate if the room is free.",
    },
    terms: {
      defaultDepositPence: 10000,
      defaultSecurityDepositPence: 10000,
      defaultMemberDiscountPence: booking.is_member ? 5000 : null,
      depositRuleLabel: "half the total cost, up to £100",
      depositRule: { percent: 50, capPence: 10000 },
      needsTerms: false,
    },
    canEdit: true,
    canDelete: true,
    canEditBooking: true,
    ...over,
  };
}

const CONFIRMED: BookingSheetBooking = {
  ...BASE,
  status: "confirmed",
  total_pence: 52000,
  security_deposit_pence: 10000,
  is_member: true,
  membership_type: "Social",
  member_number: "00123",
};

const fixture: Fixture = {
  cases: {
    /** An enquiry, on the form that prices it without taking the date. */
    enquiry: () => (
      <>
        <Page />
        <BookingSheet {...sheet("quote", BASE)} />
      </>
    ),

    /** The booker accepted in their portal: the total, the two deposits, the tick. */
    quotedAccepted: () => (
      <>
        <Page />
        <BookingSheet
          {...sheet("confirm", {
            ...BASE,
            status: "quoted",
            total_pence: 52000,
            is_member: true,
            membership_type: "Social",
            member_number: "00123",
          })}
        />
      </>
    ),

    /** Confirmed, nothing in yet: the ledger, with what is outstanding on it. */
    confirmedUnpaid: () => (
      <>
        <Page />
        <BookingSheet {...sheet("payment", CONFIRMED, {}, 10000)} />
      </>
    ),

    /** Everything paid and the event over: the deposit's return, recorded. */
    paidInFull: () => (
      <>
        <Page />
        <BookingSheet
          {...sheet("security", CONFIRMED, {
            payments: [
              payment({ id: "p3", amount_pence: 10000, paid_at: "2026-10-18", purpose: "security_deposit" }),
              payment({ id: "p2", amount_pence: 42000, paid_at: "2026-10-18", purpose: "balance" }),
              payment({ id: "p1", amount_pence: 10000, paid_at: "2026-10-10", purpose: "deposit", method: "card", source: "sumup" }),
            ],
          })}
        />
      </>
    ),

    /** Cancelled: the plain reply, which is the only door left on it. */
    cancelled: () => (
      <>
        <Page />
        <BookingSheet {...sheet("email", { ...BASE, status: "cancelled", total_pence: 52000 })} />
      </>
    ),

    // ---- the doors no status bar proposes ---------------------------------

    /** The chaser and the one-time final offer, on a quote nobody answered. */
    chase: () => (
      <>
        <Page />
        <BookingSheet
          {...sheet("chase", {
            ...BASE,
            status: "quoted",
            total_pence: 52000,
            chaser_sent_at: "2026-10-01T09:00:00.000Z",
          })}
        />
      </>
    ),

    /** Cancelling, with the reason that is emailed to the booker. */
    cancel: () => (
      <>
        <Page />
        <BookingSheet {...sheet("cancel", CONFIRMED)} />
      </>
    ),

    /** Super user only: the booking's own fields, room and window included. */
    edit: () => (
      <>
        <Page />
        <BookingSheet {...sheet("edit", CONFIRMED)} />
      </>
    ),

    /** Committee only, and told plainly what it takes with it. */
    remove: () => (
      <>
        <Page />
        <BookingSheet {...sheet("delete", CONFIRMED)} />
      </>
    ),

    /** A hand-typed `?sheet=edit` from somebody whose role cannot: no form. */
    notYours: () => (
      <>
        <Page />
        <BookingSheet {...sheet("edit", CONFIRMED, { canEditBooking: false })} />
      </>
    ),
  },
};

export default fixture;
