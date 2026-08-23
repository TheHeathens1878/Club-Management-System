/**
 * Reading and rebuilding Full-Time URLs.
 *
 * P2.3 asks a club admin to paste "the team's Full-Time URL" into a settings
 * screen, so this has to cope with whatever the browser address bar, an email
 * client or a WhatsApp message hands over: no scheme, a `www.` host, HTML-
 * escaped `&amp;` separators, a trailing full stop, wrapping angle brackets.
 * Anything that is genuinely not a Full-Time link fails with a message the
 * admin can act on.
 */

import { FullTimeUrlError } from "./errors.ts";

/** Which Full-Time page a URL points at. */
export type FullTimePageKind = "index" | "fixtures" | "results" | "table" | "team" | "unknown";

/** The identifiers a Full-Time URL can carry. */
export type FullTimeIds = {
  /**
   * The `league` parameter. Empty string for a bare `displayTeam.html?id=…`
   * link, which carries a team but no league — check `teamId` before assuming
   * a league is present.
   */
  leagueId: string;
  seasonId?: string;
  divisionId?: string;
  competitionId?: string;
  fixtureGroupKey?: string;
  teamId?: string;
  page: FullTimePageKind;
};

export const FULLTIME_ORIGIN = "https://fulltime.thefa.com";

const HOST_RE = /^(?:www\.)?full-?time(?:-league)?\.thefa\.com$/i;

const PAGE_BY_FILE: Record<string, FullTimePageKind> = {
  "index.html": "index",
  "fixtures.html": "fixtures",
  "results.html": "results",
  "table.html": "table",
  "displayteam.html": "team",
};

/** Query lookup that ignores parameter-name case, as Full-Time itself does. */
function param(params: URLSearchParams, name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const [key, value] of params) {
    if (key.toLowerCase() === wanted) {
      const trimmed = value.trim();
      if (trimmed !== "") return trimmed;
    }
  }
  return undefined;
}

/**
 * Strip the things that travel with a pasted link: surrounding whitespace and
 * brackets, HTML-escaped separators, and trailing sentence punctuation.
 */
function tidy(input: string): string {
  let value = input.trim();
  value = value.replace(/^[<("'\s]+/, "");
  // A URL copied out of page source arrives with `&amp;` between parameters.
  value = value.replace(/&amp;/gi, "&");
  // Anything after a space is not part of the URL (pasted alongside text).
  const space = value.search(/\s/);
  if (space !== -1) value = value.slice(0, space);
  // Closing brackets, quotes and sentence punctuation the link was wrapped in.
  value = value.replace(/[>)\]}"'.,;!]+$/, "");
  return value;
}

/**
 * Pull the identifiers out of any Full-Time URL.
 *
 * @throws {FullTimeUrlError} when the string is not a Full-Time URL, or is one
 * but carries no league or team identifier to work with.
 */
export function parseFullTimeUrl(url: string): FullTimeIds {
  if (typeof url !== "string" || url.trim() === "") {
    throw new FullTimeUrlError("Enter a Full-Time URL.", String(url ?? ""));
  }

  const tidied = tidy(url);
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(tidied) ? tidied : `https://${tidied}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new FullTimeUrlError(
      `That does not look like a web address: ${tidied}`,
      url,
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new FullTimeUrlError(
      "Full-Time links start with http:// or https://.",
      url,
    );
  }

  if (!HOST_RE.test(parsed.hostname)) {
    throw new FullTimeUrlError(
      `That is not a Full-Time address — expected a link on fulltime.thefa.com, got ${parsed.hostname}.`,
      url,
    );
  }

  const file = (parsed.pathname.split("/").pop() ?? "").toLowerCase();
  const page: FullTimePageKind =
    file === "" ? "index" : (PAGE_BY_FILE[file] ?? "unknown");

  const q = parsed.searchParams;
  const leagueId = param(q, "league") ?? "";
  const teamId =
    page === "team"
      ? (param(q, "id") ?? param(q, "teamID") ?? param(q, "selectedTeam"))
      : (param(q, "selectedTeam") ?? param(q, "teamID"));

  const ids: FullTimeIds = {
    leagueId,
    page,
    ...optional("seasonId", param(q, "selectedSeason")),
    ...optional("divisionId", param(q, "selectedDivision") ?? param(q, "divisionseason")),
    ...optional("competitionId", param(q, "selectedCompetition")),
    ...optional("fixtureGroupKey", param(q, "selectedFixtureGroupKey")),
    ...optional("teamId", teamId),
  };

  if (ids.leagueId === "" && ids.teamId === undefined) {
    throw new FullTimeUrlError(
      "That Full-Time link has no league or team in it — open the league, division or team page and copy the address from the browser.",
      url,
    );
  }

  return ids;
}

function optional<K extends string>(
  key: K,
  value: string | undefined,
): Record<K, string> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, string>);
}

function buildListUrl(
  file: "fixtures.html" | "results.html",
  ids: FullTimeIds,
  opts: { teamId?: string } = {},
): string {
  if (!ids.leagueId) {
    throw new FullTimeUrlError(
      "A Full-Time fixtures link needs a league id.",
      JSON.stringify(ids),
    );
  }
  const url = new URL(`${FULLTIME_ORIGIN}/${file}`);
  url.searchParams.set("league", ids.leagueId);
  if (ids.seasonId) url.searchParams.set("selectedSeason", ids.seasonId);
  if (ids.divisionId) url.searchParams.set("selectedDivision", ids.divisionId);
  // Full-Time always sends `selectedCompetition`, defaulting to 0 ("all").
  url.searchParams.set("selectedCompetition", ids.competitionId ?? "0");
  if (ids.fixtureGroupKey) url.searchParams.set("selectedFixtureGroupKey", ids.fixtureGroupKey);
  const teamId = opts.teamId ?? ids.teamId;
  if (teamId) url.searchParams.set("selectedTeam", teamId);
  return url.toString();
}

/** The canonical fixtures URL for a set of identifiers. */
export function buildFixturesUrl(ids: FullTimeIds, opts: { teamId?: string } = {}): string {
  return buildListUrl("fixtures.html", ids, opts);
}

/** The canonical results URL for a set of identifiers. */
export function buildResultsUrl(ids: FullTimeIds, opts: { teamId?: string } = {}): string {
  return buildListUrl("results.html", ids, opts);
}

/** The canonical team page URL for a team id. */
export function buildTeamUrl(teamId: string): string {
  if (!teamId) {
    throw new FullTimeUrlError("A Full-Time team link needs a team id.", teamId);
  }
  const url = new URL(`${FULLTIME_ORIGIN}/displayTeam.html`);
  url.searchParams.set("id", teamId);
  return url.toString();
}
