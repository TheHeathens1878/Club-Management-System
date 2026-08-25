"use client";

/**
 * Edit one event (Adam, 2026-08-25). Deliberately the /events/new form minus
 * the two things that only make sense at creation — "repeats weekly" and
 * "reserve this pitch" — and prefilled from the event as it stands.
 *
 * The pitch is the one field with a caveat, and the form says it out loud
 * rather than hiding the control: an event that is HOLDING a pitch moves that
 * booking with it, so it cannot simply stop having a venue here. Giving the
 * pitch back is cancelling the event, or the pitch diary.
 */

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { updateEvent, type EventActionState } from "../../actions";
import { EVENT_TYPES, eventTypeLabel } from "../../shared";

const EMPTY: EventActionState = {};

export type VenueOption = { id: string; name: string };

export type EventInitial = {
  id: string;
  type: string;
  title: string;
  date: string;
  time: string;
  meetTime: string;
  durationMinutes: number;
  venueResourceId: string;
  venueText: string;
  notes: string;
  /** The event holds a live pitch booking, which moves with it. */
  holdsPitch: boolean;
};

export function EditEventForm({
  initial,
  venues,
}: {
  initial: EventInitial;
  venues: VenueOption[];
}) {
  const [state, action, saving] = useActionState(updateEvent, EMPTY);
  const [venueMode, setVenueMode] = useState<"resource" | "text">(
    initial.venueResourceId || initial.holdsPitch ? "resource" : "text",
  );
  const [meetTime, setMeetTime] = useState(initial.meetTime);

  return (
    <form action={action} className="max-w-xl space-y-4">
      <input type="hidden" name="event_id" value={initial.id} />

      {state.error ? (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <p className="whitespace-pre-line">{state.error}</p>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <label htmlFor="event-type" className="text-sm font-medium">
          Event type
        </label>
        <select
          id="event-type"
          name="type"
          required
          className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm sm:h-9"
          defaultValue={initial.type}
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
        <Input id="event-title" name="title" required maxLength={120} defaultValue={initial.title} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <label htmlFor="event-date" className="text-sm font-medium">
            Date
          </label>
          <Input id="event-date" name="date" type="date" required defaultValue={initial.date} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="event-time" className="text-sm font-medium">
            Start time
          </label>
          <Input id="event-time" name="time" type="time" required defaultValue={initial.time} />
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
            onChange={(event) => setMeetTime(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">Leave it empty for no separate meet time.</p>
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
            required
            defaultValue={initial.durationMinutes}
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
              disabled={initial.holdsPitch}
            />
            Somewhere else
          </label>
        </div>
        {venueMode === "resource" ? (
          <select
            name="venue_resource_id"
            className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm sm:h-9"
            defaultValue={initial.venueResourceId}
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
            defaultValue={initial.venueText}
            placeholder="e.g. Longford Park, Stretford M32 8DA"
          />
        )}
        {initial.holdsPitch ? (
          <p className="text-xs text-muted-foreground">
            This event is holding a pitch, so the booking moves with it — a new time or a different
            pitch is rebooked as you save, and a clash stops the change. To give the pitch back,
            cancel the event.
          </p>
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
          defaultValue={initial.notes}
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
        />
      </div>

      <Button type="submit" className="h-11 w-full sm:w-auto" disabled={saving}>
        {saving ? "Saving…" : "Save changes"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Answers already given stand. A new time or venue is flagged on the event and the households
        are told once — nobody is asked to answer again.
      </p>
    </form>
  );
}
