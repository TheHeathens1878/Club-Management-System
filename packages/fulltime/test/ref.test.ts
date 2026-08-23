import { describe, expect, it } from "vitest";

import { fixtureIdFromHref, fnv1a64Hex, stableExternalRef } from "../src/ref";

const base = {
  date: "2026-03-30",
  homeTeam: "Angel FC",
  awayTeam: "Whalesmead Thistle",
  competition: "Hampshire Sunday Cup",
};

describe("fixtureIdFromHref", () => {
  it("finds the id in the hrefs Full-Time actually emits", () => {
    expect(fixtureIdFromHref("/displayFixture.html?id=29899584")).toBe("29899584");
    expect(fixtureIdFromHref("https://fulltime.thefa.com/displayFixture.html?id=29899584")).toBe(
      "29899584",
    );
    expect(fixtureIdFromHref("/displayFixture.html?league=1&id=29899584")).toBe("29899584");
  });

  it("ignores links to anything else", () => {
    expect(fixtureIdFromHref("/displayTeam.html?id=607526097")).toBeUndefined();
    expect(fixtureIdFromHref("/fixtures.html?league=1")).toBeUndefined();
  });
});

describe("stableExternalRef", () => {
  it("prefers the FA's own fixture id, so a reschedule is an update", () => {
    expect(stableExternalRef({ ...base, externalRef: "29899584" })).toBe("29899584");
  });

  it("is deterministic for the same match", () => {
    const first = stableExternalRef(base);
    const second = stableExternalRef({ ...base });
    expect(first).toBe(second);
    expect(first).toMatch(/^ft-hash-[0-9a-f]{16}$/);
  });

  it("ignores case and stray whitespace in team names", () => {
    expect(stableExternalRef({ ...base, homeTeam: "  ANGEL   FC " })).toBe(stableExternalRef(base));
  });

  it("separates matches that differ in teams, date or competition", () => {
    const refs = new Set([
      stableExternalRef(base),
      stableExternalRef({ ...base, date: "2026-03-31" }),
      stableExternalRef({ ...base, homeTeam: "Angel FC Reserves" }),
      stableExternalRef({ ...base, awayTeam: "Angel FC", homeTeam: "Whalesmead Thistle" }),
      stableExternalRef({ ...base, competition: "Division One" }),
    ]);
    expect(refs.size).toBe(5);
  });

  it("does not collide on the transposition a single-pass hash would miss", () => {
    expect(fnv1a64Hex("ab")).not.toBe(fnv1a64Hex("ba"));
    expect(fnv1a64Hex("")).toMatch(/^[0-9a-f]{16}$/);
  });
});
