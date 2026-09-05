import { describe, expect, it } from "vitest";

import { DESTINATIONS, itemsFor, type NavBadge } from "@/lib/destinations";
import { NO_NAV_COUNTS } from "@/lib/nav-counts";
import type { Capabilities } from "@/lib/role-view";

const everyone: Capabilities = {
  personId: "p",
  appRole: "super_user",
  isSuperUser: true,
  isCommittee: true,
  isStaff: true,
  isBarManager: true,
  isClubAdmin: true,
  isSafeguardingLead: true,
  hasCoachRole: true,
  hasParentRole: true,
  hasRefereeRole: true,
  isTeamStaff: true,
  hasPlayerMembership: true,
  isGuardian: true,
  hasFinanceRole: true,
  hasWaitingListAccess: true,
  staffTeams: [],
  playerTeams: [],
  parentTeams: [],
};

/**
 * The badge keys and the counters have to stay in step. A menu row that
 * names a count nobody produces would draw nothing; a count nobody names
 * would be wasted work on every page.
 */
describe("nav waiting-counts", () => {
  const badgedItems = DESTINATIONS.flatMap((d) => itemsFor(d.key, everyone)).filter((item) => item.badge);

  it("counts exactly the two admin queues Adam asked for, on their rows", () => {
    expect(badgedItems.map((entry) => entry.href).sort()).toEqual(["/approvals", "/registrations"]);
  });

  it("draws them only where a club administrator would see them", () => {
    for (const entry of badgedItems) {
      expect(entry.allowed({ ...everyone, isClubAdmin: false })).toBe(false);
    }
  });

  it("the tabs themselves wear only Messages and the admin queues", () => {
    const tabBadges = DESTINATIONS.filter((d) => d.badge).map((d) => [d.key, d.badge]);
    expect(tabBadges).toEqual([
      ["messages", "messages"],
      ["club", "approvals"],
    ]);
  });

  it("every badge key has a counter behind it", () => {
    const keys: NavBadge[] = ["approvals", "registrations", "messages"];
    for (const key of keys) {
      if (key === "messages") continue; // my_unread_message_count(), read in the layout
      expect(NO_NAV_COUNTS).toHaveProperty(key);
    }
  });
});
