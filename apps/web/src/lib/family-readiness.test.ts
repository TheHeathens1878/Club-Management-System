import { describe, expect, it } from "vitest";

import {
  childReadiness,
  householdNextAction,
  type FamilyChild,
} from "@/lib/family-readiness";

const NOW = new Date("2026-09-16T10:00:00Z");

const AMELIA: FamilyChild = {
  personId: "amelia",
  firstName: "Amelia",
  isMinor: true,
  dob: "2012-05-04",
  hasAddress: true,
  contactsCount: 2,
  appAccessGrantedAt: "2026-08-12T09:30:00Z",
  minAccountAge: 13,
  registrations: [
    {
      status: "approved",
      teamName: "U14 Mavericks",
      seasonName: "2026/27",
      submittedAt: "2026-08-01T10:00:00Z",
    },
  ],
};

function child(patch: Partial<FamilyChild> = {}): FamilyChild {
  return { ...AMELIA, ...patch };
}

describe("the four cells of a child's row", () => {
  it("reads a complete child", () => {
    const cells = childReadiness(AMELIA, { now: NOW });
    expect(cells.details).toEqual({ state: "ok", text: "On file" });
    expect(cells.contacts).toEqual({ state: "ok", text: "2 on file" });
    expect(cells.access).toEqual({ state: "ok", text: "Allowed 12 Aug" });
    expect(cells.registration).toEqual({ state: "ok", text: "Approved — U14 Mavericks" });
  });

  it("says None yet rather than leaving a cell blank", () => {
    const cells = childReadiness(child({ hasAddress: false, contactsCount: 0 }), { now: NOW });
    expect(cells.details).toEqual({ state: "missing", text: "None yet" });
    expect(cells.contacts).toEqual({ state: "missing", text: "None yet" });
  });

  it("waits on the parent for app access once the child is old enough", () => {
    const cells = childReadiness(child({ appAccessGrantedAt: null }), { now: NOW });
    expect(cells.access).toEqual({ state: "waiting", text: "Waiting on you" });
  });

  it("does not promise access the database would refuse", () => {
    // Born in 2020: SG-10's guard refuses an account until the 13th birthday,
    // so the cell says which age it is waiting for rather than "waiting on you".
    const cells = childReadiness(
      child({ dob: "2020-05-04", appAccessGrantedAt: null }),
      { now: NOW },
    );
    expect(cells.access).toEqual({ state: "pending", text: "From age 13" });
  });

  it("reads each registration state in words", () => {
    const none = childReadiness(child({ registrations: [] }), { now: NOW });
    expect(none.registration).toEqual({ state: "missing", text: "Not registered" });

    const pending = childReadiness(
      child({
        registrations: [
          { status: "pending", teamName: null, seasonName: "2026/27", submittedAt: "2026-09-01T10:00:00Z" },
        ],
      }),
      { now: NOW },
    );
    expect(pending.registration).toEqual({ state: "pending", text: "Pending" });

    const withdrawn = childReadiness(
      child({
        registrations: [
          { status: "withdrawn", teamName: "U14 Mavericks", seasonName: "2026/27", submittedAt: "2026-09-01T10:00:00Z" },
        ],
      }),
      { now: NOW },
    );
    expect(withdrawn.registration).toEqual({ state: "missing", text: "Withdrawn" });
  });

  it("speaks for the latest registration, not the first one filed", () => {
    const cells = childReadiness(
      child({
        registrations: [
          { status: "withdrawn", teamName: "U13 Comets", seasonName: "2025/26", submittedAt: "2025-08-01T10:00:00Z" },
          { status: "approved", teamName: "U14 Mavericks", seasonName: "2026/27", submittedAt: "2026-08-01T10:00:00Z" },
        ],
      }),
      { now: NOW },
    );
    expect(cells.registration.text).toBe("Approved — U14 Mavericks");
  });
});

describe("the one line at the top of the household", () => {
  it("offers to add a child to an empty household", () => {
    const action = householdNextAction([], { now: NOW });
    expect(action.key).toBe("add-child");
    expect(action.label).toBe("Add a child");
    expect(action.mode).toBe("add");
  });

  it("puts a missing emergency contact above an unregistered child", () => {
    // Ben is not registered and Amelia has nobody to ring: the club can sort a
    // registration out next week and cannot sort out not knowing who to call.
    const ben = child({
      personId: "ben",
      firstName: "Ben",
      appAccessGrantedAt: null,
      registrations: [],
    });
    const action = householdNextAction([ben, child({ contactsCount: 0 })], {
      seasonName: "2026/27",
      now: NOW,
    });
    expect(action.key).toBe("add-emergency-contact");
    expect(action.label).toBe("Amelia has no emergency contact");
    expect(action.personId).toBe("amelia");
    expect(action.mode).toBe("contacts");
  });

  it("asks for the registration the season needs", () => {
    const action = householdNextAction([child({ registrations: [] })], {
      seasonName: "2026/27",
      now: NOW,
    });
    expect(action.key).toBe("register-child");
    expect(action.label).toBe("Register Amelia for 2026/27");
    expect(action.mode).toBe("register");
  });

  it("names the child without a season when the club has not opened one", () => {
    const action = householdNextAction([child({ registrations: [] })], { now: NOW });
    expect(action.label).toBe("Register Amelia");
  });

  it("asks about app access once everything else is in", () => {
    const action = householdNextAction([child({ appAccessGrantedAt: null })], { now: NOW });
    expect(action.key).toBe("grant-app-access");
    expect(action.label).toBe("Amelia's app access is waiting on you");
    expect(action.mode).toBe("access");
  });

  it("goes quiet when the household is ready", () => {
    const action = householdNextAction([AMELIA], { now: NOW });
    expect(action.key).toBe("add-child");
    expect(action.tone).toBe("done");
    expect(action.why).toBe("Everything the club needs for your child is on file.");
  });

  it("does not chase an emergency contact for a grown-up in the household", () => {
    const action = householdNextAction([child({ isMinor: false, contactsCount: 0 })], {
      now: NOW,
    });
    expect(action.key).not.toBe("add-emergency-contact");
  });
});
