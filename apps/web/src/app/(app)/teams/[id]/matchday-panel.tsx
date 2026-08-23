"use client";

/**
 * Match day defaults — where the team plays and how long a match takes.
 *
 * Two things flow out of this card and neither is computed here:
 *
 *   1. `home_resource_id` is what `/pitches` pre-selects when an administrator
 *      allocates one of this team's home fixtures, and what `/pitches/book`
 *      pre-selects when a coach books training for it.
 *   2. halves × half length + half time is the pitch slot, and
 *      `team_match_duration()` is the function that says so. New fixtures
 *      inherit it in place of the blanket 90 minutes.
 *
 * The summary line under the numbers is the whole point of the card: "2 × 35 +
 * 10 = 80 min pitch slot" is the sentence a coach can check at a glance, and it
 * updates as they type rather than after a save.
 *
 * The pitch picker is grouped by venue. There is no venues table — the venue
 * is the prefix of the pitch's name — so the grouping lives in
 * `lib/pitch-venue`, and a pitch named without the separator simply becomes its
 * own group instead of vanishing.
 */

import { useActionState, useState } from "react";
import { CalendarClock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Select } from "@/components/ui/field";
import { groupByVenue, splitVenue } from "@/lib/pitch-venue";

import { updateTeamMatchDay, type MatchDayState } from "./matchday-actions";

export type MatchDayPitch = { id: string; name: string };

export type MatchDayValues = {
  home_resource_id: string | null;
  match_halves: number;
  half_length_minutes: number | null;
  half_time_minutes: number;
  default_pre_buffer_minutes: number | null;
  default_post_buffer_minutes: number | null;
};

/** Blank stays blank; anything else is read as written so 0 survives. */
function toField(value: number | null): string {
  return value === null ? "" : String(value);
}

function asInt(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) ? parsed : null;
}

export function MatchDayPanel({
  teamId,
  pitches,
  values,
  canEdit,
}: {
  teamId: string;
  pitches: MatchDayPitch[];
  values: MatchDayValues;
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState<MatchDayState, FormData>(updateTeamMatchDay, {});

  const [homeResourceId, setHomeResourceId] = useState(values.home_resource_id ?? "");
  const [halves, setHalves] = useState(String(values.match_halves));
  const [halfLength, setHalfLength] = useState(toField(values.half_length_minutes));
  const [halfTime, setHalfTime] = useState(String(values.half_time_minutes));

  const homePitch = pitches.find((pitch) => pitch.id === homeResourceId) ?? null;
  const venues = groupByVenue(pitches);

  // Exactly what `team_match_duration()` computes, and null in the same case.
  const halvesValue = asInt(halves);
  const halfLengthValue = asInt(halfLength);
  const halfTimeValue = asInt(halfTime);
  const duration =
    halvesValue !== null && halfLengthValue !== null && halfTimeValue !== null
      ? halvesValue * halfLengthValue + halfTimeValue
      : null;

  if (!canEdit) {
    return (
      <div className="space-y-1 text-sm text-muted-foreground">
        <p>
          {homePitch
            ? `Home pitch: ${homePitch.name}.`
            : "No home pitch set, so allocation starts from the first pitch on the list."}
        </p>
        <p>
          {duration === null
            ? "No match length set — new fixtures are given the club's standard 90 minutes."
            : `${halvesValue} × ${halfLengthValue} + ${halfTimeValue} = ${duration} min pitch slot.`}
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="team_id" value={teamId} />

      <div className="space-y-1">
        <Label htmlFor={`home-resource-${teamId}`}>Home venue and pitch</Label>
        <Select
          id={`home-resource-${teamId}`}
          name="home_resource_id"
          value={homeResourceId}
          onChange={(event) => setHomeResourceId(event.target.value)}
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
        <p className="text-xs text-muted-foreground">
          Allocating one of this team&apos;s home fixtures starts here, and so does booking its
          training. Every other pitch stays selectable — this is a default, not a restriction.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor={`match-halves-${teamId}`}>Halves</Label>
          <Input
            id={`match-halves-${teamId}`}
            name="match_halves"
            type="number"
            inputMode="numeric"
            min={1}
            max={4}
            required
            value={halves}
            onChange={(event) => setHalves(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`half-length-${teamId}`}>Minutes per half</Label>
          <Input
            id={`half-length-${teamId}`}
            name="half_length_minutes"
            type="number"
            inputMode="numeric"
            min={5}
            max={60}
            placeholder="Not set"
            value={halfLength}
            onChange={(event) => setHalfLength(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`half-time-${teamId}`}>Half time (min)</Label>
          <Input
            id={`half-time-${teamId}`}
            name="half_time_minutes"
            type="number"
            inputMode="numeric"
            min={0}
            max={30}
            required
            value={halfTime}
            onChange={(event) => setHalfTime(event.target.value)}
          />
        </div>
      </div>

      <p
        aria-live="polite"
        className="rounded-lg border bg-secondary/40 px-3 py-2 text-sm font-medium"
      >
        {duration === null ? (
          <span className="font-normal text-muted-foreground">
            Leave the minutes per half blank and new fixtures keep the club&apos;s standard 90
            minutes.
          </span>
        ) : (
          <>
            {halvesValue} × {halfLengthValue} + {halfTimeValue} = {duration} min pitch slot
          </>
        )}
      </p>

      <fieldset className="space-y-3 rounded-lg border p-4">
        <legend className="px-1 text-sm font-semibold">Default buffers</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={`pre-buffer-${teamId}`}>Before the match (min)</Label>
            <Input
              id={`pre-buffer-${teamId}`}
              name="default_pre_buffer_minutes"
              type="number"
              inputMode="numeric"
              min={0}
              max={120}
              placeholder="Use the pitch's own"
              defaultValue={toField(values.default_pre_buffer_minutes)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`post-buffer-${teamId}`}>After the match (min)</Label>
            <Input
              id={`post-buffer-${teamId}`}
              name="default_post_buffer_minutes"
              type="number"
              inputMode="numeric"
              min={0}
              max={120}
              placeholder="Use the pitch's own"
              defaultValue={toField(values.default_post_buffer_minutes)}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Warm-up and clear-up time held either side of the slot, so nobody else is booked onto the
          pitch during it. Left blank, the pitch&apos;s own default is used; an administrator can
          still override both when they allocate.
        </p>
      </fieldset>

      {state.error && (
        <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state.notice && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {state.notice}
        </p>
      )}

      <Button type="submit" size="sm" disabled={pending}>
        <CalendarClock className="h-4 w-4" />
        {pending ? "Saving…" : "Save match day defaults"}
      </Button>
    </form>
  );
}
