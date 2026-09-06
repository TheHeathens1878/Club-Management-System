"use client";

/**
 * Dates off — Christmas, half-term, a tournament weekend. A list with a
 * remove on each row and an add form that opens beneath it, iOS-style: the
 * list is the screen, the form is a sheet.
 */

import { useActionState, useState } from "react";
import { CalendarOff, Plus, X } from "lucide-react";

import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { blackoutLabel } from "@/lib/training-plan";

import { addBlackout, removeBlackout } from "../actions";
import { EMPTY_PLAN_STATE, PlanFeedback } from "../plan-feedback";

export type BlackoutRow = { id: string; label: string; startsOn: string; endsOn: string };

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
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 p-4 lg:p-6">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarOff className="h-4 w-4 text-primary" aria-hidden /> Dates off
        </CardTitle>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen((v) => !v)}
          className="min-h-[44px] lg:min-h-0"
        >
          <Plus className="h-4 w-4" aria-hidden /> Add dates off
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 p-4 pt-0 lg:p-6 lg:pt-0">
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
                  <span className="block text-[15px] font-medium leading-snug">{blackout.label}</span>
                  <span className="block text-[12.5px] text-muted-foreground">
                    {blackoutLabel(blackout.startsOn, blackout.endsOn)}
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
            <p className="text-xs text-muted-foreground sm:col-span-4">
              Leave “Until” blank for a single day. Inclusive on both ends.
            </p>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
