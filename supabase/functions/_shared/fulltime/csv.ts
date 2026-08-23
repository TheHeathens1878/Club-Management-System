/**
 * The manual fallback PLAN.md §3 Q2 insists on: "always keep a manual
 * paste/CSV fallback working".
 *
 * Full-Time is an unofficial integration. When the FA changes their markup, or
 * Cloudflare shuts us out for a week, a club secretary must still be able to
 * get the season's fixtures into the platform — from the CSV Full-Time itself
 * exports, or from a spreadsheet they typed by hand. So this accepts the
 * columns in any order, under any of the names people actually use, and tells
 * you which rows it could not read instead of refusing the file.
 */

import { stableExternalRef } from "./ref.ts";
import { londonToInstant, parseAnyDate, parseClockTime } from "./time.ts";
import type { FixtureStatus, ParsedFixture, ParsedPage } from "./types.ts";

/** Header names we accept for each field, after lower-casing and de-punctuating. */
const HEADER_ALIASES: Record<string, readonly string[]> = {
  date: ["date", "matchdate", "kickoffdate", "fixturedate", "day"],
  time: ["time", "ko", "kickoff", "kickofftime", "starttime", "start"],
  home: ["home", "hometeam", "hometeamname", "hometeamn"],
  away: ["away", "awayteam", "roadteam", "awayteamname"],
  competition: ["competition", "comp", "league", "cup"],
  venue: ["venue", "ground", "location", "pitch"],
  status: ["status", "fixturestatus", "state"],
  type: ["type", "fixturetype"],
  score: ["score", "result"],
  homescore: ["homescore", "homegoals", "goalsfor"],
  awayscore: ["awayscore", "awaygoals", "goalsagainst"],
  externalref: ["externalref", "fixtureid", "id", "ref"],
};

const STATUS_ALIASES: ReadonlyArray<readonly [RegExp, FixtureStatus]> = [
  [/^(played|complete[d]?|result|finished|ft)$/i, "played"],
  [/^(postponed|postp|p-p|pp)$/i, "postponed"],
  [/^(cancelled|canceled|canx|void)$/i, "cancelled"],
  [/^(abandoned|aband)$/i, "abandoned"],
  [/^(scheduled|fixture|upcoming|tbc|to be played)$/i, "scheduled"],
];

/** The byte-order mark Excel puts at the start of a CSV it saves. */
const BOM = String.fromCharCode(0xfeff);

