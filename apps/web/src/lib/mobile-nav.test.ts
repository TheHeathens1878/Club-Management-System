import { describe, expect, it } from "vitest";

import { MORE_REPORT_HREF, mobileTabsFor, moreScreenGroups } from "@/lib/mobile-nav";
import { navFor } from "@/lib/nav";
import type { Capabilities } from "@/lib/role-view";

/** A signed-in adult with a person record and one child. */
function guardian(overrides: Partial<Capabilities> = {}): Capabilities {
  return {
    personId: "p-adam",
    appRole: "member",
    isSuperUser: false,
    isCommittee: false,
    isStaff: false,
    isBarManager: false,
    isClubAdmin: false,
    isSafeguardingLead: false,
    hasCoachRole: false,
    hasParentRole: false,
    hasRefereeRole: false,
    isTeamStaff: false,
    hasPlayerMembership: false,
    isGuardian: true,
    hasWaitingListAccess: false,
    staffTeams: [],
    playerTeams: [],
    parentTeams: [{ id: "t-mavericks", name: "U14 Mavericks" }],
    ...overrides,
  };
}

function hrefsIn(groups: ReturnType<typeof moreScreenGroups>, group: string): string[] {
  return groups.find((entry) => entry.group === group)?.items.map((item) => item.href) ?? [];
}

describe("moreScreenGroups", () => {
  it("keeps the whole Membership Flow even where a step is also a tab", () => {
    // Adam, 2026-09-01. The Me view's Children tab is /family, which is also
    // step 3 of the flow; thinning it left the phone showing 1, 2, 4, 5.
    const capabilities = guardian();
    const tabs = mobileTabsFor("me", capabilities);
    expect(tabs.map((tab) => tab.href)).toContain("/family");

    const tabHrefs = new Set(tabs.map((tab) => tab.href));
    const listed = moreScreenGroups(navFor("me", capabilities), tabHrefs);

    expect(hrefsIn(listed, "Membership Flow")).toEqual([
      "/profile",
      "/connected-adults",
      "/family",
      "/family-linking",
      "/my-registrations",
    ]);
  });

  it("still drops entries the tab bar carries, query string or not", () => {
    const capabilities = guardian();
    const tabHrefs = new Set(mobileTabsFor("me", capabilities).map((tab) => tab.href));
    const listed = moreScreenGroups(navFor("me", capabilities), tabHrefs);

    const everything = listed.flatMap((group) => group.items.map((item) => item.href));
    expect(everything).not.toContain("/lobby");
    expect(everything).not.toContain("/messages");
    // "My groups" is the Messages tab with a filter on it, not a destination.
    expect(everything).not.toContain("/messages?filter=groups");
    expect(everything).not.toContain("/events");
    // The concern report is drawn as its own accent card instead.
    expect(everything).not.toContain(MORE_REPORT_HREF);
  });

  it("leaves a child's money where a guardian can reach it", () => {
    // /my-subs is "mine, the ones I pay for, and my children's" under
    // subscriptions_self_read — the Me view's one money screen must survive.
    const capabilities = guardian();
    const tabHrefs = new Set(mobileTabsFor("me", capabilities).map((tab) => tab.href));
    const listed = moreScreenGroups(navFor("me", capabilities), tabHrefs);

    expect(listed.flatMap((group) => group.items.map((item) => item.href))).toContain("/my-subs");
  });

  it("does not invent groups for a view whose menu is thinned to nothing", () => {
    expect(moreScreenGroups([{ group: "Club", items: [] }], new Set())).toEqual([]);
  });

  it("keeps the flow whole for an adult with no children yet", () => {
    // Without a guardianship the Children tab collapses, so the plain rule and
    // the exemption have to agree that step 3 is still listed.
    const capabilities = guardian({ isGuardian: false, parentTeams: [] });
    const tabHrefs = new Set(mobileTabsFor("me", capabilities).map((tab) => tab.href));
    expect(tabHrefs.has("/family")).toBe(false);

    const listed = moreScreenGroups(navFor("me", capabilities), tabHrefs);
    expect(hrefsIn(listed, "Membership Flow")).toContain("/family");
  });
});
