import { describe, expect, it } from "vitest";

import { parseCsvFixtures, parseCsvRows } from "../src/csv";
import { stableExternalRef } from "../src/ref";

describe("parseCsvRows", () => {
  it("handles quotes, embedded commas and CRLF", () => {
    const csv = 'a,b\r\n"one, two",three\r\n"say ""hi""",four\r\n';
    expect(parseCsvRows(csv)).toEqual([
      ["a", "b"],
      ["one, two", "three"],
      ['say "hi"', "four"],
    ]);
  });
});

describe("parseCsvFixtures", () => {
  it("accepts the documented header row in any order", () => {
    const csv = [
      "venue,away,home,status,date,competition,time",
      "Angel Park,Compton Corinthians,Angel FC,played,06/09/2025,Division One,15:00",
    ].join("\n");

    const { fixtures, warnings } = parseCsvFixtures(csv);
    expect(warnings).toEqual([]);
    expect(fixtures).toHaveLength(1);
    expect(fixtures[0]).toMatchObject({
      date: "2025-09-06",
      time: "15:00",
      kickoffAt: "2025-09-06T14:00:00.000Z",
      homeTeam: "Angel FC",
      awayTeam: "Compton Corinthians",
      competition: "Division One",
      venue: "Angel Park",
      status: "played",
    });
  });

  it("gives CSV rows the same hashed reference the HTML parser would", () => {
    const csv = "date,time,home,away,competition,venue,status\n30/03/26,19:45,Angel FC,Whalesmead Thistle,Hampshire Sunday Cup,Angel Park,";
    const parsed = parseCsvFixtures(csv);
    expect(parsed.fixtures[0]?.externalRef).toBe(
      stableExternalRef({
        date: "2026-03-30",
        homeTeam: "Angel FC",
        awayTeam: "Whalesmead Thistle",
        competition: "Hampshire Sunday Cup",
      }),
    );
  });

  it("reads dd/mm/yy, dd/mm/yyyy and yyyy-mm-dd alike", () => {
    const csv = [
      "date,home,away",
      "06/09/25,Angel FC,A",
      "06/09/2025,Angel FC,B",
      "2025-09-06,Angel FC,C",
    ].join("\n");
    const dates = parseCsvFixtures(csv).fixtures.map((f) => f.date);
    expect(dates).toEqual(["2025-09-06", "2025-09-06", "2025-09-06"]);
  });

  it("infers played from a score and understands status synonyms", () => {
    const csv = [
      "date,home,away,score,status",
      "06/09/25,Angel FC,A,3 - 1,",
      "13/09/25,Angel FC,B,,P-P",
      "20/09/25,Angel FC,C,,canx",
      "27/09/25,Angel FC,D,,",
    ].join("\n");
    const parsed = parseCsvFixtures(csv);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.fixtures.map((f) => f.status)).toEqual([
      "played",
      "postponed",
      "cancelled",
      "scheduled",
    ]);
    expect(parsed.fixtures[0]).toMatchObject({ homeScore: 3, awayScore: 1 });
  });

  it("warns about the rows it cannot read and keeps the ones it can", () => {
    const csv = [
      "date,home,away",
      "06/09/25,Angel FC,Compton Corinthians",
      "sometime,Angel FC,Nobody",
      "13/09/25,,Nobody",
    ].join("\n");
    const parsed = parseCsvFixtures(csv);
    expect(parsed.fixtures).toHaveLength(1);
    expect(parsed.warnings).toHaveLength(2);
    expect(parsed.warnings[0]).toContain("Line 3");
    expect(parsed.warnings[1]).toContain("Line 4");
  });

  it("explains which columns a file is missing", () => {
    const parsed = parseCsvFixtures("when,who,whom\n06/09/25,Angel FC,Compton Corinthians");
    expect(parsed.fixtures).toEqual([]);
    expect(parsed.warnings[0]).toMatch(/date, home, away/);
  });

  it("says so when the file is empty", () => {
    expect(parseCsvFixtures("").warnings).toEqual(["The CSV was empty."]);
  });
});
