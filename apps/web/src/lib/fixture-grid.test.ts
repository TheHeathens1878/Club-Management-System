import { describe, expect, it } from "vitest";

import {
  busiestFixtureDay,
  fixtureGridDays,
  fixtureGridRows,
  matchesNextAction,
  type FixtureGridFixture,
  type FixtureGridTeam,
} from "@/lib/fixture-grid";

// 2026-09-05 is a Saturday; the window below runs Thursday to Sunday, the
// days the fixture desk is actually about.
const THU = "2026-09-03";
const FRI = "2026-09-04";
const SAT = "2026-09-05";
const SUN = "2026-09-06";
const WINDOW = [THU, FRI, SAT, SUN];

function fixture(overrides: Partial<FixtureGridFixture> & { id: string; teamId: string }): FixtureGridFixture {
  return {
    eventId: `event-${overrides.id}`,
    teamName: "A team",
    ageGroup: null,
    opponent: "Sale Utd",
    isHome: true,
    status: "scheduled",
    time: "10:30",
    dateIso: SAT,
    pitch: "Banky Lane 1",
    allocated: true,
    accepted: 12,
    declined: 1,
    squad: 14,
    ...overrides,
  };
}

const TEAMS: FixtureGridTeam[] = [
  { id: "mavericks", name: "U14 Mavericks", ageGroup: "U14" },
  { id: "comets", name: "U7 Comets", ageGroup: "U7" },
  { id: "venus", name: "U11 Venus", ageGroup: "U11", centralVenueName: "Platt Lane" },
];

describe("the fixture grid", () => {
  it("puts the teams in age order, youngest first", () => {
    const rows = fixtureGridRows([], TEAMS, WINDOW);
    expect(rows.map((row) => row.teamName)).toEqual(["U7 Comets", "U11 Venus", "U14 Mavericks"]);
  });

  it("stacks two games on one day by kick-off", () => {
    const rows = fixtureGridRows(
      [
        fixture({ id: "late", teamId: "comets", time: "12:00", opponent: "Timperley" }),
        fixture({ id: "early", teamId: "comets", time: "09:00", opponent: "Altrincham" }),
      ],
      TEAMS,
      WINDOW,
    );
    const comets = rows.find((row) => row.teamId === "comets");
    expect(comets?.byDay[SAT]?.map((card) => card.time)).toEqual(["09:00", "12:00"]);
    expect(comets?.byDay[SAT]?.map((card) => card.opponent)).toEqual(["Altrincham", "Timperley"]);
  });

  it("asks for a pitch where a home game has none, and never for an away game", () => {
    const rows = fixtureGridRows(
      [
        fixture({ id: "home", teamId: "mavericks", allocated: false, pitch: "Unallocated" }),
        fixture({ id: "away", teamId: "mavericks", isHome: false, dateIso: SUN, pitch: "Away", allocated: false }),
      ],
      TEAMS,
      WINDOW,
    );
    const mavericks = rows.find((row) => row.teamId === "mavericks");
    expect(mavericks?.byDay[SAT]?.[0]?.pitchLabel).toBe("Needs a pitch");
    expect(mavericks?.byDay[SAT]?.[0]?.needsPitch).toBe(true);
    expect(mavericks?.byDay[SUN]?.[0]?.pitchLabel).toBe("Away");
    expect(mavericks?.byDay[SUN]?.[0]?.homeAway).toBe("A");
    expect(mavericks?.needsPitch).toBe(1);
  });

  it("never asks a central-venue team for one of our pitches", () => {
    const rows = fixtureGridRows(
      [fixture({ id: "central", teamId: "venus", allocated: true, pitch: "Platt Lane" })],
      TEAMS,
      WINDOW,
    );
    const venus = rows.find((row) => row.teamId === "venus");
    expect(venus?.playsCentrally).toBe(true);
    expect(venus?.byDay[SAT]?.[0]?.needsPitch).toBe(false);
    expect(venus?.byDay[SAT]?.[0]?.playsCentrally).toBe(true);
  });

  it("keeps a row for a team the caller did not list, and drops a fixture outside the window", () => {
    const rows = fixtureGridRows(
      [
        fixture({ id: "stray", teamId: "vets", teamName: "Vets", ageGroup: "Vets" }),
        fixture({ id: "next-week", teamId: "comets", dateIso: "2026-09-12" }),
      ],
      TEAMS,
      WINDOW,
    );
    expect(rows.map((row) => row.teamName)).toEqual(["U7 Comets", "U11 Venus", "U14 Mavericks", "Vets"]);
    expect(rows.find((row) => row.teamId === "comets")?.cards).toEqual([]);
  });

  it("counts a fixture's replies both ways", () => {
    const rows = fixtureGridRows(
      [fixture({ id: "one", teamId: "comets", accepted: 9, declined: 2, squad: 14 })],
      TEAMS,
      WINDOW,
    );
    expect(rows.find((row) => row.teamId === "comets")?.cards[0]?.replies).toEqual({
      in: 9,
      out: 2,
      total: 14,
    });
  });
});

