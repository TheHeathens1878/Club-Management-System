import { describe, expect, it } from "vitest";

import { buildMonthRange, parseYm, statusTag } from "./bookings-calendar";

describe("parseYm", () => {
  it("reads a YYYY-MM string as numbers", () => {
    expect(parseYm("2027-07")).toEqual({ year: 2027, month: 7 });
    expect(parseYm("2026-01")).toEqual({ year: 2026, month: 1 });
  });

  it("falls back to the current month only for malformed input", () => {
    const now = new Date();
    expect(parseYm("nope")).toEqual({ year: now.getFullYear(), month: now.getMonth() + 1 });
    expect(parseYm("dddd-dd")).toEqual({ year: now.getFullYear(), month: now.getMonth() + 1 });
  });
});

describe("buildMonthRange", () => {
  it("walks month by month across a year boundary", () => {
    expect(buildMonthRange("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });

  it("is a single month when from and to agree", () => {
    expect(buildMonthRange("2027-07", "2027-07")).toEqual(["2027-07"]);
  });
});

describe("statusTag", () => {
  it("marks everything that does not hold the room", () => {
    expect(statusTag("confirmed")).toBe("");
    expect(statusTag("pending")).toBe(" (PENDING)");
    expect(statusTag("enquiry")).toBe(" (ENQUIRY)");
    expect(statusTag("quoted")).toBe(" (QUOTED)");
  });
});
