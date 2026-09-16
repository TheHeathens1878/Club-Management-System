import { describe, expect, it } from "vitest";

import { venueNextAction, venueSeasonTotal, type VenueSeasonBooking } from "@/lib/venue-season";

// 2026-10-05 and 2026-11-02 are both Mondays, so the span holds five
// Mondays and four Wednesdays.
const SEASON = { startsOn: "2026-10-05", endsOn: "2026-11-02" };
const MONDAY = 1;
const WEDNESDAY = 3;

describe("what a season at a ground costs", () => {
  it("counts the weeks in the span and prices them", () => {
    const total = venueSeasonTotal([{ weekday: MONDAY, pricePence: 2800 }], [], SEASON);
    expect(total.sessions).toBe(5);
    expect(total.uncharged).toBe(0);
    expect(total.costPence).toBe(14_000);
  });

  it("takes off the weeks the venue does not charge for", () => {
    const total = venueSeasonTotal(
      [{ weekday: MONDAY, pricePence: 2800 }],
      [{ startsOn: "2026-10-19", endsOn: "2026-10-25" }],
      SEASON,
    );
    expect(total.sessions).toBe(5);
    expect(total.uncharged).toBe(1);
    expect(total.costPence).toBe(11_200);
  });

  it("counts a slot with no price rather than costing it at nothing", () => {
    const total = venueSeasonTotal(
      [
        { weekday: MONDAY, pricePence: 2800 },
        { weekday: WEDNESDAY, pricePence: null },
      ],
      [],
      SEASON,
    );
    expect(total.sessions).toBe(9);
    expect(total.costPence).toBe(14_000);
    expect(total.unpricedSlots).toBe(1);
  });
});

const CURRENT = { id: "season-2627", name: "2026/27" };

function booking(overrides: Partial<VenueSeasonBooking> = {}): VenueSeasonBooking {
  return {
    id: "booking-1",
    seasonId: CURRENT.id,
    seasonName: CURRENT.name,
    startsOn: SEASON.startsOn,
    endsOn: SEASON.endsOn,
    slots: [
      { weekday: MONDAY, pricePence: 2800 },
      { weekday: WEDNESDAY, pricePence: 2000 },
    ],
    ...overrides,
  };
}

describe("what a ground is waiting for", () => {
  it("says the season, the slots and the bill, and offers another booking", () => {
    const action = venueNextAction({ name: "Banky Lane" }, [booking()], CURRENT);
    // Five Mondays at £28 and four Wednesdays at £20.
    expect(action.detail).toBe("2026/27 · 2 slots booked · £220.00 for the season");
    expect(action.label).toBe("Add a booking");
    expect(action.mode).toBe("add");
    expect(action.costPence).toBe(22_000);
  });

  it("offers to book the ground when the season is empty", () => {
    const action = venueNextAction({ name: "Banky Lane" }, [], CURRENT);
    expect(action.label).toBe("Book this ground for 2026/27");
    expect(action.detail).toBe("Banky Lane has nothing booked for 2026/27");
    expect(action.mode).toBe("book");
    expect(action.seasonId).toBe(CURRENT.id);
  });

  it("ignores last season's bookings", () => {
    const action = venueNextAction(
      { name: "Banky Lane" },
      [booking({ id: "old", seasonId: "season-2526", seasonName: "2025/26" })],
      CURRENT,
    );
    expect(action.mode).toBe("book");
  });

  it("takes the uncharged dates off the season's bill", () => {
    const action = venueNextAction({ name: "Banky Lane" }, [booking()], CURRENT, [
      { startsOn: "2026-10-19", endsOn: "2026-10-25" },
    ]);
    // One Monday and one Wednesday fall in the week off.
    expect(action.costPence).toBe(22_000 - 2800 - 2000);
  });

  it("will not quote a season nobody has priced as free", () => {
    const action = venueNextAction(
      { name: "Banky Lane" },
      [booking({ slots: [{ weekday: MONDAY, pricePence: null }] })],
      CURRENT,
    );
    expect(action.detail).toBe("2026/27 · 1 slot booked · no prices yet");
  });
});
