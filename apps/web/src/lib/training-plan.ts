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

/**
 * "4 Jan" — a plain date with no year. Anchored at noon UTC so a London date
 * string never slips a day either side of the clocks changing.
 */
export function dayMonthLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
  });
}

/** "20 Dec – 4 Jan" for a date off; a single day is just the day. */
export function blackoutLabel(startsOn: string, endsOn: string): string {
  return startsOn === endsOn ? dayMonthLabel(startsOn) : `${dayMonthLabel(startsOn)} – ${dayMonthLabel(endsOn)}`;
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

/** How many of a slot's parts the club may hand out: its share, else all of them. */
export function slotCapacity(slot: { parts: number; clubParts: number | null }): number {
  return slot.clubParts === null ? slot.parts : Math.min(slot.clubParts, slot.parts);
}

/** How many of the parts the club has are still free. */
export function partsFree(capacity: number, allocations: readonly { shares: number }[]): number {
  return Math.max(0, capacity - allocations.reduce((sum, a) => sum + a.shares, 0));
}

/**
 * The shares a booked slot can be, as "parts:shares" keys for a select
 * (Adam, 2026-09-13: "some days we might only have half a pitch, or a
 * quarter, or a full pitch").
 */
export const SHARE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "1:1", label: "Full pitch" },
  { value: "2:1", label: "Half a pitch" },
  { value: "3:1", label: "A third" },
  { value: "3:2", label: "Two thirds" },
  { value: "4:1", label: "A quarter" },
  { value: "4:2", label: "Half (2 of 4)" },
  { value: "4:3", label: "Three quarters" },
  { value: "6:1", label: "A sixth" },
];

export function shareKey(parts: number, shares: number): string {
  return `${parts}:${Math.min(shares, parts)}`;
}

/** "2:1" → { parts: 2, shares: 1 }; anything else → the whole pitch. */
export function parseShareKey(key: string): { parts: number; shares: number } {
  const [pRaw, sRaw] = key.split(":");
  const p = Number.parseInt(pRaw ?? "", 10);
  const s = Number.parseInt(sRaw ?? "", 10);
  if (!Number.isInteger(p) || !Number.isInteger(s) || p < 1 || p > 6 || s < 1 || s > p) return { parts: 1, shares: 1 };
  return { parts: p, shares: s };
}

/** "full pitch" / "½ pitch" for a chip. */
export function shareWord(parts: number, shares: number): string {
  return parts <= 1 || shares >= parts ? "full pitch" : `${shareChip(shares, parts)} pitch`;
}

/** "2 of 4 ours" — or nothing when the whole slot is the club's. */
export function oursLabel(slot: { parts: number; clubParts: number | null }): string | null {
  if (slot.parts <= 1 || slot.clubParts === null || slot.clubParts >= slot.parts) return null;
  return `${slot.clubParts} of ${slot.parts} ours`;
}

// ---------------------------------------------------------------------------
// The timetable (Adam, 2026-09-14: "you should only see the venues where we
// have slots … clicking on the slot card … taking you to that slot details …
// minimising clicks and scrolling")
// ---------------------------------------------------------------------------

/** What the timetable needs of a slot. */
export type TimetableSlot = {
  id: string;
  venueId: string | null;
  venueName: string;
  pitchId: string | null;
  pitchName: string | null;
  weekday: number;
  startTime: string;
  endTime: string;
};

/** What the timetable needs of a booked slot at a venue. */
export type TimetableBooking = {
  pitchId: string | null;
  pitchName: string | null;
  weekday: number;
  startTime: string;
  endTime: string;
  parts: number;
  shares: number;
};

export type TimetableRow<S extends TimetableSlot, B extends TimetableBooking> = {
  /** venue id (or name, for a slot at no venue) + pitch id. */
  key: string;
  venueId: string | null;
  venueName: string;
  pitchId: string | null;
  pitchName: string | null;
  /** The row's slots, in day-then-time order. */
  slots: S[];
  /** Booked at this venue and pitch for the block's dates, with no slot planned yet. */
  unplanned: B[];
};

const dayRank = (weekday: number): number => (weekday === 0 ? 7 : weekday);

