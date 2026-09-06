import { describe, expect, it } from "vitest";

import {
  PORTAL_COLUMNS,
  csvField,
  portalCells,
  portalCsv,
  portalDate,
  portalFileStem,
  portalSex,
  type PortalRow,
} from "@/lib/clubs-portal";

const kit: PortalRow = {
  team_name: "Under 11s",
  first_name: "Kit",
  last_name: "Child",
  dob: "2015-09-01",
  sex: "male",
  email: null,
  phone: null,
  age_proved: true,
  address: { line1: "1 Parent Road", town: "Sale", postcode: "M33 1AA" },
  contact1: {
    first_name: "Petra",
    last_name: "Parent",
    dob: "1984-05-05",
    sex: "female",
    email: "petra@test.invalid",
    address: { line1: "1 Parent Road", town: "Sale", county: "Cheshire", postcode: "M33 1AA" },
    phone: "07700 900001",
    relationship: "Mother",
    source: "linked",
  },
  contact2: null,
};

describe("the Portal spreadsheet", () => {
  it("has the columns Adam listed, in order, with the second contact after the first", () => {
    expect(PORTAL_COLUMNS.length).toBe(36);
    expect(PORTAL_COLUMNS.slice(0, 7)).toEqual([
      "Team",
      "Player first name",
      "Player last name",
      "Player date of birth",
      "Player sex",
      "Player email",
      "Age proved",
    ]);
    expect(PORTAL_COLUMNS[22]).toBe("Emergency contact mobile");
    expect(PORTAL_COLUMNS[24]).toBe("Emergency contact 2 first name");
  });

  it("fills a row cell for cell, blank where the club holds nothing", () => {
    const cells = portalCells(kit);
    expect(cells.length).toBe(PORTAL_COLUMNS.length);
    expect(cells.slice(0, 12)).toEqual([
      "Under 11s",
      "Kit",
      "Child",
      "01/09/2015",
      "Male",
      "",
      "Yes",
      "1 Parent Road",
      "",
      "Sale",
      "",
      "M33 1AA",
    ]);
    expect(cells.slice(12, 24)).toEqual([
      "Petra",
      "Parent",
      "05/05/1984",
      "Female",
      "petra@test.invalid",
      "1 Parent Road",
      "",
      "Sale",
      "Cheshire",
      "M33 1AA",
      "07700 900001",
      "Mother",
    ]);
    expect(cells.slice(24).every((cell) => cell === "")).toBe(true);
  });

  it("reads dates and sex the Portal's way", () => {
    expect(portalDate("2015-09-01")).toBe("01/09/2015");
    expect(portalDate("2015-09-01T00:00:00Z")).toBe("01/09/2015");
    expect(portalDate(null)).toBe("");
    expect(portalDate("nonsense")).toBe("");
    expect(portalSex("female")).toBe("Female");
    expect(portalSex(null)).toBe("");
  });

  it("escapes commas and quotes, and writes a BOM and CRLF", () => {
    expect(csvField('O"Brien, Kit')).toBe('"O""Brien, Kit"');
    const csv = portalCsv([kit]);
    expect(csv.startsWith("﻿Team,Player first name")).toBe(true);
    expect(csv.split("\r\n").length).toBe(3);
  });

  it("names the download after the teams", () => {
    expect(portalFileStem(["CP Under 11s", "CP Ladies"])).toBe("cp-under-11s-cp-ladies");
    expect(portalFileStem([])).toBe("clubs-portal");
  });
});
