import { describe, expect, it } from "vitest";

import { headcountLabel, summariseAvailability } from "./headcount";

describe("summariseAvailability", () => {
  const players = ["p1", "p2", "p3", "p4"];

  it("counts players by answer and the silent remainder", () => {
    const h = summariseAvailability(
      [
        { person_id: "p1", status: "available" },
        { person_id: "p2", status: "unavailable" },
        { person_id: "p3", status: "maybe" },
      ],
      players,
    );
    expect(h).toEqual({ going: 1, notGoing: 1, maybe: 1, unanswered: 1, squad: 4 });
  });

  it("ignores answers from people who are not players (coaches, ex-members)", () => {
    const h = summariseAvailability(
      [
        { person_id: "coach", status: "available" },
        { person_id: "p1", status: "available" },
      ],
      players,
    );
    expect(h.going).toBe(1);
    expect(h.squad).toBe(4);
  });

  it("one answer per person even if rows repeat", () => {
    const h = summariseAvailability(
      [
        { person_id: "p1", status: "available" },
        { person_id: "p1", status: "unavailable" },
      ],
      players,
    );
    expect(h.going).toBe(1);
    expect(h.notGoing).toBe(0);
    expect(h.unanswered).toBe(3);
  });

  it("an empty squad is all zeroes", () => {
    expect(summariseAvailability([], [])).toEqual({
      going: 0,
      notGoing: 0,
      maybe: 0,
      unanswered: 0,
      squad: 0,
    });
  });
});

describe("headcountLabel", () => {
  it("says the useful parts and drops the zero ones", () => {
    expect(
      headcountLabel({ going: 5, notGoing: 2, maybe: 1, unanswered: 4, squad: 12 }),
    ).toBe("5 going · 2 out · 1 maybe · 4 unanswered");
    expect(headcountLabel({ going: 0, notGoing: 0, maybe: 0, unanswered: 0, squad: 0 })).toBe(
      "0 going",
    );
    expect(headcountLabel({ going: 8, notGoing: 0, maybe: 0, unanswered: 0, squad: 8 })).toBe(
      "8 going",
    );
  });
});
