"use client";

/**
 * The add-an-adult form for Connected Adults. Same open/close shape as the
 * family screen's AddChildForm; the database's refusals are shown word for
 * word.
 */

import { useActionState, useState } from "react";
import { UserPlus } from "lucide-react";

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
          <UserPlus className="h-4 w-4" /> Connect an adult
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
        <Input id="adult-dob" name="dob" type="date" required />
        <p className="text-xs text-muted-foreground">
          Only an adult can be connected here — a child is added on My Children so the club
          records you as their guardian.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="adult-email">Email (optional)</Label>
          <Input id="adult-email" name="email" type="email" autoComplete="off" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="adult-phone">Phone (optional)</Label>
          <Input id="adult-phone" name="phone" type="tel" autoComplete="off" />
        </div>
      </div>

      <Feedback state={state} />

      <div className="flex flex-col items-stretch gap-2 lg:flex-row lg:flex-wrap lg:items-center">
        <Button type="submit" size="sm" disabled={pending} className="min-h-[44px] lg:min-h-0">
          {pending ? "Connecting…" : "Connect adult"}
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