describe("the days the grid shows", () => {
  const fixtures = [
    fixture({ id: "a", teamId: "comets", dateIso: SAT }),
    fixture({ id: "b", teamId: "mavericks", dateIso: SAT }),
    fixture({ id: "c", teamId: "venus", dateIso: THU }),
  ];

  it("drops a day with nothing on it", () => {
    expect(fixtureGridDays(fixtures)).toEqual([THU, SAT]);
  });

  it("clips to the window it is given", () => {
    expect(fixtureGridDays(fixtures, { from: FRI, to: SUN })).toEqual([SAT]);
  });

  it("opens on Saturday, the busiest day", () => {
    expect(busiestFixtureDay(fixtures)).toBe(SAT);
  });

  it("has no busiest day when there is nothing on the desk", () => {
    expect(busiestFixtureDay([])).toBeNull();
  });
});

describe("what the desk is waiting for", () => {
  const rows: FixtureGridFixture[] = [
    // Two home fixtures with no pitch, one of them also short of replies.
    fixture({ id: "1", teamId: "comets", allocated: false, pitch: "Unallocated", accepted: 2, squad: 14 }),
    fixture({ id: "2", teamId: "mavericks", allocated: false, pitch: "Unallocated" }),
    // Short of replies but already on a pitch.
    fixture({ id: "3", teamId: "venus", accepted: 3, declined: 0, squad: 14 }),
    // Cancelled needs neither a pitch nor a squad.
    fixture({ id: "4", teamId: "venus", status: "cancelled", allocated: false, pitch: "Unallocated", accepted: 0, squad: 14 }),
  ];

  it("counts what is to place and who is short of replies", () => {
    const action = matchesNextAction(rows);
    expect(action.detail).toBe("2 to place, 2 short of replies");
    expect(action.action).toBe("allocate");
    expect(action.label).toBe("Allocate the unplaced");
    expect(action.fixtureIds).toEqual(["1", "2"]);
  });

  it("offers to place the only one there is", () => {
    const action = matchesNextAction([rows[1] as FixtureGridFixture]);
    expect(action.detail).toBe("1 to place");
    expect(action.label).toBe("Place it");
    expect(action.fixtureIds).toEqual(["2"]);
  });

  it("falls back to adding a fixture once everything is placed", () => {
    const action = matchesNextAction([rows[2] as FixtureGridFixture]);
    expect(action.action).toBe("add");
    expect(action.label).toBe("Add a fixture");
    expect(action.detail).toBe("1 short of replies");
  });

  it("says so plainly when the window is empty", () => {
    expect(matchesNextAction([])).toEqual({
      label: "Add a fixture",
      detail: "Nothing on the desk for this window",
      action: "add",
      fixtureIds: [],
    });
  });

  it("congratulates a desk with nothing to do", () => {
    const settled = fixture({ id: "5", teamId: "comets", accepted: 12, declined: 1, squad: 14 });
    expect(matchesNextAction([settled]).detail).toBe("1 fixture, every one placed");
  });
});
