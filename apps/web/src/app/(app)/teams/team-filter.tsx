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
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors " +
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
}) {
  const [query, setQuery] = useState(initialQuery);
  const [showAll, setShowAll] = useState(initialShowAll);
  const [needsStaffOnly, setNeedsStaffOnly] = useState(false);

  const needsStaffCount = useMemo(
    () => items.filter((item) => item.active && item.needsStaff).length,
    [items],
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-2">
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
          <div className="flex items-center gap-1.5 pb-0.5">
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
              className="w-auto"
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
        <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
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
      )}
    </>
  );
}
