import { describe, expect, it } from "vitest";

import {
  isMemberView,
  parseViewOption,
  roleSwitchAnnouncement,
  roleSwitcherProps,
  roleViewOptions,
  ROLE_VIEWS,
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
    hasFinanceRole: false,
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

/**
 * Adam, 2026-09-02: "As a parent for the U14 Mavericks, I can mark who
 * attended. This should only be available to coaches (even though I am also a
 * coach)… Where I am in parent view, I don't want to see any of my coach or
 * club admin privileges. I want to see what other parents can see."
 *
 * The audit that followed found the same shape in eight places, and the reason
 * was always the same: the gate asked what the person CAN do and forgot to ask
 * which hat they were wearing. `isMemberView` is the missing half, written
 * once so the next screen cannot forget it by accident.
 */
describe("isMemberView", () => {
  it("is true for the three hats you wear to look at the club as a member", () => {
    expect(isMemberView("me")).toBe(true);
    expect(isMemberView("parent")).toBe(true);
    expect(isMemberView("player")).toBe(true);
  });

  it("is false for the hats you wear to run something", () => {
    expect(isMemberView("coach")).toBe(false);
    expect(isMemberView("admin")).toBe(false);
    expect(isMemberView("referee")).toBe(false);
    expect(isMemberView("function_room")).toBe(false);
  });

  /**
   * Null is "no view resolved" — an account the club has not linked to
   * anybody. It must NOT read as a member view: the pages that fall back to
   * `view === null` treat it as "no hat chosen, show me everything I hold",
   * and flipping that would hide an administrator's own tools from them.
   */
  it("is false when no view resolved at all", () => {
    expect(isMemberView(null)).toBe(false);
  });

  it("answers for every view the club has, so a new one cannot be forgotten", () => {
    for (const view of ROLE_VIEWS) {
      expect(typeof isMemberView(view)).toBe("boolean");
    }
  });
});
