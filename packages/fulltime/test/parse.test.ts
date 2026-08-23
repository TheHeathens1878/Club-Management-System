import { describe, expect, it } from "vitest";

import { parseFixturesPage } from "../src/parse";
import { fixture } from "./helpers";

const league = fixture("ft-league.html");
const fixturesPage = fixture("ft-fixtures.html");
const team = fixture("ft-team.html");
const challenge = fixture("ft-results.html");
const synthetic = fixture("synthetic-fixtures.html");

describe("parseFixturesPage: seasons and teams", () => {
  it("reads every season option off the recorded league page", () => {
    const { seasons } = parseFixturesPage(league);
    expect(seasons).toHaveLength(13);
    expect(seasons[0]).toEqual({ id: "389298401", name: "2013-14", selected: false });
    expect(seasons).toContainEqual({ id: "736475439", name: "2024-25", selected: false });
    expect(seasons.filter((season) => season.selected)).toEqual([
      { id: "249484346", name: "2025-26", selected: true },
    ]);
  });

  it("reads the team filter options, dropping the empty All entry", () => {
    expect(parseFixturesPage(synthetic).teams).toEqual([
      { id: "607526097", name: "Whalesmead Thistle" },
      { id: "607526098", name: "Angel FC" },
      { id: "607526099", name: "Otterbourne Rovers" },
    ]);
    // The recorded off-season fixtures page really does only offer "All".
    expect(parseFixturesPage(fixturesPage).teams).toEqual([]);
  });
});

describe("parseFixturesPage: recorded pages", () => {
  it("reads the real result out of the league home page", () => {
    const { fixtures, warnings } = parseFixturesPage(league);
    expect(warnings).toEqual([]);
    expect(fixtures).toHaveLength(1);
    expect(fixtures[0]).toMatchObject({
      externalRef: "29899584",
      type: "O",
      date: "2026-05-10",
      homeTeam: "Whalesmead Thistle",
      awayTeam: "Angel FC",
      homeScore: 2,
      awayScore: 5,
      status: "played",
    });
    // That table prints no kick-off time, so none is invented.
    expect(fixtures[0]?.time).toBeUndefined();
  });

  it("reads the same result with its kick-off time off the team page", () => {
    const { fixtures, warnings } = parseFixturesPage(team);
    expect(warnings).toEqual([]);
    expect(fixtures).toHaveLength(1);
    expect(fixtures[0]).toMatchObject({
      externalRef: "29899584",
      type: "O",
      date: "2026-05-10",
      time: "10:30",
      kickoffAt: "2026-05-10T09:30:00.000Z",
      homeTeam: "Whalesmead Thistle",
      awayTeam: "Angel FC",
      homeScore: 2,
      awayScore: 5,
      status: "played",
    });
    expect(fixtures[0]?.raw).toContain("Whalesmead Thistle");
  });

  it("ignores the team page's season-statistics tables", () => {
    // ft-team.html carries three tables; only the results one is fixtures.
    expect(parseFixturesPage(team).fixtures).toHaveLength(1);
  });

  it("returns nothing and complains about nothing for an off-season fixtures page", () => {
    const parsed = parseFixturesPage(fixturesPage);
    expect(parsed.fixtures).toEqual([]);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.seasons.length).toBeGreaterThan(0);
  });

  it("warns instead of parsing when Cloudflare answers with a challenge", () => {
    const parsed = parseFixturesPage(challenge);
    expect(parsed.fixtures).toEqual([]);
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.warnings[0]).toMatch(/cloudflare challenge/i);
  });
});

