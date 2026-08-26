import { describe, expect, it } from "vitest";

import {
  NO_WAITING_LIST_MESSAGE,
  ageBandNumber,
  ageGroupFromDobString,
  eligibleAgeBands,
  eligibleBandsLabel,
  londonToday,
  normalisePlayerSex,
  openAgeGroupsSummary,
  seasonStartYear,
  sortedOpenAgeGroups,
  teamAdmitsSex,
  teamAgeBandNumber,
  teamOfferedToPlayer,
} from "./waiting-list";

describe("sortedOpenAgeGroups", () => {
  it("is empty when the club has nothing ticked open", () => {
    expect(sortedOpenAgeGroups([])).toEqual([]);
    expect(sortedOpenAgeGroups(null)).toEqual([]);
    expect(sortedOpenAgeGroups(undefined)).toEqual([]);
  });

  it("sorts U05 … U18 rather than alphabetically", () => {
    expect(
      sortedOpenAgeGroups([{ age_group: "U18" }, { age_group: "U08" }, { age_group: "U11" }]),
    ).toEqual(["U08", "U11", "U18"]);
  });

  it("trims and de-duplicates, and drops blanks", () => {
    expect(
      sortedOpenAgeGroups([
        { age_group: " U12 " },
        { age_group: "U12" },
        { age_group: "  " },
      ]),
    ).toEqual(["U12"]);
  });
});

describe("openAgeGroupsSummary", () => {
  it("says which groups are open", () => {
    expect(openAgeGroupsSummary(["U08", "U12"])).toBe("Open for new entries: U08, U12.");
  });

  it("carries the public message when nothing is open", () => {
    expect(openAgeGroupsSummary([])).toContain(NO_WAITING_LIST_MESSAGE);
  });

  it("uses the club's one sentence, exactly", () => {
    expect(NO_WAITING_LIST_MESSAGE).toBe("We aren't operating a waiting list at the moment.");
  });
});

// ---------------------------------------------------------------------------
// The FA age band (Adam, 2026-08-26)
// ---------------------------------------------------------------------------
// The rule under test: band = (year the season starts, boundary 1 July)
// minus (year the birth cohort starts, boundary 1 September).

describe("seasonStartYear", () => {
  it("puts July to December in the season of their own year", () => {
    expect(seasonStartYear("2026-07-01")).toBe(2026);
    expect(seasonStartYear("2026-08-26")).toBe(2026);
    expect(seasonStartYear("2026-12-31")).toBe(2026);
  });

  it("puts January to June in the season that started the year before", () => {
    expect(seasonStartYear("2027-01-01")).toBe(2026);
    expect(seasonStartYear("2027-06-30")).toBe(2026);
  });

  it("says nothing about a value that is not a calendar date", () => {
    expect(seasonStartYear("not a date")).toBeNull();
    expect(seasonStartYear("2026-13-01")).toBeNull();
  });
});

