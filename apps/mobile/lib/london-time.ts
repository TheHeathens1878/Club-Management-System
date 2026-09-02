/**
 * Europe/London wall clock <-> instant, for the coach's kick-off editor.
 *
 * A kick-off at 10:30 is 10:30 in Sale whatever the phone is set to, and the
 * season crosses the clock change in October — so the conversion must come
 * from the tz database, not from the device zone or a fixed offset. This is
 * a deliberate port of the web app's `apps/web/src/lib/booking-time.ts`
 * (P1.6): ambiguous local times (the repeated hour when BST ends) resolve to
 * the FIRST occurrence and non-existent ones (the skipped hour when it
 * starts) are read with the pre-transition offset, because that is how
 * Postgres's `at time zone 'Europe/London'` resolved the club's data.
 * lib/london-time.test.ts pins both edges; if the web file's behaviour ever
 * changes, this one changes with it.
 */

export const LONDON = "Europe/London";

const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{1,2}):(\d{2})$/;

const wallClockFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: LONDON,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** True for a `YYYY-MM-DD` string naming a real calendar day. */
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

/** True for an `H:mm` / `HH:mm` string naming a real time of day. */
export function isValidTimeString(value: string): boolean {
  const m = TIME_RE.exec(value);
  if (!m) return false;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
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

/** The instant at which a London wall clock occurs, ISO, for a timestamptz. */
export function localToInstant(date: string, time: string): string {
  const dm = DATE_RE.exec(date);
  const tm = TIME_RE.exec(time);
  if (!dm || !isValidDateString(date)) {
    throw new RangeError(`Not a calendar date: ${JSON.stringify(date)}`);
  }
  if (!tm || !isValidTimeString(time)) {
    throw new RangeError(`Not a time of day: ${JSON.stringify(time)}`);
  }

  const naive = Date.UTC(
    Number(dm[1]),
    Number(dm[2]) - 1,
    Number(dm[3]),
    Number(tm[1]),
    Number(tm[2]),
    0,
  );

  const offsetBefore = offsetMsAt(naive - DAY_MS);
  const offsetAfter = offsetMsAt(naive + DAY_MS);

  const candidateBefore = naive - offsetBefore;
  if (offsetMsAt(candidateBefore) === offsetBefore) {
    return new Date(candidateBefore).toISOString();
  }
  const candidateAfter = naive - offsetAfter;
  if (offsetMsAt(candidateAfter) === offsetAfter) {
    return new Date(candidateAfter).toISOString();
  }
  return new Date(candidateBefore).toISOString();
}

/** The London date (`YYYY-MM-DD`) and time (`HH:mm`) an instant occurs at. */
export function instantToLocal(iso: string): { date: string; time: string } {
  const epochMs = Date.parse(iso);
  if (Number.isNaN(epochMs)) {
    throw new RangeError(`Not a timestamp: ${JSON.stringify(iso)}`);
  }
  const w = wallClockAt(epochMs);
  return {
    date: `${String(w.year).padStart(4, "0")}-${pad2(w.month)}-${pad2(w.day)}`,
    time: `${pad2(w.hour)}:${pad2(w.minute)}`,
  };
}
