import { describe, expect, it } from "vitest";

import {
  parseStaffTeams,
  repliesLine,
  toCoachFixtures,
  toRegister,
  toSquadSheet,
  whereLine,
  type EventPersonRow,
  type MatchdayRow,
} from "./coach";

function row(overrides: Partial<MatchdayRow>): MatchdayRow {
  return {
    fixture_id: "f1",
    event_id: "e1",
    team_id: "t1",
    team_name: "U14 Mavericks",
    opponent: "Sale United",
    is_home: true,
    competition: null,
    kickoff_at: "2026-09-06T09:30:00.000Z",
    status: "scheduled",
    pitch_name: "Banky Lane 1",
    venue_text: null,
    allocated: true,
    accepted: 8,
    declined: 2,
    squad: 15,
    ...overrides,
  };
}

describe("parseStaffTeams", () => {
  it("reads staff_teams and nothing else", () => {
    expect(
      parseStaffTeams({
        staff_teams: [{ id: "a", name: "U14" }, { id: 7, name: "bad" }, "junk"],
        player_teams: [{ id: "b", name: "Vets" }],
      }),
    ).toEqual([{ id: "a", name: "U14" }]);
  });

  it("answers empty for null, arrays and scalars", () => {
    expect(parseStaffTeams(null)).toEqual([]);
    expect(parseStaffTeams([])).toEqual([]);
    expect(parseStaffTeams("nope")).toEqual([]);
  });
});

describe("toCoachFixtures", () => {
  it("keeps only the caller's staffed teams — an admin's club-wide answer is narrowed", () => {
    const fixtures = toCoachFixtures(
      [row({}), row({ fixture_id: "f2", team_id: "other" })],
      new Set(["t1"]),
    );
    expect(fixtures.map((f) => f.id)).toEqual(["f1"]);
  });

  it("drops cancelled games and sorts soonest first", () => {
    const fixtures = toCoachFixtures(
      [
        row({ fixture_id: "late", kickoff_at: "2026-09-20T09:30:00.000Z" }),
        row({ fixture_id: "gone", status: "cancelled" }),
        row({ fixture_id: "soon", kickoff_at: "2026-09-05T09:30:00.000Z" }),
      ],
      new Set(["t1"]),
    );
    expect(fixtures.map((f) => f.id)).toEqual(["soon", "late"]);
  });

  it("shapes the card: title, London time, pitch and replies", () => {
    const fixture = toCoachFixtures([row({})], new Set(["t1"]))[0]!;
    expect(fixture.title).toBe("v Sale United (H)");
    expect(fixture.when).toBe("Sun 6 Sept · 10:30");
    expect(fixture.where).toBe("Banky Lane 1");
    expect(fixture.replies).toBe("8 in · 2 out · 5 no answer");
    expect(fixture.quiet).toBe(5);
  });
});

describe("whereLine", () => {
  it("is honest about an unallocated home game", () => {
    expect(whereLine(row({ allocated: false, pitch_name: null }))).toBe("Pitch TBC");
  });

  it("names the away ground when Full-Time gave one", () => {
    expect(whereLine(row({ is_home: false, venue_text: "Crossford Bridge" }))).toBe(
      "Crossford Bridge",
    );
    expect(whereLine(row({ is_home: false, venue_text: null }))).toBe("Away — ground TBC");
  });
});

describe("repliesLine", () => {
  it("omits the chase list when everyone has answered", () => {
    expect(repliesLine(9, 2, 11)).toBe("9 in · 2 out");
  });

  it("never counts a negative silence", () => {
    // A guest player accepted beyond the registered squad.
    expect(repliesLine(12, 0, 11)).toBe("12 in · 0 out");
  });
});

describe("toSquadSheet", () => {
  const people: EventPersonRow[] = [
    { person_id: "c", full_name: "Cass Coach", team_role: "coach", is_organiser: true, response: "accepted", note: null, response_stale: false },
    { person_id: "a", full_name: "Ava", team_role: "player", is_organiser: false, response: "accepted", note: null, response_stale: false },
    { person_id: "b", full_name: "Ben", team_role: "player", is_organiser: false, response: "declined", note: "Away that weekend", response_stale: false },
    { person_id: "q", full_name: "Quinn", team_role: "player", is_organiser: false, response: null, note: null, response_stale: false },
    { person_id: "s", full_name: "Sam", team_role: "player", is_organiser: false, response: "accepted", note: null, response_stale: true },
  ];

  it("buckets players and names organisers separately", () => {
    const sheet = toSquadSheet(people);
    expect(sheet.organisers).toEqual(["Cass Coach"]);
    expect(sheet.yes.map((e) => e.name)).toEqual(["Ava", "Sam"]);
    expect(sheet.no[0]).toMatchObject({ name: "Ben", note: "Away that weekend" });
    expect(sheet.quiet.map((e) => e.name)).toEqual(["Quinn"]);
  });

  it("carries the stale flag so an old yes can be re-asked", () => {
    const sheet = toSquadSheet(people);
    expect(sheet.yes.find((e) => e.name === "Sam")?.stale).toBe(true);
    expect(sheet.yes.find((e) => e.name === "Ava")?.stale).toBe(false);
  });
});

describe("toRegister", () => {
  it("lists players only, alphabetically, deduplicated, with their marks", () => {
    const rows = toRegister(
      [
        { person_id: "p2", role: "player" },
        { person_id: "p1", role: "player" },
        { person_id: "p1", role: "player" },
        { person_id: "c1", role: "coach" },
      ],
      new Map([
        ["p1", "Ava"],
        ["p2", "Ben"],
      ]),
      new Map([["p2", "present" as const]]),
    );
    expect(rows).toEqual([
      { personId: "p1", name: "Ava", status: null },
      { personId: "p2", name: "Ben", status: "present" },
    ]);
  });
});
