"use client";

/**
 * One hire's doors, in a sheet (P8.1b).
 *
 * Everything the desk does to a booking used to be a panel sitting on the
 * record page: a sidebar of five buttons that opened five inline forms, a
 * payments card, a security-deposit card, a reply form, an edit form and a
 * danger zone — nine surfaces, all on screen at once, all of them empty most
 * of the time. They are one sheet now, and `mode` says which one is open:
 * bottom sheet on a phone, right-hand drawer at `lg`.
 *
 * The mode lives in the URL as `?sheet=<mode>` (see `[id]/sheet-route.tsx`),
 * which is what makes it survive a server-action refresh — the old inline
 * forms lost their place every time one of their own actions re-rendered the
 * page underneath them — and what lets the desk list (P8.2) open a booking
 * straight onto the thing it needs, with no state to hand across.
 *
 * The sheet is CONTROLLED: it owns no `mode` of its own and never navigates.
 * That is the contract the desk needs, because there the mode is a row's own
 * state rather than the page's URL.
 *
 * Every gate is the one the page already applied, and every server action is
 * called with the arguments it has always taken; this file moved the forms,
 * it did not rewrite them.
 */

import Link from "next/link";

import { formatBookingDate, type BookingWindow } from "@/lib/booking-time";
import type { BookingMoney, BookingSheetMode as BookingActionMode } from "@/lib/booking-next-action";
import { Callout } from "@/components/ui/callout";
import { Sheet } from "@/components/ui/sheet";

import { DeleteBookingButton } from "./delete-booking-button";
import { EditBookingForm } from "./edit-booking-form";
import { PaymentsPanel, type PaymentRow } from "./payments-panel";
import { ReplyForm } from "./reply-form";
import { SecurityDepositCard } from "./security-deposit-card";
import { CancelForm, ChaseForm, ConfirmForm, QuoteForm } from "./status-form";

/**
 * The doors this sheet has. It is the desk's list: `bookingNextAction()`'s
 * desk modes, plus `edit` and `delete`, which are gated acts no status bar
 * ever proposes.
 */
export const BOOKING_SHEET_MODES = [
  "quote",
  "confirm",
  "chase",
  "cancel",
  "payment",
  "security",
  "email",
  "edit",
  "delete",
] as const;

export type BookingSheetMode = (typeof BOOKING_SHEET_MODES)[number];

export function isBookingSheetMode(value: unknown): value is BookingSheetMode {
  return typeof value === "string" && (BOOKING_SHEET_MODES as readonly string[]).includes(value);
}

/**
 * The mode a status bar's action opens. `bookingNextAction()` also answers in
 * the booker's voice, whose `accept` / `pay` / `view` are `/portal`'s doors and
 * not the desk's, so those come back as null here.
 */
export function deskSheetMode(mode: BookingActionMode | undefined): BookingSheetMode | null {
  return mode && isBookingSheetMode(mode) ? mode : null;
}

/** The columns every mode of the sheet reads off the booking. */
export type BookingSheetBooking = {
  status: string;
  kind: string;
  booker_email: string;
  total_pence: number | null;
  security_deposit_pence: number | null;
  security_deposit_returned_at: string | null;
  security_deposit_returned_method: string | null;
  security_deposit_returned_note: string | null;
  is_member: boolean;
  membership_type: string | null;
  member_number: string | null;
  chaser_sent_at: string | null;
  final_chaser_sent_at: string | null;
  final_chaser_discount_pence: number | null;
};

/** The confirm form's prefills, worked out server-side from the club's rule. */
export type BookingSheetTerms = {
  defaultDepositPence: number;
  defaultSecurityDepositPence: number;
  defaultMemberDiscountPence: number | null;
  depositRuleLabel: string;
  depositRule: import("@/lib/hire-terms").DepositRule | null;
  needsTerms: boolean;
};

export type BookingSheetProps = {
  bookingId: string;
  /** Which door is open. `null` draws nothing at all. */
  mode: BookingSheetMode | null;
  onClose: () => void;
  booking: BookingSheetBooking;
  roomName: string;
  /** The London wall clock, for the sheet's subtitle and the email's subject. */
  when: BookingWindow;
  money: BookingMoney;
  payments: PaymentRow[];
  securityPaidPence: number;
  rooms: { id: string; name: string }[];
  editInitial: React.ComponentProps<typeof EditBookingForm>["initial"];
  terms: BookingSheetTerms;
  /** `isStaff` — quote, confirm, chase and cancel. */
  canEdit: boolean;
  /** `isCommittee` — delete the booking, and delete a payment off it. */
  canDelete: boolean;
  /** `isSuperUser` — edit the booking's own fields. */
  canEditBooking: boolean;
  /**
   * Where the whole record is, when the sheet was opened from somewhere that
   * is not it (the desk, P8.2). The booker's details, the internal notes, the
   * email log and the clash banner live on the record and nowhere else, so a
   * sheet opened over a month needs a way through to them. Omitted on the
   * record page itself, where the link would lead back to where you are.
   */
  recordHref?: string;
};

