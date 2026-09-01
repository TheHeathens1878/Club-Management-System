"use client";

/**
 * Filter-as-you-type over the teams table (Adam, 2026-08-25: "it should search
 * and filter teams as you search in the box"; layout from the design build
 * spec §2.3 — a table of Team | Staff | Squad | Next out | Subs).
 *
 * The rows themselves are server-rendered and passed in whole — staff names,
 * fixture times, subs pills and the active-toggle form all arrive done — so
 * this component owns nothing but the matching: a haystack per row, filtered
 * on every keystroke, plus the two design chips (all / needs staff) and the
 * active-only select. The query is mirrored into the URL with `replaceState`
 * so a filtered view still shares, without a server round trip per letter.
 *
 * Each item arrives twice: as a table row for lg+, and as a card for the phone
 * (mobile design — "every dense table becomes a stack of cards"). Filtering is
 * one list either way, so the two presentations can never disagree.
 */

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Search } from "lucide-react";

import { Input, Label } from "@/components/ui/input";
import { Select } from "@/components/ui/field";
import { Card, CardContent } from "@/components/ui/card";

export type TeamFilterItem = {
  key: string;
  /** Lower-cased name + age group, the two things the box searches. */
  haystack: string;
  active: boolean;
  /** No manager or coach on the books — the design's "Needs staff" chip. */
  needsStaff: boolean;
  row: ReactNode;
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
  initialQuery,
  initialShowAll,
  noTeamsMessage,
  head,
  actions,
  footerNote,
}: {
  items: TeamFilterItem[];
  initialQuery: string;
  initialShowAll: boolean;
  /** Shown when there are no teams at all, as opposed to no match. */
  noTeamsMessage: string;
  /** The table's server-rendered header row. */
  head: ReactNode;
  /** Server-rendered controls beside the search box — the "New team" button. */
  actions?: ReactNode;
  /** The design's right-aligned footer line under the table. */
  footerNote?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [showAll, setShowAll] = useState(initialShowAll);
  const [needsStaffOnly, setNeedsStaffOnly] = useState(false);

  const needsStaffCount = useMemo(
    () => items.filter((item) => item.active && item.needsStaff).length,
    [items],
  );

  // "Show the other N teams" — the inactive rows the default filter hides.
  const hiddenInactive = useMemo(
    () => (showAll ? 0 : items.filter((item) => !item.active).length),
    [items, showAll],
  );

  const needle = query.trim().toLocaleLowerCase("en-GB");
  const shown = useMemo(
    () =>
      items.filter((item) => {
        if (!showAll && !item.active) return false;
        if (needsStaffOnly && !item.needsStaff) return false;
        return needle === "" || item.haystack.includes(needle);
      }),
    [items, needle, showAll, needsStaffOnly],
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

      {shown.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {items.length === 0 ? noTeamsMessage : "No team matches that search."}
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-xl border bg-card shadow-sm">
          {/* The phone reads the same teams as a stack of cards. */}
          <ul className="divide-y lg:hidden">
            {shown.map((item) => (
              <li key={item.key}>{item.card}</li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-secondary/40 text-xs text-muted-foreground">
                {head}
              </thead>
              <tbody className="divide-y">
                {shown.map((item) => (
                  <Fragment key={item.key}>{item.row}</Fragment>
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
