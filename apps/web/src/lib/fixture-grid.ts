/**
 * The matches desk as a grid: rows are teams in age order, columns are the
 * days in the window, and a cell holds that team's fixtures that day.
 *
 * The arithmetic is the winter planner's (`lib/training-plan.ts`) turned
 * ninety degrees — there a row is a pitch and a column a weekday; here a row
 * is a team and a column a date — so the two screens behave the same way: a
 * day with nothing on it is not a column, and the busiest day is the one the
 * screen opens on. Pure, no Supabase, no server-only imports, so the server
 * page and a `"use client"` grid can both call it.
 */

import type { DeskRow } from "@/app/(app)/matches/types";
import { compareAgeGroups } from "@/lib/age-group";

/**
 * What the grid needs of a fixture. Taken from the desk's own row so the
 * page hands its `deskRows` straight over rather than re-deriving anything:
 * `matchday_fixtures()` is read and formatted once, on the server.
 */
export type FixtureGridFixture = Pick<
  DeskRow,
  | "id"
  | "eventId"
  | "teamId"
  | "teamName"
  | "ageGroup"
  | "opponent"
  | "isHome"
  | "status"
  | "time"
  | "dateIso"
  | "pitch"
  | "allocated"
  | "accepted"
  | "declined"
  | "squad"
>;

/** A team the grid draws a row for, whether or not it has a fixture. */
export type FixtureGridTeam = {
  id: string;
  name: string;
  /** `teams.age_group` — the row order. */
  ageGroup: string | null;
  /**
   * `teams.central_venue_name`. A central-venue team's home game is played
   * at the league's ground, so it is never waiting for one of ours.
   */
  centralVenueName?: string | null;
};

/** One fixture as a card in a cell. */
export type FixtureCard = {
  id: string;
  eventId: string | null;
  teamId: string;
  /** "2026-09-05" — which column the card sits in. */
  dayIso: string;
  /** "10:30", London wall clock, formatted by the server. */
  time: string;
  opponent: string;
  homeAway: "H" | "A";
  /** "Banky Lane 1" · "Away" · "Needs a pitch" when a home game has none. */
  pitchLabel: string;
  /** The team plays its home games at a ground the club does not manage. */
  playsCentrally: boolean;
  replies: { in: number; out: number; total: number };
  /** `fixtures.status` — scheduled, cancelled, postponed, played. */
  status: string;
  /** A scheduled home fixture with no pitch and no central venue. */
  needsPitch: boolean;
};

/** One team's row across the window. */
export type FixtureGridTeamRow = {
  teamId: string;
  teamName: string;
  ageGroup: string | null;
  playsCentrally: boolean;
  /** ISO day → that day's cards, kick-off first. Days with none are absent. */
  byDay: Record<string, FixtureCard[]>;
  /** Every card on the row, day then kick-off. */
  cards: FixtureCard[];
  /** How many of the row's cards are still waiting for a pitch. */
  needsPitch: number;
};

/** "Needs a pitch" is the desk's standing invitation, not a scolding. */
export const NEEDS_A_PITCH = "Needs a pitch";

const byKickoff = (a: FixtureCard, b: FixtureCard): number =>
  a.dayIso.localeCompare(b.dayIso) || a.time.localeCompare(b.time) || a.opponent.localeCompare(b.opponent, "en-GB");

/**
 * Is this fixture still waiting for one of our pitches? The desk's own rule
 * (`matches/page.tsx`): a scheduled home fixture with no booking. `allocated`
 * already folds in the central-venue case, and the team's central venue is
 * checked again so a row built without `allocated` still reads honestly.
 */
function waitingForAPitch(fixture: FixtureGridFixture, playsCentrally: boolean): boolean {
  return fixture.isHome && fixture.status === "scheduled" && !fixture.allocated && !playsCentrally;
}

/** Everyone who has answered, out of the squad the invitation went to. */
function replies(fixture: FixtureGridFixture): FixtureCard["replies"] {
  return { in: fixture.accepted, out: fixture.declined, total: fixture.squad };
}

function cardFor(fixture: FixtureGridFixture, playsCentrally: boolean): FixtureCard {
  const needsPitch = waitingForAPitch(fixture, playsCentrally);
  return {
    id: fixture.id,
    eventId: fixture.eventId,
    teamId: fixture.teamId,
    dayIso: fixture.dateIso,
    time: fixture.time,
    opponent: fixture.opponent,
    homeAway: fixture.isHome ? "H" : "A",
    // The desk's pitch word, except that an unallocated home game is asked
    // for rather than reported: the card is the door to allocating it.
    pitchLabel: needsPitch ? NEEDS_A_PITCH : fixture.pitch,
    playsCentrally,
    replies: replies(fixture),
    status: fixture.status,
    needsPitch,
  };
}

/**
 * The grid's rows: one per team given, plus one for any team a fixture names
 * that the caller did not list — a fixture is never dropped for want of a
 * row. Age order throughout (U7 up to Vets, then no age group), then name,
 * so the grid reads the way the club says its teams.
 *
 * `days` bounds the columns: a fixture outside them belongs to another
 * window and is left out.
 */
