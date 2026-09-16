/**
 * One hire, in the five states the desk meets it in (P8.1a).
 *
 * The cases are chosen so that between them every tone the status bar can take
 * is photographed once — `pending` (the desk's own move), `waiting` (waiting on
 * the booker), `done` (settled and quiet) and `error` (a clash) — because the
 * bar is the whole point of the screen and a tone is the one thing a unit test
 * cannot show you.
 *
 * `record.tsx` is a plain module, not `"use client"`, so it mounts here exactly
 * as the page renders it: the fixture supplies the rows the page would have
 * read and calls the same two pure helpers the page calls. The panels inside it
 * ARE client components importing `../actions`, which the harness swaps for its
 * no-op shim — so the forms draw and the buttons are real, but pressing one
 * does nothing. Anything that only exists after a server round trip (the
 * expanded confirm form, a payment just added, "Sent — it is in the email log")
 * is therefore not covered here.
 *
 * `now` is fixed at 5 October 2026 so a due date is the same distance away
 * every time this runs.
 */

import { BookingRecord, type BookingRecordProps, type BookingRecordRow } from "@/app/(app)/room-bookings/[id]/record";
import {
  bookingMoney,
  bookingNextAction,
  type BookingFacts as NextActionBooking,
  type BookingClash,
} from "@/lib/booking-next-action";
import type { PaymentRow } from "@/app/(app)/room-bookings/payments-panel";

import type { Fixture } from "./contract";

const NOW = new Date("2026-10-05T11:00:00.000Z");
const BOOKING_ID = "7f3c2a10-0000-4000-8000-000000000001";

/** Everything the record draws plus everything the state machine reads. */
type FakeBooking = BookingRecordRow & NextActionBooking;

const BASE: FakeBooking = {
  // --- the state machine's columns ---
  status: "enquiry",
  starts_at: "2026-11-14T19:00:00.000Z",
  ends_at: "2026-11-15T00:00:00.000Z",
  total_pence: 48000,
  deposit_pence: null,
  deposit_due_date: null,
  balance_due_date: null,
  security_deposit_pence: null,
  security_deposit_returned_at: null,
  quote_accepted_at: null,
  chaser_sent_at: null,
  final_chaser_sent_at: null,
  // --- the facts band ---
  estimated_guests: 80,
  occasion: "60th birthday party",
  base_hire_pence: 40000,
  extras_total_pence: 8000,
  selected_extras: null,
  member_discount_pence: null,
  member_checked_at: null,
  member_checked_by_email: null,
  final_chaser_discount_pence: null,
  is_member: false,
  membership_type: null,
  member_number: null,
  team_name: null,
  child_name: null,
  child_team: null,
  // --- the folds ---
  kind: "public",
  booker_name: "Jane Metcalfe",
  booker_first_name: "Jane",
  booker_last_name: "Metcalfe",
  booker_email: "jane.metcalfe@example.com",
  booker_phone: "07700 900123",
  notes: "Hoping to get in from 6pm to decorate if the room is free.",
  internal_notes: "",
  payment_status: "unpaid",
  security_deposit_returned_method: null,
  security_deposit_returned_note: null,
  created_at: "2026-09-28T09:12:00.000Z",
};

const EMAILS = [
  {
    id: "e1",
    at: "2026-10-02T14:02:00.000Z",
    to: "jane.metcalfe@example.com",
    subject: "Your enquiry — The Function Room, 14 November",
    via: "sent",
  },
  {
    id: "e2",
    at: "2026-09-28T09:13:00.000Z",
    to: "jane.metcalfe@example.com",
    subject: "We have your enquiry",
    via: "sent",
  },
];

const ROOMS = [
  { id: "room-1", name: "The Function Room" },
  { id: "room-2", name: "The Lounge" },
];

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

