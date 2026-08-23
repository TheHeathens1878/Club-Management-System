/**
 * The pitch calendar — the shared vocabulary (gap 6).
 *
 * Separate from the function-room calendar (`lib/calendar.ts`) on purpose: the
 * room diary answers "is the room free and who paid", this one answers "who is
 * on which pitch, when" for a club that mostly wants to know where its
 * children are playing on Saturday.
 *
 * The rows come from `pitch_calendar(p_from, p_to)` — SECURITY DEFINER, no
 * booker PII, and gated on `can_view_pitch_calendar()`. Everything here is
 * pure: week arithmetic, the four groups the filters offer, and the geometry
 * the day grid lays blocks out with. It imports nothing that reaches
 * `next/headers`, so a client view can render a week without dragging the
 * server Supabase client into the bundle. The reads live in
 * `lib/pitch-calendar-data.ts`.
 *
 * Wall clock is Europe/London throughout, via `lib/booking-time`.
 */

import type { Database } from "@club/db";

import {
  addDays,
  instantToLocal,
  localToInstant,
  londonToday,
} from "@/lib/booking-time";
import type { BookingKind, BookingStatus } from "@/lib/pitch-booking";

export type PitchCalendarRpcRow =
  Database["public"]["Functions"]["pitch_calendar"]["Returns"][number];

/** The four buckets the tabs offer. `kind` has five values; hire joins block. */
export type CalendarGroup = "fixture" | "training" | "other" | "closed";

export const CALENDAR_GROUP_LABELS: Record<CalendarGroup, string> = {
  fixture: "Match",
  training: "Training",
  other: "Other use",
  closed: "Closed",
};

export function groupOf(kind: BookingKind): CalendarGroup {
  if (kind === "fixture") return "fixture";
  if (kind === "training") return "training";
  if (kind === "maintenance") return "closed";
  return "other";
}

/** The tab a URL names, and the groups it keeps. */
export const CALENDAR_FILTERS = [
  { value: "all", label: "All", groups: null },
  { value: "matches", label: "Matches", groups: ["fixture"] },
  { value: "training", label: "Training", groups: ["training"] },
  { value: "closures", label: "Closures", groups: ["closed"] },
] as const;

export type CalendarFilter = (typeof CALENDAR_FILTERS)[number]["value"];

export function isCalendarFilter(value: string | undefined): value is CalendarFilter {
  return CALENDAR_FILTERS.some((f) => f.value === value);
}

export function groupsForFilter(filter: CalendarFilter): CalendarGroup[] | null {
  const found = CALENDAR_FILTERS.find((f) => f.value === filter);
  return found?.groups ? [...found.groups] : null;
}

export type CalendarView = "week" | "month";

export function isCalendarView(value: string | undefined): value is CalendarView {
  return value === "week" || value === "month";
}

/**
 * One booking as every view renders it.
 *
 * `startMinutes` / `endMinutes` are minutes from midnight on `date` in
 * Europe/London. A booking that runs past midnight is clipped to the day it
 * starts on — no pitch session does, and a grid that has to wrap is a grid
 * nobody can read.
 */
export type CalendarEntry = {
  bookingId: string;
  resourceId: string;
  resourceName: string;
  kind: BookingKind;
  group: CalendarGroup;
  status: BookingStatus;
  startsAt: string;
  endsAt: string;
  date: string;
  startTime: string;
  endTime: string;
  startMinutes: number;
  endMinutes: number;
  label: string;
  teamId: string | null;
  teamName: string | null;
  fixtureId: string | null;
  opponent: string | null;
  isHome: boolean | null;
  sharedTeamIds: string[];
  /** Team names for `sharedTeamIds` that the caller could resolve. */
  sharedTeamNames: string[];
};

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(":");
  return Number(hours) * 60 + Number(minutes);
}