export function fixtureGridRows(
  fixtures: readonly FixtureGridFixture[],
  teams: readonly FixtureGridTeam[],
  days: readonly string[],
): FixtureGridTeamRow[] {
  const inWindow = new Set(days);
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const rows = new Map<string, FixtureGridTeamRow>();

  const rowFor = (teamId: string, name: string, ageGroup: string | null, centralVenueName: string | null) => {
    let row = rows.get(teamId);
    if (!row) {
      row = {
        teamId,
        teamName: name,
        ageGroup,
        playsCentrally: (centralVenueName ?? "").trim() !== "",
        byDay: {},
        cards: [],
        needsPitch: 0,
      };
      rows.set(teamId, row);
    }
    return row;
  };

  for (const team of teams) rowFor(team.id, team.name, team.ageGroup, team.centralVenueName ?? null);

  for (const fixture of fixtures) {
    if (!inWindow.has(fixture.dateIso)) continue;
    const team = teamById.get(fixture.teamId);
    const row = rowFor(
      fixture.teamId,
      team?.name ?? fixture.teamName,
      team ? team.ageGroup : fixture.ageGroup,
      team?.centralVenueName ?? null,
    );
    const card = cardFor(fixture, row.playsCentrally);
    row.cards.push(card);
    (row.byDay[card.dayIso] ??= []).push(card);
    if (card.needsPitch) row.needsPitch += 1;
  }

  return Array.from(rows.values())
    .map((row) => {
      row.cards.sort(byKickoff);
      // Two games on one day stack in kick-off order, earliest at the top.
      for (const day of Object.keys(row.byDay)) row.byDay[day]?.sort(byKickoff);
      return row;
    })
    .sort(
      (a, b) => compareAgeGroups(a.ageGroup, b.ageGroup) || a.teamName.localeCompare(b.teamName, "en-GB"),
    );
}

/**
 * The days the grid shows, earliest first: any day inside the window with a
 * fixture on it. An empty day drops out, as `timetableDays()` drops an empty
 * weekday — a blank column is a column nobody needs at 390px.
 */
export function fixtureGridDays(
  fixtures: readonly { dateIso: string }[],
  window?: { from?: string; to?: string },
): string[] {
  const days = new Set<string>();
  for (const fixture of fixtures) {
    if (window?.from && fixture.dateIso < window.from) continue;
    if (window?.to && fixture.dateIso > window.to) continue;
    days.add(fixture.dateIso);
  }
  return Array.from(days).sort();
}

/**
 * The day with the most fixtures — Saturday, most weeks — so the phone opens
 * on the column the desk is actually about. Ties go to the earlier day; no
 * fixtures at all, no day.
 */
export function busiestFixtureDay(fixtures: readonly { dateIso: string }[]): string | null {
  const counts = new Map<string, number>();
  for (const fixture of fixtures) counts.set(fixture.dateIso, (counts.get(fixture.dateIso) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const day of Array.from(counts.keys()).sort()) {
    const n = counts.get(day) ?? 0;
    if (n > bestCount) {
      best = day;
      bestCount = n;
    }
  }
  return best;
}

/** What the status bar says, and what its button does. */
export type MatchesAction = {
  /** The button: "Allocate the unplaced" or "Add a fixture". */
  label: string;
  /** The sentence beside it: "8 to place, 3 short of replies". */
  detail: string;
  action: "allocate" | "add";
  /** The fixtures the bulk sheet opens pre-ticked; empty for "add". */
  fixtureIds: string[];
};

/** "1 fixture" / "3 fixtures". */
function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The one thing the desk is waiting for. Placing a pitch comes first: a
 * fixture with no ground is a Saturday morning nobody can answer, whereas a
 * quiet squad still has until kick-off. The desk's own counts
 * (`matches/page.tsx`) decide, so the bar and the chips never disagree —
 * cancelled and postponed fixtures need neither a pitch nor a squad.
 */
export function matchesNextAction(rows: readonly FixtureGridFixture[]): MatchesAction {
  const toPlace = rows.filter((row) => waitingForAPitch(row, false));
  const shortOfReplies = rows.filter(
    (row) => row.status === "scheduled" && row.squad > 0 && row.accepted * 2 < row.squad,
  );
  const parts: string[] = [];
  if (toPlace.length > 0) parts.push(`${toPlace.length} to place`);
  if (shortOfReplies.length > 0) parts.push(`${shortOfReplies.length} short of replies`);

  if (toPlace.length > 0) {
    return {
      label: toPlace.length === 1 ? "Place it" : "Allocate the unplaced",
      detail: parts.join(", "),
      action: "allocate",
      fixtureIds: toPlace.map((row) => row.id),
    };
  }
  return {
    label: "Add a fixture",
    detail:
      parts.length > 0
        ? parts.join(", ")
        : rows.length === 0
          ? "Nothing on the desk for this window"
          : `${plural(rows.length, "fixture", "fixtures")}, every one placed`,
    action: "add",
    fixtureIds: [],
  };
}
