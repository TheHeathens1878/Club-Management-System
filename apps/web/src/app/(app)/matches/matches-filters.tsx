"use client";

/**
 * The desk's filters (Adam, 2026-09-03: "there should be filters on each of
 * the columns"), lifted out of the table they used to be a header row of.
 *
 * They narrow what the caller is ALREADY allowed to see — the RPC answered
 * for that — so none of this is a permission, and all of it is client-side:
 * nine controls over rows the server already scoped. The window itself (this
 * weekend / four weeks / all / results) stays in the URL where it has always
 * been, because that is the part worth sharing and going back from.
 */

import { Input } from "@/components/ui/input";

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

// ---------------------------------------------------------------------------

const SELECT =
  "touch w-full min-w-0 rounded-md border border-input bg-card px-2 text-list lg:h-9";

export function MatchesFilters({
  filters,
  options,
  onChange,
  onClear,
}: {
  filters: Filters;
  options: FilterOptions;
  onChange: (filters: Filters) => void;
  onClear: () => void;
}) {
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    onChange({ ...filters, [key]: value });

  const pick = (
    value: string,
    onPick: (value: string) => void,
    values: string[],
    allLabel: string,
    label: string,
  ) => (
    <label className="min-w-0 space-y-1">
      <span className="block text-2xs text-muted-foreground">{label}</span>
      {/* min-w-0: WebKit will not shrink a select below its longest option
          without it, and both team and pitch names run long. */}
      <select value={value} onChange={(event) => onPick(event.target.value)} aria-label={label} className={SELECT}>
        <option value="">{allLabel}</option>
        {values.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <label className="min-w-0 space-y-1">
          <span className="block text-2xs text-muted-foreground">From</span>
          <Input
            type="date"
            value={filters.from}
            onChange={(event) => set("from", event.target.value)}
            aria-label="From date"
            className="touch lg:h-9"
          />
        </label>
        <label className="min-w-0 space-y-1">
          <span className="block text-2xs text-muted-foreground">Until</span>
          <Input
            type="date"
            value={filters.to}
            onChange={(event) => set("to", event.target.value)}
            aria-label="To date"
            className="touch lg:h-9"
          />
        </label>
        {pick(filters.team, (v) => set("team", v), options.teams, "All teams", "Team")}
        <label className="min-w-0 space-y-1">
          <span className="block text-2xs text-muted-foreground">Home or away</span>
          <select
            value={filters.homeAway}
            onChange={(event) => set("homeAway", event.target.value as Filters["homeAway"])}
            aria-label="Home or away"
            className={SELECT}
          >
            <option value="all">Home &amp; away</option>
            <option value="home">Home</option>
            <option value="away">Away</option>
          </select>
        </label>
        {pick(filters.competition, (v) => set("competition", v), options.competitions, "All", "Competition")}
        {/* The ground and the pitch on it are separate (Adam, 2026-09-04:
            "filter by venue … not just pitch"). */}
        {pick(filters.venue, (v) => set("venue", v), options.venues, "All venues", "Venue")}
        {pick(filters.pitch, (v) => set("pitch", v), options.pitches, "All pitches", "Pitch")}
        {pick(filters.status, (v) => set("status", v), options.statuses, "All", "Status")}
        <label className="min-w-0 space-y-1">
          <span className="block text-2xs text-muted-foreground">Replies</span>
          <select
            value={filters.replies}
            onChange={(event) => set("replies", event.target.value as Filters["replies"])}
            aria-label="Replies"
            className={SELECT}
          >
            <option value="all">All</option>
            <option value="short">Short of replies</option>
            <option value="quiet">No answers yet</option>
          </select>
        </label>
        <label className="col-span-2 min-w-0 space-y-1">
          <span className="block text-2xs text-muted-foreground">Opponent</span>
          <Input
            value={filters.opponent}
            onChange={(event) => set("opponent", event.target.value)}
            placeholder="Opponent contains…"
            aria-label="Opponent contains"
            className="touch lg:h-9"
          />
        </label>
      </div>
      {filtersActive(filters) ? (
        <button
          type="button"
          onClick={onClear}
          className="touch inline-flex items-center rounded-md px-2 text-list font-medium text-primary hover:underline"
        >
          Clear the filters
        </button>
      ) : null}
    </div>
  );
}
