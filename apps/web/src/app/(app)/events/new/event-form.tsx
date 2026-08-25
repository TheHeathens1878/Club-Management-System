"use client";

/**
 * One form for both shapes Adam asked for: a one-off event, or a weekly
 * series ("Coaches should be able to create both one-off and recurring
 * events"). Ticking "repeats weekly" swaps the submit path to
 * `create_event_series`; everything else is shared.
 */

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { createEvent, type EventActionState } from "../actions";
import { EVENT_TYPES, eventTypeLabel } from "../shared";

const EMPTY: EventActionState = {};

export type TeamOption = { id: string; name: string };
/** A club pitch. `isPitch` decides whether reserving it is even offered. */
export type VenueOption = { id: string; name: string };

export function EventForm({
  teams,
  venues,
  canConfirm,
}: {
  teams: TeamOption[];
  venues: VenueOption[];
  /** Club admins hold the pitch outright; a coach's booking is a request. */
  canConfirm: boolean;
}) {
  const [state, action, saving] = useActionState(createEvent, EMPTY);
  const [repeats, setRepeats] = useState(false);
  const [venueMode, setVenueMode] = useState<"resource" | "text">("resource");
  const [venueId, setVenueId] = useState("");
  // "Meet at" follows the start time at 30 minutes before until the coach
  // touches it — then their choice stands (Adam, 2026-08-25).
  const [meetTime, setMeetTime] = useState("");
  const [meetEdited, setMeetEdited] = useState(false);

  const canBook = venueMode === "resource" && venueId !== "";

  function minus30(startTime: string): string {
    const parts = startTime.split(":");
    const hours = Number(parts[0] ?? "");
    const minutes = Number(parts[1] ?? "");
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return "";
    const total = (hours * 60 + minutes - 30 + 1440) % 1440;
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  }

  return (
    <form action={action} className="max-w-xl space-y-4">
      {state.error ? (
        <div className="space-y-1 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <p className="whitespace-pre-line">{state.error}</p>
          {state.clashes && state.clashes.length > 0 ? (
            <ul className="list-inside list-disc text-xs">
              {state.clashes.map((clash) => (
                <li key={clash}>{clash}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {state.notice ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {state.notice}
        </p>
      ) : null}

      <div className="space-y-1.5">
        <label htmlFor="event-team" className="text-sm font-medium">
          Team
        </label>
        <select
          id="event-team"
          name="team_id"
          required
          className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm sm:h-9"
          defaultValue={teams.length === 1 ? teams[0]?.id : ""}
        >
          <option value="" disabled>
            Choose a team…
          </option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="event-type" className="text-sm font-medium">
          Event type
        </label>
        <select
          id="event-type"
          name="type"
          required
          className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm sm:h-9"
          defaultValue="practice"
        >
          {EVENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {eventTypeLabel(type)}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="event-title" className="text-sm font-medium">
          Name
        </label>
        <Input
          id="event-title"
          name="title"
          required
          maxLength={120}
          placeholder="e.g. Tuesday practice, vs Rovers (H), End of season BBQ"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <label htmlFor="event-date" className="text-sm font-medium">
            Date
          </label>
          <Input id="event-date" name="date" type="date" required />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="event-time" className="text-sm font-medium">
            Start time
          </label>
          <Input
            id="event-time"
            name="time"
            type="time"
            required
            onChange={(event) => {
              if (!meetEdited) setMeetTime(minus30(event.target.value));
            }}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="event-meet" className="text-sm font-medium">
            Meet at
          </label>
          <Input
            id="event-meet"
            name="meet_time"
            type="time"
            value={meetTime}
            onChange={(event) => {
              setMeetEdited(true);
              setMeetTime(event.target.value);
            }}
          />
          <p className="text-xs text-muted-foreground">30 minutes before the start unless you change it.</p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="event-duration" className="text-sm font-medium">
            Length (minutes)
          </label>
          <Input
            id="event-duration"
            name="duration_minutes"
            type="number"
            min={15}
            max={480}
            step={5}
            defaultValue={60}
            required
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <span className="text-sm font-medium">Venue</span>
        <div className="flex gap-4 text-sm">
          <label className="flex min-h-[44px] items-center gap-2 sm:min-h-0">
            <input
              type="radio"
              name="venue_mode"
              checked={venueMode === "resource"}
              onChange={() => setVenueMode("resource")}
            />
            A club venue
          </label>
          <label className="flex min-h-[44px] items-center gap-2 sm:min-h-0">
            <input
              type="radio"
              name="venue_mode"
              checked={venueMode === "text"}
              onChange={() => setVenueMode("text")}
            />
            Somewhere else
          </label>
        </div>
        {venueMode === "resource" ? (
          <select
            name="venue_resource_id"
            className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm sm:h-9"
            value={venueId}
            onChange={(e) => setVenueId(e.target.value)}
          >
            <option value="">No venue yet</option>
            {venues.map((venue) => (
              <option key={venue.id} value={venue.id}>
                {venue.name}
              </option>
            ))}
          </select>
        ) : (
          <Input
            name="venue_text"
            maxLength={200}
            placeholder="e.g. Longford Park, Stretford M32 8DA"
          />
        )}

        {canBook ? (
          <label className="flex items-start gap-2 pt-2 text-sm">
            <input type="checkbox" name="book_pitch" value="true" defaultChecked className="mt-1" />
            <span>
              Reserve this pitch
              <span className="block text-xs text-muted-foreground">
                {canConfirm
                  ? "The pitch is booked and confirmed straight away. A clash stops the event being created."
                  : "A pitch request goes to the club for confirmation, exactly as booking from the pitches page does. A clash stops the event being created."}
              </span>
            </span>
          </label>
        ) : null}
      </div>

      <div className="space-y-1.5 rounded-lg border p-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            name="repeats"
            value="true"
            checked={repeats}
            onChange={(e) => setRepeats(e.target.checked)}
          />
          Repeats weekly
        </label>
        {repeats ? (
          <div className="space-y-1.5 pt-2">
            <label htmlFor="event-repeat-until" className="text-sm font-medium">
              Repeat until
            </label>
            <Input id="event-repeat-until" name="repeat_until" type="date" required />
            <p className="text-xs text-muted-foreground">
              One event every week on the same day and time, up to and including this date (at
              most 60).
              {canBook
                ? " A week whose pitch is already taken still gets its event — you will be told which weeks to sort out."
                : ""}
            </p>
          </div>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="event-notes" className="text-sm font-medium">
          Notes (optional)
        </label>
        <textarea
          id="event-notes"
          name="notes"
          maxLength={1000}
          rows={3}
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
          placeholder="Anything the team should know — kit, car sharing, what to bring"
        />
      </div>

      <Button type="submit" className="h-11 w-full sm:w-auto" disabled={saving}>
        {saving ? "Creating…" : "Create event"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Everyone on the team is notified in the app and can accept or decline. A series lands as
        one notification, not one per week.
      </p>
    </form>
  );
}
