import { describe, expect, it } from "vitest";

import { parseWidgetDate, parseWidgetHtml, widgetCodeFrom, widgetHtmlFrom, widgetUrl } from "../src/widget.ts";
import { fixturesForTeam } from "../src/team.ts";
import { fixture } from "./helpers.ts";

describe("widget snippet helpers", () => {
  it("reads the code from a pasted snippet or a bare code", () => {
    const snippet = `<div id="lrep728576966" style="width: 350px;">Data loading....</div>
<script language="javascript" type="text/javascript">
var lrcode = '728576966'
</script>
<script language="Javascript" type="text/javascript" src="https://fulltime.thefa.com/client/api/cs1.js"></script>`;
    expect(widgetCodeFrom(snippet)).toBe("728576966");
    expect(widgetCodeFrom("  24198659 ")).toBe("24198659");
    expect(widgetCodeFrom("hello")).toBeUndefined();
    expect(widgetUrl("728576966")).toBe("https://fulltime.thefa.com/js/cs1.html?cs=728576966");
  });

  it("unwraps the cs1.html JavaScript envelope", () => {
    expect(widgetHtmlFrom("document.getElementById('lrep1').innerHTML = '<table><tr><td>x</td></tr></table>';")).toBe(
      "<table><tr><td>x</td></tr></table>",
    );
    expect(widgetHtmlFrom("<table></table>")).toBe("<table></table>");
  });

  it("parses widget date rows", () => {
    expect(parseWidgetDate("Sun 06 Sept 2026 10:00")).toEqual({ date: "2026-09-06", time: "10:00" });
    expect(parseWidgetDate("Sat 1 Feb 2027")).toEqual({ date: "2027-02-01" });
    expect(parseWidgetDate("Data loading....")).toBeUndefined();
  });
});

describe("parseWidgetHtml on a recorded team widget", () => {
  const page = parseWidgetHtml(fixture("widget-team-728576966.html"));

  it("reads every fixture row with the FA fixture id as the external ref", () => {
    expect(page.warnings).toEqual([]);
    expect(page.fixtures.length).toBeGreaterThan(10);
    const first = page.fixtures[0]!;
    expect(first).toMatchObject({
      externalRef: "30540038",
      type: "L",
      date: "2026-09-06",
      time: "10:00",
      kickoffAt: "2026-09-06T09:00:00.000Z",
      homeTeam: "Ashton On Mersey FC U14 Mavericks",
      awayTeam: "Cheadle & Gatley Junior U14 Hurricanes",
      status: "scheduled",
      venue: "DAINEWELL PARK",
    });
    expect(new Set(page.fixtures.map((f) => f.externalRef)).size).toBe(page.fixtures.length);
  });

  it("keeps fixtures in date order and all belong to the team", () => {
    const dates = page.fixtures.map((f) => f.kickoffAt);
    expect([...dates].sort()).toEqual(dates);
    const mine = fixturesForTeam(page, "Ashton On Mersey FC U14 Mavericks");
    expect(mine.length).toBe(page.fixtures.length);
    expect(mine.some((f) => f.isHome)).toBe(true);
    expect(mine.some((f) => !f.isHome)).toBe(true);
  });
});
