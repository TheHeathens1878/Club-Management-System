/**
 * Winter training allocation — the words and the arithmetic both sides of
 * the wire share (Adam, 2026-09-06). Pure: no Supabase, no `next/headers`,
 * so the client panels can use it and the tests can pin it.
 *
 * The database owns the rules (a slot's parts cannot be over-allocated, the
 * sync is idempotent); this module only says things the way the screen
 * says them, and mirrors `training_share_label()` so the note on the
 * calendar and the chip on the planner read alike.
 */

/** `extract(dow)` order, Monday first for the picker. */
export const WEEKDAYS: readonly { value: number; label: string; short: string }[] = [
  { value: 1, label: "Monday", short: "Mon" },
  { value: 2, label: "Tuesday", short: "Tue" },
  { value: 3, label: "Wednesday", short: "Wed" },
  { value: 4, label: "Thursday", short: "Thu" },
  { value: 5, label: "Friday", short: "Fri" },
  { value: 6, label: "Saturday", short: "Sat" },
  { value: 0, label: "Sunday", short: "Sun" },
];

export function weekdayLabel(weekday: number, short = false): string {
  const day = WEEKDAYS.find((d) => d.value === weekday);
  return day ? (short ? day.short : day.label) : "";
}

/** How a slot may be divided: 1 to 6, as Adam asked. */
export const PARTS_OPTIONS: readonly { value: number; label: string }[] = [
  { value: 1, label: "Whole pitch" },
  { value: 2, label: "Halves" },
  { value: 3, label: "Thirds" },
  { value: 4, label: "Quarters" },
  { value: 5, label: "Fifths" },
  { value: 6, label: "Sixths" },
];

export function partsLabel(parts: number): string {
  return PARTS_OPTIONS.find((p) => p.value === parts)?.label ?? `${parts} parts`;
}

const FRACTION: Record<number, string> = { 3: "third", 4: "quarter", 5: "fifth", 6: "sixth" };
const COUNT: Record<number, string> = { 1: "A", 2: "Two", 3: "Three", 4: "Four", 5: "Five" };

/** Mirrors `training_share_label()`: "A third of the pitch", "Half of the pitch". */
export function shareLabel(shares: number, parts: number): string {
  if (parts <= 1 || shares >= parts) return "The whole pitch";
  if (parts === 2) return "Half of the pitch";
  const word = FRACTION[parts] ?? "part";
  return `${COUNT[shares] ?? String(shares)} ${word}${shares === 1 ? "" : "s"} of the pitch`;
}

/** The short chip form: "⅓", "⅔", "½", "whole". */
export function shareChip(shares: number, parts: number): string {
  if (parts <= 1 || shares >= parts) return "whole";
  const glyph: Record<string, string> = {
    "1/2": "½",
    "1/3": "⅓",
    "2/3": "⅔",
    "1/4": "¼",
    "2/4": "½",
    "3/4": "¾",
    "1/5": "⅕",
    "2/5": "⅖",
    "3/5": "⅗",
    "4/5": "⅘",
    "1/6": "⅙",
    "5/6": "⅚",
  };
  return glyph[`${shares}/${parts}`] ?? `${shares}/${parts}`;
}

/** "18:00–19:00" from two `HH:MM[:SS]` strings. */
export function timeRange(start: string, end: string): string {
  return `${start.slice(0, 5)}–${end.slice(0, 5)}`;
}

/** "Mon 12 Oct – Fri 20 Mar" — a block's span, London dates. */
export function dateSpanLabel(startsOn: string, endsOn: string): string {
  const fmt = (date: string): string =>
    new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
      timeZone: "UTC",
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  return startsOn === endsOn ? fmt(startsOn) : `${fmt(startsOn)} – ${fmt(endsOn)}`;
}

/** "20 Dec – 4 Jan" for a date off; a single day is just the day. */
export function blackoutLabel(startsOn: string, endsOn: string): string {
  const fmt = (date: string): string =>
    new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
      timeZone: "UTC",
      day: "numeric",
      month: "short",
    });
  return startsOn === endsOn ? fmt(startsOn) : `${fmt(startsOn)} – ${fmt(endsOn)}`;
}

export type SyncCounts = {
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
  cancelled: number;
};

/** Is there anything for the button to do? */
export function syncPending(counts: SyncCounts): boolean {
  return counts.added > 0 || counts.updated > 0 || counts.removed > 0;
}

/**
 * "8 to add · 2 to change · 3 to remove" before the run; "8 added · 2
 * changed · 3 removed" after; "The calendar matches the plan" when nothing.
 */
export function syncSummary(counts: SyncCounts, done = false): string {
  const parts: string[] = [];
  if (counts.added > 0) parts.push(`${counts.added} ${done ? "added" : "to add"}`);
  if (counts.updated > 0) parts.push(`${counts.updated} ${done ? "changed" : "to change"}`);
  if (counts.removed > 0) parts.push(`${counts.removed} ${done ? "removed" : "to remove"}`);
  if (parts.length === 0) {
    return done ? "Nothing needed changing — the calendar already matched the plan." : "The calendar matches the plan.";
  }
  return parts.join(" · ");
}

/** "24 sessions on the calendar, 1 cancelled by a coach". */
export function calendarSummary(counts: SyncCounts): string {
  const onCalendar = counts.unchanged + counts.updated;
  const base = `${onCalendar} session${onCalendar === 1 ? "" : "s"} on the calendar`;
  return counts.cancelled > 0
    ? `${base}, ${counts.cancelled} cancelled by a coach`
    : base;
}

/** The slots of a block, in the order the planner reads them: venue, then day, then time. */
export function slotOrder<T extends { venueName: string; weekday: number; startTime: string }>(
  slots: readonly T[],
): T[] {
  const dayRank = (weekday: number): number => (weekday === 0 ? 7 : weekday);
  return [...slots].sort(
    (a, b) =>
      a.venueName.localeCompare(b.venueName) ||
      dayRank(a.weekday) - dayRank(b.weekday) ||
      a.startTime.localeCompare(b.startTime),
  );
}

/** How many of a slot's parts are still free. */
export function partsFree(parts: number, allocations: readonly { shares: number }[]): number {
  return Math.max(0, parts - allocations.reduce((sum, a) => sum + a.shares, 0));
}
