"use client";

/**
 * The editable half of a pitch, shared by the add form and every row's editor
 * (gap 7).
 *
 * Only the columns that mean something for a pitch are here. `resources` was
 * generalised from the function room's `function_rooms`, so it still carries
 * the hire pricing (`price_pence_*`, `extras_config`, `amenities`); a pitch
 * leaves all of it NULL and this form never touches it — those belong to
 * /room-bookings/rooms.
 */

import { Input, Label } from "@/components/ui/input";
import { Textarea } from "@/components/ui/field";

export type PitchFieldValues = {
  name: string;
  description: string | null;
  address: string | null;
  information: string | null;
  capacity: number | null;
  defaultPreBufferMinutes: number;
  defaultPostBufferMinutes: number;
};

export const EMPTY_PITCH_FIELDS: PitchFieldValues = {
  name: "",
  description: null,
  address: null,
  information: null,
  capacity: null,
  defaultPreBufferMinutes: 0,
  defaultPostBufferMinutes: 0,
};

export function PitchFields({
  idPrefix,
  values,
}: {
  /** Unique per form on the page, so every label points at its own input. */
  idPrefix: string;
  values: PitchFieldValues;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-name`}>Pitch name *</Label>
        <Input
          id={`${idPrefix}-name`}
          name="name"
          defaultValue={values.name}
          placeholder="e.g. Main Pitch"
          maxLength={120}
          required
        />
      </div>

      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-description`}>
          Description{" "}
          <span className="text-xs font-normal text-muted-foreground">
            one line, shown next to the name
          </span>
        </Label>
        <Textarea
          id={`${idPrefix}-description`}
          name="description"
          rows={2}
          maxLength={2000}
          defaultValue={values.description ?? ""}
          placeholder="e.g. Full-size grass pitch behind the clubhouse"
        />
      </div>

      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-address`}>
          Address{" "}
          <span className="text-xs font-normal text-muted-foreground">
            street and postcode — home fixtures use it for their maps link and event details
          </span>
        </Label>
        <Input
          id={`${idPrefix}-address`}
          name="address"
          defaultValue={values.address ?? ""}
          placeholder="e.g. Banky Lane, Ashton on Mersey, Sale M33 5SL"
          maxLength={300}
        />
      </div>

      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-information`}>
          Information for coaches{" "}
          <span className="text-xs font-normal text-muted-foreground">
            access, keys, parking, anything they need on the day
          </span>
        </Label>
        <Textarea
          id={`${idPrefix}-information`}
          name="information"
          rows={3}
          maxLength={4000}
          defaultValue={values.information ?? ""}
          placeholder="e.g. Gate code 1234. Park on the far side — the near side is the neighbour's."
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-capacity`}>
          Capacity{" "}
          <span className="text-xs font-normal text-muted-foreground">optional, players</span>
        </Label>
        <Input
          id={`${idPrefix}-capacity`}
          name="capacity"
          type="number"
          min={1}
          max={10000}
          defaultValue={values.capacity ?? ""}
          placeholder="e.g. 22"
        />
      </div>

      <div className="hidden sm:block" aria-hidden />

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-pre`}>Set-up buffer (minutes)</Label>
        <Input
          id={`${idPrefix}-pre`}
          name="default_pre_buffer_minutes"
          type="number"
          min={0}
          max={240}
          defaultValue={values.defaultPreBufferMinutes}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-post`}>Clear-down buffer (minutes)</Label>
        <Input
          id={`${idPrefix}-post`}
          name="default_post_buffer_minutes"
          type="number"
          min={0}
          max={240}
          defaultValue={values.defaultPostBufferMinutes}
        />
      </div>

      <p className="text-xs text-muted-foreground sm:col-span-2">
        The buffers are the changeover time either side of a booking. They are what a new booking
        starts with, and they are held against every other booking on this pitch by the same
        overlap check that stops two sessions being put on top of each other.
      </p>
    </div>
  );
}
