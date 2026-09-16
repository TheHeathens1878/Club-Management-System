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
 *
 * The controls only. What the nine MEAN — and the sentence the folded row
 * shows — is `./filters`, a plain module with a test beside it.
 */

import { Input } from "@/components/ui/input";

import { filtersActive, type FilterOptions, type Filters } from "./filters";

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
