"use client";

/**
 * The function-room desk (P8.2): what is waiting, the diary, and the sheet
 * that answers any of it without leaving the page.
 *
 * The desk used to be two pictures — a month you could only read, and a table
 * whose rows went somewhere else. Both are presses now, and both open the same
 * `BookingSheet` the record page opens, on the door that booking actually
 * needs: an enquiry opens on the quote, an accepted quote on confirm, a hire
 * with a deposit overdue on its chaser. Nothing about a booking changes here
 * that did not change there; this file only decides which door is in front of
 * somebody when they press.
 *
 *   · THE STATUS BAR — "4 waiting on the desk · 2 deposits overdue", and the
 *     one button that starts: Open the oldest, which is the longest-waiting
 *     enquiry, opened where it stands. Nothing waiting: New booking.
 *   · THE DIARY — the month at a desk, the week on a phone; an empty day is a
 *     new booking with that date already in it.
 *   · THE LIST — the same bookings as rows, with the ticks as a Select mode.
 *
 * The mode lives in this component's state, not in the URL: the desk's every
 * filter is already a URL and a sheet opened over a filtered month is not a
 * place worth its own address. (The record page does the opposite — see
 * `[id]/sheet-route.tsx` — because there a link into a door is worth having.)
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarPlus } from "lucide-react";

import { ActionBar } from "@/components/ui/action-bar";
import { buttonVariants, Button } from "@/components/ui/button";
import type { BookingListItem } from "@/lib/booking-types";

import { bookingActionIcon } from "./booking-facts";
import { BookingSheet, type BookingSheetMode } from "./booking-sheet";
import { BookingsCalendar } from "./bookings-calendar";
import { BookingsTable, type ChipGroup } from "./bookings-table";
import { deskCellMode, type DeskBooking, type DeskSummary } from "./desk-shared";
import type { AwayEntry } from "./staff-away-panel";

/** Which booking is open, and on which of the sheet's doors. */
type SheetState = { id: string; mode: BookingSheetMode };

export function BookingsDesk({
  bookings,
  calendarItems,
  listItems,
  roomName,
  rooms,
  awayEntries,
  isCalendar,
  summary,
  chipGroups,
  initialQuery,
  canDelete,
  canDecline,
  sheetCanEdit,
  sheetCanDelete,
  sheetCanEditBooking,
}: {
  /** Every function-room booking, sheet-ready, keyed by id below. */
  bookings: DeskBooking[];
  /** The diary's rows — every booking, whatever the list filters say. */
  calendarItems: BookingListItem[];
  /** The list's rows: the page's `?status=&room=&period=` filters applied. */
  listItems: BookingListItem[];
  roomName: Record<string, string>;
  rooms: { id: string; name: string }[];
  awayEntries: AwayEntry[];
  isCalendar: boolean;
  summary: DeskSummary;
  chipGroups: ChipGroup[];
  initialQuery: string;
  /** `isSuperUser` — delete a booking off the list. */
  canDelete: boolean;
  /** `isCommittee` — decline a block booking and give its dates back. */
  canDecline: boolean;
  /** `isStaff` — the sheet's quote, confirm, chase and cancel. */
  sheetCanEdit: boolean;
  /** `isCommittee` — the sheet's delete door, and deleting a payment. */
  sheetCanDelete: boolean;
  /** `isSuperUser` — the sheet's edit door. */
  sheetCanEditBooking: boolean;
}) {
  const router = useRouter();
  const [sheet, setSheet] = useState<SheetState | null>(null);

  const byId = new Map(bookings.map((b) => [b.id, b]));
  const open = sheet ? byId.get(sheet.id) : undefined;

  /** A press on a chip or a row: the sheet, on the door this booking needs. */
  function openBooking(id: string) {
    const booking = byId.get(id);
    if (!booking) return;
    setSheet({ id, mode: deskCellMode(booking.next.mode) });
  }

  /**
   * Closing refetches the desk. Several of the sheet's actions revalidate only
   * the booking's own page — recording a payment, saving a note — so without
   * this the month behind would still show yesterday's answer.
   */
  function close() {
    setSheet(null);
    router.refresh();
  }

  const oldest = summary.oldestId ? byId.get(summary.oldestId) : undefined;

  return (
    <div className="space-y-3">
      <ActionBar
        icon={bookingActionIcon(oldest?.next.key ?? "paid-in-full")}
        tone={summary.tone === "done" ? "done" : summary.tone === "error" ? "error" : "waiting"}
        status={summary.status}
        detail={summary.detail}
        action={
          oldest ? (
            <Button type="button" size="touch" onClick={() => openBooking(oldest.id)}>
              {bookingActionIcon(oldest.next.key)} Open the oldest
            </Button>
          ) : (
            <Link href="/room-bookings/new" className={buttonVariants({ size: "touch", variant: "outline" })}>
              <CalendarPlus className="h-4 w-4" aria-hidden /> New booking
            </Link>
          )
        }
      />

      {isCalendar ? (
        <BookingsCalendar
          bookings={calendarItems}
          roomName={roomName}
          awayEntries={awayEntries}
          onOpen={(booking) => openBooking(booking.id)}
        />
      ) : (
        <BookingsTable
          bookings={listItems}
          roomName={roomName}
          canDelete={canDelete}
          canDecline={canDecline}
          chipGroups={chipGroups}
          initialQuery={initialQuery}
          onOpen={(booking) => openBooking(booking.id)}
        />
      )}

      {open && (
        <BookingSheet
          bookingId={open.id}
          mode={sheet?.mode ?? null}
          onClose={close}
          booking={open.sheet.booking}
          roomName={open.roomName}
          when={open.sheet.when}
          money={open.sheet.money}
          payments={open.sheet.payments}
          securityPaidPence={open.sheet.securityPaidPence}
          rooms={rooms}
          editInitial={open.sheet.editInitial}
          terms={open.sheet.terms}
          canEdit={sheetCanEdit}
          canDelete={sheetCanDelete}
          canEditBooking={sheetCanEditBooking}
          recordHref={`/room-bookings/${open.id}`}
        />
      )}
    </div>
  );
}
