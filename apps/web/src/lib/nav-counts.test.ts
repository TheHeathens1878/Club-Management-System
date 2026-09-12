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

  it("counts the two admin queues and the room desk's waiting requests, on their rows", () => {
    expect(badgedItems.map((entry) => entry.href).sort()).toEqual([
      "/approvals",
      "/registrations",
      "/room-bookings?status=open&view=list",
    ]);
  });

  it("draws the admin queues only where a club administrator would see them", () => {
    for (const entry of badgedItems.filter((entry) => entry.badge !== "roomBookings")) {
      expect(entry.allowed({ ...everyone, isClubAdmin: false })).toBe(false);
    }
  });

  it("draws the room desk's count for staff who are not administrators", () => {
    const desk = badgedItems.find((entry) => entry.badge === "roomBookings")!;
    expect(desk.allowed({ ...everyone, isClubAdmin: false, isCommittee: false, isSuperUser: false })).toBe(true);
    expect(desk.allowed({ ...everyone, isStaff: false })).toBe(false);
  });

  it("the doors themselves wear the admin queues, the room desk, and the two unread counts", () => {
    const tabBadges = DESTINATIONS.filter((d) => d.badge).map((d) => [d.key, d.badge]);
    expect(tabBadges).toEqual([
      ["people", "approvals"],
      ["clubhouse", "roomBookings"],
      ["inbox", "notifications"],
      ["messages", "messages"],
    ]);
  });

  it("every badge key has a counter behind it", () => {
    const keys: NavBadge[] = ["approvals", "registrations", "messages", "roomBookings", "notifications"];
    for (const key of keys) {
      // my_unread_message_count() and unread_notification_count(), read in the layout
      if (key === "messages" || key === "notifications") continue;
      expect(NO_NAV_COUNTS).toHaveProperty(key);
    }
  });
});
