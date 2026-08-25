import { describe, expect, it } from "vitest";

import { countyForTown, countyIsSettled, townKey, TOWN_COUNTIES } from "./address";

describe("countyForTown", () => {
  it("settles the club's own town", () => {
    expect(countyForTown("Sale")).toBe("Greater Manchester");
  });

  it("settles the towns Adam named beside it", () => {
    expect(countyForTown("Timperley")).toBe("Greater Manchester");
    expect(countyForTown("Altrincham")).toBe("Greater Manchester");
  });

  it("does not care about case or stray space", () => {
    for (const typed of ["SALE", "sale", " Sale ", "sAlE"]) {
      expect(countyForTown(typed)).toBe("Greater Manchester");
    }
  });

  it("reads a hyphenated town the way people type it", () => {
    expect(countyForTown("Ashton-on-Mersey")).toBe("Greater Manchester");
    expect(countyForTown("ashton on mersey")).toBe("Greater Manchester");
    expect(countyForTown("Chorlton-cum-Hardy")).toBe("Greater Manchester");
  });

  it("leaves a town the club does not know alone", () => {
    expect(countyForTown("Leeds")).toBeNull();
    expect(countyForTown("Knutsford")).toBeNull();
    expect(countyForTown("")).toBeNull();
    expect(countyForTown(null)).toBeNull();
    expect(countyForTown(undefined)).toBeNull();
  });

  it("does not match a town buried in a longer line", () => {
    // "Sale Moor" is its own place and is listed on its own terms; an address
    // line is not a town and must not be guessed at.
    expect(countyForTown("Sale Moor")).toBe("Greater Manchester");
    expect(countyForTown("47 Sale Road, Nowhere")).toBeNull();
  });

  it("says whether the field should be held", () => {
    expect(countyIsSettled("Sale")).toBe(true);
    expect(countyIsSettled("Leeds")).toBe(false);
  });
});

describe("townKey", () => {
  it("strips punctuation and collapses space", () => {
    expect(townKey("  Ashton-on-Mersey  ")).toBe("ashton on mersey");
    expect(townKey("St. Helens")).toBe("st helens");
  });

  it("keys every town in the table to a value", () => {
    for (const [key, county] of Object.entries(TOWN_COUNTIES)) {
      expect(county.length).toBeGreaterThan(0);
      expect(key).toBe(key.toLowerCase());
    }
  });
});
