"use client";

import { useActionState } from "react";

import { DateOfBirthInput } from "@/components/date-of-birth-input";
import { buttonVariants } from "@/components/ui/button";

import { completeDob, type ActionState } from "./actions";

export function CompleteProfileForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(completeDob, {});

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1 text-sm">
        <label htmlFor="complete-dob" className="block font-medium">
          Date of birth
        </label>
        {/* Almost everybody sent here is an adult — the coaching staff the club
            imported without a date of birth — so the picker opens on 1 January
            1990 rather than on today. The line under it is what stops a
            grown-up's real date being replaced by the scaffolding. */}
        <DateOfBirthInput
          id="complete-dob"
          required
          start="adult"
          className="min-h-[44px] lg:min-h-0"
        />
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className={buttonVariants() + " min-h-[44px] w-full lg:min-h-0 lg:w-auto"}
      >
        {pending ? "Saving…" : "Save and continue"}
      </button>
    </form>
  );
}
