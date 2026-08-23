import { describe, expect, it } from "vitest";

import {
  clubDate,
  clubDateTime,
  clubDateTimeLong,
  clubTime,
  humaniseEnum,
  poundsFromPence,
  previewText,
  shortAgo,
} from "./format";

/**
 * The timezone tests are the point of this file: a fixture stored as UTC has
 * to read as the local kickoff time whatever the phone is set to, and British
 * Summer Time has to be handled rather than assumed away.
 */
describe("club time", () => {
  it("renders a summer kickoff in BST, not UTC", () => {
    // 2026-09-05T09:30Z is 10:30 in Sale.
    expect(clubTime("2026-09-05T09:30:00Z")).toBe("10:30");
    expect(clubDate("2026-09-05T09:30:00Z")).toMatch(/^Sat 5 Sept?$/);
  });

  it("renders a winter kickoff in GMT", () => {
    expect(clubTime("2026-01-10T14:00:00Z")).toBe("14:00");
    expect(clubDate("2026-01-10T14:00:00Z")).toBe("Sat 10 Jan");
  });

  it("keeps a late-evening UTC kickoff on the British day", () => {
    // 23:30 UTC in July is 00:30 the next day in Sale.
    expect(clubDate("2026-07-10T23:30:00Z")).toBe("Sat 11 Jul");
    expect(clubTime("2026-07-10T23:30:00Z")).toBe("00:30");
  });

  it("combines date and time", () => {
    expect(clubDateTime("2026-09-05T09:30:00Z")).toMatch(/^Sat 5 Sept? · 10:30$/);
    expect(clubDateTimeLong("2026-09-05T09:30:00Z")).toMatch(
      /^Sat 5 Sept? 2026 · 10:30$/,
    );
  });

  it("never leaves ICU's weekday comma in", () => {
    // Node and Hermes disagree about where the comma goes; the app must not.
    expect(clubDate("2026-09-05T09:30:00Z")).not.toContain(",");
    expect(clubDateTimeLong("2026-09-05T09:30:00Z")).not.toContain(",");
  });

  it("returns empty for missing or unparseable input", () => {
    expect(clubDate(null)).toBe("");
    expect(clubTime(undefined)).toBe("");
    expect(clubDateTime("not a date")).toBe("");
  });
});

describe("poundsFromPence", () => {
  it("formats whole and part pounds", () => {
    expect(poundsFromPence(0)).toBe("£0.00");
    expect(poundsFromPence(4250)).toBe("£42.50");
    expect(poundsFromPence(5)).toBe("£0.05");
  });

  it("puts the sign before the symbol", () => {
    expect(poundsFromPence(-1500)).toBe("-£15.00");
  });

  it("treats a null amount as nothing owing", () => {
    expect(poundsFromPence(null)).toBe("£0.00");
  });
});

describe("shortAgo", () => {
  const now = new Date("2026-09-05T12:00:00Z");

  it("counts up through minutes, hours and days", () => {
    expect(shortAgo("2026-09-05T11:59:40Z", now)).toBe("now");
    expect(shortAgo("2026-09-05T11:45:00Z", now)).toBe("15m");
    expect(shortAgo("2026-09-05T09:00:00Z", now)).toBe("3h");
    expect(shortAgo("2026-09-03T12:00:00Z", now)).toBe("2d");
  });

  it("falls back to a date beyond a week", () => {
    expect(shortAgo("2026-08-01T12:00:00Z", now)).toBe("Sat 1 Aug");
  });
});

describe("previewText", () => {
  it("collapses whitespace", () => {
    expect(previewText("hello\n\n  there")).toBe("hello there");
  });

  it("clips to the limit with an ellipsis", () => {
    const preview = previewText("a".repeat(200), 20);
    expect(preview).toHaveLength(20);
    expect(preview.endsWith("…")).toBe(true);
  });

  it("leaves a short body alone", () => {
    expect(previewText("See you Saturday")).toBe("See you Saturday");
  });
});

describe("humaniseEnum", () => {
  it("sentence-cases a snake_case value", () => {
    expect(humaniseEnum("past_due")).toBe("Past due");
    expect(humaniseEnum("postponed")).toBe("Postponed");
    expect(humaniseEnum("")).toBe("");
  });
});
