"use client";

/**
 * Filter-as-you-type over the team cards (Adam, 2026-08-25: "it should search
 * and filter teams as you search in the box").
 *
 * The cards themselves are server-rendered and passed in whole — each carries
 * its badges, Full-Time state and server-action forms untouched — so this
 * component owns nothing but the matching: a haystack string per card,
 * filtered on every keystroke. The query is mirrored into the URL with
 * `replaceState` so a filtered view can still be shared or refreshed, without
 * a server round trip per letter.
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

export function TeamFilterGrid({
  items,
  initialQuery,
  initialShowAll,
  noTeamsMessage,
  actions,
}: {
  items: TeamFilterItem[];
  initialQuery: string;
  initialShowAll: boolean;
  /** Shown when there are no teams at all, as opposed to no match. */
  noTeamsMessage: string;
  /** Server-rendered controls beside the search box — the "New team" button. */
  actions?: ReactNode;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [showAll, setShowAll] = useState(initialShowAll);

  const needle = query.trim().toLocaleLowerCase("en-GB");
  const shown = useMemo(
    () =>
      items.filter((item) => {
        if (!showAll && !item.active) return false;
        return needle === "" || item.haystack.includes(needle);
      }),
    [items, needle, showAll],
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
              placeholder="Search name or age group"
              autoComplete="off"
              className="w-full pl-9 sm:w-64"
            />
          </div>
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((item) => (
            <Fragment key={item.key}>{item.card}</Fragment>
          ))}
        </div>
      )}
    </>
  );
}
