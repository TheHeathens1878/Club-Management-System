import { describe, expect, it } from "vitest";

import {
  parseViewOption,
  roleSwitchAnnouncement,
  roleSwitcherProps,
  roleViewOptions,
  type Capabilities,
} from "@/lib/role-view";

/** Somebody wearing most of the club's hats, so every shape of option appears. */
function manyHats(overrides: Partial<Capabilities> = {}): Capabilities {
  return {
    personId: "p-adam",
    appRole: "committee",
    isSuperUser: false,
    isCommittee: true,
    isStaff: true,
    isBarManager: false,
    isClubAdmin: true,
    isSafeguardingLead: false,
    hasCoachRole: true,
    hasParentRole: true,
    hasRefereeRole: true,
    isTeamStaff: true,
    hasPlayerMembership: true,
    isGuardian: true,
    hasWaitingListAccess: true,
    staffTeams: [{ id: "t-mav", name: "U14 Mavericks" }],
    playerTeams: [{ id: "t-vets", name: "Vets" }],
    parentTeams: [
      { id: "t-mav", name: "U14 Mavericks" },
      { id: "t-cobras", name: "U18 Cobras" },
    ],
    ...overrides,
  };
}

describe("the switcher's option values round-trip", () => {
  // The "Viewing as" panel closes itself when the hat it asked for comes back
  // down in `current` (Adam, 2026-09-01). That only works while the value the
  // panel SENDS is the value `roleSwitcherProps` gives back once the cookies
  // are written — if the two ever disagree the panel would sit open forever.
  it("gives back the same value the panel sent, for every option", () => {
    const capabilities = manyHats();
    const options = roleViewOptions(capabilities);
    expect(options.length).toBeGreaterThan(4);

    for (const option of options) {
      const parsed = parseViewOption(option.value);
      expect(parsed).not.toBeNull();
      const { current } = roleSwitcherProps(capabilities, parsed!.view, parsed!.teamId);
      expect(current).toBe(option.value);
    }
  });

  it("falls back to a held option when the stored team is gone", () => {
    // A child who has moved teams: the scope cookie names a team the parent
    // hat no longer covers, so `current` must not claim it.
    const capabilities = manyHats();
    const { current, options } = roleSwitcherProps(capabilities, "parent", "t-left-the-club");
    expect(current).not.toContain("t-left-the-club");
    expect(options.some((option) => option.value === current)).toBe(true);
  });
});

describe("roleSwitchAnnouncement", () => {
  it("says nothing while nothing is in flight", () => {
    expect(roleSwitchAnnouncement(null, false)).toBe("");
    expect(roleSwitchAnnouncement(null, true)).toBe("");
  });

  it("names the hat being switched to", () => {
    expect(roleSwitchAnnouncement("Coach, U14 Mavericks", false)).toBe(
      "Switching to Coach, U14 Mavericks. One moment.",
    );
  });

  it("stops promising an answer once the switch has stalled", () => {
    const stalled = roleSwitchAnnouncement("Coach, U14 Mavericks", true);
    expect(stalled).not.toContain("One moment");
    expect(stalled).toContain("longer than it should");
  });
});
