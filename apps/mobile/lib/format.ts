/**
 * Formatting helpers. Pure — no React Native imports — so vitest can exercise
 * them (lib/format.test.ts).
 *
 * Every date the club cares about is a UK date: a fixture at 10:30 is 10:30 in
 * Sale, whatever timezone the phone is set to. So the timezone is pinned to
 * Europe/London rather than left to the device.
 */

export const CLUB_TIME_ZONE = "Europe/London";

function fmt(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: CLUB_TIME_ZONE,
    ...options,
  });
}

/**
 * ICU puts a comma after the weekday in some patterns and not others, and the
 * exact rule differs between Node and Hermes. Dropping it keeps "Sat 5 Sept"
 * and "Sat 5 Sept 2026" reading the same way on every device.
 */
function tidy(value: string): string {
  return value.replace(/,/g, "").replace(/\s+/g, " ").trim();
}

/** "Sat 6 Sep" — the day part of a kickoff. */
export function clubDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return tidy(
    fmt({ weekday: "short", day: "numeric", month: "short" }).format(date),
  );
}

/** "10:30" — the time part of a kickoff, 24-hour, Europe/London. */
export function clubTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return fmt({ hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

/** "Sat 6 Sep · 10:30". */
export function clubDateTime(iso: string | null | undefined): string {
  const day = clubDate(iso);
  const time = clubTime(iso);
  if (!day) return "";
  return `${day} · ${time}`;
}

/** "Sat 6 Sep 2025 · 10:30" — used where the year is not obvious. */
export function clubDateTimeLong(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const day = tidy(
    fmt({
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(date),
  );
  return `${day} · ${clubTime(iso)}`;
}

/** Pence to "£42.50". Negative amounts keep the sign in front of the symbol. */
export function poundsFromPence(pence: number | null | undefined): string {
  const value = pence ?? 0;
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  return `${sign}£${(absolute / 100).toFixed(2)}`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "now", "5m", "3h", "2d", then the date. Used on the conversation list, where
 * a full timestamp would crowd out the message preview.
 */
export function shortAgo(
  iso: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!iso) return "";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const delta = now.getTime() - then.getTime();
  if (delta < MINUTE) return "now";
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h`;
  if (delta < 7 * DAY) return `${Math.floor(delta / DAY)}d`;
  return clubDate(iso);
}

/** Single-line preview, collapsed and clipped so a card never grows. */
export function previewText(body: string, limit = 80): string {
  const collapsed = body.replace(/\s+/g, " ").trim();
  if (collapsed.length <= limit) return collapsed;
  return `${collapsed.slice(0, limit - 1).trimEnd()}…`;
}

/** Sentence-cases a snake_case enum value: `past_due` → "Past due". */
export function humaniseEnum(value: string): string {
  const spaced = value.replace(/_/g, " ").trim();
  if (!spaced) return "";
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
