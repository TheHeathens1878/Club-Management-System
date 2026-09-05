import { describe, expect, it } from "vitest";

import { addCalendarDays, closureSpanLabel, closureWindows, MAX_CLOSURE_DAYS } from "@/lib/pitch-closure";

function windowsOf(result: ReturnType<typeof closureWindows>) {
  if ("error" in result) throw new Error(result.error);
  return result.windows;
}

describe("a closure as one continuous span", () => {
  it("is one day, one window, when no end date is given", () => {
    expect(windowsOf(closureWindows("2026-09-06", "08:00", "", "22:00"))).toEqual([
      { date: "2026-09-06", start: { date: "2026-09-06", time: "08:00" }, end: { date: "2026-09-06", time: "22:00" } },
    ]);
  });

  it("runs from the From time on the first day to the Until time on the last, whole days between", () => {
    // Saturday 14:00 until Monday 10:00 — the Until time is EARLIER in the
    // day than the From time, which is fine on a later date.
    expect(windowsOf(closureWindows("2026-09-05", "14:00", "2026-09-07", "10:00"))).toEqual([
      { date: "2026-09-05", start: { date: "2026-09-05", time: "14:00" }, end: { date: "2026-09-06", time: "00:00" } },
      { date: "2026-09-06", start: { date: "2026-09-06", time: "00:00" }, end: { date: "2026-09-07", time: "00:00" } },
      { date: "2026-09-07", start: { date: "2026-09-07", time: "00:00" }, end: { date: "2026-09-07", time: "10:00" } },
    ]);
  });

  it("crosses a month end and the October clock change without losing a day", () => {
    expect(windowsOf(closureWindows("2026-10-24", "08:00", "2026-11-02", "22:00"))).toHaveLength(10);
    expect(addCalendarDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("refuses an end before the start, on the day and across days", () => {
    expect(closureWindows("2026-09-06", "10:00", "", "09:00")).toEqual({
      error: "The end time must be after the start time on a one-day closure.",
    });
    expect(closureWindows("2026-09-06", "08:00", "2026-09-05", "22:00")).toEqual({
      error: "The closure cannot end before it starts.",
    });
  });

  it("caps the span", () => {
    const tooLong = closureWindows("2026-09-06", "08:00", addCalendarDays("2026-09-06", MAX_CLOSURE_DAYS), "22:00");
    expect("error" in tooLong).toBe(true);
    const justRight = closureWindows("2026-09-06", "08:00", addCalendarDays("2026-09-06", MAX_CLOSURE_DAYS - 1), "22:00");
    expect(windowsOf(justRight)).toHaveLength(MAX_CLOSURE_DAYS);
  });

  it("describes the span the way the notice reads it", () => {
    expect(closureSpanLabel(windowsOf(closureWindows("2026-09-06", "08:00", "", "22:00")))).toBe(
      "on 2026-09-06, 08:00–22:00",
    );
    expect(closureSpanLabel(windowsOf(closureWindows("2026-09-05", "14:00", "2026-09-07", "10:00")))).toBe(
      "from 2026-09-05 14:00 to 2026-09-07 10:00 (3 days)",
    );
  });
});
