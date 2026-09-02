"use client";

/**
 * The "Connect an adult player" form for Connected Adults. Same open/close
 * shape as the family screen's AddChildForm; the database's refusals are shown
 * word for word.
 *
 * The one refusal with a second step is the possible duplicate (hint
 * `confirm_new`, 20260825490000): the club already has somebody of that name.
 * A name is not evidence, so the form does NOT offer "yes, that's them" — that
 * would hand out somebody's contact details for a guessed name. It offers the
 * two answers that are safe: go back and add the email address the club holds
 * for them (an email match links the existing record), or say plainly that this
 * is a different person and create a second record on purpose.
 */

import { useActionState, useState } from "react";
import { UserPlus } from "lucide-react";

import { DateOfBirthInput } from "@/components/date-of-birth-input";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

import { addHouseholdAdult, type HouseholdActionState } from "./actions";

function Feedback({ state }: { state: HouseholdActionState }) {
  if (state.error) {
    return (
      <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
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

export function AddAdultForm() {
  const [state, action, pending] = useActionState<HouseholdActionState, FormData>(
    addHouseholdAdult,
    {},
  );
  const [open, setOpen] = useState(false);
  // "Go back and add their email" dismisses THIS warning without losing it if a
  // second, different one comes back.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const confirm = state.confirm && state.confirm.message !== dismissed ? state.confirm : null;

  if (confirm) {
    const values = confirm.values;
    return (
      <div className="space-y-4">
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {confirm.message}
        </p>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs uppercase text-muted-foreground">You entered</dt>
            <dd className="mt-0.5">
              {values.first_name} {values.last_name}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-muted-foreground">Date of birth</dt>
            <dd className="mt-0.5">{values.dob}</dd>
          </div>
        </dl>
        <div className="flex flex-col items-stretch gap-2 lg:flex-row lg:flex-wrap lg:items-center">
          <form action={action}>
            <input type="hidden" name="first_name" value={values.first_name} />
            <input type="hidden" name="last_name" value={values.last_name} />
            <input type="hidden" name="dob" value={values.dob} />
            <input type="hidden" name="email" value={values.email} />
            <input type="hidden" name="phone" value={values.phone} />
            <input type="hidden" name="confirm_new" value="yes" />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={pending}
              className="min-h-[44px] w-full lg:min-h-0 lg:w-auto"
            >
              {pending ? "Adding…" : "This is a different person — add them as a new record"}
            </Button>
          </form>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setDismissed(confirm.message);
              setOpen(true);
            }}
            className="min-h-[44px] lg:min-h-0"
          >
            Go back and add their email address
          </Button>
        </div>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="space-y-3">
        <Feedback state={state} />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          className="min-h-[44px] w-full lg:min-h-0 lg:w-auto"
        >
          <UserPlus className="h-4 w-4" /> Connect an adult player
        </Button>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="adult-first-name">
            First name <span className="text-destructive">*</span>
          </Label>
          <Input id="adult-first-name" name="first_name" required autoComplete="off" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="adult-last-name">
            Last name <span className="text-destructive">*</span>
          </Label>
          <Input id="adult-last-name" name="last_name" required autoComplete="off" />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="adult-dob">
          Date of birth <span className="text-destructive">*</span>
        </Label>
        {/* An adult by construction — `add_household_adult()` refuses a minor
            — so the picker opens where an adult's answer lives. */}
        <DateOfBirthInput id="adult-dob" required start="adult" />
        <p className="text-xs text-muted-foreground">
          Only an adult can be connected here — a child is added on My Children so the club
          records you as their guardian.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="adult-email">Email (optional)</Label>
          <Input id="adult-email" name="email" type="email" autoComplete="off" />
          <p className="text-xs text-muted-foreground">
            If the club already holds this email address, their existing record is connected
            instead of a second one being created.
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="adult-phone">Phone (optional)</Label>
          <Input id="adult-phone" name="phone" type="tel" autoComplete="off" />
        </div>
      </div>

      <Feedback state={state} />

      <div className="flex flex-col items-stretch gap-2 lg:flex-row lg:flex-wrap lg:items-center">
        <Button type="submit" size="sm" disabled={pending} className="min-h-[44px] lg:min-h-0">
          {pending ? "Connecting…" : "Connect adult player"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setOpen(false)}
          className="min-h-[44px] lg:min-h-0"
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
