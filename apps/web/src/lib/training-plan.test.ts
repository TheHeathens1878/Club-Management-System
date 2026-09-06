import { describe, expect, it } from "vitest";

import {
  blackoutLabel,
  calendarSummary,
  dateSpanLabel,
  partsFree,
  shareChip,
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
});
