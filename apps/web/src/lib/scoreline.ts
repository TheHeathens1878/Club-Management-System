/**
 * The one place that decides what a match finished.
 *
 * Adam, 2026-08-25: "Full-Time will only import scorelines for U12 and above so
 * where it comes through as X-X, the coach's score will over-ride it."
 *
 * Two pairs of columns live on `fixtures`:
 *   * `home_score` / `away_score` — the FA Full-Time importer's. For a U9 or
 *     U11 side they are NULL forever, because Full-Time does not publish
 *     results for those age groups at all; for older sides they are NULL until
 *     the league secretary types the result in, and they can be wrong.
 *   * `coach_home_score` / `coach_away_score` — the club's own record, typed on
 *     the Scoreline tab by the team's staff.
 *
 * THE RULE: the coach's pair wins whenever it is set; otherwise Full-Time's
 * pair; otherwise there is no score yet. Nothing else in the app may decide
 * this — every screen calls `effectiveScore` or `scorelineLabel`.
 *
 * Both pairs are stored all-or-nothing (a database check constraint says so),
 * but this module does not trust that: a half-filled pair is treated as no
 * score, so a broken row degrades to "no result yet" rather than to "0".
 */

/** Which pair the number on screen came from. */
export type ScoreSource = "coach" | "fulltime";

/** The four score columns of a fixture row, in either naming. */
export type ScoreInput = {
  homeScore: number | null | undefined;
  awayScore: number | null | undefined;
  coachHomeScore: number | null | undefined;
  coachAwayScore: number | null | undefined;
};

export type EffectiveScore = {
  /** Goals for the home side, whoever that is. */
  home: number;
  /** Goals for the away side. */
  away: number;
  source: ScoreSource;
};

function pair(home: number | null | undefined, away: number | null | undefined): [number, number] | null {
  if (typeof home !== "number" || typeof away !== "number") return null;
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  if (home < 0 || away < 0) return null;
  return [home, away];
}

/**
 * The scoreline as home–away, and where it came from. `null` when neither the
 * coach nor Full-Time has given the match a result.
 */
export function effectiveScore(input: ScoreInput): EffectiveScore | null {
  const coach = pair(input.coachHomeScore, input.coachAwayScore);
  if (coach) return { home: coach[0], away: coach[1], source: "coach" };
  const imported = pair(input.homeScore, input.awayScore);
  if (imported) return { home: imported[0], away: imported[1], source: "fulltime" };
  return null;
}

export type Scoreline = {
  /** Goals the club's team scored. */
  us: number;
  /** Goals the opponent scored. */
  them: number;
  /** "3–1", us first, with an en dash. */
  text: string;
  outcome: "win" | "draw" | "loss";
  source: ScoreSource;
};

/**
 * The same score turned round so the club's team is always first — a parent
 * reads "we won 3–1", not "the home side won 3–1". How it is worded ("AoM 3–1
 * Angel FC", a badge, a heading) is the screen's business; this returns the
 * numbers.
 */
export function scorelineLabel(fixture: ScoreInput & { isHome: boolean }): Scoreline | null {
  const score = effectiveScore(fixture);
  if (!score) return null;
  const us = fixture.isHome ? score.home : score.away;
  const them = fixture.isHome ? score.away : score.home;
  return {
    us,
    them,
    text: `${us}–${them}`,
    outcome: us > them ? "win" : us < them ? "loss" : "draw",
    source: score.source,
  };
}

/** Where the number on screen came from, in the words the tab uses. */
export function scoreSourceLabel(source: ScoreSource): string {
  return source === "coach" ? "Entered by the coach" : "From Full-Time";
}
