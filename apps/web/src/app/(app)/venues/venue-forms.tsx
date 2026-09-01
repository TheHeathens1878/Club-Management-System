"use client";

/**
 * The three forms a venue screen needs: add one, edit one, retire or restore
 * one. Each is its own `useActionState`, so a refusal appears beside the thing
 * it refused rather than at the top of the page.
 */

import Link from "next/link";
import { useActionState } from "react";
import { Archive, RotateCcw } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";

import {
  createVenue,
  setVenueActive,
  updateVenue,
  type VenueActionState,
} from "./venue-actions";
import { EMPTY_VENUE_FIELDS, VenueFields, type VenueFieldValues } from "./venue-fields";

const EMPTY: VenueActionState = {};

export function VenueFeedback({ state }: { state: VenueActionState }) {
  if (state.error) {
    return (
      <p className="whitespace-pre-line rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {state.error}
      </p>
    );
  }
  if (state.notice) {
    return (
      <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        {state.notice}
      </p>
    );
  }
  return null;
}

export function NewVenueForm() {
  const [state, action, pending] = useActionState(createVenue, EMPTY);

  return (
    <form action={action} className="space-y-4">
      <VenueFields idPrefix="new-venue" values={EMPTY_VENUE_FIELDS} />
      <VenueFeedback state={state} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" className="h-11 w-full sm:h-9 sm:w-auto" disabled={pending}>
          {pending ? "Adding…" : "Add venue"}
        </Button>
        <Link
          href={state.createdId ? `/venues/${state.createdId}` : "/venues"}
          className={
            buttonVariants({ variant: "outline", size: "sm" }) + " h-11 w-full sm:h-9 sm:w-auto"
          }
        >
          {state.createdId ? "Open it and add its pitches" : "Cancel"}
        </Link>
      </div>
    </form>
  );
}

export function EditVenueForm({
  venueId,
  values,
}: {
  venueId: string;
  values: VenueFieldValues;
}) {
  const [state, action, pending] = useActionState(updateVenue, EMPTY);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="venue_id" value={venueId} />
      <VenueFields idPrefix={`venue-${venueId}`} values={values} />
      <VenueFeedback state={state} />
      <Button type="submit" size="sm" className="h-11 w-full sm:h-9 sm:w-auto" disabled={pending}>
        {pending ? "Saving…" : "Save venue"}
      </Button>
    </form>
  );
}

export function RetireVenueForm({ venueId, active }: { venueId: string; active: boolean }) {
  const [state, action, pending] = useActionState(setVenueActive, EMPTY);

  return (
    <div className="space-y-2">
      <form action={action}>
        <input type="hidden" name="venue_id" value={venueId} />
        <input type="hidden" name="active" value={active ? "no" : "yes"} />
        <Button
          type="submit"
          size="sm"
          variant={active ? "outline" : "default"}
          className="h-11 gap-1.5 sm:h-9"
          disabled={pending}
        >
          {active ? (
            <>
              <Archive className="h-3.5 w-3.5" /> Retire this venue
            </>
          ) : (
            <>
              <RotateCcw className="h-3.5 w-3.5" /> Bring it back into use
            </>
          )}
        </Button>
      </form>
      <VenueFeedback state={state} />
      <p className="text-xs text-muted-foreground">
        A venue is never deleted. Its coaches group is a conversation, and a conversation is never
        destroyed — retiring keeps the room, the history and the address, and simply stops the
        ground being offered.
      </p>
    </div>
  );
}
