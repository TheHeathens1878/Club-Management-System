import { describe, expect, it } from "vitest";

import {
  anyFilterSet,
  filterChanges,
  filterKeysOf,
  filterParam,
  filterRows,
  gatherFacets,
  matchesNeedle,
  readFilters,
  searchNeedle,
  updateQuery,
} from "@/lib/data-list";

const COLUMNS = [
  { filterKey: "age" },
  {},
  { filterKey: "venue" },
  { filterKey: "age" },
] as const;

const ROWS = [
  { haystack: "under 12s lions willow park", facets: { age: "Under 12s", venue: "Willow Park" } },
  { haystack: "under 12s tigers ash lane", facets: { age: "Under 12s", venue: "Ash Lane" } },
  { haystack: "open age first team willow park", facets: { age: "Open age", venue: "Willow Park" } },
  { haystack: "under 9s cubs", facets: { age: "Under 9s", venue: "" } },
];

describe("where a column filter lives in the URL", () => {
  it("prefixes the parameter so a column called team cannot eat ?team", () => {
    expect(filterParam("team")).toBe("f.team");
    expect(filterParam("type")).toBe("f.type");
  });

  it("lists the filterable columns once each, in column order", () => {
    expect(filterKeysOf(COLUMNS)).toEqual(["age", "venue"]);
    expect(filterKeysOf([{}, {}])).toEqual([]);
  });

  it("reads every known key, so an unfiltered column is an empty string", () => {
    expect(readFilters("f.age=Under+12s&q=lions", ["age", "venue"])).toEqual({
      age: "Under 12s",
      venue: "",
    });
  });

  it("reads a URLSearchParams as happily as a string", () => {
    const params = new URLSearchParams("f.venue=Ash+Lane");
    expect(readFilters(params, ["venue"])).toEqual({ venue: "Ash Lane" });
  });

  it("ignores a parameter that is not one of its columns", () => {
    expect(readFilters("f.nonsense=1", ["age"])).toEqual({ age: "" });
  });
});

describe("writing the filters back", () => {
  it("leaves every other parameter of the list alone", () => {
    const next = updateQuery("q=lions&status=all&cols=name,type", {
      "f.age": "Under 12s",
    });
    expect(next).toBe("q=lions&status=all&cols=name%2Ctype&f.age=Under+12s");
  });

  it("removes a filter set back to All rather than writing an empty one", () => {
    expect(updateQuery("q=lions&f.age=Under+12s", { "f.age": "" })).toBe("q=lions");
  });

  it("returns an empty string when nothing is left, which means the bare path", () => {
    expect(updateQuery("f.age=Under+12s", { "f.age": "" })).toBe("");
  });

  it("turns a filter map into the changes one call can apply", () => {
    expect(filterChanges({ age: "Under 12s", venue: "" }, ["age", "venue"])).toEqual({
      "f.age": "Under 12s",
      "f.venue": "",
    });
  });

  it("clears a column the caller forgot to mention", () => {
    expect(filterChanges({ age: "Under 12s" }, ["age", "venue"])).toEqual({
      "f.age": "Under 12s",
      "f.venue": "",
    });
  });
});

describe("what the search box is looking for", () => {
  it("trims and case-folds so typing loudly still finds the team", () => {
    expect(searchNeedle("  LIONS  ")).toBe("lions");
  });

  it("treats a blank box as no filter at all", () => {
    expect(searchNeedle("   ")).toBe("");
    expect(matchesNeedle("under 9s cubs", "")).toBe(true);
  });

  it("matches anywhere in the row's search text", () => {
    expect(matchesNeedle("under 12s lions willow park", "willow")).toBe(true);
    expect(matchesNeedle("under 12s lions willow park", "oak")).toBe(false);
  });
});

describe("the values a column's filter can offer", () => {
  it("takes them from the rows, sorted for a British reader", () => {
    expect(gatherFacets(ROWS, ["age", "venue"])).toEqual({
      age: ["Open age", "Under 12s", "Under 9s"],
      venue: ["Ash Lane", "Willow Park"],
    });
  });

  it("drops a blank value, because the empty option is All", () => {
    expect(gatherFacets(ROWS, ["venue"]).venue).not.toContain("");
  });

  it("offers nothing for a column no row has a facet for", () => {
    expect(gatherFacets(ROWS, ["staff"])).toEqual({ staff: [] });
  });
});

describe("which rows survive", () => {
  it("keeps everything when nothing is asked", () => {
    expect(filterRows(ROWS)).toHaveLength(4);
  });

  it("matches a column filter exactly", () => {
    const shown = filterRows(ROWS, { filters: { age: "Under 12s" } });
    expect(shown.map((row) => row.facets.venue)).toEqual(["Willow Park", "Ash Lane"]);
  });

  it("ands the filters together with the search box", () => {
    const shown = filterRows(ROWS, {
      needle: "willow",
      filters: { age: "Under 12s", venue: "Willow Park" },
    });
    expect(shown).toHaveLength(1);
    expect(shown[0]?.haystack).toContain("lions");
  });

  it("ignores a filter set to All", () => {
    expect(filterRows(ROWS, { filters: { age: "", venue: "" } })).toHaveLength(4);
  });

  it("can end up with nothing, which is the list's no-match line", () => {
    expect(filterRows(ROWS, { filters: { age: "Open age", venue: "Ash Lane" } })).toEqual([]);
    expect(anyFilterSet({ age: "Open age", venue: "Ash Lane" })).toBe(true);
    expect(anyFilterSet({ age: "", venue: "" })).toBe(false);
  });

  it("does not match a row that has no facet for the filtered column", () => {
    expect(filterRows([{ haystack: "no facets here" }], { filters: { age: "Open age" } })).toEqual(
      [],
    );
  });
});
