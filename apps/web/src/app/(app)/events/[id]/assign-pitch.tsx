"use client";

/**
 * "Click into an event and assign a pitch" (Adam, 2026-08-25) — the admin's
 * inline allocation. `assign_event_pitch` re-checks everything; a clash comes
 * back with the slot named, word for word.
 */

import { useActionState } from "react";
import { LandPlot } from "lucide-react";

import { Button } from "@/components/ui/button";

import { assignEventPitch, type EventActionState } from "../actions";

const EMPTY: EventActionState = {};

export function AssignPitch({
  eventId,
  pitches,
  homeResourceId = null,
}: {
  eventId: string;
  pitches: { id: string; name: string }[];
  /** `teams.home_resource_id` — where the select opens; any pitch stays pickable. */
  homeResourceId?: string | null;
}) {
  const [state, action, saving] = useActionState(assignEventPitch, EMPTY);
  // An inactive or deleted home pitch is not in the list, so it cannot be the
  // starting value.
  const home = pitches.some((pitch) => pitch.id === homeResourceId) ? homeResourceId : null;

  return (
    <form action={action} className="space-y-2">
      {state.error ? (
        <p className="whitespace-pre-line rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {state.notice}
        </p>
      ) : null}
      <input type="hidden" name="event_id" value={eventId} />
      <div className="flex flex-wrap items-center gap-2">
        <select
          name="resource_id"
          required
          defaultValue={home ?? ""}
          className="h-11 w-full min-w-[14rem] rounded-md border border-input bg-transparent px-3 text-sm sm:h-9 sm:w-auto"
        >
          <option value="" disabled>
            Choose a pitch…
          </option>
          {pitches.map((pitch) => (
            <option key={pitch.id} value={pitch.id}>
              {pitch.name}
              {pitch.id === home ? " (home)" : ""}
            </option>
          ))}
        </select>
        <Button
          type="submit"
          size="sm"
          className="h-11 w-full sm:h-9 sm:w-auto"
          disabled={saving}
        >
          <LandPlot className="h-4 w-4" /> {saving ? "Assigning…" : "Assign pitch"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        A fixture goes through the allocator (its booking and buffers move with it); a practice or
        social books the slot directly. Clashes are refused with the slot named.
      </p>
    </form>
  );
}
