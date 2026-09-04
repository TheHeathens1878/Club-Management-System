import { describe, expect, it } from "vitest";

import { compareAgeGroups } from "./age-group";

describe("compareAgeGroups", () => {
  it("orders the numbers as ages, not as words", () => {
    const groups = ["U10", "U7", "U18", "U08"];
    groups.sort(compareAgeGroups);
    expect(groups).toEqual(["U7", "U08", "U10", "U18"]);
  });

  it("reads any spelling of an age group by its number", () => {
    expect(compareAgeGroups("Under 12s", "U14")).toBeLessThan(0);
    expect(compareAgeGroups("U07", "Under 7s")).toBe(0);
  });

  it("puts the grown-up groups after every junior age, Vets last", () => {
    const groups = ["Vets", "U18", "Open age", "U7"];
    groups.sort(compareAgeGroups);
    expect(groups).toEqual(["U7", "U18", "Open age", "Vets"]);
  });

  it("puts a team with no age group at the end", () => {
    expect(compareAgeGroups(null, "Vets")).toBeGreaterThan(0);
    expect(compareAgeGroups("U9", null)).toBeLessThan(0);
  });
});
