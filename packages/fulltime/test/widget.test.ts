import { describe, expect, it } from "vitest";

import {
  matchClubTeam,
  widgetCodesFrom,
  parseWidgetDate,
  parseWidgetHtml,
  widgetCodeFrom,
  widgetHtmlFrom,
  widgetTeamName,
  widgetUrl,
} from "../src/widget.ts";
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

describe("widget additions", () => {
  it("undoes JavaScript string escapes in the envelope", () => {
    const body =
      "document.getElementById('lrep1').innerHTML = '<a href=\"https:\\/\\/x\">St Mary\\'s\\tFC<\\/a>\\n';";
    expect(widgetHtmlFrom(body)).toBe('<a href="https://x">St Mary\'s\tFC</a>\n');
  });

  it("names the team the widget was generated for", () => {
    const page = parseWidgetHtml(fixture("widget-team-728576966.html"));
    expect(widgetTeamName(page.fixtures)).toBe("Ashton On Mersey FC U14 Mavericks");
    expect(widgetTeamName([])).toBeUndefined();
    // A division widget: nobody is in every row.
    const [a, b] = page.fixtures;
    expect(widgetTeamName([{ ...a!, homeTeam: "X", awayTeam: "Y" }, b!])).toBeUndefined();
  });

  it("reads a played result with scores", () => {
    const html = `<table><tr><td colspan="7">Sun 06 Sept 2026 10:00</td></tr>
<tr><td><a href="https://fulltime.thefa.com/displayFixture.html?id=1">L</a></td><td>Home FC</td><td>3</td><td>-</td><td>1</td><td>Away FC</td><td>PARK</td></tr>
<tr><td colspan="7">Sun 13 Sept 2026 10:00</td></tr>
<tr><td><a href="https://fulltime.thefa.com/displayFixture.html?id=2">L</a></td><td>Home FC</td><td></td><td>P</td><td></td><td>Away FC</td><td>PARK</td></tr>
</table>`;
    const page = parseWidgetHtml(html);
    expect(page.warnings).toEqual([]);
    expect(page.fixtures.map((f) => [f.externalRef, f.status, f.homeScore, f.awayScore])).toEqual([
      ["1", "played", 3, 1],
      ["2", "postponed", undefined, undefined],
    ]);
  });
});

