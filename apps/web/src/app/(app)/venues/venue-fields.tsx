"use client";

/**
 * The editable half of a venue, shared by the add form and the edit form.
 *
 * A venue is a GROUND: a name, where it is, what somebody arriving for the
 * first time needs to know — and, since 2026-09-13, what it is FOR: the
 * club's matches (the grounds with our pitches, or a central venue), its
 * training (a hired 3G or school pitch the winter blocks are planned at), or
 * both. A training venue also says how much of its pitch is ours — "half of
 * Loreto" — and carries notes for whoever plans there. It carries no booking
 * settings of its own — buffers, capacity and pricing all live on the pitch,
 * because a booking is made against a pitch and never against a ground.
 */

import { useState } from "react";

import { Input, Label } from "@/components/ui/input";
import { Select, Textarea } from "@/components/ui/field";
import { PARTS_OPTIONS, shareChip } from "@/lib/training-plan";

export type VenueFieldValues = {
  name: string;
  address: string | null;
  notes: string | null;
  sortOrder: number;
  forMatches: boolean;
  forTraining: boolean;
  /** How the pitch is divided when the club trains here, 1–6. */
  trainingParts: number;
  /** How many of those parts are the club's. */
  trainingShares: number;
  trainingNotes: string | null;
};

export const EMPTY_VENUE_FIELDS: VenueFieldValues = {
  name: "",
  address: null,
  notes: null,
  sortOrder: 0,
  forMatches: true,
  forTraining: false,
  trainingParts: 1,
  trainingShares: 1,
  trainingNotes: null,
};

export function VenueFields({
  idPrefix,
  values,
}: {
  idPrefix: string;
  values: VenueFieldValues;
}) {
  const [forTraining, setForTraining] = useState(values.forTraining);
  const [parts, setParts] = useState(values.trainingParts);
  const [shares, setShares] = useState(Math.min(values.trainingShares, values.trainingParts));

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-name`}>Venue name *</Label>
        <Input
          id={`${idPrefix}-name`}
          name="name"
          defaultValue={values.name}
          placeholder="e.g. Ashton Park"
          maxLength={120}
          required
        />
        <p className="text-xs text-muted-foreground">
          The ground as people say it, without the pitch. The venue&rsquo;s coaches group takes its
          name from this, so renaming here renames the group.
        </p>
      </div>

      <fieldset className="space-y-2 sm:col-span-2">
        <legend className="text-sm font-medium leading-none text-foreground">Used for</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <label className="flex min-h-[44px] items-center gap-2 text-sm lg:min-h-0">
            <input
              type="checkbox"
              name="for_matches"
              defaultChecked={values.forMatches}
              className="h-4 w-4 rounded border-input"
            />
            Matches
          </label>
          <label className="flex min-h-[44px] items-center gap-2 text-sm lg:min-h-0">
            <input
              type="checkbox"
              name="for_training"
              checked={forTraining}
              onChange={(event) => setForTraining(event.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            Training
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          A ground with our pitches is for matches; a hired 3G or school pitch the winter blocks
          are planned at is for training. Some are both. A venue a training slot names becomes a
          training venue on its own.
        </p>
      </fieldset>

      {forTraining ? (
        <fieldset className="space-y-3 rounded-lg border bg-secondary/30 p-3 sm:col-span-2">
          <legend className="px-1 text-sm font-medium leading-none text-foreground">Our share of the pitch</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-training-parts`}>The pitch is divided into</Label>
              <Select
                id={`${idPrefix}-training-parts`}
                name="training_parts"
                value={String(parts)}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setParts(next);
                  setShares((current) => Math.min(current, next));
                }}
              >
                {PARTS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-training-shares`}>Of which the club has</Label>
              <Select
                id={`${idPrefix}-training-shares`}
                name="training_shares"
                value={String(shares)}
                onChange={(event) => setShares(Number(event.target.value))}
                disabled={parts === 1}
              >
                {Array.from({ length: parts }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n === parts ? "All of it" : `${n} of ${parts} · ${shareChip(n, parts)}`}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            A new training slot here starts from this: the slot is divided the same way, and only
            our share is handed out to teams. Each slot can still say otherwise.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-training-notes`}>
              Training notes{" "}
              <span className="text-xs font-normal text-muted-foreground">
                which half is ours, where the equipment lives, who to ring
              </span>
            </Label>
            <Textarea
              id={`${idPrefix}-training-notes`}
              name="training_notes"
              rows={2}
              maxLength={2000}
              defaultValue={values.trainingNotes ?? ""}
              placeholder="e.g. The far half, by the changing rooms. Lights go off at 21:00 sharp."
            />
          </div>
        </fieldset>
      ) : null}

      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-address`}>
          Address{" "}
          <span className="text-xs font-normal text-muted-foreground">street and postcode</span>
        </Label>
        <Input
          id={`${idPrefix}-address`}
          name="address"
          defaultValue={values.address ?? ""}
          placeholder="e.g. Banky Lane, Ashton on Mersey, Sale M33 5SL"
          maxLength={300}
        />
        <p className="text-xs text-muted-foreground">
          A pitch may still carry its own — two entrances to one park — and where it does, the
          pitch wins.
        </p>
      </div>

      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-notes`}>
          Notes for coaches and ground staff{" "}
          <span className="text-xs font-normal text-muted-foreground">
            gate codes, parking, changing rooms, who holds the key
          </span>
        </Label>
        <Textarea
          id={`${idPrefix}-notes`}
          name="notes"
          rows={3}
          maxLength={4000}
          defaultValue={values.notes ?? ""}
          placeholder="e.g. Gate code 1234. Changing rooms are the far block; the key is with the bar."
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-order`}>Order</Label>
        <Input
          id={`${idPrefix}-order`}
          name="sort_order"
          type="number"
          min={0}
          max={9999}
          defaultValue={values.sortOrder}
        />
        <p className="text-xs text-muted-foreground">
          Lowest first, in lists of venues.
        </p>
      </div>
    </div>
  );
}
