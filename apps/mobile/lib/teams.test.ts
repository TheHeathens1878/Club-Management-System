import { describe, expect, it } from "vitest";

import { buildHousehold, type GuardianshipRow } from "./household";
import {
  groupTeamsByPerson,
  playerMemberships,
  teamSeasonKeys,
  type HouseholdMembershipRow,
} from "./teams";

function membershipRow(
  overrides: Partial<HouseholdMembershipRow> = {},
): HouseholdMembershipRow {
  return {
    id: "membership-1",
    person_id: "child-1",
    role: "player",
    shirt_number: 9,
    joined_at: "2026-07-01T00:00:00Z",
    left_at: null,
    teams: { id: "team-1", name: "Sale AoM U12", age_group: "U12" },
    seasons: { id: "season-1", name: "2026/27", is_current: true },
    ...overrides,
  };
}

const GUARDIANSHIPS: GuardianshipRow[] = [
  { child_person_id: "child-1", relationship: "parent", ended_at: null },
];

const HOUSEHOLD = buildHousehold("parent", "Adam", GUARDIANSHIPS, {
  "child-1": "Ellie",
});

describe("groupTeamsByPerson", () => {
  it("gives every household member a section, self first", () => {
    const sections = groupTeamsByPerson(HOUSEHOLD, [membershipRow()]);
    expect(sections.map((section) => section.name)).toEqual(["You", "Ellie"]);
    expect(sections[0]?.teams).toHaveLength(0);
    expect(sections[1]?.teams).toHaveLength(1);
  });

  it("keeps a member with no team so they are not silently dropped", () => {
    const sections = groupTeamsByPerson(HOUSEHOLD, []);
    expect(sections).toHaveLength(2);
    expect(sections.every((section) => section.teams.length === 0)).toBe(true);
  });

  it("does not leak one person's teams into another's section", () => {
    const sections = groupTeamsByPerson(HOUSEHOLD, [
      membershipRow({ person_id: "parent", id: "coach", role: "coach" }),
      membershipRow(),
    ]);
    expect(sections[0]?.teams[0]?.role).toBe("coach");
    expect(sections[1]?.teams[0]?.role).toBe("player");
  });
});

describe("teamSeasonKeys", () => {
  it("deduplicates two children in the same team", () => {
    const keys = teamSeasonKeys([
      membershipRow({ person_id: "child-1" }),
      membershipRow({ person_id: "child-2", id: "membership-2" }),
    ]);
    expect(keys).toEqual([{ teamId: "team-1", seasonId: "season-1" }]);
  });

  it("keeps the same team in two seasons apart", () => {
    const keys = teamSeasonKeys([
      membershipRow(),
      membershipRow({
        id: "membership-2",
        seasons: { id: "season-0", name: "2025/26", is_current: false },
      }),
    ]);
    expect(keys).toHaveLength(2);
  });

  it("skips a membership that has ended", () => {
    expect(teamSeasonKeys([membershipRow({ left_at: "2026-08-01" })])).toEqual(
      [],
    );
  });

  it("skips a row whose team RLS hid", () => {
    expect(teamSeasonKeys([membershipRow({ teams: null })])).toEqual([]);
  });
});

describe("playerMemberships", () => {
  it("lists who may set availability for which team and season", () => {
    expect(playerMemberships([membershipRow()])).toEqual([
      { personId: "child-1", teamId: "team-1", seasonId: "season-1" },
    ]);
  });

  it("excludes an ended membership, which the DB guard would reject", () => {
    expect(playerMemberships([membershipRow({ left_at: "2026-08-01" })])).toEqual(
      [],
    );
  });
});
