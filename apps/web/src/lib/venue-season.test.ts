import { describe, expect, it } from "vitest";

import {
  parseVenueSheet,
  venueGridDays,
  venueGridRows,
  venueNextAction,
  venueSeasonGroups,
  venueSeasonLine,
  venueSeasonTotal,
  venueSheetParam,
  type VenueSeasonBooking,
  type VenueSheetState,
} from "@/lib/venue-season";

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

// ---------------------------------------------------------------------------
// The grid, the folded seasons and the panel in the URL (P8.8)
// ---------------------------------------------------------------------------

const GROUND = {
  id: "venue-1",
  name: "Banky Lane",
  pitches: [
    { id: "pitch-1", name: "Pitch 1" },
    { id: "pitch-2", name: "Pitch 2" },
  ],
};

function gridSlot(over: Partial<GridSlot> = {}): GridSlot {
  return {
    id: "slot-1",
    venueId: GROUND.id,
    venueName: GROUND.name,
    pitchId: "pitch-1",
    pitchName: "Pitch 1",
    weekday: MONDAY,
    startTime: "18:00",
    endTime: "19:00",
    ...over,
  };
}

type GridSlot = {
  id: string;
  venueId: string;
  venueName: string;
  pitchId: string | null;
  pitchName: string | null;
  weekday: number;
  startTime: string;
  endTime: string;
};

describe("the ground as a grid", () => {
  it("gives every pitch a row, booked or not, in the ground's own order", () => {
    const rows = venueGridRows([gridSlot({ pitchId: "pitch-2", pitchName: "Pitch 2" })], GROUND);
    expect(rows.map((row) => row.pitchName)).toEqual(["Pitch 1", "Pitch 2"]);
    expect(rows[0]!.slots).toHaveLength(0);
    expect(rows[1]!.slots).toHaveLength(1);
  });

  it("gives a ground with no pitches named one row of its own", () => {
    const rows = venueGridRows([], { ...GROUND, pitches: [] });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.pitchId).toBeNull();
  });

  it("puts a slot's own day in the columns, and the working week when there are none", () => {
    expect(venueGridDays(venueGridRows([gridSlot({ weekday: 4 })], GROUND))).toEqual([4]);
    expect(venueGridDays(venueGridRows([], GROUND))).toEqual([1, 2, 3, 4, 5]);
  });

  it("says what a folded season held and what it cost", () => {
    expect(venueSeasonLine([booking()])).toBe("2 slots · £220.00");
    expect(venueSeasonLine([booking({ slots: [{ weekday: MONDAY, pricePence: null }] })])).toBe(
      "1 slot · no prices yet",
    );
  });

  it("groups the bookings by season, keeping the page's order", () => {
    const groups = venueSeasonGroups(
      [
        booking(),
        booking({ id: "b2" }),
        booking({ id: "old", seasonId: "season-2526", seasonName: "2025/26" }),
        booking({ id: "loose", seasonId: null, seasonName: null }),
      ],
      CURRENT.id,
    );
    expect(groups.map((g) => g.name)).toEqual(["2026/27", "2025/26", "No season"]);
    expect(groups[0]!.isCurrent).toBe(true);
    expect(groups[0]!.bookings).toHaveLength(2);
    expect(groups[2]!.isCurrent).toBe(false);
  });
});

describe("which panel is open, in the URL", () => {
  it("survives the round trip", () => {
    const states: VenueSheetState[] = [
      { kind: "booking", bookingId: null },
      { kind: "booking", bookingId: "b1" },
      { kind: "slot", slotId: "s1" },
      { kind: "add", bookingId: "b1", pitchId: "p1", weekday: 4 },
      { kind: "add", bookingId: "b1", pitchId: null, weekday: 0 },
    ];
    for (const state of states) {
      expect(parseVenueSheet(venueSheetParam(state))).toEqual(state);
    }
  });

  it("reads nothing it does not recognise as no panel at all", () => {
    expect(parseVenueSheet(null)).toBeNull();
    expect(parseVenueSheet("")).toBeNull();
    expect(parseVenueSheet("slot")).toBeNull();
    expect(parseVenueSheet("add.b1.p1.9")).toBeNull();
    expect(parseVenueSheet("whatever")).toBeNull();
  });
});
