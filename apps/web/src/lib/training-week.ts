/**
 * The training week as a grid: rows are teams in age order, columns are the
 * next seven days, and a cell is that team's session that evening — its
 * time, its pitch, how many are coming and whether the register has been
 * taken.
 *
 * Unlike the matches desk, the columns do NOT drop out when a day is empty:
 * a coach looks at the week to see where the gaps are, and an empty Thursday
 * is the answer to "when could we train?". Pure, so the server page and a
 * `"use client"` grid can both call it.
 */

import { compareAgeGroups } from "@/lib/age-group";
import { addDays, instantToLocal, londonToday } from "@/lib/booking-time";
import { dayMonthLabel, weekdayLabel } from "@/lib/training-plan";

/**
 * What the week needs of a session — `training_sessions()`, one row per
 * pitch booking, plus whether its register has been taken.
 */
export type TrainingWeekSession = {
  bookingId: string;
  eventId: string | null;
  teamId: string;
  teamName: string;
  /** `starts_at` — an ISO instant; the London wall clock is read from it. */
  startsAt: string;
  /** `pitch_name`; null for a session booked without a pitch. */
  pitchName: string | null;
  /** The booking's status: "pending" is a pitch awaiting confirmation. */
  status: string;
  accepted: number;
  declined: number;
  squad: number;
  /**
   * Has anybody been marked on the register yet? `training_sessions()` does
   * not carry it, so the screen reads it beside the sessions; leaving it out
   * reads the same as "not taken", which is the safe way round — the worst
   * that happens is the coach is offered a register they have already done.
   */
  marked?: boolean | null;
};

/** A team the week draws a row for, whether or not it trains that week. */
export type TrainingWeekTeam = {
  id: string;
  name: string;
  /** `teams.age_group` — the row order. */
  ageGroup: string | null;
};

/** One session as a card in a cell. */
export type SessionCard = {
  bookingId: string;
  eventId: string | null;
  teamId: string;
  teamName: string;
  /** "2026-09-17" — which column the card sits in. */
  dayIso: string;
  /** "18:00", London wall clock. */
  time: string;
  /** "Banky Lane 1" or "No pitch". */
  pitch: string;
  /** "11/14" — accepted out of the squad invited. */
  attendance: string;
  accepted: number;
  declined: number;
  squad: number;
  /** The register has been started. */
  marked: boolean;
  /** The pitch is booked but the club has not confirmed it yet. */
  awaitingPitch: boolean;
};

/** One team's row across the week. */
export type TrainingWeekRow = {
  teamId: string;
  teamName: string;
  ageGroup: string | null;
  /** ISO day → that day's sessions, earliest first. */
  byDay: Record<string, SessionCard[]>;
  /** Every session on the row, day then time. */
  cards: SessionCard[];
  /** Sessions still waiting for a register. */
  unmarked: number;
};

/** No pitch is a fact about the session, not a blank. */
export const NO_PITCH = "No pitch";

const byStart = (a: SessionCard, b: SessionCard): number =>
  a.dayIso.localeCompare(b.dayIso) || a.time.localeCompare(b.time) || a.teamName.localeCompare(b.teamName, "en-GB");

/**
 * The weekday a London date falls on, 0 = Sunday. Noon UTC is the safe
 * anchor: it is the same calendar day in London whichever side of the
 * clocks changing the date sits.
 */
export function londonWeekday(dateIso: string): number {
  return new Date(`${dateIso}T12:00:00Z`).getUTCDay();
}

export function sessionCard(session: TrainingWeekSession): SessionCard {
  const local = instantToLocal(session.startsAt);
  return {
    bookingId: session.bookingId,
    eventId: session.eventId,
    teamId: session.teamId,
    teamName: session.teamName,
    dayIso: local.date,
    time: local.time,
    pitch: session.pitchName ?? NO_PITCH,
    attendance: `${session.accepted}/${session.squad}`,
    accepted: session.accepted,
    declined: session.declined,
    squad: session.squad,
    marked: session.marked === true,
    awaitingPitch: session.status === "pending",
  };
}

/**
 * The seven days the grid shows, today first. Fixed, not derived from the
 * sessions: the empty cells are the point — each one is a "Book a pitch"
 * with the team and the date already filled in.
 */
export function trainingWeekDays(from: Date | string = new Date(), count = 7): string[] {
  const first = typeof from === "string" ? from : londonToday(from);
  return Array.from({ length: Math.max(count, 0) }, (_, i) => addDays(first, i));
}

/**
 * The week's rows: one per team given, plus one for any team a session names
 * that the caller did not list. Age order, then name. `days` bounds the
 * columns — a session outside the week belongs to another screen.
 */
