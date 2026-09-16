/**
 * What the desk's nine filters mean, on their own — no React, no controls.
 *
 * They narrow what the caller is ALREADY allowed to see (the RPC answered for
 * that), so none of this is a permission. It lives in a plain module beside
 * the controls that drive it because the summary a folded Filters row shows
 * has to be computed from the same rules the filtering uses, and because a
 * rule worth trusting is a rule with a test beside it.
 */

import type { DeskRow } from "./types";

export type Filters = {
  from: string;
  to: string;
  team: string;
  opponent: string;
  homeAway: "all" | "home" | "away";
  competition: string;
  venue: string;
  pitch: string;
  status: string;
  replies: "all" | "short" | "quiet";
};

export const NO_FILTERS: Filters = {
  from: "",
  to: "",
  team: "",
  opponent: "",
  homeAway: "all",
  competition: "",
  venue: "",
  pitch: "",
  status: "",
  replies: "all",
};

/** A cancelled or postponed match is short of nobody. */
export function shortOfReplies(row: DeskRow): boolean {
  return row.status === "scheduled" && row.squad > 0 && row.accepted * 2 < row.squad;
}

export function applyFilters(rows: DeskRow[], f: Filters): DeskRow[] {
  const opponent = f.opponent.trim().toLowerCase();
  return rows.filter((row) => {
    if (f.from && row.dateIso < f.from) return false;
    if (f.to && row.dateIso > f.to) return false;
    if (f.team && row.teamName !== f.team) return false;
    if (opponent && !row.opponent.toLowerCase().includes(opponent)) return false;
    if (f.homeAway === "home" && !row.isHome) return false;
    if (f.homeAway === "away" && row.isHome) return false;
    if (f.competition && row.competition !== f.competition) return false;
    if (f.venue && row.venue !== f.venue) return false;
    if (f.pitch && row.pitch !== f.pitch) return false;
    if (f.status && row.status !== f.status) return false;
    if (f.replies === "short" && !shortOfReplies(row)) return false;
    if (f.replies === "quiet" && row.accepted + row.declined > 0) return false;
    return true;
  });
}

export function distinct(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, "en-GB"));
}

/** Are any of the nine actually narrowing anything? */
export function filtersActive(f: Filters): boolean {
  return (
    f.from !== "" ||
    f.to !== "" ||
    f.team !== "" ||
    f.opponent.trim() !== "" ||
    f.homeAway !== "all" ||
    f.competition !== "" ||
    f.venue !== "" ||
    f.pitch !== "" ||
    f.status !== "" ||
    f.replies !== "all"
  );
}

/**
 * What the filters are doing, in words, so the folded row is worth reading
 * shut: "All teams · All venues · showing 34 of 34" when nothing is set, and
 * the ones that ARE set otherwise — "U14 Mavericks · Home only · showing 3 of
 * 34". The count is always last, because it is the number the eye goes to.
 */
export function filtersSummary(f: Filters, shown: number, total: number): string {
  const parts: string[] = [];
  if (f.from || f.to) parts.push(`${f.from || "any date"} → ${f.to || "any date"}`);
  if (f.team) parts.push(f.team);
  if (f.opponent.trim()) parts.push(`v ${f.opponent.trim()}`);
  if (f.homeAway !== "all") parts.push(f.homeAway === "home" ? "Home only" : "Away only");
  if (f.competition) parts.push(f.competition);
  if (f.venue) parts.push(f.venue);
  if (f.pitch) parts.push(f.pitch);
  if (f.status) parts.push(f.status);
  if (f.replies === "short") parts.push("Short of replies");
  if (f.replies === "quiet") parts.push("No answers yet");
  if (parts.length === 0) parts.push("All teams", "All venues");
  return `${parts.join(" · ")} · showing ${shown} of ${total}`;
}

/** The options each select offers, taken from the rows themselves. */
export type FilterOptions = {
  teams: string[];
  competitions: string[];
  venues: string[];
  pitches: string[];
  statuses: string[];
};

export function filterOptions(rows: DeskRow[]): FilterOptions {
  return {
    teams: distinct(rows.map((row) => row.teamName)),
    competitions: distinct(rows.map((row) => row.competition)),
    venues: distinct(rows.map((row) => row.venue)),
    pitches: distinct(rows.map((row) => row.pitch)),
    statuses: distinct(rows.map((row) => row.status)),
  };
}

/** How the export and the printed table are ordered. */
export type MatchesOrder = "kickoff" | "age" | "venue";

/**
 * The words the folded Export row shows: what pressing either button would
 * take away, and in what order. "34 matches · by kick-off".
 */
export function exportSummary(shown: number, order: MatchesOrder): string {
  const by =
    order === "age" ? "by age group, U7 up to Vets" : order === "venue" ? "by venue" : "by kick-off";
  return `${shown} match${shown === 1 ? "" : "es"} · ${by} · CSV or PDF`;
}
