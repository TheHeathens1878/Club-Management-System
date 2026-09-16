/**
 * What the function-room desk knows before anything is drawn (P8.2).
 *
 * A plain module on purpose: the desk page is a server component and the
 * calendar, the list and the sheet are client ones, so everything both sides
 * need — the shape of a booking on the desk, the colours the calendar paints
 * with, who is clashing with whom, and what the status bar says — lives here
 * where either can import it and a vitest file can call it.
 *
 * Nothing here talks to Supabase and nothing here is `"use client"`. The two
 * imports from `booking-sheet.tsx` are TYPES, which are erased at build: the
 * server page never calls a function out of a client module.
 */

import type {
  BookingActionKey,
  BookingMoney,
  BookingSheetMode,
  BookingTone,
} from "@/lib/booking-next-action";
import type { BookingWindow } from "@/lib/booking-time";
import type { BookingKind, BookingListItem, BookingStatus } from "@/lib/booking-types";

import type { BookingSheetBooking, BookingSheetProps, BookingSheetTerms } from "./booking-sheet";
import type { PaymentRow } from "./payments-panel";

// ---------------------------------------------------------------------------
// One booking, as the desk holds it
// ---------------------------------------------------------------------------

/**
 * A booking on the desk: the row the calendar and the list draw, plus
 * everything `BookingSheet` needs to open on it without another round trip.
 *
 * The desk reads every function-room booking anyway — 48 of them on the club's
 * database — so the money and the ledger come down with them and a press opens
 * the sheet instantly, instead of a navigation to the record page and back.
 */
export type DeskBooking = {
  id: string;
  /** When the request came in — what "the oldest" in the status bar means. */
  createdAt: string;
  /** The flattened London wall-clock row the calendar and the list draw. */
  item: BookingListItem;
  roomName: string;
  /** `bookingNextAction()` in the desk's voice, worked out on the server. */
  next: {
    key: BookingActionKey;
    label: string;
    why: string;
    tone: BookingTone;
    mode?: BookingSheetMode;
  };
  /** The sheet's own props for this booking, bar the mode and the callbacks. */
  sheet: {
    booking: BookingSheetBooking;
    when: BookingWindow;
    money: BookingMoney;
    payments: PaymentRow[];
    securityPaidPence: number;
    editInitial: BookingSheetProps["editInitial"];
    terms: BookingSheetTerms;
  };
};

// ---------------------------------------------------------------------------
// Which door a press opens
// ---------------------------------------------------------------------------

/**
 * The doors a calendar entry or a list row may open.
 *
 * `bookingNextAction()` also answers in the booker's voice, whose `accept`,
 * `pay` and `view` are the portal's doors; the desk has no view-only mode, so
 * anything that is not one of these opens the ledger — the closest thing the
 * sheet has to "just show me this booking", and the place the desk goes when
 * the answer is "nothing is owed".
 */
const DESK_CELL_MODES = [
  "quote",
  "confirm",
  "chase",
  "cancel",
  "payment",
  "security",
  "email",
] as const satisfies readonly BookingSheetMode[];

/** The mode a cell opens the sheet on. Never null: a press must do something. */
export function deskCellMode(mode: string | null | undefined): (typeof DESK_CELL_MODES)[number] {
  const found = DESK_CELL_MODES.find((candidate) => candidate === mode);
  return found ?? "payment";
}

// ---------------------------------------------------------------------------
// Clashes, without 48 round trips
// ---------------------------------------------------------------------------

/** The columns a clash is decided on — `booking_conflicts()`'s own `where`. */
export type ClashCandidate = {
  id: string;
  resource_id: string;
  status: string;
  blocked_from: string;
  blocked_until: string;
};

/**
 * Who else is holding this room over this window.
 *
 * The record page asks the database (`booking_conflicts()`); the desk cannot
 * ask it once per booking, so this repeats that function's rule over the rows
 * the page has already read: same room, `pending` or `confirmed` — the two
 * statuses that hold a room — and a half-open overlap of the blocked period,
 * never itself. Same answer, one query.
 */
