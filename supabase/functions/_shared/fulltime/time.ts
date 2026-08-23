/**
 * Full-Time prints Europe/London wall clock (`dd/mm/yy` + `HH:MM`); the
 * `fixtures` table stores a `timestamptz`. This is the only place the two meet.
 *
 * The conversion is the same one `apps/web/src/lib/booking-time.ts` performs
 * for bookings: probe the zone offset with `Intl.DateTimeFormat` so the DST
 * rules come from the platform's tz database instead of a hard-coded table,
 * and resolve ambiguous/non-existent local times exactly as Postgres's
 * `timestamp at time zone 'Europe/London'` does. The helper is copied rather
 * than imported because this package must stay free of app dependencies — it
 * is meant to be liftable into an Edge Function on its own (P2.4).
 */

export const FULLTIME_TIME_ZONE = "Europe/London";

const DAY_MS = 86_400_000;

const wallClockFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: FULLTIME_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

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

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Epoch ms for a Europe/London wall clock given as `YYYY-MM-DD` + `HH:MM`. */
export function londonToEpochMs(date: string, time: string): number {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (!d) throw new RangeError(`Not a calendar date: ${JSON.stringify(date)}`);
  if (!t) throw new RangeError(`Not a time of day: ${JSON.stringify(time)}`);

  const naive = Date.UTC(
    Number(d[1]),
    Number(d[2]) - 1,
    Number(d[3]),
    Number(t[1]),
    Number(t[2]),
    t[3] === undefined ? 0 : Number(t[3]),
  );

  const offsetBefore = offsetMsAt(naive - DAY_MS);
  const offsetAfter = offsetMsAt(naive + DAY_MS);

  const candidateBefore = naive - offsetBefore;
  if (offsetMsAt(candidateBefore) === offsetBefore) return candidateBefore;

  const candidateAfter = naive - offsetAfter;
  if (offsetMsAt(candidateAfter) === offsetAfter) return candidateAfter;

  // Spring-forward gap: the wall clock never happens. Postgres reads it with
  // the pre-transition offset, which lands just after the gap.
  return candidateBefore;
}

/** The instant a Europe/London wall clock occurs, as an ISO UTC string. */
export function londonToInstant(date: string, time: string): string {
  return new Date(londonToEpochMs(date, time)).toISOString();
}

/**
 * `dd/mm/yy` or `dd/mm/yyyy` to `YYYY-MM-DD`.
 *
 * Full-Time prints two-digit years. `00`–`69` is read as 20xx and `70`–`99` as
 * 19xx — the POSIX convention; a football fixture is never from the 1970s, but
 * a mis-scraped `70` should not silently become 2070 either.
 *
 * Returns `undefined` for anything that is not a real calendar date, so the
 * caller can raise a warning rather than invent a fixture.
 */
export function parseUkDate(value: string): string | undefined {
  const m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/.exec(value.trim());
  if (!m) return undefined;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const rawYear = Number(m[3]);
  const year =
    (m[3] ?? "").length === 4 ? rawYear : rawYear <= 69 ? 2000 + rawYear : 1900 + rawYear;

  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return undefined;
  }
  return `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;
}

/** `H:mm` / `HH:mm:ss` to `HH:MM`; `undefined` when it is not a time of day. */
export function parseClockTime(value: string): string | undefined {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!m) return undefined;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return undefined;
  return `${pad2(hour)}:${pad2(minute)}`;
}

/** An ISO date already in `YYYY-MM-DD` form, or `undefined`. */
export function parseIsoDate(value: string): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return undefined;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return undefined;
  }
  return `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;
}

/** Either `YYYY-MM-DD` or a UK-style `dd/mm/yy(yy)`, whichever parses. */
export function parseAnyDate(value: string): string | undefined {
  return parseIsoDate(value) ?? parseUkDate(value);
}
