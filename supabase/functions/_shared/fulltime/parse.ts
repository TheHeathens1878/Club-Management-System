/**
 * Reading fixtures and results out of a Full-Time page.
 *
 * The contract that matters for P2.4: **this never throws on bad markup**. A
 * row we cannot read becomes a string in `warnings`, the rows around it still
 * parse, and the importer gets both a usable import and a breakage signal to
 * alert the admin with. An exception here would turn one changed `<td>` into a
 * silent, total import failure.
 *
 * Cell identification is class-driven first (`home-team`, `road-team`,
 * `score`) and only falls back to column headers when the header row lines up
 * one-to-one with the body cells — Full-Time's own tables use `colspan` in
 * `<thead>`, so index-based header mapping is wrong for them and right for the
 * simpler tables an admin might save out of a spreadsheet.
 */

import { isChallengeHtml } from "./fetch.ts";
import {
  extractTables,
  hrefsIn,
  selectOptions,
  type HtmlCell,
  type HtmlRow,
  type HtmlTable,
} from "./html.ts";
import { fixtureIdFromHref, stableExternalRef } from "./ref.ts";
import { londonToInstant, parseClockTime, parseUkDate } from "./time.ts";
import type {
  FixtureStatus,
  ParseOptions,
  ParsedFixture,
  ParsedPage,
  ParsedSeason,
  ParsedTeam,
} from "./types.ts";

const DATE_TOKEN = /(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})/;
const TIME_TOKEN = /\b(\d{1,2}:\d{2})\b/;
const SCORE_TOKEN = /(\d{1,3})\s*[-–—]\s*(\d{1,3})/;
const TYPE_TOKEN = /^[A-Za-z]{1,3}$/;

const STATUS_PATTERNS: ReadonlyArray<readonly [RegExp, FixtureStatus]> = [
  [/abandon/i, "abandoned"],
  [/cancell?ed|\bcanx\b|\bvoid\b/i, "cancelled"],
  [/postpon|\bpostp\b|(?:^|\s)p\s*-\s*p(?:\s|$)|(?:^|\s)pp(?:\s|$)/i, "postponed"],
];

/** The status word a cell contains, if any. */
function statusIn(text: string): FixtureStatus | undefined {
  for (const [pattern, status] of STATUS_PATTERNS) {
    if (pattern.test(text)) return status;
  }
  return undefined;
}

function classIncludes(className: string, ...needles: string[]): boolean {
  return needles.some((needle) => className.includes(needle));
}