export function deskClashes(
  rows: readonly ClashCandidate[],
  row: ClashCandidate,
): { id: string; status: string }[] {
  return rows
    .filter(
      (other) =>
        other.id !== row.id &&
        other.resource_id === row.resource_id &&
        (other.status === "pending" || other.status === "confirmed") &&
        other.blocked_from < row.blocked_until &&
        row.blocked_from < other.blocked_until,
    )
    .map((other) => ({ id: other.id, status: other.status }));
}

// ---------------------------------------------------------------------------
// The status bar
// ---------------------------------------------------------------------------

export type DeskSummary = {
  /** The sentence: "4 waiting on the desk · 2 deposits overdue". */
  status: string;
  detail: string;
  tone: BookingTone;
  /** What "Open the oldest" opens, or null when there is nothing waiting. */
  oldestId: string | null;
};

/** The keys that mean somebody is late paying, in the order they are said. */
const OVERDUE: { key: BookingActionKey; one: string; many: string }[] = [
  { key: "chase-deposit", one: "1 deposit overdue", many: "deposits overdue" },
  { key: "chase-balance", one: "1 balance overdue", many: "balances overdue" },
];

/**
 * What the desk owes the world this morning, in one sentence.
 *
 * "Waiting on the desk" is an enquiry or a pending request — somebody asked
 * and nobody has answered — which is the same pair the nav's number counts.
 * Overdue money is counted from `bookingNextAction()`, so the bar and the
 * booking it opens cannot disagree about whether a deposit is late.
 */
export function deskSummary(bookings: readonly DeskBooking[]): DeskSummary {
  const waiting = bookings
    .filter((b) => b.item.status === "enquiry" || b.item.status === "pending")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const parts: string[] = [];
  if (waiting.length > 0) parts.push(`${waiting.length} waiting on the desk`);
  let overdueId: string | null = null;
  for (const band of OVERDUE) {
    const late = bookings.filter((b) => b.next.key === band.key);
    if (late.length === 0) continue;
    parts.push(late.length === 1 ? band.one : `${late.length} ${band.many}`);
    overdueId ??= [...late].sort((a, b) => a.item.date.localeCompare(b.item.date))[0]?.id ?? null;
  }

  if (parts.length === 0) {
    return {
      status: "Nothing is waiting on the desk",
      detail: "Every enquiry has an answer and nothing is overdue. Take the next booking.",
      tone: "done",
      oldestId: null,
    };
  }

  const oldest = waiting[0]?.id ?? overdueId;
  return {
    status: parts.join(" · "),
    detail: waiting[0]
      ? `The oldest came in ${dayMonth(waiting[0].createdAt)} — it opens where it stands.`
      : "The sheet opens on the chaser it needs.",
    tone: overdueId ? "error" : "waiting",
    oldestId: oldest,
  };
}

/** "3 Sep" — how long something has been sitting there, in two words. */
function dayMonth(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
  });
}

// ---------------------------------------------------------------------------
// The calendar's colours, as data
// ---------------------------------------------------------------------------

/**
 * A chip's colours, as CSS strings rather than classes.
 *
 * These are the one thing on this screen that is NOT a token: a month grid is
 * a key, and its seven colours have to stay apart from each other and survive
 * a printer, which is a different job from "this is a warning". They are data,
 * so they are written once here and the calendar, its legend and the print
 * legend all read the same array — the way `FilterRail` takes a `swatch`.
 *
 * Only `confirmed` and a block hold the room, and only confirmed is green: an
 * enquiry or a quote is a conversation about a date, not a claim on it, and
 * painting those green is how one confirmed booking looked like three bookings
 * on the same night.
 */
export type BookingSwatch = {
  /** The chip's fill. */
  bg: string;
  /** Its ink — dark enough to read on paper. */
  ink: string;
  edge: string;
  /** A dashed edge says "this is not holding the room". */
  dashed?: boolean;
};

