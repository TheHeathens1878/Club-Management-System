import { describe, expect, it } from "vitest";

import { localToEpochMs } from "./booking-time";
import {
  cellAt,
  comingWeekend,
  entriesByResource,
  shiftWeekend,
  slotBounds,
  slotTimes,
  weekendOf,
  weekendWindow,
  type GridEntry,
} from "./pitch-grid";

// 2026-09-19 is a Saturday; 2026-09-20 the Sunday after it.

function entry(overrides: Partial<GridEntry> & Pick<GridEntry, "startsAtMs" | "endsAtMs">): GridEntry {
  return {
    bookingId: "b1",
    kind: "hire",
    status: "confirmed",
    label: "Booking",
    blockedFromMs: overrides.startsAtMs,
    blockedUntilMs: overrides.endsAtMs,
    fixtureId: null,
    teamId: null,
    ...overrides,
  };
}

describe("slotTimes", () => {
  it("runs 08:00 to 19:30 in half hours", () => {
    const times = slotTimes();
    expect(times).toHaveLength(24);
    expect(times[0]).toBe("08:00");
    expect(times[1]).toBe("08:30");
    expect(times.at(-1)).toBe("19:30");
  });
});

describe("slotBounds", () => {
  it("spans exactly one half hour of London wall clock", () => {
    const { startMs, endMs } = slotBounds("2026-09-19", "10:30");
    expect(startMs).toBe(localToEpochMs("2026-09-19", "10:30"));
    expect(endMs).toBe(localToEpochMs("2026-09-19", "11:00"));
  });
  it("closes the last slot at 20:00", () => {
    expect(slotBounds("2026-09-19", "19:30").endMs).toBe(localToEpochMs("2026-09-19", "20:00"));
  });
});

describe("weekendOf", () => {
  it("keeps a Saturday", () => {
    expect(weekendOf("2026-09-19")).toEqual({ saturday: "2026-09-19", sunday: "2026-09-20" });
  });
  it("steps a Sunday back to its own Saturday", () => {
    expect(weekendOf("2026-09-20")).toEqual({ saturday: "2026-09-19", sunday: "2026-09-20" });
  });
  it("looks forward from a weekday", () => {
    expect(weekendOf("2026-09-14").saturday).toBe("2026-09-19"); // Monday
    expect(weekendOf("2026-09-18").saturday).toBe("2026-09-19"); // Friday
  });
});

describe("comingWeekend", () => {
  it("reads today in Europe/London, not UTC", () => {
    // 23:30 UTC on Friday is already Saturday in London (BST).
    expect(comingWeekend(new Date("2026-09-18T23:30:00Z")).saturday).toBe("2026-09-19");
  });
});

describe("shiftWeekend", () => {
  it("moves whole weeks", () => {
    const start = { saturday: "2026-09-19", sunday: "2026-09-20" };
    expect(shiftWeekend(start, 1)).toEqual({ saturday: "2026-09-26", sunday: "2026-09-27" });
    expect(shiftWeekend(start, -1)).toEqual({ saturday: "2026-09-12", sunday: "2026-09-13" });
  });
  it("stays on Saturday across the end of BST", () => {
    // BST ends on Sunday 25 October 2026.
    expect(shiftWeekend({ saturday: "2026-10-24", sunday: "2026-10-25" }, 1).saturday).toBe(
      "2026-10-31",
    );
  });
});

describe("weekendWindow", () => {
  it("covers midnight Saturday to midnight Monday", () => {
    const window = weekendWindow({ saturday: "2026-09-19", sunday: "2026-09-20" });
    expect(window.from).toBe(new Date(localToEpochMs("2026-09-19", "00:00")).toISOString());
    expect(window.untilExclusive).toBe(
      new Date(localToEpochMs("2026-09-21", "00:00")).toISOString(),
    );
  });
});

describe("cellAt", () => {
  const kickoff = entry({
    startsAtMs: localToEpochMs("2026-09-19", "10:30"),
    endsAtMs: localToEpochMs("2026-09-19", "12:00"),
    blockedFromMs: localToEpochMs("2026-09-19", "10:00"),
    blockedUntilMs: localToEpochMs("2026-09-19", "12:30"),
    label: "U13s v Angel FC",
    kind: "fixture",
    fixtureId: "f1",
  });

  function at(time: string) {
    const { startMs, endMs } = slotBounds("2026-09-19", time);
    return cellAt([kickoff], startMs, endMs);
  }

  it("marks the booked half hours", () => {
    expect(at("10:30")?.state).toBe("booked");
    expect(at("11:30")?.state).toBe("booked");
  });
  it("marks the buffers either side", () => {
    expect(at("10:00")?.state).toBe("buffer");
    expect(at("12:00")?.state).toBe("buffer");
  });
  it("leaves everything else empty", () => {
    expect(at("09:30")).toBeNull();
    expect(at("12:30")).toBeNull();
  });
  it("shows a slot that only partly overlaps as booked", () => {
    const quarterPast = entry({
      startsAtMs: localToEpochMs("2026-09-19", "10:15"),
      endsAtMs: localToEpochMs("2026-09-19", "10:20"),
    });
    const { startMs, endMs } = slotBounds("2026-09-19", "10:00");
    expect(cellAt([quarterPast], startMs, endMs)?.state).toBe("booked");
  });
  it("prefers a booking to another booking's buffer", () => {
    const hire = entry({
      startsAtMs: localToEpochMs("2026-09-19", "12:00"),
      endsAtMs: localToEpochMs("2026-09-19", "13:00"),
      label: "Hirer",
    });
    const { startMs, endMs } = slotBounds("2026-09-19", "12:00");
    // The fixture's post buffer reaches 12:30, but the hire is what matters.
    expect(cellAt([kickoff, hire], startMs, endMs)).toMatchObject({
      state: "booked",
      entry: { label: "Hirer" },
    });
  });
});

describe("entriesByResource", () => {
  it("keeps a pitch with no bookings as an empty column", () => {
    const booking = entry({
      startsAtMs: localToEpochMs("2026-09-19", "10:00"),
      endsAtMs: localToEpochMs("2026-09-19", "11:00"),
    });
    const grouped = entriesByResource([
      { resourceId: "r1", entry: booking },
      { resourceId: "r2", entry: null },
    ]);
    expect(grouped.get("r1")).toHaveLength(1);
    expect(grouped.get("r2")).toEqual([]);
  });
});
