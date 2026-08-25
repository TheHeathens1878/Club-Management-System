"use client";

/**
 * The one form behind /people/new and the top of /people/[id].
 *
 * Refusals are shown as the database sent them: 42501 becomes "only a club
 * administrator…", and a P0001 from `people_dob_guard` (SG-1.2, SG-6 tier 1(c))
 * is shown verbatim because it explains which live arrangement the correction
 * would break.
 */

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Textarea } from "@/components/ui/field";
import { ADDRESS_KEYS, ADDRESS_LABELS, type AddressFields } from "@/lib/people-display";

import { createPerson, updatePerson, type PersonActionState } from "./actions";

const EMPTY: PersonActionState = {};

export type PersonFormValues = {
  first_name: string;
  last_name: string;
  preferred_name: string;
  dob: string;
  email: string;
  phone: string;
  address: AddressFields;
  notes: string;
};

export function PersonForm({
  mode,
  personId,
  values,
  pendingImports = 0,
}: {
  mode: "create" | "edit";
  personId?: string;
  values: PersonFormValues;
  /** Unapplied `neon_import_pending` rows, so the DOB field can say why it matters. */
  pendingImports?: number;
}) {
  const [state, action, pending] = useActionState(
    mode === "create" ? createPerson : updatePerson,
    EMPTY,
  );

  return (
    <form action={action} className="space-y-5">
      {personId && <input type="hidden" name="person_id" value={personId} />}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="first_name">First name *</Label>
          <Input id="first_name" name="first_name" defaultValue={values.first_name} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="last_name">Last name *</Label>
          <Input id="last_name" name="last_name" defaultValue={values.last_name} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="preferred_name">Preferred name</Label>
          <Input
            id="preferred_name"
            name="preferred_name"
            defaultValue={values.preferred_name}
            placeholder="What they are called"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="dob">Date of birth</Label>
          <Input id="dob" name="dob" type="date" defaultValue={values.dob} />
          <p className="text-xs text-muted-foreground">
            An unknown date of birth counts as a minor everywhere (SG-0), so leaving it blank is
            never neutral.
            {pendingImports > 0 && (
              <>
                {" "}
                <span className="font-medium text-amber-700">
                  {pendingImports} imported record{pendingImports === 1 ? " is" : "s are"} waiting on
                  this date and will be applied the moment you save it.
                </span>
              </>
            )}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" defaultValue={values.email} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" name="phone" defaultValue={values.phone} />
        </div>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Address</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          {ADDRESS_KEYS.map((key) => (
            <div key={key} className="space-y-1.5">
              <Label htmlFor={`address_${key}`}>{ADDRESS_LABELS[key]}</Label>
              <Input
                id={`address_${key}`}
                name={`address_${key}`}
                defaultValue={values.address[key]}
              />
            </div>
          ))}
        </div>
      </fieldset>

      <div className="space-y-1.5">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" defaultValue={values.notes} rows={3} />
        <p className="text-xs text-muted-foreground">
          Administrative notes only. Anything about a safeguarding concern belongs in the
          safeguarding record, which has a far narrower readership (SG-7).
        </p>
      </div>

      <div className="flex flex-col items-stretch gap-3 lg:flex-row lg:flex-wrap lg:items-center">
        <Button type="submit" disabled={pending} className="min-h-[44px] lg:min-h-0">
          {pending ? "Saving…" : mode === "create" ? "Create person" : "Save changes"}
        </Button>
        {state.error && (
          <p className="whitespace-pre-line rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {state.error}
          </p>
        )}
        {state.notice && (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {state.notice}
          </p>
        )}
      </div>
    </form>
  );
}