export const BOOKING_SWATCH = {
  confirmed: { bg: "#dcfce7", ink: "#166534", edge: "#86efac" },
  pending: { bg: "#fffbeb", ink: "#854d0e", edge: "#fde047" },
  enquiry: { bg: "#f8fafc", ink: "#475569", edge: "#cbd5e1", dashed: true },
  quoted: { bg: "#f5f3ff", ink: "#5b21b6", edge: "#c4b5fd", dashed: true },
  cancelled: { bg: "#fee2e2", ink: "#991b1b", edge: "#fca5a5" },
  blocked: { bg: "#fef3c7", ink: "#92400e", edge: "#fde68a" },
  away: { bg: "#fef2f2", ink: "#b91c1c", edge: "#fecaca" },
} satisfies Record<string, BookingSwatch>;

/** The colours one booking's chip wears. A block is blocked, whatever its status. */
export function bookingSwatch(
  status: BookingStatus | string,
  kind: BookingKind | string,
): BookingSwatch {
  if (kind === "block") return BOOKING_SWATCH.blocked;
  switch (status) {
    case "pending":
      return BOOKING_SWATCH.pending;
    case "enquiry":
      return BOOKING_SWATCH.enquiry;
    case "quoted":
      return BOOKING_SWATCH.quoted;
    case "cancelled":
      return BOOKING_SWATCH.cancelled;
    default:
      return BOOKING_SWATCH.confirmed;
  }
}

/** The legend, on screen and on paper — the same seven swatches, in one order. */
export const CALENDAR_LEGEND: { label: string; swatch: BookingSwatch }[] = [
  { label: "Confirmed", swatch: BOOKING_SWATCH.confirmed },
  { label: "Pending", swatch: BOOKING_SWATCH.pending },
  { label: "Enquiry (not held)", swatch: BOOKING_SWATCH.enquiry },
  { label: "Quoted (not held)", swatch: BOOKING_SWATCH.quoted },
  { label: "Cancelled", swatch: BOOKING_SWATCH.cancelled },
  { label: "Staff away", swatch: BOOKING_SWATCH.away },
  { label: "Blocked", swatch: BOOKING_SWATCH.blocked },
];

// ---------------------------------------------------------------------------
// The phone's week
// ---------------------------------------------------------------------------

function iso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * The Monday of the week a date falls in.
 *
 * A phone cannot show seven columns of a month — that is what the
 * `min-w-[640px]` on the grid was admitting — so below `lg` the calendar shows
 * one week, a day at a time, with the week's days as chips.
 */
export function weekStartOf(dateIso: string): string {
  const date = new Date(`${dateIso}T12:00:00`);
  const back = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - back);
  return iso(date);
}

/** The seven days of the week that starts on `startIso`. */
export function weekDays(startIso: string): string[] {
  const start = new Date(`${startIso}T12:00:00`);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return iso(day);
  });
}

/** Where a week's chips go when the arrow is pressed. */
export function shiftWeek(startIso: string, weeks: number): string {
  const start = new Date(`${startIso}T12:00:00`);
  start.setDate(start.getDate() + weeks * 7);
  return iso(start);
}

/**
 * The week the phone opens on for a month: the one holding today when the
 * month on screen is this month, and otherwise the month's first week — never
 * an empty strip of days belonging to the month before.
 */
export function openingWeek(ym: string, today: string): string {
  if (today.slice(0, 7) === ym) return weekStartOf(today);
  return weekStartOf(`${ym}-01`);
}

/** "Mon 14" — a day chip's label. */
export function dayChipLabel(dateIso: string): string {
  return new Date(`${dateIso}T12:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
  });
}

/** "Monday, 14 September" — the heading over one day's bookings on a phone. */
export function dayHeading(dateIso: string): string {
  return new Date(`${dateIso}T12:00:00`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}