/** The page's own assembly, done once here so a case is only its differences. */
function record(
  booking: FakeBooking,
  over: Partial<BookingRecordProps> = {},
): BookingRecordProps {
  const payments = over.payments ?? [];
  const clashes = over.clashes ?? [];
  const input = { booking, payments, clashes: clashes as BookingClash[] };
  const money = bookingMoney(input);

  return {
    bookingId: BOOKING_ID,
    shortRef: "7F3C2A10",
    roomName: "The Function Room",
    when: { date: "2026-11-14", startTime: "19:00", endTime: "00:00" },
    booking,
    money,
    nextAction: bookingNextAction(input, { voice: "desk", now: NOW }),
    clashes,
    holdsRoom: booking.status === "confirmed" || booking.status === "pending",
    payments,
    securityPaidPence: money.securityPaidPence,
    emailLog: EMAILS,
    rooms: ROOMS,
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
      notes: booking.notes ?? "",
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
    saveNote: async () => {},
    ...over,
  };
}

const fixture: Fixture = {
  cases: {
    /** Asked, never priced. The bar's move is the desk's: send a quote. */
    enquiry: () => <BookingRecord {...record(BASE)} />,

    /** The booker has said yes in their portal — the desk only has to confirm. */
    quotedAccepted: () => (
      <BookingRecord
        {...record({
          ...BASE,
          status: "quoted",
          total_pence: 52000,
          quote_accepted_at: "2026-10-04T18:40:00.000Z",
          internal_notes: "Wants the bar open until midnight; Lyndsey has said that is fine.",
        })}
      />
    ),

    /** Confirmed with terms, deposit not in yet and not yet late: the quiet wait. */
    confirmedUnpaid: () => (
      <BookingRecord
        {...record({
          ...BASE,
          status: "confirmed",
          total_pence: 52000,
          deposit_pence: 10000,
          deposit_due_date: "2026-10-12",
          balance_due_date: "2026-10-31",
          security_deposit_pence: 10000,
          member_discount_pence: 5000,
          member_checked_at: "2026-10-03T10:00:00.000Z",
          member_checked_by_email: "lyndsey@example.com",
          is_member: true,
          membership_type: "Social",
          member_number: "00123",
          internal_notes: "Cash bar. Two long tables down the middle, not the usual horseshoe.",
        })}
      />
    ),

    /** Everything in, event been, deposit returned: the bar goes quiet. */
    paidInFull: () => {
      const booking: FakeBooking = {
        ...BASE,
        status: "confirmed",
        starts_at: "2026-10-03T19:00:00.000Z",
        ends_at: "2026-10-04T00:00:00.000Z",
        total_pence: 52000,
        deposit_pence: 10000,
        deposit_due_date: "2026-09-12",
        balance_due_date: "2026-09-19",
        security_deposit_pence: 10000,
        security_deposit_returned_at: "2026-10-05T08:30:00.000Z",
        security_deposit_returned_method: "bank transfer",
        security_deposit_returned_note: "Room left clean; full £100 back.",
        payment_status: "paid",
      };
      return (
        <BookingRecord
          {...record(booking, {
            payments: [
              payment({ id: "p3", amount_pence: 10000, paid_at: "2026-09-18", purpose: "security_deposit" }),
              payment({ id: "p2", amount_pence: 42000, paid_at: "2026-09-18", purpose: "balance" }),
              payment({ id: "p1", amount_pence: 10000, paid_at: "2026-09-10", purpose: "deposit", method: "card", source: "sumup" }),
            ],
          })}
        />
      );
    },

    /**
     * Cancelled, and the night has since gone to somebody else. The clash
     * outranks every other branch, which is the bar's most important rule.
     */
    cancelledWithClash: () => (
      <BookingRecord
        {...record(
          {
            ...BASE,
            status: "cancelled",
            total_pence: 52000,
            chaser_sent_at: "2026-10-01T09:00:00.000Z",
            internal_notes: "Rang to say the date had moved; said we would keep her details.",
          },
          {
            clashes: [
              {
                id: "9a1b2c3d-0000-4000-8000-000000000002",
                who: "Priya Desai",
                status: "confirmed",
                when: "18:30–23:30",
              },
            ],
          },
        )}
      />
    ),
  },
};

export default fixture;
