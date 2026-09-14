import { describe, expect, it } from "vitest";

import {
  blackoutLabel,
  busiestDay,
  timetableDays,
  timetableRows,
  unplannedBookings,
  calendarSummary,
  dateSpanLabel,
  oursLabel,
  partsFree,
  shareChip,
  slotCapacity,
  shareLabel,
  slotOrder,
  syncPending,
  syncSummary,
  timeRange,
  weekdayLabel,
} from "@/lib/training-plan";

describe("the words on the planner", () => {
  it("says a share the way the database does", () => {
    expect(shareLabel(1, 1)).toBe("The whole pitch");
    expect(shareLabel(1, 2)).toBe("Half of the pitch");
    expect(shareLabel(1, 3)).toBe("A third of the pitch");
    expect(shareLabel(2, 3)).toBe("Two thirds of the pitch");
    expect(shareLabel(3, 4)).toBe("Three quarters of the pitch");
    expect(shareLabel(6, 6)).toBe("The whole pitch");
  });

  it("chips a share as a glyph", () => {
    expect(shareChip(1, 3)).toBe("⅓");
    expect(shareChip(2, 4)).toBe("½");
    expect(shareChip(3, 3)).toBe("whole");
    expect(shareChip(4, 6)).toBe("4/6");
  });

  it("reads days, times and spans", () => {
    expect(weekdayLabel(1)).toBe("Monday");
    expect(weekdayLabel(0, true)).toBe("Sun");
    expect(timeRange("18:00:00", "19:30:00")).toBe("18:00–19:30");
    expect(dateSpanLabel("2026-10-12", "2027-03-20")).toBe("Mon 12 Oct – Sat 20 Mar");
    expect(blackoutLabel("2026-12-20", "2027-01-04")).toBe("20 Dec – 4 Jan");
    expect(blackoutLabel("2026-12-25", "2026-12-25")).toBe("25 Dec");
  });
});

describe("the sync summary", () => {
  const counts = { added: 8, updated: 2, removed: 3, unchanged: 40, cancelled: 1 };

  it("says what will happen, then what did", () => {
    expect(syncPending(counts)).toBe(true);
    expect(syncSummary(counts)).toBe("8 to add · 2 to change · 3 to remove");
    expect(syncSummary(counts, true)).toBe("8 added · 2 changed · 3 removed");
  });

  it("says when there is nothing to do", () => {
    const settled = { added: 0, updated: 0, removed: 0, unchanged: 40, cancelled: 0 };
    expect(syncPending(settled)).toBe(false);
    expect(syncSummary(settled)).toBe("The calendar matches the plan.");
    expect(calendarSummary(settled)).toBe("40 sessions on the calendar");
    expect(calendarSummary(counts)).toBe("42 sessions on the calendar, 1 cancelled by a coach");
  });
});

describe("slots", () => {
  it("order by venue, then Monday-first day, then time", () => {
    const sorted = slotOrder([
      { venueName: "Zed 3G", weekday: 1, startTime: "18:00" },
      { venueName: "Abbey 2G", weekday: 0, startTime: "09:00" },
      { venueName: "Abbey 2G", weekday: 1, startTime: "19:00" },
      { venueName: "Abbey 2G", weekday: 1, startTime: "18:00" },
    ]);
    expect(sorted.map((s) => `${s.venueName} ${s.weekday} ${s.startTime}`)).toEqual([
      "Abbey 2G 1 18:00",
      "Abbey 2G 1 19:00",
      "Abbey 2G 0 09:00",
      "Zed 3G 1 18:00",
    ]);
  });

  it("count the parts still free", () => {
    expect(partsFree(3, [{ shares: 1 }, { shares: 1 }])).toBe(1);
    expect(partsFree(3, [{ shares: 2 }, { shares: 1 }])).toBe(0);
    expect(partsFree(1, [])).toBe(1);
  });

  it("counts against the club's share of the slot, not the whole pitch", () => {
    expect(slotCapacity({ parts: 4, clubParts: null })).toBe(4);
    expect(slotCapacity({ parts: 4, clubParts: 2 })).toBe(2);
    expect(slotCapacity({ parts: 2, clubParts: 5 })).toBe(2);
    expect(partsFree(slotCapacity({ parts: 4, clubParts: 2 }), [{ shares: 1 }])).toBe(1);
    expect(oursLabel({ parts: 4, clubParts: 2 })).toBe("2 of 4 ours");
    expect(oursLabel({ parts: 4, clubParts: null })).toBeNull();
    expect(oursLabel({ parts: 4, clubParts: 4 })).toBeNull();
    expect(oursLabel({ parts: 1, clubParts: 1 })).toBeNull();
  });
});

