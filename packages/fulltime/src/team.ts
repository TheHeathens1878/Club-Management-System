/**
 * Picking one club's fixtures out of a whole division's page.
 *
 * Full-Time's `selectedTeam` filter would do this server-side, but every extra
 * request is another step towards a Cloudflare challenge (see `fetch.ts`), so
 * fetching a division once and filtering locally is both kinder and more
 * robust.
 */

import type { ParsedFixture, ParsedPage, TeamFixture } from "./types";

/**
 * A team name reduced to what can be compared: case folded, Unicode
 * normalised, whitespace collapsed, curly apostrophes straightened.
 *
 * Nothing else is stripped. "Angel F.C." and "Angel FC" stay different names,
 * because guessing that they are the same club is the importer's job — with a
 * human confirming it in the P2.3 preview — not the parser's.
 */
export function normaliseTeamName(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** True when two team names refer to the same team as far as we can tell. */
export function sameTeam(a: string, b: string): boolean {
  const left = normaliseTeamName(a);
  return left !== "" && left === normaliseTeamName(b);
}

/**
 * Every fixture on the page involving `teamName`, annotated with which side
 * the team is on and who they are playing.
 */
export function fixturesForTeam(parsed: ParsedPage, teamName: string): TeamFixture[] {
  const wanted = normaliseTeamName(teamName);
  if (wanted === "") return [];

  const result: TeamFixture[] = [];
  for (const fixture of parsed.fixtures) {
    const isHome = normaliseTeamName(fixture.homeTeam) === wanted;
    const isAway = normaliseTeamName(fixture.awayTeam) === wanted;
    if (!isHome && !isAway) continue;
    result.push({
      ...fixture,
      isHome,
      opponent: isHome ? fixture.awayTeam : fixture.homeTeam,
    });
  }
  return result;
}

/** Every distinct team name appearing in a page's fixtures, sorted. */
export function teamNamesIn(fixtures: ParsedFixture[]): string[] {
  const seen = new Map<string, string>();
  for (const fixture of fixtures) {
    for (const name of [fixture.homeTeam, fixture.awayTeam]) {
      const key = normaliseTeamName(name);
      if (key !== "" && !seen.has(key)) seen.set(key, name);
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, "en-GB"));
}