/** A table worth looking at for fixtures. */
function isFixtureTable(table: HtmlTable): boolean {
  if (/displayFixture\.html/i.test(table.html)) return true;
  if (/class\s*=\s*["'][^"']*(?:home-team|road-team|away-team)/i.test(table.html)) return true;
  const headers = table.headers.join(" ");
  return headers.includes("home") && (headers.includes("away") || headers.includes("road"));
}

/** True for a table that is explicitly telling us there is nothing to show. */
function saysNothingToShow(table: HtmlTable): boolean {
  const text = table.rows.map((row) => row.text).join(" ");
  return /\bno\s+(fixtures|results|matches|games)\b/i.test(text);
}

/**
 * Column index by header label, but only when the header row lines up with the
 * body. Full-Time's own `<thead>` uses `colspan`, which makes index mapping
 * lie; refusing to map at all is better than mapping wrongly.
 */
function headerIndex(table: HtmlTable, dataCellCount: number): Map<string, number> {
  const map = new Map<string, number>();
  if (table.headers.length === 0 || table.headers.length !== dataCellCount) return map;
  table.headers.forEach((label, index) => {
    const key = label.replace(/[^a-z]/g, "");
    if (key !== "" && !map.has(key)) map.set(key, index);
  });
  return map;
}

function cellByHeader(
  cells: readonly HtmlCell[],
  headers: Map<string, number>,
  ...labels: string[]
): HtmlCell | undefined {
  for (const label of labels) {
    const index = headers.get(label);
    if (index !== undefined) {
      const cell = cells[index];
      if (cell) return cell;
    }
  }
  return undefined;
}

type RowOutcome =
  | { ok: true; fixture: ParsedFixture }
  | { ok: false; skip: true }
  | { ok: false; skip?: false; warning: string };

function truncate(value: string, max = 200): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function parseRow(row: HtmlRow, table: HtmlTable): RowOutcome {
  const cells = row.cells.filter((cell) => cell.tag === "td");
  // Grouping rows ("Saturday 6 September") and spacers carry one or two cells;
  // they are layout, not a fixture we failed to read.
  if (cells.length < 3) return { ok: false, skip: true };

  const headers = headerIndex(table, cells.length);

  const homeCell =
    cells.find((cell) => classIncludes(cell.className, "home-team")) ??
    cellByHeader(cells, headers, "hometeam", "home");
  const awayCell =
    cells.find((cell) => classIncludes(cell.className, "road-team", "away-team")) ??
    cellByHeader(cells, headers, "awayteam", "away", "roadteam");

  const dateIndex = cells.findIndex((cell) => DATE_TOKEN.test(cell.text));
  const dateCell =
    (dateIndex === -1 ? undefined : cells[dateIndex]) ??
    cellByHeader(cells, headers, "datetime", "date");

  const scoreCell =
    cells.find((cell) => classIncludes(cell.className, "score")) ??
    cellByHeader(cells, headers, "score", "result");
  const statusCell = cellByHeader(cells, headers, "status");
  const venueCell =
    cells.find((cell) => classIncludes(cell.className, "venue", "ground", "location")) ??
    cellByHeader(cells, headers, "venue", "ground", "location", "pitch");
  const competitionCell =
    cells.find((cell) => classIncludes(cell.className, "competition")) ??
    cellByHeader(cells, headers, "competition", "comp");

  const homeTeam = homeCell?.text ?? "";
  const awayTeam = awayCell?.text ?? "";
  const dateText = dateCell?.text ?? "";
  const date = parseUkDate(DATE_TOKEN.exec(dateText)?.[1] ?? "");

  if (date === undefined || homeTeam === "" || awayTeam === "") {
    return { ok: false, warning: `Could not read a fixture row: ${truncate(row.text)}` };
  }

  const scoreText = scoreCell?.text ?? "";
  const statusText = `${scoreText} ${statusCell?.text ?? ""}`;

  let status: FixtureStatus = statusIn(statusText) ?? "scheduled";
  let homeScore: number | undefined;
  let awayScore: number | undefined;

  // "P - P" is a postponement, not a nil-nil, so only digits count as a score.
  const score = SCORE_TOKEN.exec(scoreText);
  if (score) {
    homeScore = Number(score[1]);
    awayScore = Number(score[2]);
    if (status === "scheduled") status = "played";
  }

  // Kick-off time sits in the date cell on team and results pages, and in the
  // score cell on a fixtures page for a match that has not been played.
  const time =
    parseClockTime(TIME_TOKEN.exec(dateText)?.[1] ?? "") ??
    (homeScore === undefined ? parseClockTime(TIME_TOKEN.exec(scoreText)?.[1] ?? "") : undefined);

  const typeCell = cells.find(
    (cell, index) => (dateIndex === -1 || index < dateIndex) && TYPE_TOKEN.test(cell.text),
  );
  const type = (cellByHeader(cells, headers, "type")?.text ?? typeCell?.text ?? "").toUpperCase();

  const fixtureId = hrefsIn(row.html)
    .map(fixtureIdFromHref)
    .find((id): id is string => id !== undefined);

  const competition = competitionCell?.text;
  const venue = venueCell?.text;

  const fixture: ParsedFixture = {
    externalRef: stableExternalRef({
      ...(fixtureId === undefined ? {} : { externalRef: fixtureId }),
      date,
      homeTeam,
      awayTeam,
      ...(competition ? { competition } : {}),
    }),
    type,
    // No time on the page means no kick-off was published; midnight London is
    // the honest placeholder, and `time` being absent is how a caller tells.
    kickoffAt: londonToInstant(date, time ?? "00:00"),
    date,
    ...(time === undefined ? {} : { time }),
    homeTeam,
    awayTeam,
    ...(homeScore === undefined ? {} : { homeScore }),
    ...(awayScore === undefined ? {} : { awayScore }),
    status,
    ...(competition ? { competition } : {}),
    ...(venue ? { venue } : {}),
    raw: row.text,
  };

  return { ok: true, fixture };
}

/**
 * Parse a Full-Time fixtures, results, league-home or team page.
 *
 * All four use the same row markup, so one parser covers them; which page it
 * is only changes which of `seasons`, `teams` and `fixtures` come back
 * populated.
 */
export function parseFixturesPage(html: string, opts: ParseOptions = {}): ParsedPage {
  // Named so the Europe/London assumption is visible at the call site. The FA
  // publishes London wall clock on every page, so there is nothing else to
  // honour here — but a caller that believes otherwise should say so out loud.
  void opts.timeZone;

  const warnings: string[] = [];

  if (isChallengeHtml(html)) {
    warnings.push(
      "Full-Time returned a Cloudflare challenge page instead of fixtures - back off and retry later.",
    );
    return { seasons: [], teams: [], fixtures: [], warnings };
  }

  const seasons: ParsedSeason[] = selectOptions(html, "selectedSeason")
    .filter((option) => option.value !== "")
    .map((option) => ({ id: option.value, name: option.label, selected: option.selected }));

  const teams: ParsedTeam[] = selectOptions(html, "selectedTeam")
    .filter((option) => option.value !== "" && option.label !== "")
    .map((option) => ({ id: option.value, name: option.label }));

  const fixtures: ParsedFixture[] = [];

  for (const table of extractTables(html)) {
    if (!isFixtureTable(table)) continue;

    let dataRows = 0;
    let parsedRows = 0;
    let tableWarnings = 0;

    for (const row of table.rows) {
      if (row.text === "") continue;
      if (row.cells.length > 0 && row.cells.every((cell) => cell.tag === "th")) continue;
      dataRows += 1;
      const outcome = parseRow(row, table);
      if (outcome.ok) {
        fixtures.push(outcome.fixture);
        parsedRows += 1;
      } else if (!outcome.skip) {
        warnings.push(outcome.warning);
        tableWarnings += 1;
      }
    }

    // A table that looks like fixtures but yielded nothing is the shape of
    // breakage P2.4 needs to hear about - unless it is simply saying so.
    if (dataRows > 0 && parsedRows === 0 && tableWarnings === 0 && !saysNothingToShow(table)) {
      warnings.push("Found a fixtures table but could not read any rows from it.");
    }
  }

  return { seasons, teams, fixtures, warnings };
}
