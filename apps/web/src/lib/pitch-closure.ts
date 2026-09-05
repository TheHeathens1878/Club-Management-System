/**
 * A closure that runs for more than a day (Adam, 2026-09-05: "I need to
 * close a pitch for a longer time period than a day"). Pure, so the date
 * arithmetic is testable on its own.
 *
 * The form reads as one continuous span — From date and time, Until date and
 * time — so "Saturday 14:00 until Monday 10:00" is exactly that, and an Until
 * time earlier in the day than the From time is fine on a later date (Adam,
 * 2026-09-05, after the first cut refused it).
 *
 * The span is written as one `maintenance` booking PER DAY rather than one
 * booking across the nights between: the first day runs from the From time to
 * midnight, the middle days are whole, the last day runs from midnight to the
 * Until time. The weekend grid and the day calendar both draw a booking
 * inside the day it belongs to, and an administrator re-opening one Saturday
 * should not re-open the whole fortnight. The insert is still a single
 * statement, so the closure lands on every day and every pitch, or on none.
 */

/** How far a single closure may run. Longer than this is a decision worth two forms. */
export const MAX_CLOSURE_DAYS = 92;

/** `YYYY-MM-DD` plus `days`, on the calendar (no clock, no DST). */
export function addCalendarDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const at = new Date(Date.UTC(y!, m! - 1, d! + days, 12));
  return at.toISOString().slice(0, 10);
}

/** One day's slice of the closure, as local wall-clock bounds. */
export type ClosureWindow = {
  /** The day this slice belongs to. */
  date: string;
  start: { date: string; time: string };
  /** Midnight is expressed as 00:00 on the NEXT day, so every bound is a real instant. */
  end: { date: string; time: string };
};

/**
 * The per-day slices of a closure from (fromDate, fromTime) to (untilDate,
 * untilTime), or an error message. A blank `untilDate` means the one day.
 */
export function closureWindows(
  fromDate: string,
  fromTime: string,
  untilDate: string | "",
  untilTime: string,
): { windows: ClosureWindow[] } | { error: string } {
  const last = untilDate || fromDate;
  if (last < fromDate) return { error: "The closure cannot end before it starts." };
  if (last === fromDate && untilTime <= fromTime) {
    return { error: "The end time must be after the start time on a one-day closure." };
  }

  const windows: ClosureWindow[] = [];
  for (let date = fromDate; date <= last; date = addCalendarDays(date, 1)) {
    if (windows.length >= MAX_CLOSURE_DAYS) {
      return { error: `A closure can run for up to ${MAX_CLOSURE_DAYS} days at a time. Close the rest separately.` };
    }
    const first = date === fromDate;
    const final = date === last;
    windows.push({
      date,
      start: { date, time: first ? fromTime : "00:00" },
      end: final ? { date, time: untilTime } : { date: addCalendarDays(date, 1), time: "00:00" },
    });
  }
  return { windows };
}

/** "on 2026-09-06, 08:00–22:00" or "from 2026-09-06 14:00 to 2026-09-08 10:00 (3 days)". */
export function closureSpanLabel(windows: readonly ClosureWindow[]): string {
  const first = windows[0];
  const final = windows[windows.length - 1];
  if (!first || !final) return "";
  if (windows.length === 1) return `on ${first.date}, ${first.start.time}–${final.end.time}`;
  return `from ${first.date} ${first.start.time} to ${final.date} ${final.end.time} (${windows.length} days)`;
}
