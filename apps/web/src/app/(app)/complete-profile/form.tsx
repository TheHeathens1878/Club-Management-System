"use client";

import { useActionState } from "react";

import { buttonVariants } from "@/components/ui/button";

import { completeDob, type ActionState } from "./actions";

export function CompleteProfileForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(completeDob, {});
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={action} className="space-y-4">
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Date of birth</span>
        <input
          type="date"
          name="dob"
          required
          max={today}
          className="block min-h-[44px] w-full rounded-md border bg-background px-3 py-2 lg:min-h-0"
        />
      </label>
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
