"use client";

/**
 * Correcting a connected adult's record, in place on their card.
 *
 * Offered only for somebody with no login of their own — the page decides
 * that, and `update_household_adult_details()` refuses it again on the way in,
 * because a person who holds an account keeps their own contact details.
 *
 * Every field is pre-filled with what the club holds, so "leave it blank to
 * keep it" never comes up: what is on screen is what will be saved.
 */

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

import { editHouseholdAdult } from "./actions";
import type { HouseholdActionState } from "./actions";

const EMPTY: HouseholdActionState = {};

export function EditAdultForm({
  personId,
  firstName,
  lastName,
  preferredName,
  email,
  phone,
}: {
  personId: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  email: string | null;
  phone: string | null;
}) {
  const [state, action, pending] = useActionState(editHouseholdAdult, EMPTY);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className="space-y-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-[44px] lg:min-h-0"
          onClick={() => setOpen(true)}
        >
          Edit their details
        </Button>
        {state.notice && <p className="text-sm text-success">{state.notice}</p>}
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3 rounded-lg border bg-muted/30 p-3">
      <input type="hidden" name="person_id" value={personId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`first-${personId}`}>First name</Label>
          <Input id={`first-${personId}`} name="first_name" defaultValue={firstName} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`last-${personId}`}>Last name</Label>
          <Input id={`last-${personId}`} name="last_name" defaultValue={lastName} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`pref-${personId}`}>Known as (optional)</Label>
          <Input
            id={`pref-${personId}`}
            name="preferred_name"
            defaultValue={preferredName ?? ""}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`phone-${personId}`}>Phone</Label>
          <Input id={`phone-${personId}`} name="phone" type="tel" defaultValue={phone ?? ""} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`email-${personId}`}>Email</Label>
          <Input id={`email-${personId}`} name="email" type="email" defaultValue={email ?? ""} />
          <p className="text-xs text-muted-foreground">
            Getting this right is what lets the club connect this record to their own login if they
            ever create one.
          </p>
        </div>
      </div>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state.notice && <p className="text-sm text-success">{state.notice}</p>}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" className="min-h-[44px] lg:min-h-0" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-[44px] lg:min-h-0"
          onClick={() => setOpen(false)}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
