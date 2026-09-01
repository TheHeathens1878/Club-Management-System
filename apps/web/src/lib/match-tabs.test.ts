import { describe, expect, it } from "vitest";

import { EVENT_TABS, eventTabFrom, eventTabsFor } from "@/lib/match-tabs";

/**
 * The rule Adam set on 2026-09-01: a family gets the match's Details before
 * kick-off and everything afterwards. The line-up is the thing being held
 * back, and only until the game it describes has started.
 */
describe("eventTabsFor", () => {
  it("gives a family Details and nothing else before kick-off", () => {
    expect(eventTabsFor({ memberView: true, kickedOff: false })).toEqual(["details"]);
  });

  it("does not offer the line-up before kick-off", () => {
    expect(eventTabsFor({ memberView: true, kickedOff: false })).not.toContain("lineup");
  });

  it("hands the family the whole bar once the game has started", () => {
    expect(eventTabsFor({ memberView: true, kickedOff: true })).toEqual([...EVENT_TABS]);
  });

  it("leaves staff and administrators the whole bar throughout", () => {
    expect(eventTabsFor({ memberView: false, kickedOff: false })).toEqual([...EVENT_TABS]);
    expect(eventTabsFor({ memberView: false, kickedOff: true })).toEqual([...EVENT_TABS]);
  });
});

describe("eventTabFrom", () => {
  it("reads a tab the reader is offered", () => {
    expect(eventTabFrom("lineup")).toBe("lineup");
    expect(eventTabFrom(["stats"])).toBe("stats");
  });

  it("falls back to Details for a tab that does not exist", () => {
    expect(eventTabFrom("substitutions")).toBe("details");
    expect(eventTabFrom(undefined)).toBe("details");
  });

  it("falls back to Details for a tab this reader is not offered", () => {
    // ?tab=lineup typed into the address bar before kick-off reaches exactly
    // what the bar would have linked to, which is the page they already have.
    const offered = eventTabsFor({ memberView: true, kickedOff: false });
    expect(eventTabFrom("lineup", offered)).toBe("details");
    expect(eventTabFrom("score", offered)).toBe("details");
  });

  it("admits it again once the game has kicked off", () => {
    const offered = eventTabsFor({ memberView: true, kickedOff: true });
    expect(eventTabFrom("lineup", offered)).toBe("lineup");
  });
});
