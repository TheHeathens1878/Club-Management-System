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
