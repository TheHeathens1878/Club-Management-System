/**
 * What a ground costs the club for a season, and what its page is asking
 * for next.
 *
 * A hired slot is weekly, so a season's bill is the number of times that
 * weekday falls inside the span, less the dates off the venue does not
 * charge for, times the price per session. `lib/venue-hire.ts` already
 * counts occurrences that way for the bookings card and the Finance report;
 * this adds the season-wide total the status bar quotes, so the two figures
 * can never drift apart. Pure, no Supabase, no server-only imports.
 */

import {
  timetableDays,
  timetableRows,
  type TimetableBooking,
  type TimetableRow,
  type TimetableSlot,
} from "@/lib/training-plan";
import { bookingCost, type DateRange, type PricedSlot } from "@/lib/venue-hire";
import { formatCurrency } from "@/lib/utils";

export type VenueSeasonTotal = {
  /** Sessions across every slot, over the whole season span. */
  sessions: number;
  /** Of those, the ones inside a date off the venue does not charge for. */
  uncharged: number;
  /** (sessions − uncharged) × price, in pence; unpriced slots are not costed. */
  costPence: number;
  /** Slots with no price yet — counted so the screen can say so honestly. */
  unpricedSlots: number;
};

/**
 * What a set of weekly slots costs over a season's span. The span is the
 * booking's dates, not the season's, wherever the two differ — a booking
 * that starts in October is charged from October.
 */
export function venueSeasonTotal(
  slots: readonly PricedSlot[],
  blackoutsUncharged: readonly DateRange[],
  season: DateRange,
): VenueSeasonTotal {
  return bookingCost({ startsOn: season.startsOn, endsOn: season.endsOn, slots }, blackoutsUncharged);
}

/** A booking at this ground, as the venue page already builds it. */
export type VenueSeasonBooking = {
  id: string;
  /** `venue_bookings.season_id`; null for a booking not tied to a season. */
  seasonId: string | null;
  seasonName: string | null;
  startsOn: string;
  endsOn: string;
  slots: readonly PricedSlot[];
};

export type VenueAction = {
  /** "Add a booking" or "Book this ground for 2026/27". */
  label: string;
  /** "2026/27 · 3 slots booked · £1,840 for the season". */
  detail: string;
  mode: "add" | "book";
  /** The season the button prefills. */
  seasonId: string | null;
  seasonName: string | null;
  costPence: number;
};

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The one thing this ground is waiting for. A season with nothing booked
 * asks to be booked — today that door is buried at the bottom of the
 * bookings card — and a season already under way offers another booking
 * beside what it is costing.
 *
 * `bookingsBySeason` is the page's flat, season-sorted list; the current
 * season's bookings are picked out of it here. With no current season the
 * whole list counts, so a club between seasons still sees its bill.
 */
export function venueNextAction(
  venue: { name: string },
  bookingsBySeason: readonly VenueSeasonBooking[],
  currentSeason: { id: string; name: string } | null,
  blackoutsUncharged: readonly DateRange[] = [],
): VenueAction {
  const mine = currentSeason
    ? bookingsBySeason.filter((booking) => booking.seasonId === currentSeason.id)
    : bookingsBySeason;
  const seasonName = currentSeason?.name ?? mine[0]?.seasonName ?? null;

  if (mine.length === 0) {
    return {
      label: seasonName ? `Book this ground for ${seasonName}` : "Book this ground",
      detail: seasonName
        ? `${venue.name} has nothing booked for ${seasonName}`
        : `${venue.name} has nothing booked`,
      mode: "book",
      seasonId: currentSeason?.id ?? null,
      seasonName,
      costPence: 0,
    };
  }

  let slots = 0;
  let costPence = 0;
  let unpricedSlots = 0;
  for (const booking of mine) {
    const cost = venueSeasonTotal(booking.slots, blackoutsUncharged, booking);
    slots += booking.slots.length;
    costPence += cost.costPence;
    unpricedSlots += cost.unpricedSlots;
  }

  const parts: string[] = [];
  if (seasonName) parts.push(seasonName);
  parts.push(`${plural(slots, "slot", "slots")} booked`);
  // Quoting £0.00 for a season nobody has priced yet would read as free.
  parts.push(
    costPence === 0 && unpricedSlots > 0
      ? "no prices yet"
      : `${formatCurrency(costPence)} for the season`,
  );
  if (costPence > 0 && unpricedSlots > 0) {
    parts.push(`${plural(unpricedSlots, "slot", "slots")} still unpriced`);
  }

  return {
    label: "Add a booking",
    detail: parts.join(" · "),
    mode: "add",
    seasonId: currentSeason?.id ?? null,
    seasonName,
    costPence,
  };
}

// ---------------------------------------------------------------------------
// The ground as a grid — the same shape the training block page uses
// ---------------------------------------------------------------------------

/**
 * The grid's rows: one per pitch on this ground, whether or not anything is
 * booked on it, so every pitch has a row of cells to press.
 *
 * `timetableRows()` (lib/training-plan.ts) already builds rows of venue ×
 * pitch out of anything slot-shaped, and this page's slots are slot-shaped,
 * so the timetable and the ground read the same way and only ever have one
 * implementation between them. The one thing it deliberately does NOT do is
 * draw a pitch with nothing on it — on a block page an empty venue is noise.
 * Here it is the opposite: a pitch with no slot is exactly where the next
 * booking goes, so the empty pitches are added back and the rows put in the
 * ground's own pitch order.
 */
