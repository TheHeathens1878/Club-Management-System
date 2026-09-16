import { describe, expect, it } from "vitest";

import {
  NO_FILTERS,
  applyFilters,
  exportSummary,
  filterOptions,
  filtersActive,
  filtersSummary,
  shortOfReplies,
  type Filters,
} from "./filters";
import type { DeskRow } from "./types";

// August, not September: en-GB abbreviates September as "Sept" in some ICU
// builds, and these strings are compared literally.
const SAT = "2026-08-22";
const SUN = "2026-08-23";

function row(over: Partial<DeskRow> & { id: string }): DeskRow {
  return {
    eventId: `ev-${over.id}`,
    teamId: "t-u14",
    teamName: "U14 Mavericks",
    ageGroup: "U14",
    opponent: "Sale Utd",
    isHome: true,
    competition: "League",
    status: "scheduled",
    date: "Sat 22 Aug",
    time: "10:30",
    dateIso: SAT,
    pitch: "Banky Lane 1",
    allocated: true,
    venue: "Banky Lane",
    venueText: null,
    accepted: 12,
    declined: 1,
    squad: 14,
    ...over,
  };
}

const ROWS: DeskRow[] = [
  row({ id: "a" }),
  row({ id: "b", teamId: "t-u7", teamName: "U7 Comets", ageGroup: "U7", opponent: "Altrincham Jnrs", accepted: 3 }),
  row({ id: "c", isHome: false, pitch: "Away", venue: "Away", dateIso: SUN, opponent: "Timperley" }),
  row({ id: "d", status: "cancelled", accepted: 0, declined: 0 }),
];

const ids = (rows: DeskRow[]) => rows.map((r) => r.id);

describe("the desk's filters", () => {
  it("shows everything when nothing is set", () => {
    expect(ids(applyFilters(ROWS, NO_FILTERS))).toEqual(["a", "b", "c", "d"]);
    expect(filtersActive(NO_FILTERS)).toBe(false);
  });

  it("narrows by team, side and date", () => {
    expect(ids(applyFilters(ROWS, { ...NO_FILTERS, team: "U7 Comets" }))).toEqual(["b"]);
    expect(ids(applyFilters(ROWS, { ...NO_FILTERS, homeAway: "away" }))).toEqual(["c"]);
    expect(ids(applyFilters(ROWS, { ...NO_FILTERS, from: SUN }))).toEqual(["c"]);
  });

  it("matches an opponent on part of the name, ignoring case", () => {
    expect(ids(applyFilters(ROWS, { ...NO_FILTERS, opponent: "  altrincham " }))).toEqual(["b"]);
  });

  it("counts nobody short on a cancelled match", () => {
    // 0 of 14 have accepted, but it is not on.
    expect(shortOfReplies(ROWS[3]!)).toBe(false);
    expect(ids(applyFilters(ROWS, { ...NO_FILTERS, replies: "short" }))).toEqual(["b"]);
  });

  it("offers each column's own values, sorted and without repeats", () => {
    const options = filterOptions(ROWS);
    expect(options.teams).toEqual(["U14 Mavericks", "U7 Comets"]);
    expect(options.venues).toEqual(["Away", "Banky Lane"]);
    expect(options.statuses).toEqual(["cancelled", "scheduled"]);
  });
});

describe("what the folded rows say", () => {
  it("says everything is shown when nothing is set", () => {
    expect(filtersSummary(NO_FILTERS, 34, 34)).toBe("All teams · All venues · showing 34 of 34");
  });

  it("says the filters that ARE set, and ends on the count", () => {
    const filters: Filters = { ...NO_FILTERS, team: "U14 Mavericks", homeAway: "home", replies: "short" };
    expect(filtersSummary(filters, 3, 34)).toBe(
      "U14 Mavericks · Home only · Short of replies · showing 3 of 34",
    );
  });

  it("names an open-ended date range honestly", () => {
    expect(filtersSummary({ ...NO_FILTERS, from: SAT }, 2, 4)).toBe(
      `${SAT} → any date · showing 2 of 4`,
    );
  });

  it("says what the export would take away, and in what order", () => {
    expect(exportSummary(34, "kickoff")).toBe("34 matches · by kick-off · CSV or PDF");
    expect(exportSummary(1, "age")).toBe("1 match · by age group, U7 up to Vets · CSV or PDF");
    expect(exportSummary(0, "venue")).toBe("0 matches · by venue · CSV or PDF");
  });
});
