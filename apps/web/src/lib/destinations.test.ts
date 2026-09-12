import { describe, expect, it } from "vitest";

import {
  DESTINATIONS,
  activeDestination,
  allHrefs,
  contextHref,
  contextLabel,
  destination,
  destinationHref,
  destinationLabel,
  drawerItemsFor,
  itemsFor,
  linkHref,
  paletteEntries,
  sectionsOf,
  visibleDestinations,
} from "@/lib/destinations";
import type { Capabilities } from "@/lib/role-view";

function person(overrides: Partial<Capabilities> = {}): Capabilities {
  return {
    personId: "p-1",
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
    isGuardian: false,
    hasFinanceRole: false,
    hasWaitingListAccess: false,
    staffTeams: [],
    playerTeams: [],
    parentTeams: [],
    ...overrides,
  };
}

/** A parent who also coaches — the person the redesign is for. */
const parentCoach = person({
  isGuardian: true,
  hasParentRole: true,
  isTeamStaff: true,
  hasCoachRole: true,
  parentTeams: [{ id: "t-u12", name: "U12 Cobras", children: ["Ben"] }],
  staffTeams: [{ id: "t-u14", name: "U14 Mavericks" }],
});

const clubAdmin = person({
  appRole: "committee",
  isCommittee: true,
  isStaff: true,
  isClubAdmin: true,
  isSuperUser: true,
  hasFinanceRole: true,
  isTeamStaff: true,
  staffTeams: [{ id: "t-u14", name: "U14 Mavericks" }],
});

/** Every route the retired per-hat menus (nav.ts, 2026-09-04) could reach. */
const RETIRED_MENU_HREFS = [
  "/getting-started",
  "/profile",
  "/family-linking",
  "/my-registrations",
  "/welcome",
  "/lobby",
  "/messages?filter=groups",
  "/messages",
  "/events",
  "/referee",
  "/groups",
  "/overview",
  "/teams",
  "/people",
  "/waiting-list/manage",
  "/approvals",
  "/registrations",
  "/registrations/form",
  "/matches",
  "/training",
  "/social",
  "/pitches/calendar",
  "/pitches/book",
  "/pitches/mine",
  "/pitches",
  "/pitches/requests",
  "/pitches/clashes",
  "/pitches/manage",
  "/venues",
  "/room-bookings",
  "/room-bookings?status=open&view=list",
  "/room-bookings/rooms",
  "/room-bookings/contacts",
  "/bar",
  "/finance",
  "/my-payments",
  "/membership-card",
  "/safeguarding",
  "/safeguarding/report",
  "/media",
  "/settings",
  "/settings/comms",
];

describe("the four nouns and two utilities", () => {
  it("are Diary, People, Clubhouse, Money, then Inbox and Messages — in that order, always", () => {
    expect(DESTINATIONS.map((d) => d.label)).toEqual(["Diary", "People", "Clubhouse", "Money", "Inbox", "Messages"]);
    expect(DESTINATIONS.map((d) => d.kind)).toEqual(["noun", "noun", "noun", "noun", "utility", "utility"]);
  });

  it("shows the Clubhouse door to staff and to nobody else", () => {
    expect(visibleDestinations(person()).map((d) => d.key)).toEqual(["diary", "people", "money", "inbox", "messages"]);
    expect(visibleDestinations(clubAdmin).map((d) => d.key)).toContain("clubhouse");
  });

  it("names People and Money for the person looking at them", () => {
    const people = destination("people");
    const money = destination("money");
    expect(destinationLabel(people, clubAdmin)).toBe("People");
    expect(destinationLabel(people, parentCoach)).toBe("My teams");
    expect(destinationLabel(people, person({ isGuardian: true }))).toBe("Family");
    expect(destinationLabel(money, clubAdmin)).toBe("Money");
    expect(destinationLabel(money, parentCoach)).toBe("What I owe");
    expect(destinationHref(money, clubAdmin)).toBe("/finance");
    expect(destinationHref(money, parentCoach)).toBe("/my-payments");
  });

  it("reach every route the retired per-hat menus reached, for somebody who holds every hat", () => {
    const everything = allHrefs(person({
      ...clubAdmin,
      isBarManager: true,
      isSafeguardingLead: true,
      hasWaitingListAccess: true,
      hasRefereeRole: true,
      isGuardian: true,
      hasPlayerMembership: true,
      parentTeams: [{ id: "t-u12", name: "U12 Cobras" }],
      playerTeams: [{ id: "t-vets", name: "Vets" }],
    }));
    for (const href of RETIRED_MENU_HREFS) {
      expect(everything, `${href} lost its home`).toContain(href);
    }
    // /my-team was a redirect that chose a team from the cookie; the team
    // rows now name each team directly, so nothing links to it. /my-teams
    // (the player's overview) is the row a player gets only until their
    // teams are known by name — then each team is its own row.
    expect(everything).not.toContain("/my-team");
    expect(allHrefs(person({ hasPlayerMembership: true }))).toContain("/my-teams");
  });

  it("gives each route one home — no door or drawer lists an href twice, and none share one", () => {
    const seen = new Map<string, string>();
    const claim = (owner: string, key: string) => {
      expect(seen.get(key), `${key} is listed under both ${seen.get(key)} and ${owner}`).toBeUndefined();
      seen.set(key, owner);
    };
    for (const d of DESTINATIONS) {
      for (const item of itemsFor(d.key, clubAdmin)) claim(d.label, item.href);
    }
    for (const item of drawerItemsFor(clubAdmin)) claim("the drawer", item.href);
  });

  it("puts the daily desks under the nouns and the set-up behind the crest", () => {
    expect(sectionsOf(itemsFor("diary", clubAdmin)).map((s) => s.section)).toEqual(["What's on", "Coaching", "Pitches"]);
    expect(sectionsOf(itemsFor("people", clubAdmin)).map((s) => s.section)).toEqual([
      "Your teams",
      "Waiting on you",
      "Directory",
      "Protected",
    ]);
    expect(sectionsOf(itemsFor("clubhouse", clubAdmin)).map((s) => s.section)).toEqual(["Bookings", "The building"]);
    expect(sectionsOf(itemsFor("money", clubAdmin)).map((s) => s.section)).toEqual(["The books", "Yours"]);
    expect(sectionsOf(drawerItemsFor(clubAdmin)).map((s) => s.section)).toEqual(["Running the club", "You", "Help"]);
    // A member has no club to run: the drawer opens on "You".
    expect(sectionsOf(drawerItemsFor(person())).map((s) => s.section)).toEqual(["You", "Help"]);
  });
});

