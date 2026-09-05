import { describe, expect, it } from "vitest";

import { paletteEntries } from "@/lib/destinations";
import { pageScore, rankPages } from "@/lib/search-terms";
import type { Capabilities } from "@/lib/role-view";

const member: Capabilities = {
  personId: "p",
  appRole: "member",
  isSuperUser: false,
  isCommittee: false,
  isStaff: false,
  isBarManager: false,
  isClubAdmin: false,
  isSafeguardingLead: false,
  hasCoachRole: false,
  hasParentRole: true,
  hasRefereeRole: false,
  isTeamStaff: false,
  hasPlayerMembership: false,
  isGuardian: true,
  hasFinanceRole: false,
  hasWaitingListAccess: false,
  staffTeams: [],
  playerTeams: [],
  parentTeams: [{ id: "t-u12", name: "U12 Cobras", children: ["Ben"] }],
};

const pages = paletteEntries(member, { view: "me", teamId: null });

describe("everyday words find the page", () => {
  it.each([
    ["pay subs", "/my-payments"],
    ["subs", "/my-payments"],
    ["next match", "/events"],
    ["availability", "/events"],
    ["message coach", "/messages/new"],
    ["family details", "/family-linking"],
    ["update family", "/family-linking"],
    ["register a player", "/my-registrations"],
    ["report a concern", "/safeguarding/report"],
    ["cobras", "/context?view=parent&next=%2Fteams%2Ft-u12&team=t-u12"],
  ])("%s → %s", (query, href) => {
    expect(rankPages(pages, query)[0]?.href).toBe(href);
  });

  it("puts an exact label above a keyword match", () => {
    const first = rankPages(pages, "messages")[0]!;
    expect(first.label).toBe("Messages");
  });

  it("scores nothing for an unrelated word and lists the first pages for an empty query", () => {
    expect(rankPages(pages, "zebra")).toEqual([]);
    expect(rankPages(pages, "").map((p) => p.label).slice(0, 5)).toEqual([
      "Home",
      "Calendar",
      "Messages",
      "Club",
      "Me",
    ]);
    expect(pageScore({ label: "Home", href: "/lobby", group: "Go to", keywords: [] }, "")).toBe(0);
  });
});
