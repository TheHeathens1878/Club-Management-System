import { describe, expect, it } from "vitest";

import {
  matchClubTeam,
  widgetCodeLabels,
  widgetCodesFrom,
  parseWidgetDate,
  classifyFixtureRow,
  parseWidgetHtml,
  widgetCodeFrom,
  widgetHtmlFrom,
  widgetTeamName,
  widgetUrl,
  foldTeamName,
  resolveClubTeams,
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
    expect(page.fixtures.length).toBe(20);
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

describe("widgetCodeLabels", () => {
  it("reads a league name written before its code", () => {
    const labels = widgetCodeLabels("Timperley & District JFL: 885630049, SMGFL: 442066767");
    expect(labels.get("885630049")).toBe("Timperley & District JFL");
    expect(labels.get("442066767")).toBe("SMGFL");
  });

  it("accepts newline-separated pairs and dash separators", () => {
    const labels = widgetCodeLabels("South Manchester Girls FL – 442066767\nTimperley 885630049");
    expect(labels.get("442066767")).toBe("South Manchester Girls FL");
    expect(labels.get("885630049")).toBe("Timperley");
  });

  it("labels nothing for bare codes, URLs and pasted snippets", () => {
    expect(widgetCodeLabels("885630049, 442066767").size).toBe(0);
    expect(widgetCodeLabels("https://fulltime.thefa.com/js/cs1.html?cs=885630049").size).toBe(0);
    expect(
      widgetCodeLabels(`<div id="lrep885630049">…</div>\n<script>var lrcode = '885630049'</script>`).size,
    ).toBe(0);
  });

  it("keeps the first label when a code appears twice", () => {
    const labels = widgetCodeLabels("Timperley: 885630049, Other name: 885630049");
    expect(labels.get("885630049")).toBe("Timperley");
    expect(labels.size).toBe(1);
  });
});

/**
 * Adam, 2026-09-02: "I am only getting home fixtures from this snippet and
 * it's saying they are away", about Trafford United 2nd's Division Three
 * widget (code 60006558) and Trafford United's Division One one (25374225).
 *
 * Both leagues print a DIVISION CODE in the type column — "D3", "D1" — rather
 * than the bare letter the youth widgets use. The old reader classified cells
 * left to right and only recognised a type cell of one to three LETTERS, so
 * "D3" failed that test, became the first text on the row, and was taken for
 * the home team. Every home game arrived as an away game against "D3", and
 * every away game vanished, because the team's own name was then in neither
 * slot. The reader now anchors on the "v" instead.
 */
describe("a widget whose type column carries a division code", () => {
  const page = parseWidgetHtml(fixture("widget-team-60006558.html"));
  const mine = fixturesForTeam(page, "Trafford United 2nd");

  it("reads the row without mistaking the division code for a team", () => {
    expect(page.warnings).toEqual([]);
    const first = page.fixtures[0]!;
    expect(first.homeTeam).toBe("Trafford United 2nd");
    expect(first.awayTeam).toBe("South Manchester");
    expect(first.type).toBe("D3");
    expect(first.venue).toBe("ASHTON-ON-MERSEY SPORTS CLUB Pitch 2 Grass");
  });

  it("keeps the away fixtures, which used to be dropped altogether", () => {
    expect(mine.length).toBe(page.fixtures.length);
    expect(mine.some((f) => f.isHome)).toBe(true);
    expect(mine.some((f) => !f.isHome)).toBe(true);
  });

  it("puts the team on the right side of its own home games", () => {
    const home = mine.find((f) => f.opponent === "South Manchester" && f.venue?.startsWith("ASHTON"));
    expect(home?.isHome).toBe(true);
    const away = mine.find((f) => f.opponent === "Boothstown");
    expect(away?.isHome).toBe(false);
    expect(away?.venue).toBe("Bridgewater Park");
  });

  it("names the team the widget belongs to", () => {
    expect(widgetTeamName(page.fixtures)).toBe("Trafford United 2nd");
  });
});

describe("a widget mixing league, cup and friendly rows", () => {
  const page = parseWidgetHtml(fixture("widget-team-25374225.html"));
  const mine = fixturesForTeam(page, "Trafford United");

  it("reads a played friendly whose separator is the dash between the scores", () => {
    const friendly = page.fixtures[0]!;
    expect(friendly.type).toBe("FR");
    expect(friendly.homeTeam).toBe("AFC Oldham");
    expect(friendly.awayTeam).toBe("Trafford United");
    expect(friendly.homeScore).toBe(7);
    expect(friendly.awayScore).toBe(0);
    expect(friendly.status).toBe("played");
  });

  it("reads the league and cup rows either side of it", () => {
    expect(new Set(page.fixtures.map((f) => f.type))).toContain("D1");
    expect(mine.length).toBe(page.fixtures.length);
    expect(mine.some((f) => f.isHome)).toBe(true);
    expect(mine.some((f) => !f.isHome)).toBe(true);
  });
});

describe("classifyFixtureRow", () => {
  it("anchors on the separator, wherever the type column is", () => {
    expect(classifyFixtureRow(["D3", "Home FC", "", "v", "", "Away FC", "The Park"])).toEqual({
      type: "D3",
      homeTeam: "Home FC",
      awayTeam: "Away FC",
      venue: "The Park",
    });
  });

  it("reads scores that hug the separator", () => {
    expect(classifyFixtureRow(["L", "Home FC", "3", "v", "1", "Away FC", "The Park"])).toEqual({
      type: "L",
      homeTeam: "Home FC",
      awayTeam: "Away FC",
      homeScore: 3,
      awayScore: 1,
      venue: "The Park",
    });
  });

  it("takes a postponement marker but never a team name that looks like one", () => {
    expect(classifyFixtureRow(["L", "Home FC", "P", "v", "", "Away FC"]).cellStatus).toBe("postponed");
    // "Athletic P" is a side, not a status: it is the last thing standing on
    // its side of the separator, so it is the team.
    expect(classifyFixtureRow(["D1", "Athletic P", "v", "Away FC"]).homeTeam).toBe("Athletic P");
  });

  it("works with no type column at all", () => {
    expect(classifyFixtureRow(["Home FC", "v", "Away FC"])).toEqual({
      type: "",
      homeTeam: "Home FC",
      awayTeam: "Away FC",
    });
  });
});

describe("suppressed young-age-group scores (the U8 'X')", () => {
  it("peels a bare X off each side of the separator and records no score", () => {
    expect(
      classifyFixtureRow([
        "",
        "Ashton On Mersey FC U8 Sparrows Black",
        "X",
        "v",
        "X",
        "Altrincham FC Juniors U8 Girls Toucans",
        "Platt Lane Pitch 1",
      ]),
    ).toEqual({
      type: "",
      homeTeam: "Ashton On Mersey FC U8 Sparrows Black",
      awayTeam: "Altrincham FC Juniors U8 Girls Toucans",
      venue: "Platt Lane Pitch 1",
    });
  });

  it("accepts a joined 'X - X' as the separator itself", () => {
    expect(classifyFixtureRow(["Home FC", "X - X", "Away FC"])).toEqual({
      type: "",
      homeTeam: "Home FC",
      awayTeam: "Away FC",
    });
  });

  it("never swallows a team actually called X", () => {
    // The `> 1` guard: the last thing standing on a side is the team.
    expect(classifyFixtureRow(["X", "v", "Away FC"]).homeTeam).toBe("X");
  });

  it("parses the recorded U8 widget with real team names throughout", () => {
    const page = parseWidgetHtml(fixture("widget-league-611418289.html"));
    expect(page.fixtures.length).toBe(7);
    for (const f of page.fixtures) {
      expect(f.homeTeam).not.toMatch(/^x$/i);
      expect(f.awayTeam).not.toMatch(/^x$/i);
      expect(f.homeScore).toBeUndefined();
      expect(f.awayScore).toBeUndefined();
    }
  });

  it("names the widget's own team again, which is the whole diagnosis", () => {
    // The recording is the snippet Adam pasted for Sparrows Black on
    // 2026-09-02 — and it is actually the Toucans' widget; Sparrows Black is
    // in one row, as their opponent. Before this fix the suppressed scores
    // parsed as team names and verify reported the widget as belonging to
    // "X"; now it reports the truth, which tells the person exactly what to
    // fetch instead.
    const page = parseWidgetHtml(fixture("widget-league-611418289.html"));
    expect(widgetTeamName(page.fixtures)).toBe("Altrincham FC Juniors U8 Girls Toucans");
  });
});

describe("resolveClubTeams — two squads, one club record", () => {
  const clubTeams = ["U08 Sparrows Girls", "U14 Mavericks"];
  const prefix = "Ashton On Mersey FC";

  it("refuses a club team claimed by two squads, with a warning naming both", () => {
    const { assignments, warnings } = resolveClubTeams(
      [
        "Ashton On Mersey FC U8 Sparrows Black",
        "Ashton On Mersey FC U8 Sparrows Orange",
        "Timperley FC U8 Hammarby",
      ],
      clubTeams,
      prefix,
    );
    expect(assignments.size).toBe(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Sparrows Black");
    expect(warnings[0]).toContain("Sparrows Orange");
    expect(warnings[0]).toContain("U08 Sparrows Girls");
  });

  it("lets an exact name beat a squad-qualified one instead of tying with it", () => {
    const { assignments, warnings } = resolveClubTeams(
      ["Ashton On Mersey FC U14 Mavericks", "Ashton On Mersey FC U14 Mavericks Blue"],
      clubTeams,
      prefix,
    );
    expect(assignments.get(foldTeamName("Ashton On Mersey FC U14 Mavericks"))).toBe(
      "U14 Mavericks",
    );
    expect(assignments.get(foldTeamName("Ashton On Mersey FC U14 Mavericks Blue"))).toBeUndefined();
    expect(warnings).toHaveLength(1);
  });

  it("assigns a lone squad-qualified name exactly as before", () => {
    const { assignments, warnings } = resolveClubTeams(
      ["Ashton On Mersey FC U8 Sparrows Black", "Sale United U8 Foxes"],
      clubTeams,
      prefix,
    );
    expect(assignments.get(foldTeamName("Ashton On Mersey FC U8 Sparrows Black"))).toBe(
      "U08 Sparrows Girls",
    );
    expect(warnings).toHaveLength(0);
  });
});

describe("parseWidgetHtml on the recorded U13 Mambas widget (167003499)", () => {
  // Adam, 2026-09-04: "the snippet isn't importing County Cup games." The
  // County Cup row links to displayCountyFixture.html — a different page than
  // displayFixture.html — so before the fix its row had no recognised fixture
  // id, was mistaken for a heading, and vanished without even a warning.
  const page = parseWidgetHtml(fixture("widget-team-167003499.html"));

  it("keeps every game, the County Cup one included", () => {
    expect(page.warnings).toHaveLength(0);
    expect(page.fixtures).toHaveLength(13);
  });

  it("reads the County Cup game in full, on its own id space", () => {
    const cup = page.fixtures.find((f) => f.type === "CC");
    expect(cup).toBeDefined();
    expect(cup?.externalRef).toBe("county-30313824");
    expect(cup?.competition).toBe("County Cup");
    expect(cup?.date).toBe("2026-09-06");
    expect(cup?.time).toBe("10:00");
    expect(cup?.homeTeam).toBe("Ashton On Mersey FC U13 Mambas");
    expect(cup?.awayTeam).toBe("JFC Phoenix U13 Inferno");
    expect(cup?.status).toBe("scheduled");
  });

  it("leaves the league games' refs exactly as they were", () => {
    const league = page.fixtures.find((f) => f.date === "2026-09-05");
    expect(league?.externalRef).toBe("30717447");
    expect(league?.competition).toBeUndefined();
  });
});
