import { describe, expect, it } from "vitest";

import { attributeOf, decodeEntities, extractTables, hrefsIn, selectOptions, textOf } from "../src/html.ts";

describe("decodeEntities / textOf", () => {
  it("decodes the entities Full-Time actually emits", () => {
    expect(decodeEntities("Winchester &amp; District")).toBe("Winchester & District");
    expect(decodeEntities("St Mary&#39;s")).toBe("St Mary's");
    expect(decodeEntities("St Mary&#x27;s")).toBe("St Mary's");
    expect(decodeEntities("&notanentity;")).toBe("&notanentity;");
  });

  it("collapses the tabs, newlines and non-breaking spaces in a cell", () => {
    expect(textOf('\n\t<span class="spacer-right">10/05/26</span> <span>10:30</span>\n')).toBe(
      "10/05/26 10:30",
    );
  });
});

describe("attributeOf", () => {
  it("reads quoted, single-quoted and bare attributes", () => {
    expect(attributeOf('<td class="home-team right">', "class")).toBe("home-team right");
    expect(attributeOf("<td class='score'>", "class")).toBe("score");
    expect(attributeOf("<td colspan=8>", "colspan")).toBe("8");
    expect(attributeOf("<td>", "class")).toBeUndefined();
  });

  it("does not match an attribute name that is only a suffix of another", () => {
    expect(attributeOf('<a data-href="/x" href="/y">', "href")).toBe("/y");
  });
});

describe("selectOptions", () => {
  it("reads values, labels and the selected flag", () => {
    const html = `<select name="selectedSeason" id="s">
      <option value="1">2024-25</option>
      <option value="2" selected="selected">2025-26</option>
    </select>`;
    expect(selectOptions(html, "selectedSeason")).toEqual([
      { value: "1", label: "2024-25", selected: false },
      { value: "2", label: "2025-26", selected: true },
    ]);
  });

  it("does not confuse one select's name for another's", () => {
    const html = `<select name="selectedSeasonGroup"><option value="9">nope</option></select>
      <select name="selectedSeason"><option value="1">yes</option></select>`;
    expect(selectOptions(html, "selectedSeason")).toEqual([
      { value: "1", label: "yes", selected: false },
    ]);
    expect(selectOptions(html, "selectedTeam")).toEqual([]);
  });
});

describe("extractTables", () => {
  it("keeps a nested table inside its parent instead of reporting it twice", () => {
    const html = "<table><tr><td><table><tr><td>inner</td></tr></table></td></tr></table>";
    const tables = extractTables(html);
    expect(tables).toHaveLength(1);
    expect(tables[0]?.html).toContain("inner");
  });

  it("survives a table that is never closed", () => {
    expect(() => extractTables("<table><tr><td>x</td></tr>")).not.toThrow();
  });
});

describe("hrefsIn", () => {
  it("collects every link in a fragment, decoded", () => {
    expect(hrefsIn('<a href="/a.html?x=1&amp;y=2">one</a><a href="/b">two</a>')).toEqual([
      "/a.html?x=1&y=2",
      "/b",
    ]);
  });
});
