import { describe, expect, it } from "vitest";

import {
  availabilityCell,
  fixtureDayLabel,
  fixtureWhenLabel,
  matchesFilter,
  needsChasing,
  squadCounts,
  subsCell,
  type SquadCardFacts,
} from "./squad-cards";

describe("availabilityCell", () => {
  it("separates a no from a silence", () => {
    expect(availabilityCell("unavailable")).toEqual({ label: "Away", tone: "bad" });
    expect(availabilityCell(null)).toEqual({ label: "No reply", tone: "warn" });
  });

  it("reads the two positive answers", () => {
    expect(availabilityCell("available")).toEqual({ label: "Available", tone: "good" });
    expect(availabilityCell("maybe")).toEqual({ label: "Maybe", tone: "warn" });
  });
});

describe("subsCell", () => {
  it("names the amount owing when the club knows it", () => {
    expect(subsCell({ status: "past_due", amountDuePence: 4500 })).toEqual({
      label: "£45.00 owing",
      tone: "warn",
    });
  });

  it("says owing without inventing a figure", () => {
    expect(subsCell({ status: "past_due", amountDuePence: null })).toEqual({
      label: "Owing",
      tone: "warn",
    });
  });

  it("distinguishes a finished plan from a running one", () => {
    expect(subsCell({ status: "completed", amountDuePence: null }).label).toBe("Paid");
    expect(subsCell({ status: "active", amountDuePence: null }).label).toBe("On plan");
  });

  it("says so when there is no subscription at all", () => {
    expect(subsCell(undefined)).toEqual({ label: "No subscription", tone: "plain" });
    expect(subsCell({ status: null, amountDuePence: null }).label).toBe("No subscription");
  });

  it("does not colour a cancellation or a pending row", () => {
    expect(subsCell({ status: "cancelled", amountDuePence: null }).tone).toBe("plain");
    expect(subsCell({ status: "incomplete", amountDuePence: null })).toEqual({
      label: "Pending",
      tone: "plain",
    });
  });
});

describe("needsChasing", () => {
  it("counts a silence for the next match", () => {
    expect(needsChasing({ personId: "p1", hasEmergencyContact: true, availability: null })).toBe(
      true,
    );
  });

  it("counts a missing emergency contact", () => {
    expect(
      needsChasing({ personId: "p1", hasEmergencyContact: false, availability: "available" }),
    ).toBe(true);
  });

  it("leaves alone a player who answered and has a contact", () => {
    expect(
      needsChasing({ personId: "p1", hasEmergencyContact: true, availability: "unavailable" }),
    ).toBe(false);
  });

  it("does not chase a member who was never asked", () => {
    // No fixture ahead, or a coach rather than a player: `availability` is
    // undefined, which is not the same as an unanswered question.
    expect(needsChasing({ personId: "c1", hasEmergencyContact: true })).toBe(false);
  });
});

describe("squadCounts", () => {
  const cards: SquadCardFacts[] = [
    { personId: "p1", hasEmergencyContact: true, availability: "available" },
    { personId: "p2", hasEmergencyContact: true, availability: null },
    { personId: "p3", hasEmergencyContact: false, availability: null },
    { personId: "p4", hasEmergencyContact: false, availability: "unavailable" },
  ];

  it("counts each player once however many reasons it has", () => {
    expect(squadCounts(cards)).toEqual({ all: 4, chasing: 3, noContact: 2 });
  });

  it("is empty for an empty squad", () => {
    expect(squadCounts([])).toEqual({ all: 0, chasing: 0, noContact: 0 });
  });

  it("filters the grid the same way it counted it", () => {
    expect(cards.filter((card) => matchesFilter(card, "chasing"))).toHaveLength(3);
    expect(cards.filter((card) => matchesFilter(card, "no-contact"))).toHaveLength(2);
    expect(cards.filter((card) => matchesFilter(card, "all"))).toHaveLength(4);
  });
});

describe("fixture labels", () => {
  it("writes the kick-off in club time", () => {
    // 08:30Z in August is 09:30 in London.
    expect(fixtureWhenLabel("2026-08-29T08:30:00Z")).toBe("Sat 29 Aug, 09:30");
    expect(fixtureDayLabel("2026-08-29T08:30:00Z")).toBe("Saturday");
  });

  it("does not crash on a value it cannot read", () => {
    expect(fixtureWhenLabel("not a date")).toBe("");
    expect(fixtureDayLabel("not a date")).toBe("Next match");
  });
});
