/**
 * Room hire pricing — one set of maths for the form's estimate, the server's
 * stored amount and the room card's sentence, so the three can never
 * disagree.
 *
 * The club's actual rule (Adam, 2026-09-03): "£150 for 4.5 hours and £25 per
 * half hour after that (triggering 1 minute over)". That is the STANDARD
 * HIRE model the old app kept in `standard_price_pence` / `standard_hours` /
 * `extra_hour_pence` — and note the last column's name lies: it has always
 * held the price of each additional HALF hour (£25 on prod), which is
 * exactly the rule as Adam states it. Any started half hour counts in full.
 *
 * The per-hour / half-day / full-day tiers remain as a fallback for a room
 * priced that way instead.
 */

export type RoomPricingFields = {
  standard_price_pence: number | null;
  standard_hours: number | null;
  /** Despite the name: the price per additional HALF HOUR. See above. */
  extra_hour_pence: number | null;
  price_pence_per_hour: number | null;
  price_pence_half_day: number | null;
  price_pence_full_day: number | null;
};

function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** The hire price in pence for a window, or null when the room has no pricing. */
export function roomHirePence(
  room: RoomPricingFields,
  startTime: string,
  endTime: string,
): number | null {
  const durationMins = minutesOf(endTime) - minutesOf(startTime);
  if (durationMins <= 0) return null;

  if (room.standard_price_pence && room.standard_hours) {
    const included = Math.round(room.standard_hours * 60);
    const overMins = Math.max(0, durationMins - included);
    // "Triggering 1 minute over": every STARTED half hour beyond the
    // standard window costs the full extra rate.
    const extraHalves = Math.ceil(overMins / 30);
    return room.standard_price_pence + extraHalves * (room.extra_hour_pence ?? 0);
  }

  const durationHours = durationMins / 60;
  if (durationHours >= 7 && room.price_pence_full_day) return room.price_pence_full_day;
  if (durationHours >= 3.5 && room.price_pence_half_day) return room.price_pence_half_day;
  if (room.price_pence_per_hour) return Math.ceil(durationHours * room.price_pence_per_hour);
  return null;
}

function hoursLabel(hours: number): string {
  const whole = Math.floor(hours);
  const half = hours - whole >= 0.5;
  return half ? `${whole}½` : String(whole);
}

function pounds(pence: number): string {
  return pence % 100 === 0 ? `£${pence / 100}` : `£${(pence / 100).toFixed(2)}`;
}

/**
 * The rule in a sentence, for the room's card: "£150 for up to 4½ hours,
 * then £25 for each additional half hour (any part of one counts)."
 */
export function standardHireSentence(room: RoomPricingFields): string | null {
  if (!room.standard_price_pence || !room.standard_hours) return null;
  const base = `${pounds(room.standard_price_pence)} for up to ${hoursLabel(room.standard_hours)} hours`;
  if (!room.extra_hour_pence) return `${base}.`;
  return `${base}, then ${pounds(room.extra_hour_pence)} for each additional half hour (any part of one counts).`;
}
