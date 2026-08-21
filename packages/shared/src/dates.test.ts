import { describe, expect, it } from "vitest";
import { ageInYears, isMinor } from "./dates";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("ageInYears", () => {
  it("counts whole years", () => {
    expect(ageInYears(d("2010-06-15"), d("2026-06-15"))).toBe(16);
  });
  it("does not count the year before the birthday", () => {
    expect(ageInYears(d("2010-06-15"), d("2026-06-14"))).toBe(15);
  });
});

describe("isMinor", () => {
  it("is true the day before the 18th birthday", () => {
    expect(isMinor(d("2008-08-22"), d("2026-08-21"))).toBe(true);
  });
  it("is false on the 18th birthday", () => {
    expect(isMinor(d("2008-08-21"), d("2026-08-21"))).toBe(false);
  });
});
