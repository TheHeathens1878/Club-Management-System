import { describe, expect, it } from "vitest";

import {
  instantToLocal,
  isValidDateString,
  isValidTimeString,
  localToInstant,
} from "./london-time";

/**
 * The pinned behaviour is the web app's (`apps/web/src/lib/booking-time.ts`):
 * these cases mirror its own tests so the two conversions can never drift
 * apart without a red build.
 */
describe("localToInstant", () => {
  it("converts a GMT wall clock", () => {
    expect(localToInstant("2026-11-14", "10:30")).toBe("2026-11-14T10:30:00.000Z");
  });

  it("converts a BST wall clock", () => {
    expect(localToInstant("2026-09-06", "10:30")).toBe("2026-09-06T09:30:00.000Z");
  });

  it("resolves the repeated hour when BST ends to its first occurrence", () => {
    // Clocks go back 02:00 → 01:00 on 2026-10-25; 01:30 happens twice.
    expect(localToInstant("2026-10-25", "01:30")).toBe("2026-10-25T00:30:00.000Z");
  });

  it("reads the skipped hour when BST starts with the pre-transition offset", () => {
    // Clocks go forward 01:00 → 02:00 on 2027-03-28; 01:30 never happens.
    expect(localToInstant("2027-03-28", "01:30")).toBe("2027-03-28T01:30:00.000Z");
  });

  it("refuses non-dates and non-times", () => {
    expect(() => localToInstant("2026-13-01", "10:30")).toThrow(RangeError);
    expect(() => localToInstant("2026-11-14", "25:00")).toThrow(RangeError);
  });
});

describe("instantToLocal", () => {
  it("round-trips both sides of the clock change", () => {
    expect(instantToLocal("2026-09-06T09:30:00.000Z")).toEqual({
      date: "2026-09-06",
      time: "10:30",
    });
    expect(instantToLocal("2026-11-14T10:30:00.000Z")).toEqual({
      date: "2026-11-14",
      time: "10:30",
    });
  });

  it("refuses a non-timestamp", () => {
    expect(() => instantToLocal("half past ten")).toThrow(RangeError);
  });
});

describe("validators", () => {
  it("knows a real day from a plausible-looking one", () => {
    expect(isValidDateString("2026-02-28")).toBe(true);
    expect(isValidDateString("2026-02-30")).toBe(false);
  });

  it("accepts H:mm and HH:mm and nothing else", () => {
    expect(isValidTimeString("9:05")).toBe(true);
    expect(isValidTimeString("23:59")).toBe(true);
    expect(isValidTimeString("24:00")).toBe(false);
    expect(isValidTimeString("10.30")).toBe(false);
  });
});
