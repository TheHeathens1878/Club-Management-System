"use client";

/**
 * The whole season in one click (Adam, 2026-08-25: "the ability to allocate
 * all fixtures to a pitch … and all fixtures allocated to a central venue").
 *
 * Two shapes, decided by the team's match-day settings:
 *
 *   - A team on our own pitches gets "Allocate every home fixture": pitch and
 *     kick-off open on the team's saved defaults, and the run reports itself
 *     Sunday by Sunday — allocated count up front, every clash named verbatim
 *     with the database's own message, because that message says exactly whose
 *     booking is in the way.
 *   - A central-venue team gets one button that points every future fixture at
 *     the named venue and frees anything of theirs still on our calendar.
 *
 * Nothing here decides anything: allocate_team_fixtures() and
 * allocate_team_fixtures_central() own the rules (club_admin only, home
 * fixtures only, one sub-transaction per fixture).
 */

import { useActionState } from "react";
import { AlertCircle, CalendarCheck2, CheckCircle2, MapPin } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Select } from "@/components/ui/field";
import { groupByVenue, splitVenue } from "@/lib/pitch-venue";

import {
  allocateAllTeamFixtures,
  sendFixturesToCentralVenue,
  type BulkAllocationState,
} from "./matchday-actions";
import type { MatchDayPitch } from "./matchday-panel";

const EMPTY: BulkAllocationState = {};

function Feedback({ state }: { state: BulkAllocationState }) {
  if (state.error) {
    return (
      <p className="flex items-start gap-1.5 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span className="break-words">{state.error}</span>
      </p>
    );
  }
  if (state.allocated) {
    const { total, allocated, conflicts } = state.allocated;
    return (
      <div className="space-y-2">
        <p
          className={
            conflicts.length === 0
              ? "flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
              : "flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
          }
        >
          {conflicts.length === 0 ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" />
          )}
          {total === 0
            ? "No future home fixtures to allocate."
            : `${allocated} of ${total} home ${total === 1 ? "fixture" : "fixtures"} allocated${
                conflicts.length > 0 ? ` — ${conflicts.length} could not be placed:` : "."
              }`}
        </p>
        {conflicts.length > 0 && (
          <ul className="space-y-1 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-900">
            {conflicts.map((conflict) => (
              <li key={conflict.fixture_id} className="break-words">
                <span className="font-medium">{conflict.label}:</span>{" "}
                {/* Verbatim from the database: it names the bookings in the way. */}
                {conflict.error}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  if (state.central) {
    return (
      <p className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        {state.central.updated === 0
          ? "No future fixtures to move."
          : `${state.central.updated} ${
              state.central.updated === 1 ? "fixture" : "fixtures"
            } now carry the central venue${
              state.central.bookingsFreed > 0
                ? `; ${state.central.bookingsFreed} pitch ${
                    state.central.bookingsFreed === 1 ? "booking" : "bookings"
                  } freed`
                : ""
            }.`}
      </p>
    );
  }
  return null;
}

export function AllocateAllPanel({
  teamId,
  pitches,
  homeResourceId,
  homeKickoffTime,
  centralVenueName,
}: {
  teamId: string;
  pitches: MatchDayPitch[];
  homeResourceId: string | null;
  homeKickoffTime: string | null;
  centralVenueName: string | null;
}) {
  const [state, action, pending] = useActionState(allocateAllTeamFixtures, EMPTY);
  const [centralState, centralAction, centralPending] = useActionState(
    sendFixturesToCentralVenue,
    EMPTY,
  );

  if (centralVenueName) {
    return (
      <form action={centralAction} className="space-y-3">
        <input type="hidden" name="team_id" value={teamId} />
        <p className="text-sm text-muted-foreground">
          Every future fixture — home and away, the league hosts them all — is pointed at{" "}
          <span className="font-medium text-foreground">{centralVenueName}</span>, and anything of
          this team&apos;s still booked onto the club&apos;s own pitches is freed. Fixtures
          imported later pick the venue up automatically.
        </p>
        <Button type="submit" size="sm" disabled={centralPending}>
          <MapPin className="h-4 w-4" />
          {centralPending ? "Moving…" : `Send every fixture to ${centralVenueName}`}
        </Button>
        <Feedback state={centralState} />
      </form>
    );
  }

  const venues = groupByVenue(pitches);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="team_id" value={teamId} />
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="space-y-1">
          <Label htmlFor={`allocate-all-pitch-${teamId}`}>Pitch</Label>
          <Select
            id={`allocate-all-pitch-${teamId}`}
            name="resource_id"
            defaultValue={homeResourceId ?? ""}
            required
          >
            <option value="" disabled>
              Choose a pitch
            </option>
            {venues.map((group) => (
              <optgroup key={group.venue} label={group.venue}>
                {group.pitches.map((pitch) => (
                  <option key={pitch.id} value={pitch.id}>
                    {splitVenue(pitch.name).pitch}
                    {pitch.id === homeResourceId ? " (home)" : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`allocate-all-kickoff-${teamId}`}>Kick-off</Label>
          <Input
            id={`allocate-all-kickoff-${teamId}`}
            name="kickoff_time"
            type="time"
            defaultValue={homeKickoffTime ? homeKickoffTime.slice(0, 5) : ""}
            className="w-32"
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Every future home fixture still to be played goes onto this pitch
        {homeKickoffTime ? " at this kick-off" : ", re-timed to this kick-off if one is given"}.
        A fixture whose slot is already taken is skipped and named below — nothing else is undone.
        Away fixtures are never touched.
      </p>
      <Button type="submit" size="sm" disabled={pending}>
        <CalendarCheck2 className="h-4 w-4" />
        {pending ? "Allocating…" : "Allocate every home fixture"}
      </Button>
      <Feedback state={state} />
    </form>
  );
}
