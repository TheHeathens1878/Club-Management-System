/**
 * The booking record — one hire, and the next thing the desk does about it
 * (P8.1).
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
 *      button that moves it on. Under it, the other doors this booking's
 *      status allows, small. Sticky under the header on a phone, so the
 *      answer stays on screen while the desk scrolls the detail.
 *   3. THE FACTS — eight tiles, the cost in its parts, and Total / Paid /
 *      Outstanding, the last two of which are themselves the door to the
 *      payments.
 *   4. FOLDED BENEATH — booker, internal notes, emails sent, and the record
 *      itself (received, reference, edit, delete), each row saying what it
 *      holds.
 *
 * Every door is a link to `?sheet=<mode>`, and `BookingSheet` is what opens
 * there: nine forms that used to be nine panels permanently on the page. The
 * mode being a URL is what makes it survive a server-action refresh.
 *
 * Every read is the page's; every write is the same server action with the
 * same gate. Nothing here is `"use client"`, so the fixture can mount it.
 */

import { Suspense } from "react";
import Link from "next/link";
import { ClipboardList, Mail, NotebookPen, TriangleAlert, UserRound } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { FoldCard } from "@/components/ui/fold-card";
import { ActionBar } from "@/components/ui/action-bar";
import type { BookingMoney, BookingNextAction } from "@/lib/booking-next-action";
import { type BookingWindow } from "@/lib/booking-time";

import { BookingFacts, bookingActionIcon, type BookingFactsRow } from "../booking-facts";
import { deskSheetMode, type BookingSheetMode } from "../booking-sheet-modes";
import type { BookingSheetBooking, BookingSheetProps, BookingSheetTerms } from "../booking-sheet";
import type { PaymentRow } from "../payments-panel";
import { BookingSheetRoute } from "./sheet-route";

/** A row `booking_conflicts()` gave back, already put into words by the page. */
export type BookingClashLine = { id: string; who: string; status: string; when: string };

export type BookingEmailLine = {
  id: string;
  at: string | null;
  to: string;
  subject: string;
  via: string;
};

/** Everything the record draws that is not a fact, a figure or a sheet's field. */
export type BookingRecordRow = BookingFactsRow &
  BookingSheetBooking & {
    booker_name: string;
    booker_first_name: string | null;
    booker_last_name: string | null;
    booker_phone: string | null;
    notes: string | null;
    internal_notes: string | null;
    payment_status: string;
    created_at: string;
  };

