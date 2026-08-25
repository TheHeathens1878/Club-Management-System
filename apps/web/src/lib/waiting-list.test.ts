import { describe, expect, it } from "vitest";

import {
  NO_WAITING_LIST_MESSAGE,
  openAgeGroupsSummary,
  sortedOpenAgeGroups,
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
