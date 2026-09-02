"use client";

/**
 * "Home" on the teams list: where the team plays, when, and the two buttons
 * that change it — without opening the team.
 *
 * Adam, 2026-09-02: "From the teams page (listing all teams), I want the
 * ability to assign teams to pitches and allocate all home games rather than
 * having to go into the team itself. So the team should show allocated home
 * venue and time."
 *
 * The reading half is always there, for everybody who can see the list: the
 * venue and the kick-off, or the honest absence of one. The editing half is
 * behind a `<details>` and only rendered for an administrator, because a list
 * of thirteen teams with thirteen open forms on it is not a list.
 *
 * Allocation reports itself where it was asked for. `allocate_team_fixtures()`
 * places each Sunday in its own sub-transaction, so a clash on one leaves the
 * rest standing, and the conflicts come back naming the booking in the way —
 * shown verbatim, in the row, rather than as "some fixtures failed".
 */

import { useActionState } from "react";
import { AlertCircle, CalendarCheck2, CheckCircle2, MapPin } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Select } from "@/components/ui/field";
import { groupByVenue, splitVenue } from "@/lib/pitch-venue";

import type { BulkAllocationState } from "./[id]/matchday-actions";
import { allocateTeamHomeGames, setTeamHomeVenue, type HomeVenueState } from "./home-venue-actions";

export type HomeVenuePitch = { id: string; name: string };

const NO_VENUE_STATE: HomeVenueState = {};
const NO_ALLOCATION: BulkAllocationState = {};

/** The one-line answer, for everybody. */
export function HomeVenueSummary({
  homePitch,
  homeKickoff,
  centralVenue,
}: {
  homePitch: string | null;
  homeKickoff: string | null;
  centralVenue: string | null;
}) {
  if (centralVenue) {
    return (
      <>
        <p>{centralVenue}</p>
        <p className="text-xs text-muted-foreground">Central venue — we book nothing</p>
      </>
    );
  }
  if (!homePitch) {
    return <p className="font-medium text-amber-700">No home pitch</p>;
  }
  const { venue, pitch } = splitVenue(homePitch);
  return (
    <>
      <p>{venue}</p>
      <p className="text-xs text-muted-foreground">
        {pitch}
        {homeKickoff ? ` · ${homeKickoff}` : " · no set kick-off"}
      </p>
    </>
  );
}

export function HomeVenueCell({
  teamId,
  teamName,
  homePitch,
  homeResourceId,
  homeKickoff,
  centralVenue,
  pitches,
  canEdit,
}: {
  teamId: string;
  teamName: string;
  homePitch: string | null;
  homeResourceId: string | null;
  homeKickoff: string | null;
  centralVenue: string | null;
  pitches: HomeVenuePitch[];
  canEdit: boolean;
}) {
  const [venueState, saveVenue, savingVenue] = useActionState(setTeamHomeVenue, NO_VENUE_STATE);
  const [allocState, allocate, allocating] = useActionState(allocateTeamHomeGames, NO_ALLOCATION);
  const venues = groupByVenue(pitches);

  return (
    <div className="space-y-1.5">
      <HomeVenueSummary
        homePitch={homePitch}
        homeKickoff={homeKickoff}
        centralVenue={centralVenue}
      />

      {canEdit && !centralVenue && (
        <details className="group">
          <summary className="inline-flex min-h-[44px] cursor-pointer list-none items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline [&::-webkit-details-marker]:hidden lg:min-h-0">
            <MapPin className="h-3 w-3" />
            {homeResourceId ? "Change" : "Set a pitch"}
          </summary>

          <div className="mt-2 w-64 space-y-3 rounded-lg border bg-card p-3">
            <form action={saveVenue} className="space-y-2">
              <input type="hidden" name="team_id" value={teamId} />
              <div className="space-y-1">
                <Label htmlFor={`home-pitch-${teamId}`} className="text-xs">
                  Home pitch
                </Label>
                <Select
                  id={`home-pitch-${teamId}`}
                  name="home_resource_id"
                  defaultValue={homeResourceId ?? ""}
                >
                  <option value="">No home pitch</option>
                  {venues.map((group) => (
                    <optgroup key={group.venue} label={group.venue}>
                      {group.pitches.map((pitch) => (
                        <option key={pitch.id} value={pitch.id}>
                          {splitVenue(pitch.name).pitch}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor={`home-ko-${teamId}`} className="text-xs">
                  Home kick-off
                </Label>
                <Input
                  id={`home-ko-${teamId}`}
                  name="home_kickoff_time"
                  type="time"
                  defaultValue={homeKickoff ?? ""}
                />
              </div>
              <Button type="submit" size="sm" disabled={savingVenue} className="w-full">
                {savingVenue ? "Saving…" : "Save"}
              </Button>
              {venueState.error && (
                <p className="break-words text-xs text-destructive">{venueState.error}</p>
              )}
              {venueState.notice && (
                <p className="text-xs text-emerald-700">{venueState.notice}</p>
              )}
            </form>

            <form action={allocate} className="space-y-2 border-t pt-3">
              <input type="hidden" name="team_id" value={teamId} />
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={allocating}
                className="w-full gap-1.5"
              >
                <CalendarCheck2 className="h-3.5 w-3.5" />
                {allocating ? "Allocating…" : "Allocate all home games"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Every future home fixture for {teamName}, onto the pitch and kick-off saved above.
              </p>
              {allocState.error && (
                <p className="break-words text-xs text-destructive">{allocState.error}</p>
              )}
              {allocState.allocated && (
                <div className="space-y-1">
                  <p
                    className={
                      "flex items-start gap-1 text-xs " +
                      (allocState.allocated.conflicts.length === 0
                        ? "text-emerald-700"
                        : "text-amber-700")
                    }
                  >
                    {allocState.allocated.conflicts.length === 0 ? (
                      <CheckCircle2 className="mt-px h-3 w-3 shrink-0" />
                    ) : (
                      <AlertCircle className="mt-px h-3 w-3 shrink-0" />
                    )}
                    {allocState.allocated.total === 0
                      ? "No future home fixtures to allocate."
                      : `${allocState.allocated.allocated} of ${allocState.allocated.total} placed${
                          allocState.allocated.conflicts.length > 0
                            ? ` — ${allocState.allocated.conflicts.length} could not be:`
                            : "."
                        }`}
                  </p>
                  {allocState.allocated.conflicts.length > 0 && (
                    <ul className="space-y-1 text-[11px] text-amber-900">
                      {allocState.allocated.conflicts.map((conflict) => (
                        <li key={conflict.fixture_id} className="break-words">
                          <span className="font-medium">{conflict.label}:</span> {conflict.error}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </form>
          </div>
        </details>
      )}
    </div>
  );
}
