"use client";

/**
 * The venues this block plans at (Adam, 2026-09-13: "for each training block,
 * I need to be able to select which venues apply to that training block").
 *
 * A venue a slot names is put here by the database on its own; one with
 * slots in the block cannot be taken off until they are moved or removed,
 * and the guard says so. Being on the block is what lets the timetable offer
 * the venue's bookings as slots to use (2026-09-14) — the timetable itself
 * draws only venues with a slot or a booking. The chips carry the club's
 * share of each venue, because that is what the planner hands out. Drawn
 * inside a FoldCard on the block page, so this is the content only.
 */

import { useActionState } from "react";
import { Plus, X } from "lucide-react";

import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Label } from "@/components/ui/input";
import { shareChip } from "@/lib/training-plan";

import { addBlockVenue, removeBlockVenue } from "../actions";
import { EMPTY_PLAN_STATE, PlanFeedback } from "../plan-feedback";
import type { VenueOption } from "./types";

function venueShare(venue: VenueOption): string {
  if (venue.trainingParts <= 1 || venue.trainingShares >= venue.trainingParts) return "whole pitch";
  return `${shareChip(venue.trainingShares, venue.trainingParts)} of the pitch`;
}

function RemoveVenue({ blockId, venue, slotsHere }: { blockId: string; venue: VenueOption; slotsHere: number }) {
  const [state, action, pending] = useActionState(removeBlockVenue, EMPTY_PLAN_STATE);
  return (
    <form action={action} className="inline-flex items-center gap-1">
      <input type="hidden" name="block_id" value={blockId} />
      <input type="hidden" name="venue_id" value={venue.id} />
      {state.error ? <span className="max-w-[16rem] text-xs text-destructive">{state.error}</span> : null}
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        disabled={pending || slotsHere > 0}
        aria-label={`Take ${venue.name} off this block`}
        title={
          slotsHere > 0
            ? `${slotsHere} ${slotsHere === 1 ? "slot is" : "slots are"} at this venue — move or remove them first`
            : "Take off the block"
        }
        className="h-7 w-7 rounded-full p-0 text-muted-foreground disabled:opacity-40"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </Button>
    </form>
  );
}

export function BlockVenuesCard({
  blockId,
  venues,
  blockVenueIds,
  slotsByVenue,
}: {
  blockId: string;
  venues: VenueOption[];
  blockVenueIds: string[];
  slotsByVenue: Map<string, number>;
}) {
  const [state, action] = useActionState(addBlockVenue, EMPTY_PLAN_STATE);
  const on = new Set(blockVenueIds);
  const chosen = venues.filter((venue) => on.has(venue.id));
  const training = venues.filter((venue) => !on.has(venue.id) && venue.forTraining);
  const grounds = venues.filter((venue) => !on.has(venue.id) && !venue.forTraining);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Where this block trains. A slot added at a venue puts it here on its own; a venue on the block
        has its bookings offered on the timetable. The share is what the club has of the pitch, set
        under Venues.
      </p>
      {chosen.length === 0 ? (
        <p className="text-sm text-muted-foreground">No venues yet — pick the ones this block trains at.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {chosen.map((venue) => (
            <li
              key={venue.id}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border bg-card pl-3 pr-1 text-list font-medium"
            >
              <span>{venue.name}</span>
              <span className="text-muted-foreground">· {venueShare(venue)}</span>
              <RemoveVenue blockId={blockId} venue={venue} slotsHere={slotsByVenue.get(venue.id) ?? 0} />
            </li>
          ))}
        </ul>
      )}

      {training.length + grounds.length > 0 ? (
        <form action={action} className="flex flex-wrap items-end gap-2">
          <div className="basis-full empty:hidden">
            <PlanFeedback state={state} />
          </div>
          <input type="hidden" name="block_id" value={blockId} />
          <div className="min-w-0 flex-1 basis-56 space-y-1">
            <Label htmlFor={`block-venue-${blockId}`} className="text-xs">
              Add a venue
            </Label>
            <Select id={`block-venue-${blockId}`} name="venue_id" defaultValue="" required>
              <option value="" disabled>
                Choose a venue…
              </option>
              {training.length > 0 ? (
                <optgroup label="Training venues">
                  {training.map((venue) => (
                    <option key={venue.id} value={venue.id}>
                      {venue.name} · {venueShare(venue)}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {grounds.length > 0 ? (
                <optgroup label="Match grounds">
                  {grounds.map((venue) => (
                    <option key={venue.id} value={venue.id}>
                      {venue.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </Select>
          </div>
          <SubmitButton size="sm" variant="outline" className="touch" pendingLabel="Adding…">
            <Plus className="h-4 w-4" aria-hidden /> Add
          </SubmitButton>
        </form>
      ) : null}
    </div>
  );
}
