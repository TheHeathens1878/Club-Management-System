/**
 * Wall-clock <-> instant conversion for bookings.
 *
 * P1.5 replaced the legacy `date` + `start_time` + `end_time` trio on
 * `room_bookings` with a half-open timestamptz period `[starts_at, ends_at)`
 * on `bookings`. Every form, list, calendar and email in this app still works
 * in Europe/London wall clock — a date (`YYYY-MM-DD`) plus a time (`HH:mm`) —
 * so these helpers are the only place the two representations meet.
 *
 * The zone offset is probed with `Intl.DateTimeFormat`, so the DST rules come
 * from the platform's tz database rather than a hard-coded table and no extra
 * dependency is needed.
 *
 * Ambiguous and non-existent local times are resolved exactly as Postgres's
 * `timestamp at time zone 'Europe/London'` resolves them, because that is the
 * conversion the P1.6 data migration used:
 *   - ambiguous (the hour repeated when BST ends): the FIRST occurrence, i.e.
 *     the offset in effect before the transition;
 *   - non-existent (the hour skipped when BST starts): the local time is read
 *     with the offset in effect before the transition, which lands after the
 *     gap.
 */

export const BOOKING_TIME_ZONE = "Europe/London";

const DAY_MS = 86_400_000;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

const wallClockFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: BOOKING_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export type LocalDateTime = { date: string; time: string };

