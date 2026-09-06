"use client";

import { useActionState } from "react";

import { SubmitButton } from "@/components/submit-button";
import { Textarea } from "@/components/ui/field";
import { Input, Label } from "@/components/ui/input";

import { createBlock } from "../actions";
import { EMPTY_PLAN_STATE, PlanFeedback } from "../plan-feedback";

export function NewBlockForm({
  defaults,
}: {
  defaults: { name: string; startsOn: string; endsOn: string; seasonId: string | null };
}) {
  const [state, action] = useActionState(createBlock, EMPTY_PLAN_STATE);

  return (
    <form action={action} className="space-y-4">
      <PlanFeedback state={state} />
      {defaults.seasonId ? <input type="hidden" name="season_id" value={defaults.seasonId} /> : null}

      <div className="space-y-1.5">
        <Label htmlFor="block-name">Name</Label>
        <Input id="block-name" name="name" defaultValue={defaults.name} maxLength={80} required />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="block-starts">First day</Label>
          <Input id="block-starts" type="date" name="starts_on" defaultValue={defaults.startsOn} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="block-ends">Last day</Label>
          <Input id="block-ends" type="date" name="ends_on" defaultValue={defaults.endsOn} required />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="block-title">What the sessions are called</Label>
        <Input id="block-title" name="session_title" defaultValue="Winter training" maxLength={80} required />
        <p className="text-xs text-muted-foreground">
          This is the title every family sees on their calendar.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="block-notes">Notes (optional)</Label>
        <Textarea id="block-notes" name="notes" maxLength={1000} rows={2} placeholder="Who to call at the venue, gate codes…" />
      </div>

      <SubmitButton className="min-h-[44px] w-full sm:w-auto" pendingLabel="Creating…">
        Create the block
      </SubmitButton>
    </form>
  );
}
