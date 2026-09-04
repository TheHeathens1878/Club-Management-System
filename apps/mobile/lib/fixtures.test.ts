import { describe, expect, it } from "vitest";

import {
  availabilityLabel,
  describeFixture,
  fixtureTitle,
  fixtureVenue,
  indexAvailability,
  PITCH_TBC,
  respondentsFor,
  toFixtures,
  type AvailabilityRow,
  type FixtureRow,
  type PlayerMembership,
} from "./fixtures";
import type { HouseholdMember } from "./household";

function fixtureRow(overrides: Partial<FixtureRow> = {}): FixtureRow {
  return {
    id: "fixture-1",
    team_id: "team-1",
    season_id: "season-1",
    opponent: "Wilmslow Juniors",
    is_home: true,
    kickoff_at: "2026-09-05T09:30:00Z",
    competition: "League",
    status: "scheduled",
    venue_resource_id: null,
    venue_text: null,
    teams: { id: "team-1", name: "Sale AoM U12", central_venue_name: null },
    resources: null,
    ...overrides,
  };
}

const HOUSEHOLD: HouseholdMember[] = [
  { personId: "parent", name: "Adam", isSelf: true, relationship: null },
  { personId: "child", name: "Ellie", isSelf: false, relationship: "parent" },
];

const MEMBERSHIPS: PlayerMembership[] = [
  { personId: "child", teamId: "team-1", seasonId: "season-1" },
];

describe("fixtureVenue", () => {
  it("says Pitch TBC for a home fixture with no allocation yet", () => {
    const { venue, allocated } = fixtureVenue(fixtureRow());
    expect(venue).toBe(PITCH_TBC);
    expect(allocated).toBe(false);
  });

  it("shows the pitch once P2.5 has allocated one", () => {
    const { venue, allocated } = fixtureVenue(
      fixtureRow({
        venue_resource_id: "resource-1",
        resources: { id: "resource-1", name: "Pitch 2 (11-a-side)" },
      }),
    );
    expect(venue).toBe("Pitch 2 (11-a-side)");
    expect(allocated).toBe(true);
  });

  it("prefers the allocated pitch over Full-Time's venue text", () => {
    const { venue } = fixtureVenue(
      fixtureRow({
        venue_text: "Somewhere Lane",
        resources: { id: "resource-1", name: "Pitch 1" },
      }),
    );
    expect(venue).toBe("Pitch 1");
  });

  it("uses the imported venue text for an away fixture", () => {
    const { venue, allocated } = fixtureVenue(
      fixtureRow({ is_home: false, venue_text: "Wilmslow Rec" }),
    );
    expect(venue).toBe("Wilmslow Rec");
    expect(allocated).toBe(true);
  });

  it("does not claim a pitch for an away fixture with no venue", () => {
    const { venue, allocated } = fixtureVenue(fixtureRow({ is_home: false }));
    expect(venue).not.toBe(PITCH_TBC);
    expect(allocated).toBe(false);
  });

  // Adam, 2026-09-04: "Even though U8 Sparrows Black are at a central venue,
  // it keeps saying pitch unallocated." No allocation ever comes for these
  // teams, so TBC would nag forever.
  it("names a central-venue team's venue instead of Pitch TBC, settled", () => {
    const { venue, allocated } = fixtureVenue(
      fixtureRow({
        teams: { id: "team-1", name: "U8 Sparrows Black", central_venue_name: "Platt Lane Sports Complex" },
      }),
    );
    expect(venue).toBe("Platt Lane Sports Complex");
    expect(allocated).toBe(true);
  });

  it("lets the fixture's own venue text refine the central venue, still settled", () => {
    const { venue, allocated } = fixtureVenue(
      fixtureRow({
        venue_text: "Platt Lane 3G, Pitch 4",
        teams: { id: "team-1", name: "U8 Sparrows Black", central_venue_name: "Platt Lane Sports Complex" },
      }),
    );
    expect(venue).toBe("Platt Lane 3G, Pitch 4");
    expect(allocated).toBe(true);
  });

  it("keeps an away fixture away even for a central-venue team", () => {
    const { venue, allocated } = fixtureVenue(
      fixtureRow({
        is_home: false,
        teams: { id: "team-1", name: "U8 Sparrows Black", central_venue_name: "Platt Lane Sports Complex" },
      }),
    );
    expect(venue).not.toBe("Platt Lane Sports Complex");
    expect(allocated).toBe(false);
  });
});

