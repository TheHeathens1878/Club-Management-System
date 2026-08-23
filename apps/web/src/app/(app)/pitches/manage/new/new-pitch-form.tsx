"use client";

/**
 * Add a pitch (gap 7).
 *
 * `type` is not on the form — `createPitch()` pins it to `pitch`. A function
 * room is a different screen with a different set of columns, and letting this
 * form choose would put a room on the pitch grid.
 */

import Link from "next/link";
import { useActionState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/input";
import { Select } from "@/components/ui/field";

import { createPitch, type PitchAdminActionState } from "../pitch-actions";
import { PitchAdminFeedback } from "../manage-panel";
import { EMPTY_PITCH_FIELDS, PitchFields } from "../pitch-fields";

const EMPTY: PitchAdminActionState = {};

export function NewPitchForm() {
  const [state, action, pending] = useActionState(createPitch, EMPTY);

  return (
    <form action={action} className="space-y-4">
      <PitchFields idPrefix="new-pitch" values={EMPTY_PITCH_FIELDS} />

      <div className="space-y-1.5 sm:max-w-xs">
        <Label htmlFor="new-pitch-active">Availability</Label>
        <Select id="new-pitch-active" name="active" defaultValue="true">
          <option value="true">Bookable straight away</option>
          <option value="false">Out of use for now</option>
        </Select>
      </div>

      <PitchAdminFeedback state={state} />

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Adding…" : "Add pitch"}
        </Button>
        <Link
          href="/pitches/manage"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          {state.createdId ? "Back to the pitch list" : "Cancel"}
        </Link>
      </div>
    </form>
  );
}
