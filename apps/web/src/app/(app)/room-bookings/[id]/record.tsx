/**
 * The booking record — one hire, and the next thing the desk does about it
 * (P8.1a).
 *
 * The page used to be three columns of nine `<Card>`s, and finding "what do I
 * press now" meant reading all of them: the actions were bottom-right, the
 * money top-right, the clash top-left, and the answer was never written down
 * anywhere. Now it reads top to bottom in the makeover's vocabulary:
 *
 *   1. THE CLASH, if there is one — it outranks every other thing on the page,
 *      because confirming over a booking that is holding the room is a
 *      constraint error waiting to happen.
 *   2. THE STATUS BAR — `bookingNextAction()` in the desk's voice: one
 *      sentence of where this hire stands, one line of why, and the ONE
 *      button that moves it on. Sticky under the header on a phone, so the
 *      answer stays on screen while the desk scrolls the detail.
 *   3. THE FACTS — eight tiles, the cost in its parts, and Total / Paid /
 *      Outstanding.
 *   4. WHAT THE DESK DOES — the status, payments, security deposit and reply
 *      panels, each behind the gate it has always had. The bar's button
 *      scrolls to whichever of them it means. (P8.1b lifts these four into
 *      `BookingSheet`; the bar's button opens the matching mode instead, and
 *      everything above this line stays exactly as it is.)
 *   5. FOLDED BENEATH — booker, internal notes, emails sent, and the record
 *      itself (edit, reference, delete), each row saying what it holds.
 *
 * Every read is the page's; every write is the same server action with the
 * same gate. Nothing here is `"use client"`, so the fixture can mount it.
 */