describe("respondentsFor", () => {
  it("offers a toggle only to a household member registered for that team", () => {
    const respondents = respondentsFor(
      fixtureRow(),
      HOUSEHOLD,
      MEMBERSHIPS,
      new Map(),
    );
    expect(respondents).toHaveLength(1);
    expect(respondents[0]?.personId).toBe("child");
    expect(respondents[0]?.label).toBe("Ellie");
    expect(respondents[0]?.status).toBeNull();
  });

  it("labels the signed-in person as You", () => {
    const respondents = respondentsFor(
      fixtureRow(),
      HOUSEHOLD,
      [{ personId: "parent", teamId: "team-1", seasonId: "season-1" }],
      new Map(),
    );
    expect(respondents[0]?.label).toBe("You");
  });

  it("does not offer a toggle for a different season's membership", () => {
    const respondents = respondentsFor(
      fixtureRow(),
      HOUSEHOLD,
      [{ personId: "child", teamId: "team-1", seasonId: "season-0" }],
      new Map(),
    );
    expect(respondents).toHaveLength(0);
  });

  it("carries an existing answer through", () => {
    const availability: AvailabilityRow[] = [
      { fixture_id: "fixture-1", person_id: "child", status: "maybe" },
    ];
    const respondents = respondentsFor(
      fixtureRow(),
      HOUSEHOLD,
      MEMBERSHIPS,
      indexAvailability(availability),
    );
    expect(respondents[0]?.status).toBe("maybe");
  });
});

describe("toFixtures", () => {
  it("sorts by kickoff and drops fixtures already played", () => {
    const rows = [
      fixtureRow({ id: "later", kickoff_at: "2026-09-12T09:30:00Z" }),
      fixtureRow({ id: "played", status: "played" }),
      fixtureRow({ id: "sooner", kickoff_at: "2026-09-05T09:30:00Z" }),
    ];
    const fixtures = toFixtures(rows, HOUSEHOLD, MEMBERSHIPS, []);
    expect(fixtures.map((fixture) => fixture.id)).toEqual(["sooner", "later"]);
  });

  it("keeps a postponed fixture so nobody drives to it", () => {
    const fixtures = toFixtures(
      [fixtureRow({ status: "postponed" })],
      HOUSEHOLD,
      MEMBERSHIPS,
      [],
    );
    expect(fixtures).toHaveLength(1);
    expect(describeFixture(fixtures[0]!)).toContain("Postponed");
  });

  it("renders the kickoff in Europe/London", () => {
    const fixtures = toFixtures([fixtureRow()], HOUSEHOLD, MEMBERSHIPS, []);
    expect(fixtures[0]?.kickoff).toMatch(/^Sat 5 Sept? · 10:30$/);
  });
});

describe("fixtureTitle and describeFixture", () => {
  it("puts the home team first", () => {
    const [home] = toFixtures([fixtureRow()], HOUSEHOLD, MEMBERSHIPS, []);
    expect(fixtureTitle(home!)).toBe("Sale AoM U12 v Wilmslow Juniors");
  });

  it("puts the opponent first when away", () => {
    const [away] = toFixtures(
      [fixtureRow({ is_home: false })],
      HOUSEHOLD,
      MEMBERSHIPS,
      [],
    );
    expect(fixtureTitle(away!)).toBe("Wilmslow Juniors v Sale AoM U12");
  });

  it("names the pitch state in the summary line", () => {
    const [fixture] = toFixtures([fixtureRow()], HOUSEHOLD, MEMBERSHIPS, []);
    expect(describeFixture(fixture!)).toBe("Home · Pitch TBC · League");
  });
});

describe("availabilityLabel", () => {
  it("names each status and the absence of one", () => {
    expect(availabilityLabel("available")).toBe("Available");
    expect(availabilityLabel("maybe")).toBe("Maybe");
    expect(availabilityLabel("unavailable")).toBe("Unavailable");
    expect(availabilityLabel(null)).toBe("No answer");
  });
});
