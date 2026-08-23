import { describe, expect, it } from "vitest";

import { parseFixturesPage } from "../src/parse.ts";
import { fixturesForTeam, normaliseTeamName, sameTeam, teamNamesIn } from "../src/team.ts";
import { fixture } from "./helpers.ts";

const parsed = parseFixturesPage(fixture("synthetic-fixtures.html"));

describe("normaliseTeamName", () => {
  it("folds case, collapses whitespace and straightens apostrophes", () => {
    expect(normaliseTeamName("  ANGEL   FC \n")).toBe("angel fc");
    expect(normaliseTeamName("St Mary’s")).toBe(normaliseTeamName("St Mary's"));
    expect(normaliseTeamName("Angel FC")).toBe("angel fc");
  });

  it("does not guess that punctuation-different names are the same club", () => {
    expect(sameTeam("Angel FC", "Angel F.C.")).toBe(false);
    expect(sameTeam("", "")).toBe(false);
  });
});

describe("fixturesForTeam", () => {
  it("finds a team's matches whatever case and spacing the caller uses", () => {
    expect(fixturesForTeam(parsed, "  angel   fc ")).toHaveLength(6);
  });

  it("marks home and away and names the opponent", () => {
    const found = fixturesForTeam(parsed, "Angel FC");
    expect(found.filter((f) => f.isHome)).toHaveLength(4);
    expect(found.filter((f) => !f.isHome)).toHaveLength(2);
    expect(found.map((f) => f.opponent)).toEqual([
      "Compton Corinthians",
      "Whalesmead Thistle",
      "Otterbourne Rovers",
      "Twyford Wanderers",
      "Whalesmead Thistle",
      "Hursley Park",
    ]);
  });

  it("sees the away side of a fixture too", () => {
    const found = fixturesForTeam(parsed, "Whalesmead Thistle");
    expect(found.map((f) => ({ isHome: f.isHome, opponent: f.opponent }))).toEqual([
      { isHome: true, opponent: "Angel FC" },
      { isHome: false, opponent: "Angel FC" },
    ]);
  });

  it("returns nothing for a team that is not on the page, or for no team", () => {
    expect(fixturesForTeam(parsed, "Southampton FC")).toEqual([]);
    expect(fixturesForTeam(parsed, "   ")).toEqual([]);
  });
});

describe("teamNamesIn", () => {
  it("lists each club once, alphabetically", () => {
    expect(teamNamesIn(parsed.fixtures)).toEqual([
      "Angel FC",
      "Compton Corinthians",
      "Hursley Park",
      "Otterbourne Rovers",
      "Twyford Wanderers",
      "Whalesmead Thistle",
    ]);
  });
});
