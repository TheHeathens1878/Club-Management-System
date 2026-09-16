/**
 * What a team page is asking of whoever opened it, and what its settings
 * folds say while they are still closed.
 *
 * The overview's status bar answers one question — "what do I do next for
 * this team?" — in the order the club would: a fixture with no pitch is a
 * Saturday nobody can get to, a squad that has not answered is a team sheet
 * nobody can write, and a register can be taken any time before the whistle.
 * The settings folds answer a different one: each closed row states its own
 * setting, so a coach can read all six without opening any.
 *
 * Pure, no Supabase, no server-only imports.
 */

import { faFormatFor } from "@/lib/fa-formats";
import type { FixtureCard } from "@/lib/fixture-grid";
import { instantToLocal, londonToday } from "@/lib/booking-time";
import { dayMonthLabel, weekdayLabel } from "@/lib/training-plan";
import { dayWord, sessionLine, type SessionCard } from "@/lib/training-week";

/** What the overview knows when it asks. Both cards come from the 7-day grid. */
export type TeamNextActionInput = {
  /** The team's next fixture, from `fixtureGridRows()`; null if it has none. */
  nextFixture: FixtureCard | null;
  /** The team's next session, from `trainingWeekRows()`; null if it has none. */
  nextSession: SessionCard | null;
  /** Today in London — passed in so a test can stand on a known day. */
  today?: string;
};

export type TeamAction = {
  /** "Allocate a pitch" · "Remind the quiet ones" · "Open the register". */
  label: string;
  /** "Saturday 10:30 v Sale Utd · no pitch · 6 of 14 replied". */
  detail: string;
  mode: "pitch" | "remind" | "register" | "none";
  fixtureId: string | null;
  eventId: string | null;
  bookingId: string | null;
};

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "Saturday 10:30 v Sale Utd · no pitch · 6 of 14 replied". */
export function fixtureLine(card: FixtureCard, todayIso: string = londonToday()): string {
  const versus = card.homeAway === "H" ? `v ${card.opponent}` : `v ${card.opponent} (away)`;
  const parts = [`${dayWord(card.dayIso, card.time, todayIso)} ${card.time} ${versus}`];
  // A pitch is only worth mentioning when it is missing or when it is ours:
  // "Away" is already in the line above.
  if (card.needsPitch) parts.push("no pitch");
  else if (card.homeAway === "H") parts.push(card.pitchLabel);
  if (card.replies.total > 0) {
    parts.push(`${card.replies.in + card.replies.out} of ${card.replies.total} replied`);
  }
  return parts.join(" · ");
}

/**
 * The one thing the team is waiting for, in the club's own order. Everything
 * below the first match is still true — the bar names one action, and the
 * grid underneath shows the rest.
 */
export function teamNextAction({ nextFixture, nextSession, today }: TeamNextActionInput): TeamAction {
  const todayIso = today ?? londonToday();

  if (nextFixture?.needsPitch) {
    return {
      label: "Allocate a pitch",
      detail: fixtureLine(nextFixture, todayIso),
      mode: "pitch",
      fixtureId: nextFixture.id,
      eventId: nextFixture.eventId,
      bookingId: null,
    };
  }

  // Quiet, not short: somebody who has said no has answered. The reminder
  // goes to the people who have said nothing at all.
  const quiet = nextFixture
    ? nextFixture.replies.total - nextFixture.replies.in - nextFixture.replies.out
    : 0;
  if (nextFixture && nextFixture.replies.total > 0 && quiet > 0) {
    return {
      label: "Remind the quiet ones",
      detail: fixtureLine(nextFixture, todayIso),
      mode: "remind",
      fixtureId: nextFixture.id,
      eventId: nextFixture.eventId,
      bookingId: null,
    };
  }

  if (nextSession && !nextSession.marked) {
    return {
      label: "Open the register",
      detail: sessionLine(nextSession, todayIso),
      mode: "register",
      fixtureId: null,
      eventId: nextSession.eventId,
      bookingId: nextSession.bookingId,
    };
  }

  return {
    label: "Add a fixture",
    detail: nextFixture
      ? fixtureLine(nextFixture, todayIso)
      : nextSession
        ? sessionLine(nextSession, todayIso)
        : "Nothing booked for this team yet",
    mode: "none",
    fixtureId: nextFixture?.id ?? null,
    eventId: nextFixture?.eventId ?? nextSession?.eventId ?? null,
    bookingId: nextSession?.bookingId ?? null,
  };
}

// ---------------------------------------------------------------------------
// The six closed folds of the Settings tab
// ---------------------------------------------------------------------------