/** A `pitch_calendar()` row in the shape the views want. */
export function toCalendarEntry(
  row: PitchCalendarRpcRow,
  teamNames: Map<string, string>,
): CalendarEntry {
  const start = instantToLocal(row.starts_at);
  const end = instantToLocal(row.ends_at);
  const startMinutes = minutesOf(start.time);
  // An end on a later day (or exactly midnight) reads as the end of this day.
  const endMinutes =
    end.date === start.date ? Math.max(minutesOf(end.time), startMinutes + 15) : 24 * 60;
  const shared = (row.shared_team_ids ?? []).filter((id) => id !== row.team_id);

  return {
    bookingId: row.booking_id,
    resourceId: row.resource_id,
    resourceName: row.resource_name,
    kind: row.kind,
    group: groupOf(row.kind),
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    date: start.date,
    startTime: start.time,
    endTime: end.time,
    startMinutes,
    endMinutes,
    label: row.label?.trim() || "Pitch booking",
    teamId: row.team_id,
    teamName: row.team_name,
    fixtureId: row.fixture_id,
    opponent: row.opponent,
    isHome: row.is_home,
    sharedTeamIds: shared,
    sharedTeamNames: shared
      .map((id) => teamNames.get(id))
      .filter((name): name is string => Boolean(name)),
  };
}

// ---------------------------------------------------------------------------
// Weeks
// ---------------------------------------------------------------------------

/** `YYYY-MM-DD` split into numbers, without an index-access assertion. */
function datePartsOf(date: string): { year: number; month: number; day: number } {
  const [year = "0", month = "1", day = "1"] = date.split("-");
  return { year: Number(year), month: Number(month), day: Number(day) };
}

/**
 * Noon UTC on a given London date. Noon is never on the wrong side of a London
 * midnight in either direction, so formatting this instant in UTC reports the
 * weekday and the day-of-month of the local date.
 */