function normaliseHeader(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

/**
 * Split CSV text into rows of fields.
 *
 * Handles quoted fields, doubled quotes inside them, embedded commas and
 * newlines, CRLF, and a leading byte-order mark — everything Excel produces.
 */
export function parseCsvRows(csv: string): string[][] {
  const text = csv.startsWith(BOM) ? csv.slice(1) : csv;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let index = 0;

  const endField = (): void => {
    row.push(field);
    field = "";
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  while (index < text.length) {
    const char = text[index] as string;

    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === '"' && field.trim() === "") {
      quoted = true;
      field = "";
      index += 1;
      continue;
    }
    if (char === ",") {
      endField();
      index += 1;
      continue;
    }
    if (char === "\r") {
      index += 1;
      continue;
    }
    if (char === "\n") {
      endRow();
      index += 1;
      continue;
    }
    field += char;
    index += 1;
  }

  if (field !== "" || row.length > 0) endRow();
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

function scoreOf(value: string): { home: number; away: number } | undefined {
  const m = /^(\d{1,3})\s*[-–—:]\s*(\d{1,3})$/.exec(value.trim());
  if (!m) return undefined;
  return { home: Number(m[1]), away: Number(m[2]) };
}

/**
 * Parse a fixtures CSV into the same shape the HTML parser produces, so the
 * importer downstream of it cannot tell which one it is looking at.
 *
 * A header row is required — the columns are identified by name, never by
 * position, because "the third column" is exactly the kind of assumption that
 * silently swaps home and away teams.
 */
export function parseCsvFixtures(csv: string): ParsedPage {
  const warnings: string[] = [];
  const fixtures: ParsedFixture[] = [];
  const rows = parseCsvRows(csv);

  const headerRow = rows[0];
  if (!headerRow) {
    return {
      seasons: [],
      teams: [],
      fixtures,
      warnings: ["The CSV was empty."],
    };
  }

  const columns = new Map<string, number>();
  headerRow.forEach((label, index) => {
    const key = normaliseHeader(label);
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(key) && !columns.has(field)) columns.set(field, index);
    }
  });

  const missing = (["date", "home", "away"] as const).filter((field) => !columns.has(field));
  if (missing.length > 0) {
    return {
      seasons: [],
      teams: [],
      fixtures,
      warnings: [
        `The CSV needs a header row with ${missing.join(", ")} column${
          missing.length > 1 ? "s" : ""
        }. Found: ${headerRow.map((h) => h.trim()).join(", ")}`,
      ],
    };
  }

  const read = (cells: readonly string[], field: string): string => {
    const index = columns.get(field);
    if (index === undefined) return "";
    return (cells[index] ?? "").trim();
  };

  rows.slice(1).forEach((cells, offset) => {
    const lineNumber = offset + 2;
    const rawDate = read(cells, "date");
    const homeTeam = read(cells, "home");
    const awayTeam = read(cells, "away");
    const date = parseAnyDate(rawDate);

    if (date === undefined || homeTeam === "" || awayTeam === "") {
      warnings.push(
        `Line ${lineNumber}: need a date, a home team and an away team — got ${JSON.stringify(
          [rawDate, homeTeam, awayTeam].join(", "),
        )}.`,
      );
      return;
    }

    const time = parseClockTime(read(cells, "time"));
    const rawTime = read(cells, "time");
    if (rawTime !== "" && time === undefined) {
      warnings.push(`Line ${lineNumber}: ignoring "${rawTime}", which is not a kick-off time.`);
    }

    const combined = scoreOf(read(cells, "score"));
    const homeScoreText = read(cells, "homescore");
    const awayScoreText = read(cells, "awayscore");
    const homeScore =
      combined?.home ?? (/^\d{1,3}$/.test(homeScoreText) ? Number(homeScoreText) : undefined);
    const awayScore =
      combined?.away ?? (/^\d{1,3}$/.test(awayScoreText) ? Number(awayScoreText) : undefined);

    const rawStatus = read(cells, "status");
    let status: FixtureStatus | undefined;
    for (const [pattern, value] of STATUS_ALIASES) {
      if (pattern.test(rawStatus)) {
        status = value;
        break;
      }
    }
    if (rawStatus !== "" && status === undefined) {
      warnings.push(`Line ${lineNumber}: unrecognised status "${rawStatus}", treating as scheduled.`);
    }
    if (status === undefined) {
      status = homeScore !== undefined && awayScore !== undefined ? "played" : "scheduled";
    }

    const competition = read(cells, "competition");
    const venue = read(cells, "venue");
    const externalRef = read(cells, "externalref");

    fixtures.push({
      externalRef: stableExternalRef({
        ...(externalRef === "" ? {} : { externalRef }),
        date,
        homeTeam,
        awayTeam,
        ...(competition === "" ? {} : { competition }),
      }),
      type: read(cells, "type").toUpperCase(),
      kickoffAt: londonToInstant(date, time ?? "00:00"),
      date,
      ...(time === undefined ? {} : { time }),
      homeTeam,
      awayTeam,
      ...(homeScore === undefined ? {} : { homeScore }),
      ...(awayScore === undefined ? {} : { awayScore }),
      status,
      ...(competition === "" ? {} : { competition }),
      ...(venue === "" ? {} : { venue }),
      raw: cells.join(","),
    });
  });

  return { seasons: [], teams: [], fixtures, warnings };
}