describe("a parent who also coaches", () => {
  it("sees both halves of their week without switching hats", () => {
    const rows = itemsFor("people", parentCoach).filter((item) => item.section === "Your teams");
    expect(rows.map((r) => r.label)).toEqual(["Your child · U12 Cobras", "Coaching · U14 Mavericks"]);
    expect(rows[0]!.detail).toBe("for Ben");
    expect(rows[0]!.context).toEqual({ view: "parent", teamId: "t-u12" });
    expect(rows[1]!.context).toEqual({ view: "coach", teamId: "t-u14" });
  });

  it("is offered nothing the pages would bounce", () => {
    const hrefs = allHrefs(parentCoach);
    expect(hrefs).not.toContain("/people");
    expect(hrefs).not.toContain("/finance");
    expect(hrefs).not.toContain("/approvals");
    expect(hrefs).not.toContain("/settings");
    expect(hrefs).not.toContain("/room-bookings");
    // …but the coaching desks are theirs.
    expect(hrefs).toContain("/matches");
    expect(hrefs).toContain("/training");
    expect(hrefs).toContain("/teams");
  });

  it("opens the coaching desks as a coach, never as an admin they are not", () => {
    const training = itemsFor("diary", parentCoach).find((item) => item.href === "/training")!;
    expect(training.context).toEqual({ view: "coach", teamId: "t-u14" });
    const teams = itemsFor("people", parentCoach).find((item) => item.href === "/teams")!;
    expect(teams.context).toEqual({ view: "coach", teamId: "t-u14" });
  });
});

describe("context follows the link", () => {
  it("routes through /context only when the hat changes", () => {
    const coaching = itemsFor("people", parentCoach).find((item) => item.label.startsWith("Coaching"))!;
    expect(linkHref(coaching, { view: "parent", teamId: "t-u12" })).toBe(
      "/context?view=coach&next=%2Fteams%2Ft-u14&team=t-u14",
    );
    expect(linkHref(coaching, { view: "coach", teamId: "t-u14" })).toBe("/teams/t-u14");
  });

  it("a row with no context keeps whatever hat is on", () => {
    const profile = drawerItemsFor(parentCoach).find((item) => item.href === "/profile")!;
    expect(linkHref(profile, { view: "coach", teamId: "t-u14" })).toBe("/profile");
  });

  it("encodes the destination path and only the destination path", () => {
    expect(contextHref({ view: "admin" }, "/overview")).toBe("/context?view=admin&next=%2Foverview");
  });

  it("labels the hat plainly", () => {
    expect(contextLabel("coach", { id: "t", name: "U14 Mavericks" })).toBe("Coaching · U14 Mavericks");
    expect(contextLabel("parent", { id: "t", name: "U12 Cobras" })).toBe("Your child · U12 Cobras");
    expect(contextLabel("admin", null)).toBe("Club administration");
    expect(contextLabel("me", null)).toBeNull();
  });
});

describe("where am I", () => {
  it("lights the door whose prefix matches most of the path", () => {
    expect(activeDestination("/lobby")).toBe("inbox");
    expect(activeDestination("/notifications")).toBe("inbox");
    expect(activeDestination("/events/abc")).toBe("diary");
    expect(activeDestination("/pitches/calendar")).toBe("diary");
    expect(activeDestination("/pitches")).toBe("diary");
    expect(activeDestination("/people/p-1")).toBe("people");
    expect(activeDestination("/safeguarding")).toBe("people");
    expect(activeDestination("/teams/t-1/fixtures/f-1")).toBe("people");
    expect(activeDestination("/room-bookings/b-1")).toBe("clubhouse");
    expect(activeDestination("/bar")).toBe("clubhouse");
    expect(activeDestination("/finance/charges")).toBe("money");
    expect(activeDestination("/my-payments")).toBe("money");
    expect(activeDestination("/messages/c-1")).toBe("messages");
  });

  it("claims nothing for a drawer screen or a route outside the doors", () => {
    expect(activeDestination("/profile")).toBeNull();
    expect(activeDestination("/settings")).toBeNull();
    expect(activeDestination("/portal")).toBeNull();
  });
});

describe("search words", () => {
  it("finds paying subs by the words a member would type", () => {
    const entries = paletteEntries(person(), { view: "me", teamId: null });
    // The Money door itself opens at /my-payments for a member; the ROW is the
    // one that carries the everyday words.
    const pay = entries.find((entry) => entry.href === "/my-payments" && entry.group !== "Go to")!;
    expect(pay.keywords).toContain("pay subs");
    expect(pay.group).toBe("What I owe · Yours");
  });

  it("offers the doors first, then the drawer", () => {
    const entries = paletteEntries(person(), { view: "me", teamId: null });
    expect(entries.slice(0, 5).map((entry) => entry.label)).toEqual(["Diary", "People", "What I owe", "Inbox", "Messages"]);
    expect(entries.find((entry) => entry.href === "/profile")?.group).toBe("You");
  });
});
