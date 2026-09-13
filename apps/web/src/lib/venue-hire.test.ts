import { describe, expect, it } from "vitest";

import { bookingCost, sessionDates, sessionsBetween, slotCost } from "./venue-hire";

describe("sessionsBetween", () => {
  it("counts the weekday between two dates, inclusive", () => {
    // 2026-10-05 is a Monday; 2026-10-05..2026-10-26 holds four Mondays.
    expect(sessionsBetween("2026-10-05", "2026-10-26", 1)).toBe(4);
    expect(sessionsBetween("2026-10-05", "2026-10-25", 1)).toBe(3);
    expect(sessionsBetween("2026-10-06", "2026-10-26", 1)).toBe(3);
    // Tuesdays in the same span: the 6th, 13th, 20th.
    expect(sessionsBetween("2026-10-05", "2026-10-26", 2)).toBe(3);
    expect(sessionDates("2026-10-05", "2026-10-26", 2)).toEqual(["2026-10-06", "2026-10-13", "2026-10-20"]);
  });

  it("handles a single day and an empty span", () => {
    expect(sessionsBetween("2026-10-05", "2026-10-05", 1)).toBe(1);
    expect(sessionsBetween("2026-10-05", "2026-10-05", 2)).toBe(0);
    expect(sessionsBetween("2026-10-26", "2026-10-05", 1)).toBe(0);
  });

  it("runs across the new year", () => {
    // Mondays 6 Oct 2026 to 23 Mar 2027 — 6 Oct is a Tuesday, so the first
    // Monday is 12 Oct; the last is 22 Mar. That is 24 Mondays.
    expect(sessionsBetween("2026-10-06", "2027-03-23", 1)).toBe(24);
    // Tuesdays: 6 Oct to 23 Mar inclusive = 25.
    expect(sessionsBetween("2026-10-06", "2027-03-23", 2)).toBe(25);
  });
});

describe("slotCost and bookingCost", () => {
  const booking = { startsOn: "2026-10-05", endsOn: "2026-10-26" };

  it("is the price times the sessions", () => {
    expect(slotCost(booking, { weekday: 1, pricePence: 4500 })).toEqual({ sessions: 4, uncharged: 0, costPence: 18000 });
    expect(slotCost(booking, { weekday: 1, pricePence: null })).toEqual({ sessions: 4, uncharged: 0, costPence: null });
  });

  it("leaves out the sessions in dates off the venue does not charge for", () => {
    // Half-term 19–23 Oct takes the Monday 19th out of the bill.
    const halfTerm = [{ startsOn: "2026-10-19", endsOn: "2026-10-23" }];
    expect(slotCost(booking, { weekday: 1, pricePence: 4500 }, halfTerm)).toEqual({ sessions: 4, uncharged: 1, costPence: 13500 });
    // A break on other days changes nothing for a Monday slot.
    expect(slotCost(booking, { weekday: 1, pricePence: 4500 }, [{ startsOn: "2026-10-20", endsOn: "2026-10-23" }])).toEqual({
      sessions: 4,
      uncharged: 0,
      costPence: 18000,
    });
  });

  it("adds a booking up, counting the unpriced slots", () => {
    expect(
      bookingCost(
        {
          ...booking,
          slots: [
            { weekday: 1, pricePence: 4500 },
            { weekday: 2, pricePence: 6000 },
            { weekday: 4, pricePence: null },
          ],
        },
        [{ startsOn: "2026-10-19", endsOn: "2026-10-23" }],
      ),
    ).toEqual({ sessions: 4 + 3 + 3, uncharged: 3, costPence: 3 * 4500 + 2 * 6000, unpricedSlots: 1 });
  });
});