/**
 * The booked slots at a venue that the plan has not used yet: no training
 * slot at the same venue, pitch, day and hours. Each is one click from being
 * a slot.
 */
export function unplannedBookings<B extends TimetableBooking>(
  venueId: string,
  booked: readonly B[],
  slots: readonly TimetableSlot[],
): B[] {
  return booked.filter(
    (b) =>
      !slots.some(
        (s) =>
          s.venueId === venueId &&
          (s.pitchId ?? "") === (b.pitchId ?? "") &&
          s.weekday === b.weekday &&
          s.startTime.slice(0, 5) === b.startTime.slice(0, 5) &&
          s.endTime.slice(0, 5) === b.endTime.slice(0, 5),
      ),
  );
}

/**
 * The timetable's rows: one per venue AND pitch that has a slot in the block
 * or a booking the block could use — never a venue with neither, however
 * many are on the club's list. Venues in name order, then a venue's pitches
 * in the order given, a slot on no named pitch last.
 */
export function timetableRows<S extends TimetableSlot, B extends TimetableBooking>(
  slots: readonly S[],
  venues: readonly { id: string; name: string; pitches: readonly { id: string; name: string }[]; bookedSlots: readonly B[] }[],
  blockVenueIds: readonly string[],
): TimetableRow<S, B>[] {
  const rows = new Map<string, TimetableRow<S, B>>();
  const rowFor = (venueId: string | null, venueName: string, pitchId: string | null, pitchName: string | null) => {
    const key = `${venueId ?? venueName}|${pitchId ?? ""}`;
    let row = rows.get(key);
    if (!row) {
      row = { key, venueId, venueName, pitchId, pitchName, slots: [], unplanned: [] };
      rows.set(key, row);
    }
    return row;
  };
  for (const slot of slots) rowFor(slot.venueId, slot.venueName, slot.pitchId, slot.pitchName).slots.push(slot);
  for (const venue of venues) {
    if (!blockVenueIds.includes(venue.id)) continue;
    for (const booking of unplannedBookings(venue.id, venue.bookedSlots, slots)) {
      rowFor(venue.id, venue.name, booking.pitchId, booking.pitchName).unplanned.push(booking);
    }
  }
  const pitchRank = (row: TimetableRow<S, B>): number => {
    if (!row.pitchId) return Number.MAX_SAFE_INTEGER;
    const venue = venues.find((v) => v.id === row.venueId);
    const i = venue ? venue.pitches.findIndex((p) => p.id === row.pitchId) : -1;
    return i === -1 ? Number.MAX_SAFE_INTEGER - 1 : i;
  };
  const byTime = (a: { weekday: number; startTime: string }, b: { weekday: number; startTime: string }) =>
    dayRank(a.weekday) - dayRank(b.weekday) || a.startTime.localeCompare(b.startTime);
  return Array.from(rows.values())
    .map((row) => ({ ...row, slots: [...row.slots].sort(byTime), unplanned: [...row.unplanned].sort(byTime) }))
    .sort(
      (a, b) =>
        a.venueName.localeCompare(b.venueName) ||
        pitchRank(a) - pitchRank(b) ||
        (a.pitchName ?? "").localeCompare(b.pitchName ?? ""),
    );
}

/** The days the timetable shows, Monday first: any with a slot or an unused booking. */
export function timetableDays(rows: readonly TimetableRow<TimetableSlot, TimetableBooking>[]): number[] {
  const days = new Set<number>();
  for (const row of rows) {
    for (const slot of row.slots) days.add(slot.weekday);
    for (const booking of row.unplanned) days.add(booking.weekday);
  }
  return [1, 2, 3, 4, 5, 6, 0].filter((day) => days.has(day));
}

/** The day with the most slots — the one being planned — else Monday. */
export function busiestDay(slots: readonly { weekday: number }[]): number {
  const counts = new Map<number, number>();
  for (const slot of slots) counts.set(slot.weekday, (counts.get(slot.weekday) ?? 0) + 1);
  let best = 1;
  let bestCount = -1;
  for (const day of [1, 2, 3, 4, 5, 6, 0]) {
    const n = counts.get(day) ?? 0;
    if (n > bestCount) {
      best = day;
      bestCount = n;
    }
  }
  return best;
}