describe("club widgets", () => {
  const page = parseWidgetHtml(fixture("widget-club-885630049.html"));

  it("reads the whole club's fixtures from the five-cell club variant", () => {
    expect(page.fixtures.length).toBeGreaterThan(150);
    // Undated "Postponed" groups are reported once, not per row; the only
    // other warning in this recording is a real notice row the league posted.
    expect(page.warnings).toEqual([
      "Could not read a date row: All Cheshire East pitches closed until 20/9 due to weather",
      "5 fixtures under a Postponed heading had no kick-off date and were left as previously imported.",
    ]);
    const mavs = fixturesForTeam(page, "Ashton On Mersey FC U14 Mavericks");
    expect(mavs.length).toBeGreaterThan(15);
    expect(new Set(page.fixtures.map((f) => f.externalRef)).size).toBe(page.fixtures.length);
    const first = page.fixtures[0]!;
    expect(first.date).toBe("2026-09-06");
    expect(first.time).toBe("10:00");
    expect(first.homeScore).toBeUndefined();
    // A club feed names no single team.
    expect(widgetTeamName(page.fixtures)).toBeUndefined();
  });

  it("treats an empty club results widget as nothing to show", () => {
    const empty = parseWidgetHtml(fixture("widget-club-noresults.html"));
    expect(empty.fixtures).toEqual([]);
    expect(empty.warnings).toEqual([]);
  });

  it("matches widget team names onto the club's own short names", () => {
    const clubTeams = ["U14 Mavericks", "U13 Dragons", "U14 Bulls"];
    expect(matchClubTeam("Ashton On Mersey FC U14 Mavericks", clubTeams)).toBe("U14 Mavericks");
    expect(matchClubTeam("Ashton On Mersey FC U13 Dragons", clubTeams)).toBe("U13 Dragons");
    expect(matchClubTeam("Cheadle & Gatley Junior U14 Hurricanes", clubTeams)).toBeUndefined();
    // Ambiguity is refused, not guessed.
    expect(matchClubTeam("Ashton On Mersey FC U14 Mavericks", ["U14 Mavericks", "Mavericks"])).toBeUndefined();
  });

  it("keeps club fixtures assignable to their team side", () => {
    const clubTeams = ["U14 Mavericks"];
    const prefix = "Ashton On Mersey FC";
    const mine = page.fixtures.filter(
      (f) =>
        matchClubTeam(f.homeTeam, clubTeams, prefix) !== undefined ||
        matchClubTeam(f.awayTeam, clubTeams, prefix) !== undefined,
    );
    expect(mine.length).toBeGreaterThan(15);
  });

  it("anchored on the club name, another club's identical suffix is refused", () => {
    const clubTeams = ["U14 Mavericks", "U14 Pythons"];
    const prefix = "Ashton On Mersey FC";
    // The live bug of 2026-08-23: this is AFC Urmston Meadowside's team, not ours.
    expect(matchClubTeam("AFC Urmston Meadowside U14 Mavericks", clubTeams, prefix)).toBeUndefined();
    expect(matchClubTeam("Ashton On Mersey FC U14 Mavericks", clubTeams, prefix)).toBe("U14 Mavericks");
  });

  it("folds ages, squad qualifiers and a Girls section marker", () => {
    const prefix = "Ashton On Mersey FC";
    const girls = ["U08 Sparrows Girls", "U14 Ravens Girls", "U13 Tigers Girls", "U06 Tigers"];
    expect(matchClubTeam("Ashton On Mersey FC U8 Sparrows Orange", girls, prefix)).toBe("U08 Sparrows Girls");
    expect(matchClubTeam("Ashton On Mersey FC U8 Sparrows Black", girls, prefix)).toBe("U08 Sparrows Girls");
    expect(matchClubTeam("Ashton On Mersey FC U14 Ravens", girls, prefix)).toBe("U14 Ravens Girls");
    expect(matchClubTeam("Ashton On Mersey FC U13 Tigers", girls, prefix)).toBe("U13 Tigers Girls");
    expect(matchClubTeam("Timperley FC U8 Hammarby", girls, prefix)).toBeUndefined();
  });

  it("reads the recorded girls-league club widget onto girls teams", () => {
    const girlsPage = parseWidgetHtml(fixture("widget-club-girls-442066767.html"));
    expect(girlsPage.fixtures.length).toBeGreaterThan(40);
    const teams = ["U08 Sparrows Girls", "U14 Ravens Girls", "U11 Foxes Girls"];
    const prefix = "Ashton On Mersey FC";
    const claimed = new Map<string, number>();
    for (const f of girlsPage.fixtures) {
      for (const side of [f.homeTeam, f.awayTeam]) {
        const team = matchClubTeam(side, teams, prefix);
        if (team) claimed.set(team, (claimed.get(team) ?? 0) + 1);
      }
    }
    expect(claimed.get("U08 Sparrows Girls")).toBeGreaterThanOrEqual(14); // both squads fold in
    expect(claimed.get("U14 Ravens Girls")).toBe(2);
    expect(claimed.get("U11 Foxes Girls")).toBeGreaterThanOrEqual(8);
  });

  it("finds every widget code in a multi-snippet paste", () => {
    const paste = `<div id="lrep885630049">…</div>
<script>var lrcode = '885630049'</script>
<div id="lrep442066767">…</div>
<script>var lrcode = '442066767'</script>`;
    expect(widgetCodesFrom(paste)).toEqual(["885630049", "442066767"]);
    expect(widgetCodesFrom("885630049 442066767")).toEqual(["885630049", "442066767"]);
    expect(widgetCodesFrom("nothing here")).toEqual([]);
  });
});
