"use client";

/**
 * Filter-as-you-type over the teams table (Adam, 2026-08-25: "it should search
 * and filter teams as you search in the box"), and since 2026-09-04 the rest
 * of what he asked of this list: "let me filter on all columns on the teams
 * table. I should be able to allocate home venues from here by ticking a box
 * alongside the team and then allocate to a pitch & venue" — with "Venue needs
 * to be a column".
 *
 * The rows' CELLS are server-rendered and passed in whole — staff names,
 * fixture times, subs pills all arrive done. This component owns the table
 * chrome around them: the header (one label row, one filter row), a select
 * per filterable column driven by each row's `facets`, the tick column, and
 * the bulk home-venue bar that appears once anything is ticked. The search
 * query is mirrored into the URL with `replaceState` so a filtered view still
 * shares, without a server round trip per letter.
 *
 * Each item arrives twice: as table cells for lg+, and as a card for the phone
 * (mobile design — "every dense table becomes a stack of cards"). Filtering is
 * one list either way, so the two presentations can never disagree; the phone
 * gets the same column filters in a Filter sheet, and its tick sits beside the
 * card rather than on top of the chevron.
 */

import { useMemo, useState, type ReactNode } from "react";
import { Search } from "lucide-react";

import { Input, Label } from "@/components/ui/input";
import { Select } from "@/components/ui/field";
import { Card, CardContent } from "@/components/ui/card";

import { BulkHomeVenueBar, type BulkPitch } from "./bulk-home-venue-bar";

export type TeamFilterColumn = {
  label: string;
  /** The small second line under the label ("from age group"). */
  sub?: string;
  /** Key into each item's `facets`; set, the column gets a filter select. */
  filterKey?: string;
  /** The filter's everything option — "All ages" reads better than "All". */
  allLabel?: string;
};

export type TeamFilterItem = {
  key: string;
  /** Lower-cased name + age group + league, the things the box searches. */
  haystack: string;
  active: boolean;
  /** No manager or coach on the books — the design's "Needs staff" chip. */
  needsStaff: boolean;
  /** filterKey → this row's value, for the column filters. */
  facets: Record<string, string>;
  /** The row's <td> cells only — the grid owns the <tr>, so it can add the tick. */
  cells: ReactNode;
  /** The same team as a phone card; the table row is hidden below lg. */
  card: ReactNode;
};

function syncUrl(query: string, showAll: boolean) {
  const params = new URLSearchParams(window.location.search);
  if (query) params.set("q", query);
  else params.delete("q");
  if (showAll) params.set("status", "all");
  else params.delete("status");
  const search = params.toString();
  window.history.replaceState(null, "", search ? `?${search}` : window.location.pathname);
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        // 44px on a phone (mobile design), the design build's compact chip on lg+.
        "inline-flex min-h-[44px] shrink-0 items-center whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors lg:min-h-0 lg:py-1 " +
        (active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input text-muted-foreground hover:bg-secondary")
      }
    >
      {children}
    </button>
  );
}