/** The `teams` row, as the settings panels already read it. */
export type TeamSettingsTeam = {
  name: string;
  /** `age_group` — what the FA format falls back to. */
  ageGroup: string | null;
  /** `playing_format`, when the club has overridden the FA's. */
  playingFormat: string | null;
  /** The name of `home_resource_id`'s pitch, resolved by the page. */
  homePitchName: string | null;
  /** `home_kickoff_time`, "10:30:00". */
  homeKickoffTime: string | null;
  /** `central_venue_name` — a ground the club does not manage. */
  centralVenueName: string | null;
  matchHalves: number | null;
  halfLengthMinutes: number | null;
  /** `default_training_day`, 0 = Sunday. */
  defaultTrainingDay: number | null;
  active: boolean;
};

/** `team_fulltime_links`, as the Full-Time panel reads it. */
export type TeamFullTimeLink = {
  ftTeamName: string | null;
  enabled: boolean;
  lastImportAt: string | null;
  lastImportCount: number | null;
};

/** The newest `fixture_import_runs` row. */
export type TeamImportRun = {
  createdAt: string;
  inserted: number;
  updated: number;
};

/** How much of the season is still to place. */
export type TeamHomeFixtures = { total: number; unplaced: number };

export type TeamSettingsSummaries = {
  /** "Banky Lane 1 · 10:30 · 2 × 35 min · 9v9". */
  matchDay: string;
  /** "Tuesdays" or "Not set". */
  trainingEvening: string;
  /** "14 home fixtures, 9 unplaced" or "Plays at Platt Lane". */
  season: string;
  /** "Linked to … · last import 03:10, 12 fixtures" or "Not linked". */
  fullTime: string;
  /** "Last run 2 Sep · 8 updated, 0 created". */
  imports: string;
  /** "Active" or "Inactive". */
  status: string;
};

/**
 * The six summaries the Settings folds show while closed. Each says what is
 * set rather than what the fold is called — "Tuesdays" tells a coach more
 * than "Training evening" does, and a fold that says "Not set" is the one
 * worth opening.
 */
export function teamSettingsSummaries(
  team: TeamSettingsTeam,
  fullTimeLink: TeamFullTimeLink | null,
  lastImport: TeamImportRun | null,
  homeFixtures?: TeamHomeFixtures,
): TeamSettingsSummaries {
  const central = (team.centralVenueName ?? "").trim();

  const matchDayParts: string[] = [];
  const where = team.homePitchName ?? (central || null);
  if (where) matchDayParts.push(where);
  if (team.homeKickoffTime) matchDayParts.push(team.homeKickoffTime.slice(0, 5));
  if (team.matchHalves && team.halfLengthMinutes) {
    matchDayParts.push(`${team.matchHalves} × ${team.halfLengthMinutes} min`);
  }
  // The club's own format wins; otherwise the FA's rules for the age group,
  // which is what the panel itself shows as the derived value.
  const format = (team.playingFormat ?? "").trim() || faFormatFor(team.ageGroup)?.format || null;
  if (format) matchDayParts.push(format);

  const fullTimeParts: string[] = [];
  if (fullTimeLink) {
    fullTimeParts.push(`Linked to ${fullTimeLink.ftTeamName?.trim() || team.name}`);
    if (!fullTimeLink.enabled) fullTimeParts.push("switched off");
    if (fullTimeLink.lastImportAt) {
      const count = fullTimeLink.lastImportCount;
      const time = instantToLocal(fullTimeLink.lastImportAt).time;
      fullTimeParts.push(
        count === null || count === undefined
          ? `last import ${time}`
          : `last import ${time}, ${plural(count, "fixture", "fixtures")}`,
      );
    }
  }

  return {
    matchDay: matchDayParts.length > 0 ? matchDayParts.join(" · ") : "Not set",
    trainingEvening:
      team.defaultTrainingDay === null ? "Not set" : `${weekdayLabel(team.defaultTrainingDay)}s`,
    season: central
      ? `Plays at ${central}`
      : !homeFixtures || homeFixtures.total === 0
        ? "No home fixtures to place"
        : homeFixtures.unplaced === 0
          ? `${plural(homeFixtures.total, "home fixture", "home fixtures")}, all placed`
          : `${plural(homeFixtures.total, "home fixture", "home fixtures")}, ${homeFixtures.unplaced} unplaced`,
    fullTime: fullTimeParts.length > 0 ? fullTimeParts.join(" · ") : "Not linked",
    imports: lastImport
      ? `Last run ${dayMonthLabel(instantToLocal(lastImport.createdAt).date)} · ${lastImport.updated} updated, ${lastImport.inserted} created`
      : "No imports yet",
    status: team.active ? "Active" : "Inactive",
  };
}
