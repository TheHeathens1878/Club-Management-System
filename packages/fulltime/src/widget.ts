/**
 * The Full-Time embed widget.
 *
 * Full-Time hands clubs a snippet — a `<div id="lrep<code>">`, `var lrcode =
 * '<code>'`, and `<script src="https://fulltime.thefa.com/client/api/cs1.js">` —
 * which loads `https://fulltime.thefa.com/js/cs1.html?cs=<code>`: a line of
 * JavaScript that sets the div's innerHTML to a fixtures table. It is meant for
 * browsers, and a browser is exactly what Cloudflare lets through where it
 * blocks every cloud IP. So the admin's browser loads the widget and hands the
 * rendered table here.
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
  return (m[1] ?? "").replace(/\\'/g, "'").replace(/\\n/g, "\n");
}

const SCORE = /^\s*(\d{1,3})\s*$/;
const STATUS_WORDS: ReadonlyArray<readonly [RegExp, FixtureStatus]> = [
  [/abandon/i, "abandoned"],
  [/cancell?ed|\bvoid\b/i, "cancelled"],
  [/postpon|(?:^|\s)p(?:\s|$)|(?:^|\s)pp(?:\s|$)/i, "postponed"],
];

/** Parse the widget table into fixtures. Never throws; unreadable rows become warnings. */
export function parseWidgetHtml(payload: string): ParsedPage {
  const html = widgetHtmlFrom(payload);
  const fixtures: ParsedFixture[] = [];
  const warnings: string[] = [];

  const table = extractTables(html)[0];
  if (!table) {
    return { seasons: [], teams: [], fixtures, warnings: ["The widget returned no fixtures table."] };
  }

  let current: { date: string; time?: string } | undefined;
  for (const row of table.rows) {
    const cells = row.cells.filter((c) => c.tag === "td");
    if (cells.length === 0) continue;

    if (cells.length === 1) {
      const parsed = parseWidgetDate(cells[0]?.text ?? "");
      if (parsed) current = parsed;
      else if ((cells[0]?.text ?? "").trim() !== "") warnings.push(`Could not read a date row: ${row.text.slice(0, 80)}`);
      continue;
    }

    if (!current) {
      warnings.push(`Fixture row before any date row: ${row.text.slice(0, 80)}`);
      continue;
    }
    // Footer/navigation rows ("League | Table" links) carry no fixture link.
    if (cells.length < 6) {
      if (hrefsIn(row.html).some((h) => fixtureIdFromHref(h) !== undefined)) {
        warnings.push(`Unexpected row shape (${cells.length} cells): ${row.text.slice(0, 80)}`);
      }
      continue;
    }

    const type = (cells[0]?.text ?? "").trim().toUpperCase();
    const homeTeam = (cells[1]?.text ?? "").trim();
    const homeScoreText = (cells[2]?.text ?? "").trim();
    const middle = (cells[3]?.text ?? "").trim();
    const awayScoreText = (cells[4]?.text ?? "").trim();
    const awayTeam = (cells[5]?.text ?? "").trim();
    const venue = (cells[6]?.text ?? "").trim() || undefined;
    if (!homeTeam || !awayTeam) {
      warnings.push(`Fixture row without both teams: ${row.text.slice(0, 80)}`);
      continue;
    }

    let status: FixtureStatus = "scheduled";
    for (const [pattern, s] of STATUS_WORDS) {
      if (pattern.test(`${middle} ${homeScoreText} ${awayScoreText}`)) { status = s; break; }
    }
    let homeScore: number | undefined;
    let awayScore: number | undefined;
    if (SCORE.test(homeScoreText) && SCORE.test(awayScoreText)) {
      homeScore = Number(homeScoreText);
      awayScore = Number(awayScoreText);
      if (status === "scheduled") status = "played";
    }

    const fixtureId = hrefsIn(row.html).map(fixtureIdFromHref).find((id): id is string => id !== undefined);
    const { date, time } = current;

    fixtures.push({
      externalRef: stableExternalRef({
        ...(fixtureId === undefined ? {} : { externalRef: fixtureId }),
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
      ...(homeScore === undefined ? {} : { homeScore }),
      ...(awayScore === undefined ? {} : { awayScore }),
      status,
      ...(venue ? { venue } : {}),
      raw: textOf(row.html).replace(/\s+/g, " ").trim(),
    });
  }

  return { seasons: [], teams: [], fixtures, warnings };
}
