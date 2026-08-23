import { describe, expect, it } from "vitest";

import { FullTimeUrlError } from "../src/errors.ts";
import { buildFixturesUrl, buildResultsUrl, buildTeamUrl, parseFullTimeUrl } from "../src/url.ts";

const CANONICAL =
  "https://fulltime.thefa.com/fixtures.html?league=314585552&selectedSeason=249484346&selectedDivision=239850554&selectedCompetition=0&selectedFixtureGroupKey=1_652413140";

describe("parseFullTimeUrl", () => {
  it("reads a league home page", () => {
    expect(parseFullTimeUrl("https://fulltime.thefa.com/index.html?league=314585552")).toEqual({
      leagueId: "314585552",
      page: "index",
    });
  });

  it("reads every identifier off a division fixtures URL", () => {
    expect(parseFullTimeUrl(CANONICAL)).toEqual({
      leagueId: "314585552",
      seasonId: "249484346",
      divisionId: "239850554",
      competitionId: "0",
      fixtureGroupKey: "1_652413140",
      page: "fixtures",
    });
  });

  it("accepts HTML-escaped &amp; separators, as copied out of page source", () => {
    const escaped =
      "https://fulltime.thefa.com/results.html?league=314585552&amp;selectedSeason=736475439&amp;selectedDivision=239850554";
    expect(parseFullTimeUrl(escaped)).toMatchObject({
      leagueId: "314585552",
      seasonId: "736475439",
      divisionId: "239850554",
      page: "results",
    });
  });

  it("accepts http, www and a missing scheme", () => {
    for (const input of [
      "http://www.fulltime.thefa.com/table.html?league=314585552",
      "www.fulltime.thefa.com/table.html?league=314585552",
      "fulltime.thefa.com/table.html?league=314585552",
    ]) {
      expect(parseFullTimeUrl(input)).toEqual({ leagueId: "314585552", page: "table" });
    }
  });

  it("ignores trailing junk from a pasted message", () => {
    const pasted = "<https://fulltime.thefa.com/index.html?league=314585552>.";
    expect(parseFullTimeUrl(pasted).leagueId).toBe("314585552");
    expect(parseFullTimeUrl("https://fulltime.thefa.com/index.html?league=314585552 thanks Dave!"))
      .toMatchObject({ leagueId: "314585552", page: "index" });
  });

  it("reads a modern team page", () => {
    expect(parseFullTimeUrl("https://fulltime.thefa.com/displayTeam.html?id=607526097")).toEqual({
      leagueId: "",
      teamId: "607526097",
      page: "team",
    });
  });

  it("reads the older divisionseason/teamID team page", () => {
    expect(
      parseFullTimeUrl(
        "https://fulltime.thefa.com/displayTeam.html?divisionseason=239850554&teamID=607526097",
      ),
    ).toEqual({
      leagueId: "",
      divisionId: "239850554",
      teamId: "607526097",
      page: "team",
    });
  });

  it("keeps a selectedTeam filter off a fixtures URL", () => {
    expect(
      parseFullTimeUrl(
        "https://fulltime.thefa.com/fixtures.html?league=314585552&selectedTeam=607526097",
      ),
    ).toMatchObject({ teamId: "607526097", page: "fixtures" });
  });

  it("still reports the ids of a page it does not recognise", () => {
    expect(
      parseFullTimeUrl("https://fulltime.thefa.com/statLeaders.html?league=314585552"),
    ).toEqual({ leagueId: "314585552", page: "unknown" });
  });

  it("rejects a URL that is not on Full-Time, naming the host it got", () => {
    expect(() => parseFullTimeUrl("https://example.com/fixtures.html?league=1")).toThrowError(
      FullTimeUrlError,
    );
    try {
      parseFullTimeUrl("https://example.com/fixtures.html?league=1");
    } catch (error) {
      expect((error as FullTimeUrlError).message).toContain("fulltime.thefa.com");
      expect((error as FullTimeUrlError).message).toContain("example.com");
      expect((error as FullTimeUrlError).input).toBe("https://example.com/fixtures.html?league=1");
    }
  });

  it("rejects a look-alike host that merely starts with the real one", () => {
    expect(() =>
      parseFullTimeUrl("https://fulltime.thefa.com.example.net/index.html?league=1"),
    ).toThrowError(FullTimeUrlError);
  });

  it("rejects a Full-Time URL with no league or team in it", () => {
    expect(() => parseFullTimeUrl("https://fulltime.thefa.com/index.html")).toThrowError(
      /no league or team/i,
    );
  });

  it("rejects empty input and non-URLs", () => {
    expect(() => parseFullTimeUrl("")).toThrowError(FullTimeUrlError);
    expect(() => parseFullTimeUrl("   ")).toThrowError(FullTimeUrlError);
    expect(() => parseFullTimeUrl("not a url at all")).toThrowError(FullTimeUrlError);
  });

  it("rejects a non-http scheme", () => {
    expect(() => parseFullTimeUrl("ftp://fulltime.thefa.com/index.html?league=1")).toThrowError(
      FullTimeUrlError,
    );
  });
});

describe("buildFixturesUrl / buildResultsUrl", () => {
  it("round-trips a canonical fixtures URL", () => {
    expect(buildFixturesUrl(parseFullTimeUrl(CANONICAL))).toBe(CANONICAL);
  });

  it("defaults selectedCompetition to 0", () => {
    expect(
      buildFixturesUrl({ leagueId: "314585552", seasonId: "249484346", page: "fixtures" }),
    ).toBe(
      "https://fulltime.thefa.com/fixtures.html?league=314585552&selectedSeason=249484346&selectedCompetition=0",
    );
  });

  it("adds a team filter when asked", () => {
    expect(
      buildResultsUrl({ leagueId: "314585552", page: "results" }, { teamId: "607526097" }),
    ).toBe(
      "https://fulltime.thefa.com/results.html?league=314585552&selectedCompetition=0&selectedTeam=607526097",
    );
  });

  it("refuses to build a URL with no league", () => {
    expect(() => buildFixturesUrl({ leagueId: "", page: "fixtures" })).toThrowError(
      FullTimeUrlError,
    );
  });

  it("builds a team URL", () => {
    expect(buildTeamUrl("607526097")).toBe(
      "https://fulltime.thefa.com/displayTeam.html?id=607526097",
    );
  });
});
