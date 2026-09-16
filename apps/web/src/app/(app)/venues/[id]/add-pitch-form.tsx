"use client";

/**
 * A new pitch on this ground, made here (Adam, 2026-09-13: "some venues have
 * two pitches also … pitches should be allocatable to venues"). Partington
 * Sports Village gets "Pitch 1" and "Pitch 2" without a trip to /pitches/manage:
 * a name and what it is for; the rest of a pitch's fields are edited there.
 */

import { useActionState, useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

import { createPitchAtVenue, type VenueActionState } from "../venue-actions";
import { VenueFeedback } from "../venue-forms";

const EMPTY: VenueActionState = {};

export function AddPitchForm({ venueId, forTraining }: { venueId: string; forTraining: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createPitchAtVenue, EMPTY);

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} className="touch gap-1.5">
        <Plus className="h-3.5 w-3.5" /> New pitch here
      </Button>
    );
  }

  return (
    <form action={action} className="space-y-3 rounded-lg border bg-secondary/30 p-3">
      <input type="hidden" name="venue_id" value={venueId} />
      <div className="space-y-1.5">
        <Label htmlFor={`new-pitch-${venueId}`}>Pitch name</Label>
        <Input id={`new-pitch-${venueId}`} name="name" placeholder="e.g. Pitch 1" maxLength={120} required autoFocus />
      </div>
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium leading-none">Used for</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <label className="touch flex items-center gap-2 text-sm">
            <input type="checkbox" name="for_matches" defaultChecked={!forTraining} className="h-4 w-4 rounded border-input" />
            Matches
          </label>
          <label className="touch flex items-center gap-2 text-sm">
            <input type="checkbox" name="for_training" defaultChecked className="h-4 w-4 rounded border-input" />
            Training
          </label>
        </div>
      </fieldset>
      <VenueFeedback state={state} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending} className="touch">
          {pending ? "Adding…" : "Add the pitch"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} className="touch">
          Cancel
        </Button>
      </div>
    </form>
  );
}