export type BookingWindow = { date: string; startTime: string; endTime: string };

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** True for a `YYYY-MM-DD` string that names a real calendar day. */
export function isValidDateString(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/** True for an `HH:mm` or `HH:mm:ss` string naming a real time of day. */
export function isValidTimeString(value: string): boolean {
  const m = TIME_RE.exec(value);
  if (!m) return false;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  const second = m[3] === undefined ? 0 : Number(m[3]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59;
}

/** `HH:mm:ss` / `H:mm` -> `HH:mm`. Throws on anything that is not a time. */
export function normaliseTime(value: string): string {
  const m = TIME_RE.exec(value);
  if (!m || !isValidTimeString(value)) {
    throw new RangeError(`Not a time of day: ${JSON.stringify(value)}`);
  }
  return `${pad2(Number(m[1]))}:${m[2]}`;
}

function parseDateString(value: string): { year: number; month: number; day: number } {
  const m = DATE_RE.exec(value);
  if (!m || !isValidDateString(value)) {
    throw new RangeError(`Not a calendar date: ${JSON.stringify(value)}`);
  }
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function parseTimeString(value: string): { hour: number; minute: number; second: number } {
  const m = TIME_RE.exec(value);
  if (!m || !isValidTimeString(value)) {
    throw new RangeError(`Not a time of day: ${JSON.stringify(value)}`);
  }
  return {
    hour: Number(m[1]),
    minute: Number(m[2]),
    second: m[3] === undefined ? 0 : Number(m[3]),
  };
}

type WallClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function wallClockAt(epochMs: number): WallClock {
  const parts = wallClockFormat.formatToParts(new Date(epochMs));
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    if (!part) throw new Error(`Intl did not return a ${type} part`);
    return Number(part.value);
  };
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

/** London's UTC offset in ms at a given instant (+3_600_000 during BST). */
function offsetMsAt(epochMs: number): number {
  const whole = Math.floor(epochMs / 1000) * 1000;
  const w = wallClockAt(whole);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - whole;
}

/**
 * The instant at which the given Europe/London wall clock occurs, as an ISO
 * timestamp suitable for a timestamptz column.
 */
export function localToInstant(date: string, time: string): string {
  return new Date(localToEpochMs(date, time)).toISOString();
}

/** As {@link localToInstant}, but as epoch milliseconds. */
export function localToEpochMs(date: string, time: string): number {
  const { year, month, day } = parseDateString(date);
  const { hour, minute, second } = parseTimeString(time);
  // The wall clock read as if it were UTC. The instant is this minus the
  // offset that is actually in force — which is itself a function of the
  // instant, hence the two candidates below.
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);

  const offsetBefore = offsetMsAt(naive - DAY_MS);
  const offsetAfter = offsetMsAt(naive + DAY_MS);

  const candidateBefore = naive - offsetBefore;
  if (offsetMsAt(candidateBefore) === offsetBefore) return candidateBefore;

  const candidateAfter = naive - offsetAfter;
  if (offsetMsAt(candidateAfter) === offsetAfter) return candidateAfter;

  // Neither candidate round-trips: the wall clock falls in the spring-forward
  // gap and does not exist. Postgres reads it with the pre-transition offset.
  return candidateBefore;
}

/** The Europe/London date and `HH:mm` time at which an instant occurs. */
export function instantToLocal(iso: string | Date): LocalDateTime {
  const epochMs = iso instanceof Date ? iso.getTime() : Date.parse(iso);
  if (Number.isNaN(epochMs)) {
    throw new RangeError(`Not a timestamp: ${JSON.stringify(iso)}`);
  }
  const w = wallClockAt(epochMs);
  return {
    date: `${String(w.year).padStart(4, "0")}-${pad2(w.month)}-${pad2(w.day)}`,
    time: `${pad2(w.hour)}:${pad2(w.minute)}`,
  };
}

/**
 * The legacy `date` + `start_time` + `end_time` triple as a pair of instants,
 * applying the rule the old `room_bookings` constraint encoded: an end time
 * earlier than the start time means the booking ends the next day.
 */
export function legacyWindowToInstants(
  date: string,
  startTime: string,
  endTime: string,
): { startsAt: string; endsAt: string } {
  const start = normaliseTime(startTime);
  const end = normaliseTime(endTime);
  const endDate = end < start ? addDays(date, 1) : date;
  return {
    startsAt: localToInstant(date, start),
    endsAt: localToInstant(endDate, end),
  };
}

/**
 * The inverse of {@link legacyWindowToInstants}: the wall-clock window the UI
 * shows. `date` is always the date the booking starts on, so an overnight
 * booking reads as e.g. 22:00–02:00 on its start date, exactly as before.
 */
export function instantsToLocalWindow(startsAt: string | Date, endsAt: string | Date): BookingWindow {
  const start = instantToLocal(startsAt);
  const end = instantToLocal(endsAt);
  return { date: start.date, startTime: start.time, endTime: end.time };
}

/** `YYYY-MM-DD` shifted by whole days, staying a calendar date. */
export function addDays(date: string, days: number): string {
  const { year, month, day } = parseDateString(date);
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * DAY_MS);
  return `${String(shifted.getUTCFullYear()).padStart(4, "0")}-${pad2(
    shifted.getUTCMonth() + 1,
  )}-${pad2(shifted.getUTCDate())}`;
}

/** Today's date in Europe/London, as `YYYY-MM-DD`. */
export function londonToday(now: Date = new Date()): string {
  return instantToLocal(now).date;
}

/**
 * The half-open instant range covering whole London days from `fromDate` up to
 * and including `toDate`. Use it for `.gte("starts_at", from).lt("starts_at",
 * untilExclusive)` filters so a date-window query stays exact across DST.
 */
export function londonDayRange(
  fromDate: string,
  toDate: string,
): { from: string; untilExclusive: string } {
  return {
    from: localToInstant(fromDate, "00:00"),
    untilExclusive: localToInstant(addDays(toDate, 1), "00:00"),
  };
}

function noonUtcOf(date: string): Date {
  const { year, month, day } = parseDateString(date);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

/** "Monday, 1 January 2026" — the long form used in emails and detail pages. */
export function formatBookingDate(date: string): string {
  return noonUtcOf(date).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** "Mon, 1 Jan 2026" — the compact form used in the bookings table. */
export function formatBookingDateShort(date: string): string {
  return noonUtcOf(date).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** "01/01/2026" — the form used by the CSV/Excel/PDF exports. */
export function formatBookingDateNumeric(date: string): string {
  return noonUtcOf(date).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
