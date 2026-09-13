/**
 * What the club's venue bookings cost (Adam, 2026-09-13: "put price
 * alongside the bookings slot and create a report in Money for it").
 *
 * A booked slot is weekly — Pitch 1, Mondays 18:00–19:00 — with a price per
 * session. A booking runs from a first date to a last date, so a slot's
 * cost is its price times the number of that weekday in the span, less the
 * sessions that fall in dates off the venue does not charge for (Adam, the
 * same day: "if we put dates off, we should have the ability to say we're
 * not getting charged, as often we don't"). Pure functions, shared by the
 * venue page and the Finance report.
 */

export type DateRange = { startsOn: string; endsOn: string };

export type PricedSlot = {
  weekday: number;
  /** Per session, in pence; null = not priced yet. */
  pricePence: number | null;
};

/** Every date of `weekday` (0 = Sunday) between two dates, inclusive, as YYYY-MM-DD. */
export function sessionDates(startsOn: string, endsOn: string, weekday: number): string[] {
  if (!startsOn || !endsOn || endsOn < startsOn) return [];
  const start = new Date(`${startsOn}T12:00:00Z`);
  const end = new Date(`${endsOn}T12:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  const offset = (weekday - start.getUTCDay() + 7) % 7; // days until the first such weekday
  const dates: string[] = [];
  for (let t = start.getTime() + offset * 86_400_000; t <= end.getTime(); t += 7 * 86_400_000) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  return dates;
}

/** How many of `weekday` fall between two dates, inclusive. */
export function sessionsBetween(startsOn: string, endsOn: string, weekday: number): number {
  return sessionDates(startsOn, endsOn, weekday).length;
}

function inAnyRange(date: string, ranges: readonly DateRange[]): boolean {
  return ranges.some((r) => r.startsOn <= date && date <= r.endsOn);
}

export type SlotCost = {
  /** Sessions between the booking's dates. */
  sessions: number;
  /** Of those, the ones in dates off the venue does not charge for. */
  uncharged: number;
  /** (sessions − uncharged) × price; null when the slot has no price yet. */
  costPence: number | null;
};

export function slotCost(booking: DateRange, slot: PricedSlot, unchargedRanges: readonly DateRange[] = []): SlotCost {
  const dates = sessionDates(booking.startsOn, booking.endsOn, slot.weekday);
  const uncharged = dates.filter((d) => inAnyRange(d, unchargedRanges)).length;
  const charged = dates.length - uncharged;
  return { sessions: dates.length, uncharged, costPence: slot.pricePence === null ? null : charged * slot.pricePence };
}

export type BookingCost = {
  sessions: number;
  uncharged: number;
  /** The priced slots' cost; the unpriced ones are counted, not costed. */
  costPence: number;
  unpricedSlots: number;
};

export function bookingCost(
  booking: DateRange & { slots: readonly PricedSlot[] },
  unchargedRanges: readonly DateRange[] = [],
): BookingCost {
  let sessions = 0;
  let uncharged = 0;
  let costPence = 0;
  let unpricedSlots = 0;
  for (const slot of booking.slots) {
    const c = slotCost(booking, slot, unchargedRanges);
    sessions += c.sessions;
    uncharged += c.uncharged;
    if (c.costPence === null) unpricedSlots += 1;
    else costPence += c.costPence;
  }
  return { sessions, uncharged, costPence, unpricedSlots };
}
