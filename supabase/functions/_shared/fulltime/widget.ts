/**
 * The Full-Time embed widget — the import source.
 *
 * Full-Time hands clubs a snippet — a `<div id="lrep<code>">`, `var lrcode =
 * '<code>'`, and `<script src="https://fulltime.thefa.com/client/api/cs1.js">` —
 * which loads `https://fulltime.thefa.com/js/cs1.html?cs=<code>`: a line of
 * JavaScript that sets the div's innerHTML to the team's fixtures and results
 * table for the season. It is already scoped to one team and keyed by the same
 * `displayFixture.html?id=` the page scraper uses, so the two reconcile onto
 * the same rows.
 *
 * Fetching it: Cloudflare fingerprints the TLS client, not the IP — Deno's
 * `fetch()` is refused where libcurl is let through — so the importer fetches
 * through pg_net (see `pgnet.ts`) and hands the body here.
 *
 * The table has no header row. It alternates a date row —
 *
 *   <tr><td colspan="7">Sun 06 Sept 2026 10:00</td></tr>
 *
 * — with fixture rows of seven cells: type letter, home team, home score, "v",
 * away score, away team, venue. Every cell links to `displayFixture.html?id=`,
 * which is the FA's stable fixture id.
 */

import { extractTables, hrefsIn, textOf } from "./html.ts";
import { fixtureIdFromHref, stableExternalRef } from "./ref.ts";
import { normaliseTeamName } from "./team.ts";
import { londonToInstant, parseClockTime } from "./time.ts";
import type { FixtureStatus, ParsedFixture, ParsedPage } from "./types.ts";

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** `Sun 06 Sept 2026 10:00` → `{ date: "2026-09-06", time: "10:00" }`. */
export function parseWidgetDate(text: string): { date: string; time?: string } | undefined {
  const m = /(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})(?:\s+(\d{1,2}:\d{2}))?/.exec(text.trim());
  if (!m) return undefined;
  const month = MONTHS[(m[2] ?? "").toLowerCase()];
  if (!month) return undefined;
  const day = Number(m[1]);
  const year = Number(m[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return undefined;
  }
  const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const time = m[4] ? parseClockTime(m[4]) : undefined;
  return time === undefined ? { date } : { date, time };
}

/** The `lrcode` in a pasted widget snippet, or a bare code. */
export function widgetCodeFrom(input: string): string | undefined {
  const trimmed = input.trim();
  if (/^\d{6,12}$/.test(trimmed)) return trimmed;
  const m = /lrcode\s*=\s*['"](\d{6,12})['"]/.exec(trimmed) ?? /lrep(\d{6,12})/.exec(trimmed);
  return m?.[1];
}

/** The URL the widget script fetches for a code. */
export function widgetUrl(code: string): string {
  return `https://fulltime.thefa.com/js/cs1.html?cs=${encodeURIComponent(code)}`;
}

/**
 * Accepts either the raw `cs1.html` response (`document.getElementById(…)
 * .innerHTML = '…';`) or the already-rendered innerHTML.
 */
export function widgetHtmlFrom(payload: string): string {
  const m = /innerHTML\s*=\s*'([\s\S]*)';?\s*$/.exec(payload.trim());
  if (!m) return payload;
  // Undo JavaScript string-literal escaping (`\'` in "St Mary's", `\/`, `\n`…).
  return (m[1] ?? "").replace(
    /\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g,
    (_whole: string, esc: string): string => {
      switch (esc[0]) {
        case "u":
        case "x":
          return String.fromCharCode(parseInt(esc.slice(1), 16));
        case "n":
          return "\n";
        case "r":
          return "\r";
        case "t":
          return "\t";
        case "\n":
          return "";
        default:
          return esc;
      }
    },
  );
}

/**
 * The one team every fixture has in common — the team the widget was
 * generated for. `undefined` when there are no fixtures or no single team is
 * in all of them (a division widget, say).
 */
export function widgetTeamName(fixtures: readonly ParsedFixture[]): string | undefined {
  if (fixtures.length === 0) return undefined;
  const counts = new Map<string, { name: string; count: number }>();
  for (const fixture of fixtures) {
    for (const name of new Set([fixture.homeTeam, fixture.awayTeam])) {
      const key = normaliseTeamName(name);
      if (key === "") continue;
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { name, count: 1 });
    }
  }
  const everywhere = [...counts.values()].filter((entry) => entry.count === fixtures.length);
  return everywhere.length === 1 ? everywhere[0]?.name : undefined;
}