describe("ageBandNumber", () => {
  it("puts 31 August and 1 September in DIFFERENT cohorts", () => {
    // The FA's line, and the whole reason this is not date arithmetic.
    expect(ageBandNumber("2014-09-01", "2026-08-26")).toBe(12);
    expect(ageBandNumber("2014-08-31", "2026-08-26")).toBe(13);
  });

  it("keeps a 1 September birthday in its own cohort all season", () => {
    for (const today of ["2026-07-01", "2026-09-01", "2026-12-25", "2027-06-30"]) {
      expect(ageBandNumber("2014-09-01", today)).toBe(12);
    }
  });

  it("straddles the new year without moving anybody", () => {
    // A season boundary is 1 July, not 1 January: December and the January
    // after it are the same season, so the band does not change.
    expect(ageBandNumber("2013-03-14", "2026-12-31")).toBe(14);
    expect(ageBandNumber("2013-03-14", "2027-01-01")).toBe(14);
    // …and 1 July is where it does change.
    expect(ageBandNumber("2013-03-14", "2027-06-30")).toBe(14);
    expect(ageBandNumber("2013-03-14", "2027-07-01")).toBe(15);
  });

  it("reads the date STRING, so a UTC-parsed Date cannot shift the cohort", () => {
    // `new Date("2014-09-01")` is midnight UTC. Read in any zone west of
    // Greenwich it is 31 August, which is the other side of the FA cut-off —
    // the bug this function exists to make impossible. The string is what is
    // parsed, and it says September.
    const dob = "2014-09-01";
    expect(new Date(dob).getUTCDate()).toBe(1);
    expect(ageBandNumber(dob, "2026-08-26")).toBe(12);
    // The same instant read five hours west, to show what was being avoided.
    const shifted = new Date(new Date(dob).getTime() - 5 * 3600 * 1000);
    expect(shifted.toISOString().slice(0, 10)).toBe("2014-08-31");
    expect(ageBandNumber(shifted.toISOString().slice(0, 10), "2026-08-26")).toBe(13);
  });

  it("is null when the date of birth is not a calendar date", () => {
    expect(ageBandNumber(null, "2026-08-26")).toBeNull();
    expect(ageBandNumber("", "2026-08-26")).toBeNull();
    expect(ageBandNumber("01/09/2014", "2026-08-26")).toBeNull();
  });

  it("is not clamped — an adult is a number above 18", () => {
    expect(ageBandNumber("1985-03-03", "2026-08-26")).toBe(42);
  });
});

describe("ageGroupFromDobString", () => {
  it("names the band, clamped to the groups the club runs", () => {
    expect(ageGroupFromDobString("2014-09-01", "2026-08-26")).toBe("U12");
    expect(ageGroupFromDobString("2014-08-31", "2026-08-26")).toBe("U13");
    expect(ageGroupFromDobString("2023-01-01", "2026-08-26")).toBe("U05");
    expect(ageGroupFromDobString("1985-03-03", "2026-08-26")).toBe("U18");
  });

  it("is null rather than a guess when there is no date of birth", () => {
    expect(ageGroupFromDobString(null, "2026-08-26")).toBeNull();
  });
});

describe("londonToday", () => {
  it("is the London calendar date, not the UTC one", () => {
    // 30 June 2027, 23:30 UTC — already 1 July in London (BST), which is the
    // day the season rolls over.
    expect(londonToday(new Date("2027-06-30T23:30:00Z"))).toBe("2027-07-01");
    expect(seasonStartYear(londonToday(new Date("2027-06-30T23:30:00Z")))).toBe(2027);
    // …and in January, when London is GMT, the two agree.
    expect(londonToday(new Date("2027-01-15T23:30:00Z"))).toBe("2027-01-15");
  });
});

describe("eligibleAgeBands", () => {
  it("is the player's own band and the one above it", () => {
    expect(eligibleAgeBands("2014-09-01", "2026-08-26")).toEqual({
      youth: true,
      bands: [12, 13],
    });
    expect(eligibleBandsLabel("2014-09-01", "2026-08-26")).toBe("U12 or U13");
  });

  it("never offers a band below U05", () => {
    expect(eligibleAgeBands("2023-01-01", "2026-08-26")).toEqual({ youth: true, bands: [5, 6] });
  });

  it("says an adult belongs in an adult team", () => {
    expect(eligibleAgeBands("1985-03-03", "2026-08-26")).toEqual({ youth: false });
    expect(eligibleBandsLabel("1985-03-03", "2026-08-26")).toBe("an adult team");
  });

  it("offers nothing at all when the date of birth is unknown (SG-0)", () => {
    expect(eligibleAgeBands(null, "2026-08-26")).toBeNull();
    expect(eligibleBandsLabel(null, "2026-08-26")).toBeNull();
  });
});

describe("teamAgeBandNumber", () => {
  it("reads a U-band and nothing else", () => {
    expect(teamAgeBandNumber("U12")).toBe(12);
    expect(teamAgeBandNumber("u05")).toBe(5);
    expect(teamAgeBandNumber(" U8 ")).toBe(8);
    expect(teamAgeBandNumber("Open")).toBeNull();
    expect(teamAgeBandNumber("Senior")).toBeNull();
    expect(teamAgeBandNumber(null)).toBeNull();
  });
});

