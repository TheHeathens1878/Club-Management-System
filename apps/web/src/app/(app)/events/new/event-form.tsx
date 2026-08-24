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
export type VenueOption = { id: string; name: string };

export function EventForm({
  teams,
  venues,
}: {
  teams: TeamOption[];
  venues: VenueOption[];
}) {
  const [state, action, saving] = useActionState(createEvent, EMPTY);
  const [repeats, setRepeats] = useState(false);
  const [venueMode, setVenueMode] = useState<"resource" | "text">("resource");

  return (
    <form action={action} className="max-w-xl space-y-4">
      {state.error ? (
        <p className="whitespace-pre-line rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
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
          className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
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
          className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
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
          <Input id="event-time" name="time" type="time" required />
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
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="venue_mode"
              checked={venueMode === "resource"}
              onChange={() => setVenueMode("resource")}
            />
            A club venue
          </label>
          <label className="flex items-center gap-2">
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
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            defaultValue=""
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

      <Button type="submit" disabled={saving}>
        {saving ? "Creating…" : "Create event"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Everyone on the team is notified in the app and can accept or decline. A series lands as
        one notification, not one per week.
      </p>
    </form>
  );
}