describe("parseFixturesPage: the row shapes off-season pages could not give us", () => {
  const parsed = parseFixturesPage(synthetic);

  it("reads every well-formed row and skips the date-grouping row silently", () => {
    expect(parsed.fixtures).toHaveLength(6);
  });

  it("reads a played row", () => {
    expect(parsed.fixtures[0]).toMatchObject({
      externalRef: "30111004",
      type: "L",
      date: "2025-09-06",
      time: "15:00",
      kickoffAt: "2025-09-06T14:00:00.000Z",
      homeTeam: "Angel FC",
      awayTeam: "Compton Corinthians",
      homeScore: 3,
      awayScore: 1,
      status: "played",
      competition: "Division One",
      venue: "Angel Park",
    });
  });

  it("reads an unplayed row whose score cell holds the kick-off time", () => {
    expect(parsed.fixtures[1]).toMatchObject({
      externalRef: "30111001",
      date: "2025-10-26",
      time: "14:00",
      status: "scheduled",
      homeTeam: "Whalesmead Thistle",
      awayTeam: "Angel FC",
    });
    expect(parsed.fixtures[1]?.homeScore).toBeUndefined();
  });

  it("keeps GMT and BST kick-offs an hour apart across the DST boundary", () => {
    // 26/10/2025 is after the autumn change: 14:00 London is 14:00 UTC.
    expect(parsed.fixtures[1]?.kickoffAt).toBe("2025-10-26T14:00:00.000Z");
    // 30/03/2026 is after the spring change: 19:45 London is 18:45 UTC.
    expect(parsed.fixtures[4]?.kickoffAt).toBe("2026-03-30T18:45:00.000Z");
  });

  it("reads a postponed row as postponed, not as nil-nil", () => {
    expect(parsed.fixtures[2]).toMatchObject({
      externalRef: "30111003",
      date: "2025-11-08",
      status: "postponed",
      homeTeam: "Otterbourne Rovers",
    });
    expect(parsed.fixtures[2]?.homeScore).toBeUndefined();
    expect(parsed.fixtures[2]?.awayScore).toBeUndefined();
  });

  it("reads a cancelled row", () => {
    expect(parsed.fixtures[3]).toMatchObject({ date: "2025-12-27", status: "cancelled" });
  });

  it("hashes a reference for a cup row that has no displayFixture link", () => {
    const cup = parsed.fixtures[4];
    expect(cup).toMatchObject({
      type: "C",
      competition: "Hampshire Sunday Cup",
      status: "scheduled",
    });
    expect(cup?.externalRef).toMatch(/^ft-hash-[0-9a-f]{16}$/);
  });

  it("lets an abandoned row keep the score it was abandoned at", () => {
    expect(parsed.fixtures[5]).toMatchObject({
      type: "F",
      status: "abandoned",
      homeScore: 2,
      awayScore: 2,
      competition: "Pre-season friendly",
    });
  });

  it("warns about the malformed row rather than throwing", () => {
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.warnings[0]).toMatch(/could not read a fixture row/i);
    expect(parsed.warnings[0]).toContain("Sparsholt Athletic");
  });
});

describe("parseFixturesPage: robustness", () => {
  it("survives empty and nonsense input", () => {
    for (const input of ["", "<html></html>", "not html at all", "<table><tr><td>x</td></tr>"]) {
      expect(() => parseFixturesPage(input)).not.toThrow();
      expect(parseFixturesPage(input).fixtures).toEqual([]);
    }
  });

  it("flags a fixture-shaped table it cannot read a single row from", () => {
    const broken = `
      <table>
        <thead><tr><th>Home Team</th><th>Away Team</th><th>When</th></tr></thead>
        <tbody><tr><td>Angel FC</td><td>Whalesmead Thistle</td><td>next Tuesday</td></tr></tbody>
      </table>`;
    const parsed = parseFixturesPage(broken);
    expect(parsed.fixtures).toEqual([]);
    expect(parsed.warnings).toHaveLength(1);
  });

  it("stays quiet when a table says there is nothing to show", () => {
    const empty = `
      <table>
        <thead><tr><th>Home Team</th><th>Away Team</th></tr></thead>
        <tbody><tr><td colspan="2">No fixtures found</td></tr></tbody>
      </table>`;
    expect(parseFixturesPage(empty).warnings).toEqual([]);
  });
});