export function venueGridRows<S extends TimetableSlot>(
  slots: readonly S[],
  venue: { id: string; name: string; pitches: readonly { id: string; name: string }[] },
): TimetableRow<S, TimetableBooking>[] {
  const rows = timetableRows<S, TimetableBooking>(
    slots,
    [{ id: venue.id, name: venue.name, pitches: venue.pitches, bookedSlots: [] }],
    [venue.id],
  );
  for (const pitch of venue.pitches) {
    if (rows.some((row) => row.pitchId === pitch.id)) continue;
    rows.push({
      key: `${venue.id}|${pitch.id}`,
      venueId: venue.id,
      venueName: venue.name,
      pitchId: pitch.id,
      pitchName: pitch.name,
      slots: [],
      unplanned: [],
    });
  }
  // A ground with no pitches named still gets one row: the ground itself.
  if (rows.length === 0) {
    rows.push({
      key: `${venue.id}|`,
      venueId: venue.id,
      venueName: venue.name,
      pitchId: null,
      pitchName: null,
      slots: [],
      unplanned: [],
    });
  }
  const rank = (row: TimetableRow<S, TimetableBooking>): number => {
    if (!row.pitchId) return Number.MAX_SAFE_INTEGER;
    const i = venue.pitches.findIndex((pitch) => pitch.id === row.pitchId);
    return i === -1 ? Number.MAX_SAFE_INTEGER - 1 : i;
  };
  return rows.sort((a, b) => rank(a) - rank(b) || (a.pitchName ?? "").localeCompare(b.pitchName ?? ""));
}

/** Monday to Friday — the columns a ground with nothing booked yet shows. */
const WORKING_WEEK: readonly number[] = [1, 2, 3, 4, 5];

/**
 * The grid's columns: the days something is booked on, or the working week
 * when nothing is. A season with no slots would otherwise be a grid with no
 * columns, and there would be nowhere to press to make the first one.
 */
export function venueGridDays(
  rows: readonly TimetableRow<TimetableSlot, TimetableBooking>[],
  fallback: readonly number[] = WORKING_WEEK,
): number[] {
  const days = timetableDays(rows);
  return days.length > 0 ? days : [...fallback];
}

/** "3 slots · £1,760" — a season's line when its rows are folded away. */
export function venueSeasonLine(
  bookings: readonly VenueSeasonBooking[],
  blackoutsUncharged: readonly DateRange[] = [],
): string {
  let slots = 0;
  let costPence = 0;
  let unpricedSlots = 0;
  for (const booking of bookings) {
    const cost = venueSeasonTotal(booking.slots, blackoutsUncharged, booking);
    slots += booking.slots.length;
    costPence += cost.costPence;
    unpricedSlots += cost.unpricedSlots;
  }
  const parts = [plural(slots, "slot", "slots")];
  parts.push(costPence === 0 && unpricedSlots > 0 ? "no prices yet" : formatCurrency(costPence));
  if (costPence > 0 && unpricedSlots > 0) parts.push(`${plural(unpricedSlots, "slot", "slots")} unpriced`);
  return parts.join(" · ");
}

/**
 * The bookings grouped by season, in the order they arrive — the page sorts
 * them current-season-first already, so the first group is the one the grid
 * opens on and the rest fold beneath it.
 */
export type VenueSeasonGroup<B> = {
  /** The season's id, or "none" for a booking tied to no season. */
  key: string;
  name: string;
  isCurrent: boolean;
  bookings: B[];
};

export function venueSeasonGroups<
  B extends { seasonId: string | null; seasonName: string | null },
>(bookings: readonly B[], currentSeasonId: string | null): VenueSeasonGroup<B>[] {
  const groups: VenueSeasonGroup<B>[] = [];
  for (const booking of bookings) {
    const key = booking.seasonId ?? "none";
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = {
        key,
        name: booking.seasonName ?? "No season",
        isCurrent: booking.seasonId !== null && booking.seasonId === currentSeasonId,
        bookings: [],
      };
      groups.push(group);
    }
    group.bookings.push(booking);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Which panel is open, in the URL
// ---------------------------------------------------------------------------

/**
 * What the ground's sheet is showing. It lives in `?sheet=` so a refresh —
 * and every server action on this page is a refresh — puts the panel back
 * where it was, and so a half-finished booking can be handed to somebody as
 * a link.
 */
export type VenueSheetState =
  | { kind: "booking"; bookingId: string | null }
  | { kind: "slot"; slotId: string }
  | { kind: "add"; bookingId: string; pitchId: string | null; weekday: number };

/** The `?sheet=` value for a state. Dots separate: a uuid has none. */
export function venueSheetParam(state: VenueSheetState): string {
  if (state.kind === "booking") return state.bookingId ? `booking.${state.bookingId}` : "booking";
  if (state.kind === "slot") return `slot.${state.slotId}`;
  return `add.${state.bookingId}.${state.pitchId ?? "-"}.${state.weekday}`;
}

/** `?sheet=` back into a state; anything unrecognised is no sheet at all. */
export function parseVenueSheet(param: string | null | undefined): VenueSheetState | null {
  if (!param) return null;
  const [kind, ...rest] = param.split(".");
  if (kind === "booking") return { kind: "booking", bookingId: rest[0] || null };
  if (kind === "slot") return rest[0] ? { kind: "slot", slotId: rest[0] } : null;
  if (kind === "add") {
    const [bookingId, pitchId, weekday] = rest;
    const day = Number.parseInt(weekday ?? "", 10);
    if (!bookingId || !Number.isInteger(day) || day < 0 || day > 6) return null;
    return { kind: "add", bookingId, pitchId: !pitchId || pitchId === "-" ? null : pitchId, weekday: day };
  }
  return null;
}