import Link from "next/link";
import {
  ClipboardList,
  Mail,
  NotebookPen,
  TriangleAlert,
  UserRound,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { FoldCard } from "@/components/ui/fold-card";
import { ActionBar } from "@/components/ui/action-bar";
import type { BookingMoney, BookingNextAction, BookingSheetMode } from "@/lib/booking-next-action";
import { formatBookingDate, type BookingWindow } from "@/lib/booking-time";
import type { DepositRule } from "@/lib/hire-terms";
import { formatCurrency } from "@/lib/utils";

import { BookingFacts, bookingActionIcon, bookingStatusLook, type BookingFactsRow } from "../booking-facts";
import { DeleteBookingButton } from "../delete-booking-button";
import { EditBookingForm } from "../edit-booking-form";
import type { PaymentRow } from "../payments-panel";
import { PaymentsPanel } from "../payments-panel";
import { ReplyForm } from "../reply-form";
import { SecurityDepositCard } from "../security-deposit-card";
import { StatusForm } from "../status-form";

/** A row `booking_conflicts()` gave back, already put into words by the page. */
export type BookingClashLine = { id: string; who: string; status: string; when: string };

export type BookingEmailLine = {
  id: string;
  at: string | null;
  to: string;
  subject: string;
  via: string;
};

/** Everything the record draws that is not a fact or a figure. */
export type BookingRecordRow = BookingFactsRow & {
  kind: string;
  booker_name: string;
  booker_first_name: string | null;
  booker_last_name: string | null;
  booker_email: string;
  booker_phone: string | null;
  notes: string | null;
  internal_notes: string | null;
  payment_status: string;
  security_deposit_returned_at: string | null;
  security_deposit_returned_method: string | null;
  security_deposit_returned_note: string | null;
  chaser_sent_at: string | null;
  final_chaser_sent_at: string | null;
  created_at: string;
};

/** The confirm/quote/chase/cancel panel's own prefills, worked out by the page. */
export type BookingTermsPrefill = {
  defaultDepositPence: number;
  defaultSecurityDepositPence: number;
  defaultMemberDiscountPence: number | null;
  depositRuleLabel: string;
  depositRule: DepositRule | null;
  needsTerms: boolean;
};

export type BookingRecordProps = {
  bookingId: string;
  shortRef: string;
  roomName: string;
  when: BookingWindow;
  booking: BookingRecordRow;
  money: BookingMoney;
  nextAction: BookingNextAction;
  clashes: BookingClashLine[];
  /** Confirmed or pending: this row is the one the no-overlap rule arbitrates. */
  holdsRoom: boolean;
  payments: PaymentRow[];
  securityPaidPence: number;
  emailLog: BookingEmailLine[];
  rooms: { id: string; name: string }[];
  editInitial: React.ComponentProps<typeof EditBookingForm>["initial"];
  terms: BookingTermsPrefill;
  canEdit: boolean;
  canDelete: boolean;
  canEditBooking: boolean;
  /** The page's own `"use server"` wrapper around `addInternalNote`. */
  saveNote: (formData: FormData) => Promise<void>;
};

/**
 * The button's own words.
 *
 * `bookingNextAction()` hands back a `label` that is the headline — "Waiting on
 * the deposit", "Send a quote" — and the headline is what the bar says. Half of
 * those are states rather than acts, and a button has to be an act, so the
 * mode names the door: waiting on a deposit, the thing to press is "Record a
 * payment", because a bank transfer landing is how that wait ends.
 */
const MODE_BUTTON: Record<BookingSheetMode, string> = {
  quote: "Send a quote",
  confirm: "Confirm & notify",
  chase: "Send a chaser",
  cancel: "Cancel the booking",
  payment: "Record a payment",
  security: "Mark it returned",
  email: "Email the booker",
  accept: "Accept the quote",
  pay: "Take a payment",
  view: "See the detail",
};

/** Where the bar's button lands while the panels are still on the page. */
const ANCHOR: Record<BookingSheetMode, string> = {
  quote: "#booking-actions",
  confirm: "#booking-actions",
  chase: "#booking-actions",
  cancel: "#booking-actions",
  payment: "#booking-payments",
  security: "#booking-security",
  email: "#booking-email",
  accept: "#booking-actions",
  pay: "#booking-payments",
  view: "#booking-facts",
};

/** "3 Sep 2026", the way a stamp reads in a fold's summary. */
function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function dayAndTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** A card in the working area — a plain surface with a title above it. */
function Panel({
  id,
  title,
  badge,
  children,
}: {
  id: string;
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 rounded-xl border bg-card p-4 shadow-sm lg:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-row font-semibold leading-tight">{title}</h2>
        {badge}
      </div>
      {children}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-words font-medium">{value || "—"}</p>
    </div>
  );
}

export function BookingRecord(props: BookingRecordProps) {
  const {
    bookingId,
    shortRef,
    roomName,
    when,
    booking,
    money,
    nextAction,
    clashes,
    holdsRoom,
    payments,
    securityPaidPence,
    emailLog,
    rooms,
    editInitial,
    terms,
    canEdit,
    canDelete,
    canEditBooking,
    saveNote,
  } = props;

  const look = bookingStatusLook(booking.status);
  const canEmail = booking.kind !== "block" && booking.booker_email.includes("@");
  const anchor = nextAction.mode ? ANCHOR[nextAction.mode] : "#booking-facts";
  const buttonWords = nextAction.mode ? MODE_BUTTON[nextAction.mode] : nextAction.label;

  // The four folds' closed summaries — real text, worked out here, so a row is
  // worth reading without opening it.
  const bookerSummary = [booking.booker_name, booking.booker_email, booking.booker_phone]
    .filter(Boolean)
    .join(" · ");
  const note = (booking.internal_notes ?? "").trim();
  const noteSummary = note
    ? note.length > 60
      ? `${note.slice(0, 60)}…`
      : note
    : "Nothing written down yet — staff only";
  const lastEmail = emailLog[0];
  const emailSummary =
    emailLog.length === 0
      ? "Nothing sent about this booking yet"
      : `${emailLog.length} email${emailLog.length === 1 ? "" : "s"}${
          lastEmail ? ` · last: ${lastEmail.subject}${lastEmail.at ? `, ${day(lastEmail.at)}` : ""}` : ""
        }`;
  const recordSummary = `Received ${day(booking.created_at)} · #${shortRef}`;

  return (
    <div className="space-y-4 p-4 lg:p-6">
      {/* 1. The clash. A row that is NOT holding the room may sit on top of one
          that is — an enquiry or a quote about a taken night is allowed, asking
          is free — but the desk must see it before it reaches for Confirm. */}
      {clashes.length > 0 && (
        <Callout
          tone="danger"
          icon={<TriangleAlert className="h-4 w-4" aria-hidden />}
          title={
            holdsRoom
              ? "Another booking overlaps this one on the same room"
              : booking.status === "cancelled"
                ? "This slot has since been taken — it cannot be re-quoted"
                : "This slot is already taken — this request is not holding the room"
          }
        >
          <ul className="mt-1 space-y-1">
            {clashes.map((clash) => (
              <li key={clash.id}>
                {/* A thumb-sized target: on a phone this link is the way to the
                    booking that is in the way, and it is read standing up. */}
                <Link
                  href={`/room-bookings/${clash.id}`}
                  className="touch inline-flex items-center font-medium underline-offset-2 hover:underline"
                >
                  {clash.who}
                </Link>{" "}
                · {clash.when} · {clash.status}
              </li>
            ))}
          </ul>
          {!holdsRoom && booking.status !== "cancelled" && (
            <p className="mt-1.5">
              Confirming this one will be refused while the other stands. Reply with alternatives, or
              cancel the other booking first.
            </p>
          )}
        </Callout>
      )}

      {/* 2. The one thing to do next. */}
      <ActionBar
        className="sticky top-[var(--mobile-header-h)] z-20 lg:static"
        icon={bookingActionIcon(nextAction.key)}
        tone={nextAction.tone}
        status={nextAction.label}
        detail={nextAction.why}
        action={
          <a
            href={anchor}
            className={buttonVariants({
              size: "touch",
              // Nothing is outstanding: the bar goes quiet and the button with it.
              variant: nextAction.tone === "done" ? "outline" : "default",
            })}
          >
            {bookingActionIcon(nextAction.key)}
            {buttonWords}
          </a>
        }
      />

      {/* 3. The facts. */}
      <div id="booking-facts" className="scroll-mt-24">
        <BookingFacts booking={booking} roomName={roomName} when={when} money={money} />
      </div>

      {/* 4. What the desk does. */}
      {canEdit && (
        <Panel
          id="booking-actions"
          title="What happens next"
          badge={
            <Badge variant={look.badge} className="capitalize">
              {booking.status}
            </Badge>
          }
        >
          <StatusForm
            bookingId={bookingId}
            currentStatus={booking.status}
            isStaff={canEdit}
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
            needsTerms={terms.needsTerms}
            chaserSentAt={booking.chaser_sent_at}
            finalChaserSentAt={booking.final_chaser_sent_at}
            finalChaserDiscountPence={booking.final_chaser_discount_pence}
          />
        </Panel>
      )}

      <Panel
        id="booking-payments"
        title="Payments"
        badge={
          <Badge variant={booking.payment_status === "paid" ? "success" : "muted"} className="capitalize">
            {booking.payment_status.replace("_", " ")}
          </Badge>
        }
      >
        <PaymentsPanel
          bookingId={bookingId}
          payments={payments}
          totalPence={money.totalPence}
          depositPence={money.depositPence}
          securityDepositPence={money.securityDepositPence}
          canDelete={canDelete}
        />
      </Panel>

      {money.securityDepositPence > 0 && (
        <Panel
          id="booking-security"
          title="Security deposit"
          badge={
            <Badge variant={booking.security_deposit_returned_at ? "success" : "muted"}>
              {booking.security_deposit_returned_at
                ? "Returned"
                : `${formatCurrency(securityPaidPence)} held`}
            </Badge>
          }
        >
          <SecurityDepositCard
            bookingId={bookingId}
            amountPence={money.securityDepositPence}
            paidPence={securityPaidPence}
            returnedAt={booking.security_deposit_returned_at}
            returnedMethod={booking.security_deposit_returned_method}
            returnedNote={booking.security_deposit_returned_note}
          />
        </Panel>
      )}

      {/* A plain reply from the desk (Adam, 2026-09-11), logged and audited.
          Any booking with an address, not only an enquiry. */}
      {canEmail && (
        <Panel id="booking-email" title="Email the booker">
          <ReplyForm
            bookingId={bookingId}
            bookerEmail={booking.booker_email}
            defaultSubject={`Re: your ${booking.status === "enquiry" ? "enquiry" : "booking"} — ${roomName}, ${formatBookingDate(when.date)}`}
          />
        </Panel>
      )}

      {/* 5. Folded beneath. */}
      <div className="space-y-2 pt-2">
        <FoldCard
          icon={<UserRound className="h-4 w-4" aria-hidden />}
          title="Booker"
          summary={bookerSummary}
        >
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
            {booking.booker_first_name ? (
              <>
                <Detail label="First name" value={booking.booker_first_name} />
                <Detail label="Last name" value={booking.booker_last_name ?? "—"} />
              </>
            ) : (
              <Detail label="Name" value={booking.booker_name} />
            )}
            <Detail label="Email" value={booking.booker_email} />
            <Detail label="Mobile" value={booking.booker_phone ?? "—"} />
          </div>
          {booking.notes && (
            <div className="mt-4">
              <p className="text-xs uppercase text-muted-foreground">Notes from the booker</p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm">{booking.notes}</p>
            </div>
          )}
        </FoldCard>

        <FoldCard
          icon={<NotebookPen className="h-4 w-4" aria-hidden />}
          title="Internal notes"
          summary={noteSummary}
        >
          <form action={saveNote} className="space-y-3">
            <label htmlFor="internal_notes" className="block text-xs uppercase text-muted-foreground">
              Staff only — the booker never sees these
            </label>
            <textarea
              id="internal_notes"
              name="internal_notes"
              rows={4}
              defaultValue={booking.internal_notes ?? ""}
              placeholder="Add notes visible only to staff…"
              className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <button type="submit" className={buttonVariants({ size: "touch", className: "w-full lg:w-auto" })}>
              Save notes
            </button>
          </form>
        </FoldCard>

        <FoldCard
          icon={<Mail className="h-4 w-4" aria-hidden />}
          title="Emails sent"
          summary={emailSummary}
        >
          {emailLog.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing sent about this booking yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {emailLog.slice(0, 12).map((m) => (
                <li key={m.id} className="border-b pb-2 last:border-b-0 last:pb-0">
                  <p className="font-medium leading-snug">{m.subject}</p>
                  <p className="text-xs text-muted-foreground">
                    {m.at ? dayAndTime(m.at) : "—"} · {m.to} · {m.via}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </FoldCard>

        <FoldCard
          icon={<ClipboardList className="h-4 w-4" aria-hidden />}
          title="The booking record"
          summary={recordSummary}
        >
          <div className="space-y-4">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Received</dt>
                <dd>{day(booking.created_at)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Reference</dt>
                <dd className="font-mono text-xs">#{shortRef}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Room</dt>
                <dd>{roomName}</dd>
              </div>
            </dl>

            {canEditBooking ? (
              <div className="border-t pt-4">
                <p className="mb-3 text-xs uppercase text-muted-foreground">Edit this booking</p>
                <EditBookingForm bookingId={bookingId} rooms={rooms} initial={editInitial} />
              </div>
            ) : null}

            {canDelete ? (
              <div className="border-t pt-4">
                <p className="mb-3 text-xs uppercase text-muted-foreground">Danger zone</p>
                <DeleteBookingButton id={bookingId} label="Delete this booking" />
              </div>
            ) : null}
          </div>
        </FoldCard>
      </div>
    </div>
  );
}
