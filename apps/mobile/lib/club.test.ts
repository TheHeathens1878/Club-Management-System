import { describe, expect, it } from "vitest";

import {
  authErrorMessage,
  describeMembership,
  isLiveMembership,
  isProbablyEmail,
  normaliseOtpToken,
  personDisplayName,
  teamRoleLabel,
  toTeamMemberships,
  type MembershipRow,
  type ProfileRow,
} from "./club";

function membership(overrides: Partial<MembershipRow> = {}): MembershipRow {
  return {
    id: "m1",
    role: "player",
    shirt_number: null,
    joined_at: "2026-08-01T00:00:00Z",
    left_at: null,
    teams: { id: "t1", name: "First Team", age_group: null },
    seasons: { id: "s1", name: "2026/27", is_current: true },
    ...overrides,
  };
}

function profile(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    id: "u1",
    person_id: "p1",
    full_name: null,
    role: "member",
    people: {
      id: "p1",
      first_name: "Adam",
      last_name: "Wareing",
      preferred_name: null,
      email: "adam@example.com",
    },
    ...overrides,
  };
}

describe("personDisplayName", () => {
  it("prefers the chosen name", () => {
    expect(
      personDisplayName(
        profile({
          people: {
            id: "p1",
            first_name: "Adam",
            last_name: "Wareing",
            preferred_name: "Ad",
            email: null,
          },
        }),
      ),
    ).toBe("Ad");
  });

  it("falls back to the legal name", () => {
    expect(personDisplayName(profile())).toBe("Adam Wareing");
  });

  it("falls back to the profile full_name when RLS hides the person row", () => {
    expect(
      personDisplayName(profile({ people: null, full_name: "A. Wareing" })),
    ).toBe("A. Wareing");
  });

  it("never renders an empty heading", () => {
    expect(personDisplayName(null)).toBe("Member");
    expect(personDisplayName(profile({ people: null, full_name: "   " }))).toBe(
      "Member",
    );
  });
});

describe("isLiveMembership", () => {
  it("excludes memberships that have ended", () => {
    expect(isLiveMembership(membership())).toBe(true);
    expect(
      isLiveMembership(membership({ left_at: "2026-01-01T00:00:00Z" })),
    ).toBe(false);
  });
});

describe("toTeamMemberships", () => {
  it("drops ended memberships", () => {
    const rows = [
      membership({ id: "live" }),
      membership({ id: "ended", left_at: "2026-01-01T00:00:00Z" }),
    ];
    expect(toTeamMemberships(rows).map((m) => m.id)).toEqual(["live"]);
  });

  it("drops rows whose team is not readable", () => {
    expect(toTeamMemberships([membership({ teams: null })])).toEqual([]);
  });

  it("puts the current season first, then sorts by team name", () => {
    const rows = [
      membership({
        id: "old",
        teams: { id: "t0", name: "Aardvarks", age_group: null },
        seasons: { id: "s0", name: "2025/26", is_current: false },
      }),
      membership({
        id: "zebras",
        teams: { id: "t2", name: "Zebras", age_group: "U12" },
      }),
      membership({
        id: "badgers",
        teams: { id: "t3", name: "Badgers", age_group: "U10" },
      }),
    ];
    expect(toTeamMemberships(rows).map((m) => m.id)).toEqual([
      "badgers",
      "zebras",
      "old",
    ]);
  });

  it("maps the fields the card renders", () => {
    const [first] = toTeamMemberships([
      membership({ role: "manager", shirt_number: 9 }),
    ]);
    expect(first).toMatchObject({
      teamName: "First Team",
      seasonName: "2026/27",
      isCurrentSeason: true,
      role: "manager",
      shirtNumber: 9,
    });
  });
});

describe("describeMembership", () => {
  it("includes role, shirt number and season", () => {
    const [first] = toTeamMemberships([
      membership({ role: "player", shirt_number: 9 }),
    ]);
    expect(first).toBeDefined();
    expect(describeMembership(first!)).toBe("Player · #9 · 2026/27");
  });

  it("omits the shirt number when there is none", () => {
    const [first] = toTeamMemberships([membership({ role: "assistant_coach" })]);
    expect(describeMembership(first!)).toBe("Assistant coach · 2026/27");
  });
});

describe("teamRoleLabel", () => {
  it("humanises the enum", () => {
    expect(teamRoleLabel("assistant_coach")).toBe("Assistant coach");
  });
});

describe("authErrorMessage", () => {
  it("rewrites the common gotrue failures", () => {
    expect(authErrorMessage({ message: "Invalid login credentials" })).toMatch(
      /did not match/,
    );
    expect(authErrorMessage({ message: "Email not confirmed" })).toMatch(
      /Confirm your email/,
    );
    expect(authErrorMessage({ message: "Signups not allowed for otp" })).toMatch(
      /invite you/,
    );
    expect(
      authErrorMessage({ message: "For security purposes, you can only..." }),
    ).toMatch(/Too many attempts/);
    expect(authErrorMessage({ message: "Token has expired" })).toMatch(
      /expired/,
    );
  });

  it("passes anything else through", () => {
    expect(authErrorMessage({ message: "Teapot" })).toBe("Teapot");
    expect(authErrorMessage(null)).toBe("Something went wrong. Try again.");
  });
});

describe("isProbablyEmail", () => {
  it("accepts a normal address and rejects junk", () => {
    expect(isProbablyEmail(" adam@example.com ")).toBe(true);
    expect(isProbablyEmail("adam@example")).toBe(false);
    expect(isProbablyEmail("")).toBe(false);
  });
});

describe("normaliseOtpToken", () => {
  it("keeps six digits and drops everything else", () => {
    expect(normaliseOtpToken("12 34-56")).toBe("123456");
    expect(normaliseOtpToken("1234567")).toBe("123456");
    expect(normaliseOtpToken("abc")).toBe("");
  });
});
