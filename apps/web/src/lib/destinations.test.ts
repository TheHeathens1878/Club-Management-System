import { describe, expect, it } from "vitest";

import {
  DESTINATIONS,
  activeDestination,
  allHrefs,
  contextHref,
  contextLabel,
  itemsFor,
  linkHref,
  paletteEntries,
  sectionsOf,
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
  "/room-bookings?status=pending&view=list",
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

describe("the five destinations", () => {
  it("are Home, Calendar, Messages, Club, Me — in that order, always", () => {
    expect(DESTINATIONS.map((d) => d.label)).toEqual(["Home", "Calendar", "Messages", "Club", "Me"]);
    expect(DESTINATIONS.map((d) => d.href)).toEqual(["/lobby", "/events", "/messages", "/club", "/me"]);
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

  it("gives each route one home — no destination lists an href twice", () => {
    for (const d of DESTINATIONS) {
      const hrefs = itemsFor(d.key, clubAdmin).map((item) => `${item.href}|${item.context?.view ?? ""}`);
      expect(new Set(hrefs).size, `${d.label} repeats a row`).toBe(hrefs.length);
    }
  });

  it("puts the whole of the admin desk under Club, in a labelled administration area", () => {
    const sections = sectionsOf(itemsFor("club", clubAdmin)).map((s) => s.section);
    expect(sections).toEqual(["Your teams", "Club administration", "Pitches", "Function room", "Money"]);
  });
});

describe("a parent who also coaches", () => {
  it("sees both halves of their week without switching hats", () => {
    const rows = itemsFor("club", parentCoach).filter((item) => item.section === "Your teams");
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
    // …but the coaching desks are theirs.
    expect(hrefs).toContain("/matches");
    expect(hrefs).toContain("/training");
    expect(hrefs).toContain("/teams");
  });

  it("opens the coaching desks as a coach, never as an admin they are not", () => {
    const training = itemsFor("calendar", parentCoach).find((item) => item.href === "/training")!;
    expect(training.context).toEqual({ view: "coach", teamId: "t-u14" });
    const teams = itemsFor("club", parentCoach).find((item) => item.href === "/teams")!;
    expect(teams.context).toEqual({ view: "coach", teamId: "t-u14" });
  });
});

describe("context follows the link", () => {
  it("routes through /context only when the hat changes", () => {
    const coaching = itemsFor("club", parentCoach).find((item) => item.label.startsWith("Coaching"))!;
    expect(linkHref(coaching, { view: "parent", teamId: "t-u12" })).toBe(
      "/context?view=coach&next=%2Fteams%2Ft-u14&team=t-u14",
    );
    expect(linkHref(coaching, { view: "coach", teamId: "t-u14" })).toBe("/teams/t-u14");
  });

  it("a row with no context keeps whatever hat is on", () => {
    const profile = itemsFor("me", parentCoach).find((item) => item.href === "/profile")!;
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
  it("lights the destination whose prefix matches most of the path", () => {
    expect(activeDestination("/lobby")).toBe("home");
    expect(activeDestination("/events/abc")).toBe("calendar");
    expect(activeDestination("/pitches/calendar")).toBe("calendar");
    expect(activeDestination("/pitches")).toBe("club");
    expect(activeDestination("/settings")).toBe("club");
    expect(activeDestination("/settings/comms")).toBe("me");
    expect(activeDestination("/safeguarding")).toBe("club");
    expect(activeDestination("/safeguarding/report")).toBe("me");
    expect(activeDestination("/teams/t-1/fixtures/f-1")).toBe("club");
    expect(activeDestination("/messages/c-1")).toBe("messages");
  });

  it("claims nothing for a route outside the five", () => {
    expect(activeDestination("/portal")).toBeNull();
  });
});

describe("search words", () => {
  it("finds paying subs by the words a member would type", () => {
    const entries = paletteEntries(person(), { view: "me", teamId: null });
    const pay = entries.find((entry) => entry.href === "/my-payments")!;
    expect(pay.keywords).toContain("pay subs");
    expect(pay.group).toBe("Me · Membership");
  });

  it("offers the five destinations first", () => {
    const entries = paletteEntries(person(), { view: "me", teamId: null });
    expect(entries.slice(0, 5).map((entry) => entry.label)).toEqual(["Home", "Calendar", "Messages", "Club", "Me"]);
  });
});
