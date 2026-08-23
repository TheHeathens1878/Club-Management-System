import { describe, expect, it } from "vitest";

import { londonToInstant, parseAnyDate, parseClockTime, parseUkDate } from "../src/time";

describe("parseUkDate", () => {
  it("reads Full-Time's two-digit years as this century", () => {
    expect(parseUkDate("10/05/26")).toBe("2026-05-10");
    expect(parseUkDate("01/01/00")).toBe("2000-01-01");
    expect(parseUkDate("31/12/69")).toBe("2069-12-31");
  });

  it("reads 70-99 as the twentieth century rather than inventing 2070", () => {
    expect(parseUkDate("01/01/70")).toBe("1970-01-01");
    expect(parseUkDate("01/01/99")).toBe("1999-01-01");
  });

  it("accepts four-digit years and other separators", () => {
    expect(parseUkDate("06/09/2025")).toBe("2025-09-06");
    expect(parseUkDate("6-9-2025")).toBe("2025-09-06");
  });

  it("rejects dates that are not real days", () => {
    expect(parseUkDate("31/02/26")).toBeUndefined();
    expect(parseUkDate("32/01/26")).toBeUndefined();
    expect(parseUkDate("next Tuesday")).toBeUndefined();
    expect(parseUkDate("")).toBeUndefined();
  });

  it("reads ISO dates through parseAnyDate", () => {
    expect(parseAnyDate("2025-09-06")).toBe("2025-09-06");
    expect(parseAnyDate("06/09/25")).toBe("2025-09-06");
    expect(parseAnyDate("2025-02-30")).toBeUndefined();
  });
});

describe("parseClockTime", () => {
  it("normalises the times Full-Time prints", () => {
    expect(parseClockTime("10:30")).toBe("10:30");
    expect(parseClockTime("9:05")).toBe("09:05");
    expect(parseClockTime("14:00:00")).toBe("14:00");
  });

  it("rejects anything that is not a time of day", () => {
    expect(parseClockTime("25:00")).toBeUndefined();
    expect(parseClockTime("14:60")).toBeUndefined();
    expect(parseClockTime("v")).toBeUndefined();
  });
});

describe("londonToInstant", () => {
  it("uses GMT in winter and BST in summer", () => {
    expect(londonToInstant("2025-12-27", "10:30")).toBe("2025-12-27T10:30:00.000Z");
    expect(londonToInstant("2025-09-06", "15:00")).toBe("2025-09-06T14:00:00.000Z");
  });

  it("gets both sides of the autumn change right", () => {
    // BST until 02:00 on 26/10/2025, GMT after it.
    expect(londonToInstant("2025-10-26", "00:30")).toBe("2025-10-25T23:30:00.000Z");
    expect(londonToInstant("2025-10-26", "14:00")).toBe("2025-10-26T14:00:00.000Z");
  });

  it("gets both sides of the spring change right", () => {
    // BST from 01:00 GMT on 29/03/2026.
    expect(londonToInstant("2026-03-29", "00:30")).toBe("2026-03-29T00:30:00.000Z");
    expect(londonToInstant("2026-03-30", "19:45")).toBe("2026-03-30T18:45:00.000Z");
  });

  it("resolves the ambiguous repeated hour to its first occurrence, as Postgres does", () => {
    expect(londonToInstant("2025-10-26", "01:30")).toBe("2025-10-26T00:30:00.000Z");
  });

  it("resolves a time in the spring-forward gap with the pre-transition offset", () => {
    // 01:30 on 29/03/2026 never happens; Postgres reads it as 01:30 GMT.
    expect(londonToInstant("2026-03-29", "01:30")).toBe("2026-03-29T01:30:00.000Z");
  });
});
