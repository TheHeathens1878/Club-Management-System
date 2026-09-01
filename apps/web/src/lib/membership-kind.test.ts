import { describe, expect, it } from "vitest";

import {
  currentMembership,
  membershipKindHint,
  membershipKindLabel,
  membershipKindVariant,
  membershipKindWord,
  membershipPeopleSummary,
  type PersonMembershipRow,
} from "./membership-kind";

/**
 * Wording and choosing only. WHETHER a membership is a family is decided by
 * `public.membership_kind_for()` and tested in
 * `supabase/tests/membership_kind.test.sql`; nothing here counts a player.
 */

function row(over: Partial<PersonMembershipRow> = {}): PersonMembershipRow {
  return {
    membership_id: "m1",
    kind: "individual",
    season_id: "s1",
    season_name: "2034/35",
    season_is_current: false,
    primary_person_id: "p1",
    is_primary: true,
    created_at: "2034-01-01T00:00:00Z",
    ...over,
  };
}

describe("membershipKindLabel", () => {
  it("names both kinds", () => {
    expect(membershipKindLabel("family")).toBe("Family");
    expect(membershipKindLabel("individual")).toBe("Individual");
  });
});

describe("membershipKindVariant", () => {
  it("gives the family the loud badge and the individual the quiet one", () => {
    expect(membershipKindVariant("family")).toBe("default");
    expect(membershipKindVariant("individual")).toBe("muted");
  });
});

describe("membershipKindHint", () => {
  it("states the rule rather than a count the reader may not be entitled to", () => {
    expect(membershipKindHint("family")).toContain("Two or more players");
    expect(membershipKindHint("individual")).toContain("One player");
    expect(membershipKindHint("family")).not.toMatch(/\d/);
  });
});

describe("membershipPeopleSummary", () => {
  it("counts the other people, singular and plural", () => {
    expect(membershipPeopleSummary(0)).toBe("Nobody else is on this membership.");
    expect(membershipPeopleSummary(1)).toBe("One other person is on this membership.");
    expect(membershipPeopleSummary(3)).toBe("3 other people are on this membership.");
  });

  it("never renders a negative count", () => {
    expect(membershipPeopleSummary(-1)).toBe("Nobody else is on this membership.");
  });
});

describe("membershipKindWord", () => {
  it("spells the word out where the badge's colour is missing", () => {
    expect(membershipKindWord("family")).toBe("Family membership");
    expect(membershipKindWord("individual")).toBe("Individual membership");
    expect(membershipKindWord(null)).toBe("");
    expect(membershipKindWord(undefined)).toBe("");
  });
});

describe("currentMembership", () => {
  it("has nothing to say about nobody", () => {
    expect(currentMembership([])).toBeNull();
  });

  it("prefers the current season over a newer past one", () => {
    const past = row({
      membership_id: "old",
      season_is_current: true,
      created_at: "2030-01-01T00:00:00Z",
    });
    const newer = row({
      membership_id: "newer",
      season_is_current: false,
      created_at: "2035-01-01T00:00:00Z",
    });
    expect(currentMembership([newer, past])?.membership_id).toBe("old");
  });

  it("falls back to the newest when no season is current", () => {
    const older = row({ membership_id: "older", created_at: "2030-01-01T00:00:00Z" });
    const newest = row({ membership_id: "newest", created_at: "2036-01-01T00:00:00Z" });
    expect(currentMembership([older, newest])?.membership_id).toBe("newest");
  });

  it("treats a missing created_at as the oldest rather than sorting at random", () => {
    const undated = row({ membership_id: "undated", created_at: null });
    const dated = row({ membership_id: "dated", created_at: "2030-01-01T00:00:00Z" });
    expect(currentMembership([undated, dated])?.membership_id).toBe("dated");
    expect(currentMembership([dated, undated])?.membership_id).toBe("dated");
  });

  it("returns the only row it has, current season or not", () => {
    expect(currentMembership([row({ membership_id: "only" })])?.membership_id).toBe("only");
  });
});
