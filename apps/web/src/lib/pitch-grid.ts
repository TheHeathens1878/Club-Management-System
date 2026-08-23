/**
 * Laying a weekend of pitch bookings out on a 30-minute grid (PLAN.md P2.5).
 *
 * The database owns everything that *means* something — `allocate_fixture()`
 * decides whether a slot is free, `pitch_grid(from, to)` says what is booked.
 * This module owns only the arithmetic of drawing that answer as a table:
 * which weekend is being shown, which half-hours make up a column, and which
 * of those half-hours a booking (or its buffer) covers.
 *
 * It is deliberately free of React and of Supabase so the awkward parts — the
 * Saturday the picker lands on, a booking that starts at 10:15, a buffer that
 * reaches beyond the booking — are unit-testable without either.
 *
 * All wall-clock work goes through `booking-time.ts`, so Europe/London and its
 * DST rules are handled in exactly one place in this app.
 */

import { addDays, localToEpochMs, londonDayRange, londonToday } from "@/lib/booking-time";

/** Grid resolution and extent: 08:00–20:00 in half hours, as P2.5 asks. */
export const SLOT_MINUTES = 30;
export const GRID_START_HOUR = 8;
export const GRID_END_HOUR = 20;

/** One live booking on one pitch, reduced to what the grid needs. */
export type GridEntry = {
  bookingId: string;
  kind: string;
  status: string;
  /** Already-formatted cell label: "U13s v Angel FC", or the booker/occasion. */
  label: string;
  startsAtMs: number;
  endsAtMs: number;
  /** The booking plus its buffers — the span that actually blocks the pitch. */
  blockedFromMs: number;
  blockedUntilMs: number;
  fixtureId: string | null;
  teamId: string | null;
};

/** What one cell of the grid shows. */
export type GridCell = { entry: GridEntry; state: "booked" | "buffer" };

/** A weekend, as the two London dates it covers. */
export type Weekend = { saturday: string; sunday: string };

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function minutesToTime(minutes: number): string {
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

function timeToMinutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/**
 * The `HH:mm` start of every slot in a grid column: 08:00, 08:30 … 19:30.
 * The last slot ends at {@link GRID_END_HOUR}, so 20:00 is not itself a start.
 */
export function slotTimes(): string[] {
  const times: string[] = [];
  for (let m = GRID_START_HOUR * 60; m < GRID_END_HOUR * 60; m += SLOT_MINUTES) {
    times.push(minutesToTime(m));
  }
  return times;
}

/**
 * The instants a slot spans, resolved through Europe/London rather than by
 * adding 30 minutes of milliseconds — a grid drawn across a DST change must
 * still line up with what Postgres stored.
 */
export function slotBounds(date: string, time: string): { startMs: number; endMs: number } {
  const startMinutes = timeToMinutes(time);
  return {
    startMs: localToEpochMs(date, time),
    endMs: localToEpochMs(date, minutesToTime(startMinutes + SLOT_MINUTES)),
  };
}

/** 0 = Sunday … 6 = Saturday, for a `YYYY-MM-DD` London date. */
function dayOfWeek(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/**
 * The weekend `date` belongs to: itself if it is a Saturday, the Saturday just
 * gone if it is a Sunday, and otherwise the Saturday coming. A Monday
 * therefore shows the weekend the club is about to play, not the one it just
 * played — which is the question the allocation screen exists to answer.
 */
export function weekendOf(date: string): Weekend {
  const dow = dayOfWeek(date);
  const saturday = dow === 0 ? addDays(date, -1) : addDays(date, 6 - dow);
  return { saturday, sunday: addDays(saturday, 1) };
}

/** The weekend the club is heading into, in Europe/London. */
export function comingWeekend(now: Date = new Date()): Weekend {
  return weekendOf(londonToday(now));
}

/** The prev/next week buttons: whole weeks, so a Saturday stays a Saturday. */
export function shiftWeekend(weekend: Weekend, weeks: number): Weekend {
  const saturday = addDays(weekend.saturday, weeks * 7);
  return { saturday, sunday: addDays(saturday, 1) };
}

/**
 * The half-open instant window to ask `pitch_grid()` for: midnight Saturday up
 * to midnight Monday, London.
 */
export function weekendWindow(weekend: Weekend): { from: string; untilExclusive: string } {
  return londonDayRange(weekend.saturday, weekend.sunday);
}

/**
 * What one pitch's cell shows for one slot.
 *
 * A booking wins over a buffer: where a hire's post-match buffer overlaps the
 * next hire's start, the admin needs to see the booking. Buffers are the
 * lighter shade behind them.
 */
export function cellAt(
  entries: readonly GridEntry[],
  startMs: number,
  endMs: number,
): GridCell | null {
  let buffer: GridEntry | null = null;
  for (const entry of entries) {
    if (entry.startsAtMs < endMs && entry.endsAtMs > startMs) return { entry, state: "booked" };
    if (buffer === null && entry.blockedFromMs < endMs && entry.blockedUntilMs > startMs) {
      buffer = entry;
    }
  }
  return buffer === null ? null : { entry: buffer, state: "buffer" };
}

/** Group the flat `pitch_grid()` rows by pitch, keeping the order given. */
export function entriesByResource(
  rows: ReadonlyArray<{ resourceId: string; entry: GridEntry | null }>,
): Map<string, GridEntry[]> {
  const byResource = new Map<string, GridEntry[]>();
  for (const row of rows) {
    const list = byResource.get(row.resourceId) ?? [];
    if (row.entry !== null) list.push(row.entry);
    byResource.set(row.resourceId, list);
  }
  return byResource;
}
