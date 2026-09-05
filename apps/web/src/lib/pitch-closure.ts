/**
 * A closure that runs for more than a day (Adam, 2026-09-05: "I need to
 * close a pitch for a longer time period than a day"). Pure, so the date
 * arithmetic is testable on its own.
 *
 * A multi-day closure is one `maintenance` booking PER DAY, each covering the
 * same daily window, rather than one booking spanning the nights between:
 * the weekend grid and the day calendar both draw a booking inside the day it
 * belongs to, and a coach re-opening one Saturday should not re-open the
 * whole fortnight. The insert is still a single statement, so the closure
 * lands on every day and every pitch asked for, or on none.
 */

/** How far a single closure may run. Longer than this is a decision worth two forms. */
export const MAX_CLOSURE_DAYS = 92;

/** `YYYY-MM-DD` plus `days`, on the calendar (no clock, no DST). */
export function addCalendarDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const at = new Date(Date.UTC(y!, m! - 1, d! + days, 12));
  return at.toISOString().slice(0, 10);
}

/**
 * Every date from `from` to `to` inclusive, or an error message. `to` may be
 * blank or equal to `from` for the one-day closure the form always offered.
 */
export function closureDates(from: string, to: string | ""): { dates: string[] } | { error: string } {
  const last = to || from;
  if (last < from) return { error: "The closure cannot end before it starts." };
  const dates: string[] = [];
  for (let date = from; date <= last; date = addCalendarDays(date, 1)) {
    dates.push(date);
    if (dates.length > MAX_CLOSURE_DAYS) {
      return { error: `A closure can run for up to ${MAX_CLOSURE_DAYS} days at a time. Close the rest separately.` };
    }
  }
  return { dates };
}

/** "on 2026-09-06" or "from 2026-09-06 to 2026-09-20 (15 days)". */
export function closureSpanLabel(dates: readonly string[]): string {
  if (dates.length <= 1) return `on ${dates[0] ?? ""}`;
  return `from ${dates[0]} to ${dates[dates.length - 1]} (${dates.length} days)`;
}
