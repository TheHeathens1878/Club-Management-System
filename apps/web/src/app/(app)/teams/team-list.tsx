"use client";

/**
 * The teams list's client half — everything about the list that cannot be
 * decided on the server.
 *
 * This is what is left of `team-filter.tsx` once the table, the column
 * filters, the phone cards, the tick column and the empty state moved into
 * `DataListFrame` (P8.0e). What stays here is the two things the frame does
 * not know about teams: which teams are hidden because they are inactive, and
 * which have nobody on the books — plus the three bulk bars, which need the
 * ticked ids and a callback, and so can only be wired up from a client module.
 *
 * The rows' CELLS and CARDS are still server-rendered and passed in whole —
 * staff names, fixture times and subs pills all arrive done.
 */

import { useMemo, useState } from "react";
import { Users } from "lucide-react";

import { ChipStrip } from "@/components/ui/chip-strip";
import { DataListFrame, type DataColumn, type DataItem } from "@/components/ui/data-list";
import { Select } from "@/components/ui/field";
import { Label } from "@/components/ui/input";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { updateQuery } from "@/lib/data-list";

import { BulkHomeVenueBar, type BulkPitch } from "./bulk-home-venue-bar";
import { BulkTrainingDayBar } from "./bulk-training-day-bar";
import { ClubsPortalExportBar } from "./clubs-portal-export-bar";

export type TeamListItem = DataItem & {
  active: boolean;
  /** No manager or coach on the books — the design's "Needs staff" chip. */
  needsStaff: boolean;
};

export function TeamList({
  items,
  columns,
  initialQuery,
  initialShowAll,
  noTeamsMessage,
  actions,
  footerNote,
  canTick = false,
  pitches = [],
  canExportPortal = false,
}: {
  items: TeamListItem[];
  columns: DataColumn[];
  initialQuery: string;
  initialShowAll: boolean;
  /** Shown when there are no teams at all, as opposed to no match. */
  noTeamsMessage: string;
  /** Server-rendered controls beside the search box — the "New team" button. */
  actions?: React.ReactNode;
  /** The design's right-aligned footer line under the table. */
  footerNote?: string;
  /** Ticks and the bulk bars — every server action re-checks admin itself. */
  canTick?: boolean;
  /** Active pitches for the bulk bar's venue-grouped picker. */
  pitches?: BulkPitch[];
  /** The FA Clubs Portal exports for the ticked teams — club administrators. */
  canExportPortal?: boolean;
}) {
  const [showAll, setShowAll] = useState(initialShowAll);
  const [needsStaffOnly, setNeedsStaffOnly] = useState(false);

  const needsStaffCount = useMemo(
    () => items.filter((item) => item.active && item.needsStaff).length,
    [items],
  );

  // "Show the other N teams" — the inactive rows the default view hides.
  const hiddenInactive = useMemo(
    () => (showAll ? 0 : items.filter((item) => !item.active).length),
    [items, showAll],
  );

  const shown = useMemo(
    () =>
      items
        .filter((item) => (showAll || item.active) && (!needsStaffOnly || item.needsStaff))
        // The frame fades a row it is told to; a team out of play is one.
        .map((item) => ({ ...item, dim: !item.active })),
    [items, showAll, needsStaffOnly],
  );

  /** Keep `?status=all` in step without a round trip, as the search box does. */
  function syncStatus(all: boolean) {
    const next = updateQuery(window.location.search, { status: all ? "all" : "" });
    window.history.replaceState(null, "", next ? `?${next}` : window.location.pathname);
  }

  return (
    <DataListFrame
      items={shown}
      columns={columns}
      search={{ param: "q", placeholder: "Search teams", initial: initialQuery }}
      actions={actions}
      footerNote={footerNote}
      chips={
        <>
          <ChipStrip>
            <ToggleChip on={!needsStaffOnly} onClick={() => setNeedsStaffOnly(false)}>
              All teams
            </ToggleChip>
            <ToggleChip
              on={needsStaffOnly}
              count={needsStaffCount}
              onClick={() => setNeedsStaffOnly(true)}
            >
              Needs staff
            </ToggleChip>
          </ChipStrip>
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
                syncStatus(all);
              }}
              className="touch w-auto shrink-0"
            >
              <option value="active">Active only</option>
              <option value="all">All teams</option>
            </Select>
          </div>
        </>
      }
      select={
        canTick
          ? {
              label: "Tick this team",
              bar: (keys, clear) => (
                <>
                  <BulkHomeVenueBar teamIds={keys} pitches={pitches} onDone={clear} />
                  <BulkTrainingDayBar teamIds={keys} onDone={clear} />
                  {canExportPortal && <ClubsPortalExportBar teamIds={keys} />}
                </>
              ),
            }
          : undefined
      }
      empty={{
        icon: <Users className="h-5 w-5" aria-hidden />,
        title: noTeamsMessage,
      }}
      noMatch="No team matches that search or those filters."
      showMore={
        hiddenInactive > 0
          ? {
              label: `Show the other ${hiddenInactive} ${hiddenInactive === 1 ? "team" : "teams"}`,
              onShow: () => {
                setShowAll(true);
                syncStatus(true);
              },
            }
          : undefined
      }
    />
  );
}