/** What the sheet is called, which depends on where the booking stands. */
function titleFor(mode: BookingSheetMode, booking: BookingSheetBooking, needsTerms: boolean): string {
  switch (mode) {
    case "quote":
      return booking.status === "quoted"
        ? "Re-send the quote"
        : booking.status === "cancelled"
          ? "Re-quote and reopen"
          : "Send a quote";
    case "confirm":
      return needsTerms ? "Set the price and terms" : "Confirm the booking";
    case "chase":
      return "Chase this booker";
    case "cancel":
      return "Cancel the booking";
    case "payment":
      return "Payments";
    case "security":
      return "Security deposit";
    case "email":
      return "Email the booker";
    case "edit":
      return "Edit the booking";
    case "delete":
      return "Delete the booking";
  }
}

export function BookingSheet(props: BookingSheetProps) {
  const {
    bookingId,
    mode,
    onClose,
    booking,
    roomName,
    when,
    money,
    payments,
    securityPaidPence,
    rooms,
    editInitial,
    terms,
    canEdit,
    canDelete,
    canEditBooking,
    recordHref,
  } = props;

  if (!mode) return null;

  // A hand-typed `?sheet=` must not turn into a door somebody's role does not
  // have. The server action would refuse it anyway, but being told so by a
  // failed request is a worse way to find out than being told here.
  const allowed =
    mode === "edit" ? canEditBooking : mode === "delete" ? canDelete : mode === "payment" ? true : canEdit;

  return (
    <Sheet
      open
      onClose={onClose}
      side="drawer"
      width={480}
      title={titleFor(mode, booking, terms.needsTerms)}
      subtitle={`${roomName} · ${formatBookingDate(when.date)} · ${when.startTime}–${when.endTime}`}
      headerAction={
        recordHref ? (
          <Link
            href={recordHref}
            className="touch inline-flex items-center text-list font-medium text-primary hover:underline"
          >
            The record
          </Link>
        ) : undefined
      }
    >
      {!allowed ? (
        <Callout tone="warning" title="Not yours to do">
          Your role cannot do that to a booking. Close this and the rest of the record is unchanged.
        </Callout>
      ) : mode === "quote" ? (
        <QuoteForm
          bookingId={bookingId}
          currentStatus={booking.status}
          currentTotalPence={booking.total_pence}
          onDone={onClose}
        />
      ) : mode === "confirm" ? (
        <ConfirmForm
          bookingId={bookingId}
          needsTerms={terms.needsTerms}
          defaultDepositPence={terms.defaultDepositPence}
          currentTotalPence={money.totalPence || null}
          currentDepositPence={money.depositPence || null}
          currentSecurityDepositPence={booking.security_deposit_pence}
          depositRuleLabel={terms.depositRuleLabel}
          depositRule={terms.depositRule}
          defaultSecurityDepositPence={terms.defaultSecurityDepositPence}
          defaultMemberDiscountPence={terms.defaultMemberDiscountPence}
          isMember={booking.is_member}
          memberLabel={[booking.membership_type, booking.member_number].filter(Boolean).join(" · ") || null}
          onDone={onClose}
        />
      ) : mode === "chase" ? (
        <ChaseForm
          bookingId={bookingId}
          currentStatus={booking.status}
          currentTotalPence={booking.total_pence}
          chaserSentAt={booking.chaser_sent_at}
          finalChaserSentAt={booking.final_chaser_sent_at}
          finalChaserDiscountPence={booking.final_chaser_discount_pence}
          onDone={onClose}
        />
      ) : mode === "cancel" ? (
        <CancelForm bookingId={bookingId} onDone={onClose} />
      ) : mode === "payment" ? (
        <PaymentsPanel
          bookingId={bookingId}
          payments={payments}
          totalPence={money.totalPence}
          depositPence={money.depositPence}
          securityDepositPence={money.securityDepositPence}
          canDelete={canDelete}
        />
      ) : mode === "security" ? (
        <SecurityDepositCard
          bookingId={bookingId}
          amountPence={money.securityDepositPence}
          paidPence={securityPaidPence}
          returnedAt={booking.security_deposit_returned_at}
          returnedMethod={booking.security_deposit_returned_method}
          returnedNote={booking.security_deposit_returned_note}
        />
      ) : mode === "email" ? (
        <ReplyForm
          bookingId={bookingId}
          bookerEmail={booking.booker_email}
          defaultSubject={`Re: your ${booking.status === "enquiry" ? "enquiry" : "booking"} — ${roomName}, ${formatBookingDate(when.date)}`}
        />
      ) : mode === "edit" ? (
        <EditBookingForm bookingId={bookingId} rooms={rooms} initial={editInitial} />
      ) : (
        <div className="space-y-3">
          <Callout tone="danger" title="This cannot be undone">
            The booking, its payments and its email history go with it. If the date has simply fallen
            through, cancel it instead — that tells the booker and keeps the record.
          </Callout>
          <DeleteBookingButton id={bookingId} label="Delete this booking" />
        </div>
      )}
    </Sheet>
  );
}
