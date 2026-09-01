"use client";

/**
 * Putting a pitch on a ground, and taking it off again.
 *
 * No optimistic UI: the row moves only once the server action has come back,
 * because moving it is a bigger act than it looks — `resources_sync_venue_groups`
 * walks the coaches of every team that plays here into or out of the venue's
 * group on the same statement. When it refuses, the database's own sentence is
 * what is shown.
 */

import { useActionState } from "react";
import { Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";

import { setPitchVenue, type VenueActionState } from "../venue-actions";
import { VenueFeedback } from "../venue-forms";

const EMPTY: VenueActionState = {};

export type PitchRow = { id: string; name: string; active: boolean };

export function AttachPitchForm({
  venueId,
  candidates,
}: {
  venueId: string;
  /** Pitches on no venue, or on another one. */
  candidates: { id: string; name: string; currentVenue: string | null }[];
}) {
  const [state, action, pending] = useActionState(setPitchVenue, EMPTY);

  if (candidates.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Every pitch the club has is already on a venue.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-3 rounded-lg border bg-secondary/30 p-3">
      <input type="hidden" name="venue_id" value={venueId} />
      <input type="hidden" name="attach" value="yes" />
      <Select name="resource_id" defaultValue="" aria-label="Pitch to add" required>
        <option value="" disabled>
          Choose a pitch…
        </option>
        {candidates.map((pitch) => (
          <option key={pitch.id} value={pitch.id}>
            {pitch.name}
            {pitch.currentVenue ? ` — currently on ${pitch.currentVenue}` : ""}
          </option>
        ))}
      </Select>
      <VenueFeedback state={state} />
      <Button
        type="submit"
        size="sm"
        className="min-h-[44px] w-full gap-1.5 sm:w-auto lg:min-h-0"
        disabled={pending}
      >
        <Plus className="h-3.5 w-3.5" /> {pending ? "Adding…" : "Add this pitch"}
      </Button>
    </form>
  );
}

export function DetachPitchForm({ venueId, pitch }: { venueId: string; pitch: PitchRow }) {
  const [state, action, pending] = useActionState(setPitchVenue, EMPTY);

  return (
    <div className="space-y-2">
      <form action={action}>
        <input type="hidden" name="venue_id" value={venueId} />
        <input type="hidden" name="resource_id" value={pitch.id} />
        <input type="hidden" name="attach" value="no" />
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          className="min-h-[44px] gap-1.5 lg:min-h-0"
          disabled={pending}
        >
          <Minus className="h-3.5 w-3.5" /> Take off
        </Button>
      </form>
      <VenueFeedback state={state} />
    </div>
  );
}