describe("the timetable", () => {
  const slot = (
    id: string,
    venueId: string,
    venueName: string,
    pitchId: string | null,
    weekday: number,
    start: string,
    end: string,
  ) => ({ id, venueId, venueName, pitchId, pitchName: pitchId ? `Pitch ${pitchId.slice(-1)}` : null, weekday, startTime: `${start}:00`, endTime: `${end}:00` });
  const booked = (pitchId: string | null, weekday: number, start: string, end: string, parts = 1, shares = 1) => ({
    pitchId,
    pitchName: pitchId ? `Pitch ${pitchId.slice(-1)}` : null,
    weekday,
    startTime: `${start}:00`,
    endTime: `${end}:00`,
    parts,
    shares,
  });
  const partington = {
    id: "v-part",
    name: "Partington Sports Village",
    pitches: [
      { id: "p-1", name: "Pitch 1" },
      { id: "p-2", name: "Pitch 2" },
    ],
    bookedSlots: [booked("p-1", 1, "18:00", "19:00", 2, 1), booked("p-1", 1, "19:00", "20:00"), booked("p-2", 1, "18:00", "19:00")],
  };
  const sale = { id: "v-sale", name: "Sale Grammar", pitches: [], bookedSlots: [booked(null, 4, "18:00", "19:00")] };
  const ashton = { id: "v-ash", name: "Ashton", pitches: [], bookedSlots: [booked(null, 2, "18:00", "19:00")] };

  it("shows only the venues with a slot or a booking the block can use", () => {
    const slots = [slot("s1", "v-part", "Partington Sports Village", "p-1", 1, "18:00", "19:00")];
    const rows = timetableRows(slots, [ashton, partington, sale], ["v-part", "v-sale"]);
    // Ashton has a booking but is not on the block; Sale is on the block with a booking only.
    expect(rows.map((r) => `${r.venueName}${r.pitchName ? ` · ${r.pitchName}` : ""}`)).toEqual([
      "Partington Sports Village · Pitch 1",
      "Partington Sports Village · Pitch 2",
      "Sale Grammar",
    ]);
    expect(rows[0]?.slots.map((s) => s.id)).toEqual(["s1"]);
    // The 18:00 Pitch 1 booking is planned; the 19:00 one is not.
    expect(rows[0]?.unplanned.map((b) => b.startTime)).toEqual(["19:00:00"]);
    expect(rows[1]?.slots).toEqual([]);
    expect(rows[1]?.unplanned).toHaveLength(1);
    expect(timetableDays(rows)).toEqual([1, 4]);
  });

  it("matches a booking to a slot by venue, pitch, day and hours", () => {
    const slots = [
      slot("s1", "v-part", "Partington Sports Village", "p-1", 1, "18:00", "19:00"),
      slot("s2", "v-part", "Partington Sports Village", "p-2", 1, "18:00", "19:00"),
      slot("s3", "v-part", "Partington Sports Village", "p-1", 2, "19:00", "20:00"),
    ];
    const left = unplannedBookings("v-part", partington.bookedSlots, slots);
    expect(left.map((b) => `${b.pitchId} ${b.weekday} ${b.startTime}`)).toEqual(["p-1 1 19:00:00"]);
  });

  it("orders a venue's rows by its pitches, a slot on no pitch last, and the days Monday first", () => {
    const slots = [
      slot("s0", "v-part", "Partington Sports Village", null, 0, "10:00", "11:00"),
      slot("s2", "v-part", "Partington Sports Village", "p-2", 3, "18:00", "19:00"),
      slot("s1b", "v-part", "Partington Sports Village", "p-1", 1, "19:00", "20:00"),
      slot("s1a", "v-part", "Partington Sports Village", "p-1", 1, "18:00", "19:00"),
    ];
    const rows = timetableRows(slots, [partington], []);
    expect(rows.map((r) => r.pitchName)).toEqual(["Pitch 1", "Pitch 2", null]);
    expect(rows[0]?.slots.map((s) => s.id)).toEqual(["s1a", "s1b"]);
    expect(timetableDays(rows)).toEqual([1, 3, 0]);
    // Not on the block: its bookings are not offered.
    expect(rows.every((r) => r.unplanned.length === 0)).toBe(true);
  });

  it("opens on the busiest day", () => {
    expect(busiestDay([])).toBe(1);
    expect(busiestDay([{ weekday: 4 }, { weekday: 4 }, { weekday: 2 }])).toBe(4);
    expect(busiestDay([{ weekday: 0 }, { weekday: 3 }])).toBe(3);
  });
});
