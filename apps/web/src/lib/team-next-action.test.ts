import { describe, expect, it } from "vitest";

import type { FixtureCard } from "@/lib/fixture-grid";
import {
  fixtureLine,
  teamNextAction,
  teamSettingsSummaries,
  type TeamSettingsTeam,
} from "@/lib/team-next-action";
import type { SessionCard } from "@/lib/training-week";

const TODAY = "2026-09-16"; // a Wednesday
const SATURDAY = "2026-09-19";

function fixtureCard(overrides: Partial<FixtureCard> = {}): FixtureCard {
  return {
    id: "fixture-1",
    eventId: "event-1",
    teamId: "mavericks",
    dayIso: SATURDAY,
    time: "10:30",
    opponent: "Sale Utd",
    homeAway: "H",
    pitchLabel: "Banky Lane 1",
    playsCentrally: false,
    replies: { in: 12, out: 2, total: 14 },
    status: "scheduled",
    needsPitch: false,
    ...overrides,
  };
}

function sessionCard(overrides: Partial<SessionCard> = {}): SessionCard {
  return {
    bookingId: "booking-1",
    eventId: "event-2",
    teamId: "mavericks",
    teamName: "U14 Mavericks",
    dayIso: TODAY,
    time: "18:00",
    pitch: "Banky Lane 1",
    attendance: "11/14",
    accepted: 11,
    declined: 1,
    squad: 14,
    marked: false,
    awaitingPitch: false,
    ...overrides,
  };
}

describe("what the team is waiting for", () => {
  it("asks for a pitch before anything else", () => {
    const action = teamNextAction({
      nextFixture: fixtureCard({ needsPitch: true, pitchLabel: "Needs a pitch", replies: { in: 6, out: 0, total: 14 } }),
      nextSession: sessionCard(),
      today: TODAY,
    });
    expect(action.mode).toBe("pitch");
    expect(action.label).toBe("Allocate a pitch");
    expect(action.detail).toBe("Saturday 10:30 v Sale Utd · no pitch · 6 of 14 replied");
    expect(action.fixtureId).toBe("fixture-1");
  });

  it("chases the quiet ones once the pitch is settled", () => {
    const action = teamNextAction({
      nextFixture: fixtureCard({ replies: { in: 6, out: 0, total: 14 } }),
      nextSession: sessionCard(),
      today: TODAY,
    });
    expect(action.mode).toBe("remind");
    expect(action.label).toBe("Remind the quiet ones");
    expect(action.detail).toBe("Saturday 10:30 v Sale Utd · Banky Lane 1 · 6 of 14 replied");
  });

  it("opens the register once everybody has answered", () => {
    const action = teamNextAction({
      nextFixture: fixtureCard(),
      nextSession: sessionCard(),
      today: TODAY,
    });
    expect(action.mode).toBe("register");
    expect(action.label).toBe("Open the register");
    expect(action.detail).toBe("Tonight 18:00 · Banky Lane 1 · 11 of 14 coming");
    expect(action.bookingId).toBe("booking-1");
  });

  it("counts somebody who has said no as having replied", () => {
    const action = teamNextAction({
      nextFixture: fixtureCard({ replies: { in: 9, out: 5, total: 14 } }),
      nextSession: sessionCard({ marked: true }),
      today: TODAY,
    });
    expect(action.mode).toBe("none");
  });

  it("has nothing to say for a team with nothing booked", () => {
    const action = teamNextAction({ nextFixture: null, nextSession: null, today: TODAY });
    expect(action.mode).toBe("none");
    expect(action.detail).toBe("Nothing booked for this team yet");
  });

  it("says an away game is away", () => {
    expect(fixtureLine(fixtureCard({ homeAway: "A", pitchLabel: "Away" }), TODAY)).toBe(
      "Saturday 10:30 v Sale Utd (away) · 14 of 14 replied",
    );
  });
});

const TEAM: TeamSettingsTeam = {
  name: "U14 Mavericks",
  ageGroup: "U13",
  playingFormat: null,
  homePitchName: "Banky Lane 1",
  homeKickoffTime: "10:30:00",
  centralVenueName: null,
  matchHalves: 2,
  halfLengthMinutes: 35,
  defaultTrainingDay: 2,
  active: true,
};

describe("the six closed folds of the settings tab", () => {
  it("says every setting without being opened", () => {
    const summaries = teamSettingsSummaries(
      TEAM,
      {
        ftTeamName: "Ashton On Mersey FC U14 Mavericks",
        enabled: true,
        lastImportAt: "2026-09-16T02:10:00Z",
        lastImportCount: 12,
      },
      { createdAt: "2026-09-02T09:00:00Z", inserted: 0, updated: 8 },
      { total: 14, unplaced: 9 },
    );
    expect(summaries).toEqual({
      matchDay: "Banky Lane 1 · 10:30 · 2 × 35 min · 9v9",
      trainingEvening: "Tuesdays",
      season: "14 home fixtures, 9 unplaced",
      fullTime: "Linked to Ashton On Mersey FC U14 Mavericks · last import 03:10, 12 fixtures",
      imports: "Last run 2 Sept · 8 updated, 0 created",
      status: "Active",
    });
  });

  it("says what is not set rather than leaving a blank", () => {
    const summaries = teamSettingsSummaries(
      {
        ...TEAM,
        ageGroup: null,
        homePitchName: null,
        homeKickoffTime: null,
        matchHalves: null,
        halfLengthMinutes: null,
        defaultTrainingDay: null,
        active: false,
      },
      null,
      null,
    );
    expect(summaries).toEqual({
      matchDay: "Not set",
      trainingEvening: "Not set",
      season: "No home fixtures to place",
      fullTime: "Not linked",
      imports: "No imports yet",
      status: "Inactive",
    });
  });

  it("says where a central-venue team plays instead of offering to place it", () => {
    const summaries = teamSettingsSummaries(
      { ...TEAM, centralVenueName: "Platt Lane" },
      null,
      null,
      { total: 14, unplaced: 9 },
    );
    expect(summaries.season).toBe("Plays at Platt Lane");
  });

  it("prefers the club's own format to the FA's, and says when the season is all placed", () => {
    const summaries = teamSettingsSummaries(
      { ...TEAM, playingFormat: "11v11" },
      { ftTeamName: null, enabled: false, lastImportAt: null, lastImportCount: null },
      null,
      { total: 1, unplaced: 0 },
    );
    expect(summaries.matchDay).toBe("Banky Lane 1 · 10:30 · 2 × 35 min · 11v11");
    expect(summaries.season).toBe("1 home fixture, all placed");
    expect(summaries.fullTime).toBe("Linked to U14 Mavericks · switched off");
  });
});
