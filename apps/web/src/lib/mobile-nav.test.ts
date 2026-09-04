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
    hasFinanceRole: false,
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
  it("lists the You group minus what the tab bar already carries", () => {
    // 2026-09-04 audit: the numbered flow became /getting-started plus plain
    // rows. The Family tab is /family-linking, so that row thins from More;
    // the rest of the You group survives.
    const capabilities = guardian();
    const tabs = mobileTabsFor("me", capabilities);
    expect(tabs.map((tab) => tab.href)).toContain("/family-linking");

    const tabHrefs = new Set(tabs.map((tab) => tab.href));
    const listed = moreScreenGroups(navFor("me", capabilities), tabHrefs);

    expect(hrefsIn(listed, "You")).toEqual([
      "/getting-started",
      "/profile",
      "/my-registrations",
      "/welcome",
    ]);
  });

  it("drops a tab's own row but keeps its query-filter siblings", () => {
    const capabilities = guardian();
    const tabHrefs = new Set(mobileTabsFor("me", capabilities).map((tab) => tab.href));
    const listed = moreScreenGroups(navFor("me", capabilities), tabHrefs);

    const everything = listed.flatMap((group) => group.items.map((item) => item.href));
    expect(everything).not.toContain("/lobby");
    expect(everything).not.toContain("/messages");
    // "My groups" adds a filter, so it is a DIFFERENT destination and stays —
    // the old base-only rule deleted it from the phone entirely (2026-09-04).
    expect(everything).toContain("/messages?filter=groups");
    expect(everything).not.toContain("/events");
    // The concern report is drawn as its own accent card instead.
    expect(everything).not.toContain(MORE_REPORT_HREF);
  });

  it("leaves a household's money where a guardian can reach it", () => {
    // /my-payments is the household's charges and payments (charges_read is
    // household-scoped) — the Me view's one money screen must survive on the
    // phone. It superseded /my-subs in the 2026-09-04 navigation audit.
    const capabilities = guardian();
    const tabHrefs = new Set(mobileTabsFor("me", capabilities).map((tab) => tab.href));
    const listed = moreScreenGroups(navFor("me", capabilities), tabHrefs);

    expect(listed.flatMap((group) => group.items.map((item) => item.href))).toContain("/my-payments");
  });

  it("does not invent groups for a view whose menu is thinned to nothing", () => {
    expect(moreScreenGroups([{ group: "Club", items: [] }], new Set())).toEqual([]);
  });

  it("keeps the family door open for an adult with no children yet", () => {
    // The Family tab is open to everyone now — the page itself welcomes a
    // member with nobody connected — so the phone always carries the door.
    const capabilities = guardian({ isGuardian: false, parentTeams: [] });
    const tabHrefs = new Set(mobileTabsFor("me", capabilities).map((tab) => tab.href));
    expect(tabHrefs.has("/family-linking")).toBe(true);
  });
});