const NUMBER = /^\d{1,3}$/;
const SCORE_PAIR = /^(\d{1,3})\s*[-–—]\s*(\d{1,3})$/;
const SEPARATOR = /^(?:v|vs)\.?$|^[-–—]$/i;
const TYPE_LETTER = /^[A-Za-z]{1,3}$/;
const NOTHING_TO_SHOW = /^\s*no\s+(results|fixtures|matches|games)\b/i;
const STATUS_WORDS: ReadonlyArray<readonly [RegExp, FixtureStatus]> = [
  [/abandon/i, "abandoned"],
  [/cancell?ed|\bvoid\b/i, "cancelled"],
  [/postpon|(?:^|\s)p(?:\s|$)|(?:^|\s)pp(?:\s|$)/i, "postponed"],
];

function statusWordIn(text: string): FixtureStatus | undefined {
  if (text.length > 20) return undefined;
  for (const [pattern, status] of STATUS_WORDS) {
    if (pattern.test(text)) return status;
  }
  return undefined;
}

/**
 * What a fixture row is between date rows: the team variant carries a kick-off
 * date and time; a club variant's "Postponed" group carries a status and no
 * date at all.
 */
type RowContext = { date?: string; time?: string; status?: FixtureStatus };

/**
 * Parse the widget table into fixtures. Never throws; unreadable rows become
 * warnings.
 *
 * Handles every widget variant seen so far by classifying cells rather than
 * counting them: the team widget's seven columns
 * (`type | home | score | v | score | away | venue`), the club fixtures
 * widget's five (`type | home | v | away | venue` — no score columns at all),
 * and results variants that print `3 - 1` in a single cell.
 */
export function parseWidgetHtml(payload: string): ParsedPage {
  const html = widgetHtmlFrom(payload);
  const fixtures: ParsedFixture[] = [];
  const warnings: string[] = [];

  const table = extractTables(html)[0];
  if (!table) {
    return { seasons: [], teams: [], fixtures, warnings: ["The widget returned no fixtures table."] };
  }

  let current: RowContext | undefined;
  let undated = 0;
  for (const row of table.rows) {
    const cells = row.cells.filter((c) => c.tag === "td");
    if (cells.length === 0) continue;
    const fixtureId = hrefsIn(row.html).map(fixtureIdFromHref).find((id): id is string => id !== undefined);

    // Rows that are not a fixture: date headings, group status headings
    // ("Postponed"), "No Results", the League | Table footer.
    if (fixtureId === undefined) {
      const text = row.text.trim();
      const parsedDate = parseWidgetDate(text);
      if (parsedDate) {
        current = parsedDate;
        continue;
      }
      const groupStatus = statusWordIn(text);
      if (groupStatus) {
        current = { status: groupStatus };
        continue;
      }
      if (cells.length === 1 && text !== "" && !NOTHING_TO_SHOW.test(text)) {
        warnings.push(`Could not read a date row: ${text.slice(0, 80)}`);
      }
      continue;
    }

    if (!current) {
      warnings.push(`Fixture row before any date row: ${row.text.slice(0, 80)}`);
      continue;
    }
    // A "Postponed" group prints no date, and a fixture without a kick-off
    // date cannot be imported; the row keeps its last imported date instead.
    if (current.date === undefined) {
      undated += 1;
      continue;
    }

    // Classify the cells: the optional type letter comes first, the first two
    // longer texts are the teams, digits between them are the score, and
    // whatever text follows the away team is the venue.
    let type = "";
    const texts: string[] = [];
    const numbers: number[] = [];
    let homeScore: number | undefined;
    let awayScore: number | undefined;
    let cellStatus: FixtureStatus | undefined;
    let first = true;
    for (const cell of cells) {
      const text = cell.text.trim();
      if (text === "") {
        first = false;
        continue;
      }
      if (first && TYPE_LETTER.test(text) && !SEPARATOR.test(text)) {
        type = text.toUpperCase();
        first = false;
        continue;
      }
      first = false;
      if (SEPARATOR.test(text) && texts.length === 1) continue;
      const pair = SCORE_PAIR.exec(text);
      if (pair && texts.length === 1) {
        homeScore = Number(pair[1]);
        awayScore = Number(pair[2]);
        continue;
      }
      const word = statusWordIn(text);
      if (word && texts.length <= 1) {
        cellStatus = cellStatus ?? word;
        continue;
      }
      if (NUMBER.test(text) && texts.length >= 1 && texts.length <= 2) {
        numbers.push(Number(text));
        continue;
      }
      texts.push(text);
    }

    const [homeTeam, awayTeam, ...rest] = texts;
    if (homeTeam === undefined || awayTeam === undefined) {
      warnings.push(`Fixture row without both teams: ${row.text.slice(0, 80)}`);
      continue;
    }
    if (homeScore === undefined && numbers.length === 2) {
      homeScore = numbers[0];
      awayScore = numbers[1];
    }
    const played = homeScore !== undefined && awayScore !== undefined;
    const status: FixtureStatus = cellStatus ?? current.status ?? (played ? "played" : "scheduled");
    const venue = rest.join(", ") || undefined;
    const { date, time } = current;

    fixtures.push({
      externalRef: stableExternalRef({
        externalRef: fixtureId,
        date,
        homeTeam,
        awayTeam,
      }),
      type,
      kickoffAt: londonToInstant(date, time ?? "00:00"),
      date,
      ...(time === undefined ? {} : { time }),
      homeTeam,
      awayTeam,
      ...(played ? { homeScore, awayScore } : {}),
      status,
      ...(venue ? { venue } : {}),
      raw: textOf(row.html).replace(/\s+/g, " ").trim(),
    });
  }
  if (undated > 0) {
    warnings.push(
      `${undated} fixture${undated === 1 ? "" : "s"} under a Postponed heading had no kick-off date and were left as previously imported.`,
    );
  }

  return { seasons: [], teams: [], fixtures, warnings };
}

