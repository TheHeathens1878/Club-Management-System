"use client";

/**
 * The editable half of a venue, shared by the add form and the edit form.
 *
 * A venue is a GROUND: a name, where it is, and what somebody arriving for the
 * first time needs to know. It carries no booking settings of its own —
 * buffers, capacity and pricing all live on the pitch, because a booking is
 * made against a pitch and never against a ground.
 */

import { Input, Label } from "@/components/ui/input";
import { Textarea } from "@/components/ui/field";

export type VenueFieldValues = {
  name: string;
  address: string | null;
  notes: string | null;
  sortOrder: number;
};

export const EMPTY_VENUE_FIELDS: VenueFieldValues = {
  name: "",
  address: null,
  notes: null,
  sortOrder: 0,
};

export function VenueFields({
  idPrefix,
  values,
}: {
  idPrefix: string;
  values: VenueFieldValues;
}) {
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