function noonUtcOf(date: string): Date {
  const { year, month, day } = datePartsOf(date);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

/** The Monday of the week a date falls in, in Europe/London. */
export function mondayOf(date: string): string {
  const weekday = noonUtcOf(date).getUTCDay(); // 0 = Sunday
  const backwards = weekday === 0 ? 6 : weekday - 1;
  return addDays(date, -backwards);
}

export function thisMonday(): string {
  return mondayOf(londonToday());
}

export type CalendarWeek = { monday: string; days: string[] };

export function weekOf(monday: string): CalendarWeek {
  return { monday, days: Array.from({ length: 7 }, (_, i) => addDays(monday, i)) };
}

export function shiftWeek(monday: string, weeks: number): string {
  return addDays(monday, weeks * 7);
}

/** The half-open instant window covering a whole London week. */
export function weekWindow(monday: string): { from: string; to: string } {
  return {
    from: localToInstant(monday, "00:00"),
    to: localToInstant(addDays(monday, 7), "00:00"),
  };
}

// ---------------------------------------------------------------------------
// Months
// ---------------------------------------------------------------------------

/** The first of the month a date falls in. */
export function monthStartOf(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function shiftMonth(monthStart: string, months: number): string {
  const { year, month } = datePartsOf(monthStart);
  const total = year * 12 + (month - 1) + months;
  const newYear = Math.floor(total / 12);
  const newMonth = (total % 12) + 1;
  return `${String(newYear).padStart(4, "0")}-${String(newMonth).padStart(2, "0")}-01`;
}

/**
 * The Monday-first grid a month view draws: six rows of seven days, so the
 * grid never changes height between months.
 */
export function monthGrid(monthStart: string): string[] {
  const first = mondayOf(monthStart);
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

/** The instant window covering the whole month grid, leading/trailing days in. */
export function monthWindow(monthStart: string): { from: string; to: string } {
  const grid = monthGrid(monthStart);
  const firstDay = grid[0] ?? monthStart;
  const lastDay = grid[grid.length - 1] ?? monthStart;
  return {
    from: localToInstant(firstDay, "00:00"),
    to: localToInstant(addDays(lastDay, 1), "00:00"),
  };
}

// ---------------------------------------------------------------------------
// Day-grid geometry
// ---------------------------------------------------------------------------

/** The hours a day column shows. Outside these, a booking is clamped in. */
export const DAY_START_MINUTES = 8 * 60;
export const DAY_END_MINUTES = 22 * 60;
export const DAY_HOURS = Array.from(
  { length: (DAY_END_MINUTES - DAY_START_MINUTES) / 60 + 1 },
  (_, i) => DAY_START_MINUTES / 60 + i,
);

/** Pixels per hour in the day grid; the only number the CSS and the maths share. */
export const HOUR_HEIGHT = 44;

export function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

/**
 * Where a block sits in a day column, as percentages of the visible window.
 * Anything that starts before 08:00 or ends after 22:00 is clamped, so an
 * early kick-off or a floodlit session still shows rather than escaping.
 */
export function blockGeometry(entry: CalendarEntry): { topPct: number; heightPct: number } {
  const span = DAY_END_MINUTES - DAY_START_MINUTES;
  const start = Math.max(entry.startMinutes, DAY_START_MINUTES);
  const end = Math.min(Math.max(entry.endMinutes, start + 15), DAY_END_MINUTES);
  return {
    topPct: ((start - DAY_START_MINUTES) / span) * 100,
    heightPct: (Math.max(end - start, 15) / span) * 100,
  };
}

/**
 * Group colours. Pending is drawn outlined and hatched rather than solid, so
 * "asked for" never reads as "it is happening" — the difference matters most
 * to a parent glancing at Saturday.
 */
export const GROUP_STYLES: Record<CalendarGroup, { solid: string; pending: string }> = {
  fixture: {
    solid: "border-emerald-300 bg-emerald-100 text-emerald-900",
    pending: "border-emerald-400 border-dashed bg-emerald-50/60 text-emerald-900",
  },
  training: {
    solid: "border-sky-300 bg-sky-100 text-sky-900",
    pending: "border-sky-400 border-dashed bg-sky-50/60 text-sky-900",
  },
  other: {
    solid: "border-violet-300 bg-violet-100 text-violet-900",
    pending: "border-violet-400 border-dashed bg-violet-50/60 text-violet-900",
  },
  closed: {
    solid: "border-slate-400 bg-slate-200 text-slate-900",
    pending: "border-slate-400 border-dashed bg-slate-100/60 text-slate-900",
  },
};

export function blockClasses(entry: CalendarEntry): string {
  const style = GROUP_STYLES[entry.group];
  return entry.status === "pending" ? style.pending : style.solid;
}

/** "Sat 1 Mar" — the compact day heading the week grid uses. */
export function dayHeading(date: string): string {
  return noonUtcOf(date).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** "Monday 1 March" — the list view's day heading. */
export function dayHeadingLong(date: string): string {
  return noonUtcOf(date).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

/** "March 2026" — the month view's heading. */
export function monthHeading(monthStart: string): string {
  return noonUtcOf(monthStart).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });
}

/** "1 – 7 Mar 2026" — the week's range, for the toolbar. */
export function weekHeading(monday: string): string {
  const fmt = (date: string, withYear: boolean): string =>
    noonUtcOf(date).toLocaleDateString("en-GB", {
      timeZone: "UTC",
      day: "numeric",
      month: "short",
      ...(withYear ? { year: "numeric" as const } : {}),
    });
  return `${fmt(monday, false)} – ${fmt(addDays(monday, 6), true)}`;
}

/** The teams whose sessions "My teams" keeps: the booking's own or a sharer. */
export function entryTouchesTeams(entry: CalendarEntry, teamIds: Set<string>): boolean {
  if (entry.teamId && teamIds.has(entry.teamId)) return true;
  return entry.sharedTeamIds.some((id) => teamIds.has(id));
}

/** Entries by London date, so a day column can be drawn without re-scanning. */
export function entriesByDate(entries: CalendarEntry[]): Map<string, CalendarEntry[]> {
  const byDate = new Map<string, CalendarEntry[]>();
  for (const entry of entries) {
    const list = byDate.get(entry.date);
    if (list) list.push(entry);
    else byDate.set(entry.date, [entry]);
  }
  for (const list of byDate.values()) {
    list.sort((a, b) => a.startMinutes - b.startMinutes || a.resourceName.localeCompare(b.resourceName));
  }
  return byDate;
}

/** Counts per group for one day — what the month grid shows in each cell. */
export function countsByGroup(entries: CalendarEntry[]): Record<CalendarGroup, number> {
  const counts: Record<CalendarGroup, number> = {
    fixture: 0,
    training: 0,
    other: 0,
    closed: 0,
  };
  for (const entry of entries) counts[entry.group] += 1;
  return counts;
}

export { londonToday };
