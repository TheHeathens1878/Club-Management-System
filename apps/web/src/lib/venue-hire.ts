/**
 * What the club's venue bookings cost (Adam, 2026-09-13: "put price
 * alongside the bookings slot and create a report in Money for it").
 *
 * A booked slot is weekly — Pitch 1, Mondays 18:00–19:00 — with a price per
 * session. A booking runs from a first date to a last date, so a slot's
 * cost is its price times the number of that weekday in the span. Pure
 * functions, shared by the venue page and the Finance report.
 */

export type PricedSlot = {
  weekday: number;
  /** Per session, in pence; null = not priced yet. */
  pricePence: number | null;
};

/** How many of `weekday` (0 = Sunday) fall between two dates, inclusive. */
export function sessionsBetween(startsOn: string, endsOn: string, weekday: number): number {
  if (!startsOn || !endsOn || endsOn < startsOn) return 0;
  const start = new Date(`${startsOn}T12:00:00Z`);
  const end = new Date(`${endsOn}T12:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const offset = (weekday - start.getUTCDay() + 7) % 7; // days until the first such weekday
  if (offset >= days) return 0;
  return Math.floor((days - 1 - offset) / 7) + 1;
}

export type SlotCost = {
  sessions: number;
  /** null when the slot has no price yet. */
  costPence: number | null;
};

export function slotCost(booking: { startsOn: string; endsOn: string }, slot: PricedSlot): SlotCost {
  const sessions = sessionsBetween(booking.startsOn, booking.endsOn, slot.weekday);
  return { sessions, costPence: slot.pricePence === null ? null : sessions * slot.pricePence };
}

export type BookingCost = {
  sessions: number;
  /** The priced slots' cost; the unpriced ones are counted, not costed. */
  costPence: number;
  unpricedSlots: number;
};

export function bookingCost(booking: { startsOn: string; endsOn: string; slots: readonly PricedSlot[] }): BookingCost {
  let sessions = 0;
  let costPence = 0;
  let unpricedSlots = 0;
  for (const slot of booking.slots) {
    const c = slotCost(booking, slot);
    sessions += c.sessions;
    if (c.costPence === null) unpricedSlots += 1;
    else costPence += c.costPence;
  }
  return { sessions, costPence, unpricedSlots };
}