/** The confirm form's prefills, worked out by the page from the club's rule. */
export type BookingTermsPrefill = BookingSheetTerms;

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
  editInitial: BookingSheetProps["editInitial"];
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
  edit: "Edit the booking",
  delete: "Delete the booking",
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

  const canEmail = booking.kind !== "block" && booking.booker_email.includes("@");
  const door = (mode: BookingSheetMode) => `/room-bookings/${bookingId}?sheet=${mode}`;
  const primary = deskSheetMode(nextAction.mode);

  // Which doors this booking's status allows, exactly as the old sidebar's five
  // buttons decided which of themselves to draw. The one the status bar is
  // already offering is left out of the row, so it is never on screen twice.
  const status = booking.status;
  const doors: { mode: BookingSheetMode; label: string }[] = [];
  if (canEdit && ["enquiry", "pending", "quoted", "cancelled"].includes(status)) {
    doors.push({
      mode: "quote",
      label:
        status === "quoted" ? "Re-quote" : status === "cancelled" ? "Re-quote & reopen" : "Send a quote",
    });
  }
  if (canEdit && ["enquiry", "quoted"].includes(status)) {
    doors.push({ mode: "chase", label: booking.chaser_sent_at ? "Chase again" : "Send a chaser" });
  }
  if (canEdit && (["enquiry", "quoted", "pending"].includes(status) || terms.needsTerms)) {
    doors.push({ mode: "confirm", label: terms.needsTerms ? "Set the price and terms" : "Confirm" });
  }
  doors.push({ mode: "payment", label: "Payments" });
  if (money.securityDepositPence > 0) doors.push({ mode: "security", label: "Security deposit" });
  if (canEmail) doors.push({ mode: "email", label: "Email the booker" });
  if (canEdit && ["enquiry", "quoted", "pending", "confirmed"].includes(status)) {
    doors.push({ mode: "cancel", label: "Cancel booking" });
  }
  const otherDoors = doors.filter((d) => d.mode !== primary);

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

      {/* 2. The one thing to do next, and the other doors under it. */}
      <ActionBar
        className="sticky top-[var(--mobile-header-h)] z-20 lg:static"
        icon={bookingActionIcon(nextAction.key)}
        tone={nextAction.tone}
        status={nextAction.label}
        detail={nextAction.why}
        action={
          <Link
            href={door(primary ?? "payment")}
            scroll={false}
            className={buttonVariants({
              size: "touch",
              // Nothing is outstanding: the bar goes quiet and the button with it.
              variant: nextAction.tone === "done" ? "outline" : "default",
            })}
          >
            {bookingActionIcon(nextAction.key)}
            {MODE_BUTTON[primary ?? "payment"]}
          </Link>
        }
      >
        {otherDoors.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t pt-3">
            {otherDoors.map((d) => (
              <Link
                key={d.mode}
                href={door(d.mode)}
                scroll={false}
                className={buttonVariants({
                  size: "touch",
                  variant: d.mode === "cancel" ? "ghost" : "outline",
                  className: d.mode === "cancel" ? "text-destructive hover:bg-destructive/10" : undefined,
                })}
              >
                {d.label}
              </Link>
            ))}
          </div>
        )}
      </ActionBar>

      {/* 3. The facts. */}
      <BookingFacts
        booking={booking}
        roomName={roomName}
        when={when}
        money={money}
        paymentHref={door("payment")}
      />

      {/* 4. Folded beneath. */}
      <div className="space-y-2 pt-2">
        <FoldCard icon={<UserRound className="h-4 w-4" aria-hidden />} title="Booker" summary={bookerSummary}>
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
          {canEmail && (
            <Link
              href={door("email")}
              scroll={false}
              className={buttonVariants({ size: "touch", variant: "outline", className: "mt-4" })}
            >
              Email the booker
            </Link>
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

        <FoldCard icon={<Mail className="h-4 w-4" aria-hidden />} title="Emails sent" summary={emailSummary}>
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

            {(canEditBooking || canDelete) && (
              <div className="flex flex-wrap gap-2 border-t pt-4">
                {canEditBooking && (
                  <Link
                    href={door("edit")}
                    scroll={false}
                    className={buttonVariants({ size: "touch", variant: "outline" })}
                  >
                    Edit the booking
                  </Link>
                )}
                {canDelete && (
                  <Link
                    href={door("delete")}
                    scroll={false}
                    className={buttonVariants({
                      size: "touch",
                      variant: "ghost",
                      className: "text-destructive hover:bg-destructive/10",
                    })}
                  >
                    Delete this booking
                  </Link>
                )}
              </div>
            )}
          </div>
        </FoldCard>
      </div>

      {/* The doors above are links; this is what opens at the end of one. It
          reads `?sheet=` out of the URL, so a server action refreshing the page
          underneath leaves the sheet exactly where it was. */}
      <Suspense fallback={null}>
        <BookingSheetRoute
          bookingId={bookingId}
          booking={booking}
          roomName={roomName}
          when={when}
          money={money}
          payments={payments}
          securityPaidPence={securityPaidPence}
          rooms={rooms}
          editInitial={editInitial}
          terms={terms}
          canEdit={canEdit}
          canDelete={canDelete}
          canEditBooking={canEditBooking}
        />
      </Suspense>
    </div>
  );
}