/**
 * Which of the club's own (short) team names a widget team name refers to:
 * `Ashton On Mersey FC U14 Mavericks` → `U14 Mavericks`. A name that matches
 * none — an opponent — or more than one comes back `undefined`.
 */
export function matchClubTeam(
  widgetTeamName: string,
  clubTeamNames: readonly string[],
  clubPrefix?: string,
): string | undefined {
  const full = foldTeamName(widgetTeamName);
  if (full === "") return undefined;
  const prefix = clubPrefix === undefined ? undefined : foldTeamName(clubPrefix);
  const rest =
    prefix !== undefined && full.startsWith(`${prefix} `) ? full.slice(prefix.length + 1) : undefined;

  const hits = clubTeamNames.filter((short) => {
    const exact = foldTeamName(short);
    if (exact === "") return false;
    if (full === exact) return true;
    // The club's own record may carry a section qualifier Full-Time does not
    // print ("U14 Ravens Girls" vs "Ashton On Mersey FC U14 Ravens").
    const bare = exact.replace(/\s+(girls|boys|ladies|men|women)$/, "");
    if (prefix === undefined) {
      // No club prefix to anchor on: suffix match, exact names only. This is
      // deliberately narrow — "AFC Urmston Meadowside U14 Mavericks" must not
      // claim a club team called "U14 Mavericks".
      return full.endsWith(` ${exact}`);
    }
    if (rest === undefined) return false;
    // Anchored on the club's name; the remainder may carry a squad qualifier
    // the club record folds together ("U8 Sparrows Orange" → "U08 Sparrows Girls").
    return rest === exact || rest === bare || rest.startsWith(`${bare} `);
  });
  return hits.length === 1 ? hits[0] : undefined;
}

/**
 * {@link normaliseTeamName} plus the folds that make Full-Time's spelling and
 * the club's own comparable: zero-padded age groups ("U08" → "u8").
 */
export function foldTeamName(name: string): string {
  return normaliseTeamName(name).replace(/\bu0(\d)\b/g, "u$1");
}

/**
 * Optional league names for widget codes. The club settings hold several
 * codes per field and each code is ONE league's widget, so a name written
 * next to a code — "Timperley & District JFL: 885630049" — labels the league
 * that code covers, and the importer can stamp it onto the teams that code
 * feeds. Both code parsers split on non-digits and ignore the words, so
 * labelling is optional and changes nothing else.
 *
 * A segment is one comma/semicolon/line-separated piece. Pasted snippet HTML
 * is never a label (any `<` skips the segment), URLs are stripped, and a
 * label must keep at least three characters including a letter.
 */
export function widgetCodeLabels(input: string): Map<string, string> {
  const labels = new Map<string, string>();
  for (const segment of input.split(/[,;\n]+/)) {
    if (segment.includes("<")) continue;
    const code = /(\d{6,12})/.exec(segment)?.[1];
    if (code === undefined) continue;
    const label = segment
      .replace(/https?:\/\/\S+/gi, " ")
      .replace(code, " ")
      .replace(/lrcode|lrep|[?&]cs=/gi, " ")
      .replace(/['"=:–—]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (label.length >= 3 && /[a-z]/i.test(label) && !labels.has(code)) labels.set(code, label);
  }
  return labels;
}

/** Every widget code in a paste that may hold several snippets. */
export function widgetCodesFrom(input: string): string[] {
  const codes = new Set<string>();
  for (const m of input.matchAll(/lrcode\s*=\s*['"](\d{6,12})['"]|lrep(\d{6,12})|[?&]cs=(\d{6,12})\b/g)) {
    const code = m[1] ?? m[2] ?? m[3];
    if (code) codes.add(code);
  }
  if (codes.size === 0) {
    for (const m of input.matchAll(/(?:^|\s)(\d{6,12})(?=\s|$)/g)) {
      if (m[1]) codes.add(m[1]);
    }
  }
  return [...codes];
}
