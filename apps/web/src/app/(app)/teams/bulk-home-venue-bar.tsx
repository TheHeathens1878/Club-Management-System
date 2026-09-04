"use client";

/**
 * The bar that appears once teams are ticked (Adam, 2026-09-04: "I should be
 * able to allocate home venues from here by ticking a box alongside the team
 * and then allocate to a pitch & venue").
 *
 * One pitch — venue-grouped, exactly the picker each row already has — an
 * optional standing kick-off, and an optional "allocate all their home games
 * too". The server action walks the ticked teams one at a time, so a
 * central-venue team or a clash on one Sunday is a named warning, never a
 * reason the rest failed.
 */

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { groupByVenue, splitVenue } from "@/lib/pitch-venue";

import { bulkSetHomeVenue, type BulkHomeVenueState } from "./home-venue-actions";

export type BulkPitch = { id: string; name: string };

const EMPTY: BulkHomeVenueState = {};

export function BulkHomeVenueBar({
  teamIds,
  pitches,
  onDone,
}: {
  teamIds: string[];
  pitches: BulkPitch[];
  /** Called once the action reports success, so the grid can put the ticks down. */
  onDone: () => void;
}) {
  const router = useRouter();
  const [state, action, saving] = useActionState(bulkSetHomeVenue, EMPTY);
  const venues = groupByVenue(pitches);

  // A finished save means the rows on screen are stale: refetch them. The
  // ticks deliberately STAY, because putting them down unmounts this bar and
  // its answer with it — the named warnings are the part worth reading. The
  // "Put the ticks down" button below is the way out.
  useEffect(() => {
    if (!state.notice) return;
    router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- notice is the signal
  }, [state.notice]);

  return (
    <div className="space-y-3 rounded-xl border border-primary/30 bg-card p-3">
      <p className="text-sm font-medium">
        {teamIds.length} {teamIds.length === 1 ? "team" : "teams"} ticked
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          the ticks survive filtering — this sets every ticked team&apos;s home
        </span>
      </p>
      <form action={action} className="flex flex-wrap items-end gap-x-3 gap-y-2">
        {teamIds.map((id) => (
          <input key={id} type="hidden" name="team_id" value={id} />
        ))}
        <label className="space-y-1 text-xs text-muted-foreground">
          Home pitch (venue &amp; pitch)
          {/* min-w-0: WebKit will not shrink a select below its longest
              option without it, and pitch names run long. */}
          <select
            name="home_resource_id"
            required
            defaultValue=""
            aria-label="Home pitch"
            className="block h-9 w-full min-w-0 max-w-64 rounded-md border bg-background px-2 text-sm"
          >
            <option value="" disabled>
              Choose a pitch…
            </option>
            {venues.map((group) => (
              <optgroup key={group.venue} label={group.venue}>
                {group.pitches.map((pitch) => (
                  <option key={pitch.id} value={pitch.id}>
                    {splitVenue(pitch.name).pitch}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Home KO (optional)
          <Input name="home_kickoff_time" type="time" className="block h-9 w-28" />
        </label>
        <label className="flex min-h-9 items-center gap-2 text-xs">
          <input type="checkbox" name="allocate_games" className="h-4 w-4" />
          Allocate all their home games too
        </label>
        <Button type="submit" size="sm" disabled={saving || pitches.length === 0}>
          {saving ? "Saving…" : "Set home venue"}
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">
        A blank KO leaves each team&apos;s standing kick-off alone. Allocating books every future
        home fixture onto this pitch with the same clash check as a hire; central-venue teams are
        left alone and named.
      </p>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state.notice && (
        <p className="text-sm text-emerald-700">
          {state.notice}{" "}
          <button type="button" onClick={onDone} className="font-medium underline underline-offset-2">
            Put the ticks down
          </button>
        </p>
      )}
      {(state.warnings ?? []).map((warning, index) => (
        <p key={index} className="text-sm text-amber-700">
          {warning}
        </p>
      ))}
    </div>
  );
}