export function trainingWeekRows(
  sessions: readonly TrainingWeekSession[],
  teams: readonly TrainingWeekTeam[],
  days: readonly string[],
): TrainingWeekRow[] {
  const inWeek = new Set(days);
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const rows = new Map<string, TrainingWeekRow>();

  const rowFor = (teamId: string, name: string, ageGroup: string | null) => {
    let row = rows.get(teamId);
    if (!row) {
      row = { teamId, teamName: name, ageGroup, byDay: {}, cards: [], unmarked: 0 };
      rows.set(teamId, row);
    }
    return row;
  };

  for (const team of teams) rowFor(team.id, team.name, team.ageGroup);

  for (const session of sessions) {
    const card = sessionCard(session);
    if (!inWeek.has(card.dayIso)) continue;
    const team = teamById.get(session.teamId);
    const row = rowFor(session.teamId, team?.name ?? session.teamName, team?.ageGroup ?? null);
    row.cards.push(card);
    (row.byDay[card.dayIso] ??= []).push(card);
    if (!card.marked) row.unmarked += 1;
  }

  return Array.from(rows.values())
    .map((row) => {
      row.cards.sort(byStart);
      for (const day of Object.keys(row.byDay)) row.byDay[day]?.sort(byStart);
      return row;
    })
    .sort((a, b) => compareAgeGroups(a.ageGroup, b.ageGroup) || a.teamName.localeCompare(b.teamName, "en-GB"));
}

/**
 * How a coach says a day out loud. "Tonight" earns its name from 17:00 —
 * training is an evening thing — and anything past the coming week gets its
 * date as well, because "Saturday" alone would be a lie about which one.
 */
export function dayWord(dateIso: string, time: string, todayIso: string = londonToday()): string {
  if (dateIso === todayIso) return time >= "17:00" ? "Tonight" : "Today";
  if (dateIso === addDays(todayIso, 1)) return "Tomorrow";
  if (dateIso === addDays(todayIso, -1)) return "Yesterday";
  const weekday = weekdayLabel(londonWeekday(dateIso));
  const withinTheWeek = dateIso > todayIso && dateIso <= addDays(todayIso, 6);
  return withinTheWeek ? weekday : `${weekday} ${dayMonthLabel(dateIso)}`;
}

/** "Tonight 18:00 · Banky Lane 1 · 11 of 14 coming" — the session in a line. */
export function sessionLine(card: SessionCard, todayIso: string = londonToday()): string {
  const parts = [`${dayWord(card.dayIso, card.time, todayIso)} ${card.time}`, card.pitch];
  if (card.squad > 0) parts.push(`${card.accepted} of ${card.squad} coming`);
  if (card.awaitingPitch) parts.push("pitch awaiting confirmation");
  return parts.join(" · ");
}

/** What the training status bar says, and what its button opens. */
export type SessionAction = {
  /** "Take the register" · "See the register" · "Book a pitch". */
  label: string;
  /** "Tonight 18:00 · U14 Mavericks · Banky Lane 1 · 11 of 14 coming". */
  detail: string;
  mode: "register" | "book";
  bookingId: string | null;
  eventId: string | null;
};

/**
 * The session the coach is about to stand on a pitch for. An unmarked
 * register outranks a marked one whatever the day, so tonight's register is
 * offered ahead of tomorrow's session and ahead of a session already taken;
 * within that, the earliest wins. Yesterday's unmarked register is skipped —
 * the bar is about what is next, and the fold has the term's attendance.
 */
export function sessionNextAction(
  sessions: readonly TrainingWeekSession[],
  now: Date | string = new Date(),
): SessionAction {
  const todayIso = typeof now === "string" ? now : londonToday(now);
  const cards = sessions
    .map(sessionCard)
    .filter((card) => card.dayIso >= todayIso)
    .sort(byStart);

  const chosen = cards.find((card) => !card.marked) ?? cards[0] ?? null;
  if (!chosen) {
    return {
      label: "Book a pitch",
      detail: "No training booked for the next seven days",
      mode: "book",
      bookingId: null,
      eventId: null,
    };
  }
  const when = dayWord(chosen.dayIso, chosen.time, todayIso);
  const parts = [`${when} ${chosen.time}`, chosen.teamName, chosen.pitch];
  if (chosen.squad > 0) parts.push(`${chosen.accepted} of ${chosen.squad} coming`);
  if (chosen.awaitingPitch) parts.push("pitch awaiting confirmation");
  return {
    label: chosen.marked ? "See the register" : "Take the register",
    detail: parts.join(" · "),
    mode: "register",
    bookingId: chosen.bookingId,
    eventId: chosen.eventId,
  };
}
