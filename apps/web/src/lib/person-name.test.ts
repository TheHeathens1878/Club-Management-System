import { describe, expect, it } from "vitest";

import { joinContactName, splitContactName } from "@/lib/person-name";

describe("splitContactName", () => {
  it("splits an ordinary two-part name", () => {
    expect(splitContactName("Jane Smith")).toEqual({ firstName: "Jane", lastName: "Smith" });
  });

  it("splits on the LAST space, so middle names stay with the first name", () => {
    expect(splitContactName("Mary Jane Watson")).toEqual({
      firstName: "Mary Jane",
      lastName: "Watson",
    });
    expect(splitContactName("Anne Marie de la Cruz")).toEqual({
      firstName: "Anne Marie de la",
      lastName: "Cruz",
    });
  });

  it("leaves an unsplittable name whole, with a BLANK last name rather than a guess", () => {
    expect(splitContactName("Cher")).toEqual({ firstName: "Cher", lastName: "" });
    expect(splitContactName("Club")).toEqual({ firstName: "Club", lastName: "" });
  });

  it("collapses runs of whitespace and trims", () => {
    expect(splitContactName("  Jane   Smith  ")).toEqual({ firstName: "Jane", lastName: "Smith" });
    expect(splitContactName("Jane\tSmith")).toEqual({ firstName: "Jane", lastName: "Smith" });
  });

  it("treats an empty, blank or missing name as two empty parts", () => {
    expect(splitContactName("")).toEqual({ firstName: "", lastName: "" });
    expect(splitContactName("   ")).toEqual({ firstName: "", lastName: "" });
    expect(splitContactName(null)).toEqual({ firstName: "", lastName: "" });
    expect(splitContactName(undefined)).toEqual({ firstName: "", lastName: "" });
  });

  it("keeps a hyphenated surname in one piece", () => {
    expect(splitContactName("Jo Smith-Jones")).toEqual({
      firstName: "Jo",
      lastName: "Smith-Jones",
    });
  });
});

describe("joinContactName", () => {
  it("recomposes what splitContactName took apart", () => {
    for (const name of ["Jane Smith", "Mary Jane Watson", "Cher", "Jo Smith-Jones"]) {
      const parts = splitContactName(name);
      expect(joinContactName(parts.firstName, parts.lastName)).toBe(name);
    }
  });

  it("collapses whitespace, exactly as the generated column does", () => {
    const parts = splitContactName("  Jane   Smith ");
    expect(joinContactName(parts.firstName, parts.lastName)).toBe("Jane Smith");
  });

  it("does not leave a trailing space when there is no last name", () => {
    expect(joinContactName("Cher", "")).toBe("Cher");
    expect(joinContactName("Cher", null)).toBe("Cher");
  });
});
