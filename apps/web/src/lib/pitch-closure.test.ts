import { describe, expect, it } from "vitest";

import { addCalendarDays, closureDates, closureSpanLabel, MAX_CLOSURE_DAYS } from "@/lib/pitch-closure";

describe("a closure that runs for more than a day", () => {
  it("is one day when no end date is given", () => {
    expect(closureDates("2026-09-06", "")).toEqual({ dates: ["2026-09-06"] });
    expect(closureDates("2026-09-06", "2026-09-06")).toEqual({ dates: ["2026-09-06"] });
  });

  it("lists every date from the first to the last, inclusive", () => {
    expect(closureDates("2026-09-06", "2026-09-09")).toEqual({
      dates: ["2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09"],
    });
  });

  it("crosses a month end and the October clock change without losing a day", () => {
    const result = closureDates("2026-10-24", "2026-11-02");
    expect("dates" in result && result.dates).toHaveLength(10);
    expect(addCalendarDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("refuses an end before the start, and a span longer than the cap", () => {
    expect(closureDates("2026-09-06", "2026-09-05")).toEqual({
      error: "The closure cannot end before it starts.",
    });
    const tooLong = closureDates("2026-09-06", addCalendarDays("2026-09-06", MAX_CLOSURE_DAYS));
    expect("error" in tooLong).toBe(true);
    const justRight = closureDates("2026-09-06", addCalendarDays("2026-09-06", MAX_CLOSURE_DAYS - 1));
    expect("dates" in justRight && justRight.dates).toHaveLength(MAX_CLOSURE_DAYS);
  });

  it("describes the span the way the notice reads it", () => {
    expect(closureSpanLabel(["2026-09-06"])).toBe("on 2026-09-06");
    expect(closureSpanLabel(["2026-09-06", "2026-09-07", "2026-09-08"])).toBe(
      "from 2026-09-06 to 2026-09-08 (3 days)",
    );
  });
});