describe("teamAdmitsSex", () => {
  it("keeps males out of a girls' team and lets females into a boys' team", () => {
    expect(teamAdmitsSex("male", "girls")).toBe(false);
    expect(teamAdmitsSex("female", "girls")).toBe(true);
    expect(teamAdmitsSex("male", "boys")).toBe(true);
    expect(teamAdmitsSex("female", "boys")).toBe(true);
    expect(teamAdmitsSex("male", "mixed")).toBe(true);
    expect(teamAdmitsSex("female", null)).toBe(true);
  });

  it("refuses a girls' team when the club does not know the player's sex", () => {
    expect(teamAdmitsSex(null, "girls")).toBe(false);
    expect(teamAdmitsSex(null, "mixed")).toBe(true);
  });
});

describe("normalisePlayerSex", () => {
  it("reads what the form and the legacy waiting list both post", () => {
    expect(normalisePlayerSex("male")).toBe("male");
    expect(normalisePlayerSex("MALE")).toBe("male");
    expect(normalisePlayerSex("Female")).toBe("female");
    expect(normalisePlayerSex("")).toBeNull();
    expect(normalisePlayerSex(null)).toBeNull();
    expect(normalisePlayerSex("unknown")).toBeNull();
  });
});

describe("teamOfferedToPlayer", () => {
  const on = "2026-08-26";
  const u12 = { ageGroup: "U12", gender: "mixed" };
  const u13 = { ageGroup: "U13", gender: "boys" };
  const u13girls = { ageGroup: "U13", gender: "girls" };
  const u14 = { ageGroup: "U14", gender: "mixed" };
  const u11 = { ageGroup: "U11", gender: "mixed" };
  const senior = { ageGroup: "Open", gender: "mixed" };
  const unlabelled = { ageGroup: null, gender: null };

  it("offers a U12 boy his own band and the one above, and nothing else", () => {
    expect(teamOfferedToPlayer(u12, "2014-09-01", "male", on)).toBe(true);
    expect(teamOfferedToPlayer(u13, "2014-09-01", "male", on)).toBe(true);
    expect(teamOfferedToPlayer(u14, "2014-09-01", "male", on)).toBe(false);
    expect(teamOfferedToPlayer(u11, "2014-09-01", "male", on)).toBe(false);
  });

  it("refuses him the girls' team in his own band", () => {
    expect(teamOfferedToPlayer(u13girls, "2014-09-01", "male", on)).toBe(false);
    expect(teamOfferedToPlayer(u13girls, "2014-09-01", "female", on)).toBe(true);
  });

  it("moves the same child up a band once the season rolls over", () => {
    expect(teamOfferedToPlayer(u12, "2014-09-01", "male", "2027-06-30")).toBe(true);
    expect(teamOfferedToPlayer(u12, "2014-09-01", "male", "2027-07-01")).toBe(false);
    expect(teamOfferedToPlayer(u14, "2014-09-01", "male", "2027-07-01")).toBe(true);
  });

  it("offers an adult a team that names no U-band, and only that", () => {
    expect(teamOfferedToPlayer(senior, "1985-03-03", "male", on)).toBe(true);
    expect(teamOfferedToPlayer(unlabelled, "1985-03-03", "male", on)).toBe(true);
    expect(teamOfferedToPlayer(u13, "1985-03-03", "male", on)).toBe(false);
  });

  it("offers a youth player nothing whose age group the club never recorded", () => {
    expect(teamOfferedToPlayer(unlabelled, "2014-09-01", "male", on)).toBe(false);
  });

  it("offers nothing at all when the date of birth is unknown (SG-0)", () => {
    expect(teamOfferedToPlayer(u12, null, "male", on)).toBe(false);
    expect(teamOfferedToPlayer(senior, null, "male", on)).toBe(false);
  });

  it("hides a girls' team until the sex is answered", () => {
    expect(teamOfferedToPlayer(u13girls, "2014-09-01", null, on)).toBe(false);
    expect(teamOfferedToPlayer(u12, "2014-09-01", null, on)).toBe(true);
  });
});