export function TeamFilterGrid({
  items,
  columns,
  initialQuery,
  initialShowAll,
  noTeamsMessage,
  actions,
  footerNote,
  canTick = false,
  pitches = [],
}: {
  items: TeamFilterItem[];
  /** The table's columns, in order — labels, sub-lines and filters alike. */
  columns: TeamFilterColumn[];
  initialQuery: string;
  initialShowAll: boolean;
  /** Shown when there are no teams at all, as opposed to no match. */
  noTeamsMessage: string;
  /** Server-rendered controls beside the search box — the "New team" button. */
  actions?: ReactNode;
  /** The design's right-aligned footer line under the table. */
  footerNote?: string;
  /** Ticks and the bulk home-venue bar — the server action re-checks admin. */
  canTick?: boolean;
  /** Active pitches for the bulk bar's venue-grouped picker. */
  pitches?: BulkPitch[];
}) {
  const [query, setQuery] = useState(initialQuery);
  const [showAll, setShowAll] = useState(initialShowAll);
  const [needsStaffOnly, setNeedsStaffOnly] = useState(false);
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const needsStaffCount = useMemo(
    () => items.filter((item) => item.active && item.needsStaff).length,
    [items],
  );

  // "Show the other N teams" — the inactive rows the default filter hides.
  const hiddenInactive = useMemo(
    () => (showAll ? 0 : items.filter((item) => !item.active).length),
    [items, showAll],
  );

  // Every value a column's filter can offer, from the rows themselves.
  const facetOptions = useMemo(() => {
    const options = new Map<string, string[]>();
    for (const column of columns) {
      if (!column.filterKey) continue;
      const values = new Set<string>();
      for (const item of items) {
        const value = item.facets[column.filterKey];
        if (value) values.add(value);
      }
      options.set(
        column.filterKey,
        [...values].sort((a, b) => a.localeCompare(b, "en-GB")),
      );
    }
    return options;
  }, [columns, items]);

  const filterable = columns.filter(
    (column): column is TeamFilterColumn & { filterKey: string } => !!column.filterKey,
  );
  const filteringColumns = filterable.some((column) => (columnFilters[column.filterKey] ?? "") !== "");

  const needle = query.trim().toLocaleLowerCase("en-GB");
  const shown = useMemo(
    () =>
      items.filter((item) => {
        if (!showAll && !item.active) return false;
        if (needsStaffOnly && !item.needsStaff) return false;
        for (const column of filterable) {
          const wanted = columnFilters[column.filterKey] ?? "";
          if (wanted !== "" && item.facets[column.filterKey] !== wanted) return false;
        }
        return needle === "" || item.haystack.includes(needle);
      }),
    [items, needle, showAll, needsStaffOnly, filterable, columnFilters],
  );

  function toggle(key: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAllShown() {
    setSelected((current) => {
      const everyShown = shown.length > 0 && shown.every((item) => current.has(item.key));
      const next = new Set(current);
      if (everyShown) for (const item of shown) next.delete(item.key);
      else for (const item of shown) next.add(item.key);
      return next;
    });
  }

  const filterSelect = (column: TeamFilterColumn & { filterKey: string }) => (
    <select
      value={columnFilters[column.filterKey] ?? ""}
      onChange={(event) =>
        setColumnFilters((current) => ({ ...current, [column.filterKey]: event.target.value }))
      }
      aria-label={`Filter by ${column.label.toLocaleLowerCase("en-GB")}`}
      className="h-8 w-full min-w-0 rounded-md border bg-background px-1.5 text-xs font-normal normal-case tracking-normal"
    >
      <option value="">{column.allLabel ?? "All"}</option>
      {(facetOptions.get(column.filterKey) ?? []).map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );

  return (
    <>
      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end lg:justify-between">
        <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="team-search" className="sr-only">
              Search teams
            </Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="team-search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  syncUrl(event.target.value, showAll);
                }}
                placeholder="Search teams"
                autoComplete="off"
                className="w-full pl-9 sm:w-64"
              />
            </div>
          </div>
          {/* The chips and the Show select scroll sideways on a phone rather
              than stacking into three rows (mobile design §filter chips). */}
          <div className="-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] lg:mx-0 lg:px-0 [&::-webkit-scrollbar]:hidden">
            <Chip active={!needsStaffOnly} onClick={() => setNeedsStaffOnly(false)}>
              All teams
            </Chip>
            <Chip active={needsStaffOnly} onClick={() => setNeedsStaffOnly(true)}>
              Needs staff{needsStaffCount > 0 ? ` ${needsStaffCount}` : ""}
            </Chip>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="team-status" className="sr-only">
              Show
            </Label>
            <Select
              id="team-status"
              value={showAll ? "all" : "active"}
              onChange={(event) => {
                const all = event.target.value === "all";
                setShowAll(all);
                syncUrl(query, all);
              }}
              className="w-auto shrink-0"
            >
              <option value="active">Active only</option>
              <option value="all">All teams</option>
            </Select>
          </div>
        </div>
        {actions}
      </div>

      {canTick && selected.size > 0 && (
        <BulkHomeVenueBar
          teamIds={[...selected]}
          pitches={pitches}
          onDone={() => setSelected(new Set())}
        />
      )}

      {shown.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {items.length === 0
              ? noTeamsMessage
              : filteringColumns
                ? "No team fits those filters."
                : "No team matches that search."}
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-xl border bg-card shadow-sm">
          {/* The phone reads the same teams as a stack of cards — with the
              same column filters, folded into one sheet. */}
          <div className="lg:hidden">
            {filterable.length > 0 && (
              <details className="border-b">
                <summary className="min-h-[44px] cursor-pointer list-none px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
                  Filter columns{filteringColumns ? ` · showing ${shown.length}` : ""}
                </summary>
                <div className="grid grid-cols-2 gap-2 p-3 pt-0">
                  {filterable.map((column) => (
                    <label key={column.filterKey} className="space-y-1 text-xs text-muted-foreground">
                      {column.label}
                      {filterSelect(column)}
                    </label>
                  ))}
                </div>
              </details>
            )}
            <ul className="divide-y">
              {shown.map((item) => (
                <li key={item.key} className={"flex items-start" + (item.active ? "" : " opacity-60")}>
                  {canTick && (
                    <span className="flex min-h-[44px] items-center pl-4 pt-3.5">
                      <input
                        type="checkbox"
                        checked={selected.has(item.key)}
                        onChange={() => toggle(item.key)}
                        aria-label="Tick this team"
                        className="h-5 w-5"
                      />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">{item.card}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-secondary/40 text-xs text-muted-foreground">
                <tr>
                  {canTick && (
                    <th className="w-10 px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={shown.length > 0 && shown.every((item) => selected.has(item.key))}
                        onChange={toggleAllShown}
                        aria-label="Tick every team shown"
                        className="h-4 w-4"
                      />
                    </th>
                  )}
                  {columns.map((column) => (
                    <th key={column.label} className="px-4 py-2.5 font-medium">
                      {column.label}
                      {column.sub && (
                        <span className="block font-normal normal-case tracking-normal text-muted-foreground/80">
                          {column.sub}
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
                {/* One filter per column (Adam, 2026-09-04). */}
                {filterable.length > 0 && (
                  <tr className="border-t bg-secondary/20">
                    {canTick && <td className="px-3 py-2" />}
                    {columns.map((column) => (
                      <td key={column.label} className="px-4 py-2">
                        {column.filterKey
                          ? filterSelect(column as TeamFilterColumn & { filterKey: string })
                          : null}
                      </td>
                    ))}
                  </tr>
                )}
              </thead>
              <tbody className="divide-y">
                {shown.map((item) => (
                  <tr
                    key={item.key}
                    className={
                      "transition-colors hover:bg-secondary/40" + (item.active ? "" : " opacity-60")
                    }
                  >
                    {canTick && (
                      <td className="px-3 py-3 align-top">
                        <input
                          type="checkbox"
                          checked={selected.has(item.key)}
                          onChange={() => toggle(item.key)}
                          aria-label="Tick this team"
                          className="h-4 w-4"
                        />
                      </td>
                    )}
                    {item.cells}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(hiddenInactive > 0 || footerNote) && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5 text-xs">
              {hiddenInactive > 0 ? (
                <button
                  type="button"
                  className="font-medium text-primary hover:underline"
                  onClick={() => {
                    setShowAll(true);
                    syncUrl(query, true);
                  }}
                >
                  Show the other {hiddenInactive} {hiddenInactive === 1 ? "team" : "teams"}
                </button>
              ) : (
                <span />
              )}
              {footerNote && <span className="text-muted-foreground">{footerNote}</span>}
            </div>
          )}
        </div>
      )}
    </>
  );
}
