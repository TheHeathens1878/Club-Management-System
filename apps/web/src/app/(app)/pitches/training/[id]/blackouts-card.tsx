"use client";

/**
 * Dates off — Christmas, half-term, a tournament weekend. A list with a
 * remove on each row and an add form that opens beneath it. Drawn inside a
 * FoldCard on the block page (2026-09-14), so this is the content only.
 */

import { useActionState, useState } from "react";
import { Plus, X } from "lucide-react";

import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { blackoutLabel } from "@/lib/training-plan";

import { addBlackout, removeBlackout } from "../actions";
import { EMPTY_PLAN_STATE, PlanFeedback } from "../plan-feedback";

export type BlackoutRow = {
  id: string;
  label: string;
  startsOn: string;
  endsOn: string;
  /** Whether the venue still charges for these dates. */
  charged: boolean;
};

function RemoveBlackout({ blockId, blackout }: { blockId: string; blackout: BlackoutRow }) {
  const [state, action, pending] = useActionState(removeBlackout, EMPTY_PLAN_STATE);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="block_id" value={blockId} />
      <input type="hidden" name="blackout_id" value={blackout.id} />
      {state.error ? <span className="text-xs text-destructive">{state.error}</span> : null}
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        disabled={pending}
        aria-label={`Remove ${blackout.label}`}
        className="min-h-[44px] min-w-[44px] text-muted-foreground lg:min-h-0 lg:min-w-0"
      >
        <X className="h-4 w-4" aria-hidden />
      </Button>
    </form>
  );
}

export function BlackoutsCard({
  blockId,
  startsOn,
  endsOn,
  blackouts,
}: {
  blockId: string;
  startsOn: string;
  endsOn: string;
  blackouts: BlackoutRow[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(addBlackout, EMPTY_PLAN_STATE);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">No session is created on a date off.</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen((v) => !v)}
          className="min-h-[44px] lg:min-h-0"
        >
          <Plus className="h-4 w-4" aria-hidden /> Add dates off
        </Button>
      </div>
      <PlanFeedback state={state} />

        {blackouts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No dates off yet. Christmas and half-term go here, and no session is created on them.
          </p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {blackouts.map((blackout) => (
              <li key={blackout.id} className="flex min-h-[52px] items-center gap-3 px-4 py-2">
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 text-[15px] font-medium leading-snug">
                    {blackout.label}
                    {!blackout.charged ? <Badge variant="success">Not charged</Badge> : null}
                  </span>
                  <span className="block text-[12.5px] text-muted-foreground">
                    {blackoutLabel(blackout.startsOn, blackout.endsOn)}
                    {!blackout.charged ? " · the venue is not charging for these dates" : ""}
                  </span>
                </span>
                <RemoveBlackout blockId={blockId} blackout={blackout} />
              </li>
            ))}
          </ul>
        )}

        {open ? (
          <form action={action} className="grid gap-3 rounded-xl border bg-secondary/40 p-4 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
            <input type="hidden" name="block_id" value={blockId} />
            <div className="space-y-1.5">
              <Label htmlFor="blackout-label">What</Label>
              <Input id="blackout-label" name="label" placeholder="Christmas" maxLength={80} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="blackout-from">From</Label>
              <Input id="blackout-from" type="date" name="starts_on" min={startsOn} max={endsOn} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="blackout-until">Until</Label>
              <Input id="blackout-until" type="date" name="ends_on" min={startsOn} max={endsOn} />
            </div>
            <SubmitButton size="sm" className="min-h-[44px] lg:min-h-0" pendingLabel="Adding…">
              Add
            </SubmitButton>
            <label className="flex min-h-[44px] items-center gap-2 text-sm sm:col-span-4 lg:min-h-0">
              <input type="checkbox" name="not_charged" className="h-4 w-4 rounded border-input" />
              The venue is not charging us for these dates
              <span className="text-xs text-muted-foreground">— they come off the venue hire report</span>
            </label>
            <p className="text-xs text-muted-foreground sm:col-span-4">
              Leave “Until” blank for a single day. Inclusive on both ends.
            </p>
          </form>
        ) : null}
    </div>
  );
}
