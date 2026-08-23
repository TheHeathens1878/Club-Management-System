import { describe, expect, it } from "vitest";

import {
  buildHousehold,
  householdPersonIds,
  isLiveGuardianship,
  memberLabel,
  type GuardianshipRow,
} from "./household";

function guardianship(
  overrides: Partial<GuardianshipRow> = {},
): GuardianshipRow {
  return {
    child_person_id: "child-1",
    relationship: "parent",
    ended_at: null,
    ...overrides,
  };
}

describe("buildHousehold", () => {
  it("puts the signed-in person first", () => {
    const household = buildHousehold("me", "Adam Wareing", [], {});
    expect(household).toHaveLength(1);
    expect(household[0]?.isSelf).toBe(true);
    expect(household[0]?.name).toBe("Adam Wareing");
  });

  it("adds guarded children, sorted by name", () => {
    const household = buildHousehold(
      "me",
      "Adam",
      [
        guardianship({ child_person_id: "b" }),
        guardianship({ child_person_id: "a" }),
      ],
      { a: "Zara", b: "Ellie" },
    );
    expect(household.map((member) => member.name)).toEqual([
      "Adam",
      "Ellie",
      "Zara",
    ]);
  });

  it("ignores a guardianship that has ended (SG-1.8)", () => {
    const household = buildHousehold(
      "me",
      "Adam",
      [guardianship({ ended_at: "2026-01-01T00:00:00Z" })],
      { "child-1": "Ellie" },
    );
    expect(household).toHaveLength(1);
  });

  it("collapses two live guardianship rows for the same child", () => {
    const household = buildHousehold(
      "me",
      "Adam",
      [guardianship(), guardianship({ relationship: "legal_guardian" })],
      { "child-1": "Ellie" },
    );
    expect(household).toHaveLength(2);
  });

  it("uses a neutral label for a child whose name RLS hid", () => {
    const household = buildHousehold("me", "Adam", [guardianship()], {});
    expect(household[1]?.name).toBe("A child in your care");
  });

  it("never lists the signed-in person twice", () => {
    const household = buildHousehold(
      "me",
      "Adam",
      [guardianship({ child_person_id: "me" })],
      { me: "Adam" },
    );
    expect(household).toHaveLength(1);
  });

  it("falls back to You when no name came back at all", () => {
    expect(buildHousehold("me", "", [], {})[0]?.name).toBe("You");
  });
});

describe("isLiveGuardianship", () => {
  it("is live only while it has not ended", () => {
    expect(isLiveGuardianship(guardianship())).toBe(true);
    expect(isLiveGuardianship(guardianship({ ended_at: "2026-01-01" }))).toBe(
      false,
    );
  });
});

describe("householdPersonIds and memberLabel", () => {
  it("lists every id for an .in() filter", () => {
    const household = buildHousehold("me", "Adam", [guardianship()], {
      "child-1": "Ellie",
    });
    expect(householdPersonIds(household)).toEqual(["me", "child-1"]);
  });

  it("calls the signed-in person You", () => {
    const household = buildHousehold("me", "Adam", [guardianship()], {
      "child-1": "Ellie",
    });
    expect(memberLabel(household[0]!)).toBe("You");
    expect(memberLabel(household[1]!)).toBe("Ellie");
  });
});
