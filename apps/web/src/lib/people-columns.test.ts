import { describe, expect, it } from "vitest";

import {
  DEFAULT_PEOPLE_COLUMNS,
  PEOPLE_COLUMNS,
  parsePeopleColumns,
  peopleGridTemplate,
  serialisePeopleColumns,
} from "./people-columns";

describe("parsePeopleColumns", () => {
  it("gives the default set for nothing at all", () => {
    expect(parsePeopleColumns(undefined)).toEqual([...DEFAULT_PEOPLE_COLUMNS]);
    expect(parsePeopleColumns(null)).toEqual([...DEFAULT_PEOPLE_COLUMNS]);
    expect(parsePeopleColumns("")).toEqual([...DEFAULT_PEOPLE_COLUMNS]);
  });

  it("reads a chosen set", () => {
    expect(parsePeopleColumns("membership,status")).toEqual(["name", "membership", "status"]);
  });

  it("always keeps the name, because the row's link hangs off it", () => {
    expect(parsePeopleColumns("status")).toContain("name");
  });

  it("puts the columns in the table's order, not the URL's", () => {
    // Two people with the same columns must see the same table.
    expect(parsePeopleColumns("status,teams,type")).toEqual(["name", "type", "teams", "status"]);
    expect(parsePeopleColumns("type,teams,status")).toEqual(["name", "type", "teams", "status"]);
  });

  it("drops anything it does not recognise rather than failing", () => {
    // A bookmark from before a column was renamed still shows a usable list.
    expect(parsePeopleColumns("membership,nonsense,status")).toEqual([
      "name",
      "membership",
      "status",
    ]);
  });

  it("falls back to the default when nothing survives", () => {
    expect(parsePeopleColumns("nonsense,rubbish")).toEqual([...DEFAULT_PEOPLE_COLUMNS]);
  });

  it("ignores case and spacing, which is what a hand-edited URL looks like", () => {
    expect(parsePeopleColumns(" Membership , STATUS ")).toEqual(["name", "membership", "status"]);
  });
});

describe("serialisePeopleColumns", () => {
  it("is empty for the default set, so the URL stays clean", () => {
    expect(serialisePeopleColumns(DEFAULT_PEOPLE_COLUMNS)).toBe("");
  });

  it("names the columns for anything else", () => {
    expect(serialisePeopleColumns(["name", "membership"])).toBe("name,membership");
  });

  it("round-trips through parse", () => {
    const chosen = ["name", "membership", "dob"] as const;
    expect(parsePeopleColumns(serialisePeopleColumns(chosen))).toEqual([...chosen]);
  });
});

describe("peopleGridTemplate", () => {
  it("weights each column in fr units", () => {
    expect(peopleGridTemplate(["name", "status"])).toBe("3fr 2fr");
  });

  it("covers every column the registry declares", () => {
    const all = PEOPLE_COLUMNS.map((column) => column.key);
    expect(peopleGridTemplate(all).split(" ")).toHaveLength(all.length);
  });
});
