"use client";

/**
 * The block itself — name, dates, the sessions' title — and, at the very
 * bottom, its deletion. Two clicks for that, like every other delete in the
 * app: the first says what goes, the second does it.
 */

import { useActionState, useState } from "react";
import { Settings2 } from "lucide-react";

import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/field";
import { Input, Label } from "@/components/ui/input";

import { deleteBlock, updateBlock } from "../actions";
import { EMPTY_PLAN_STATE, PlanFeedback } from "../plan-feedback";

export type BlockDetails = {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  sessionTitle: string;
  notes: string | null;
};

function DeleteBlock({ blockId, sessionsOnCalendar }: { blockId: string; sessionsOnCalendar: number }) {
  const [armed, setArmed] = useState(false);
  const [state, action, pending] = useActionState(deleteBlock, EMPTY_PLAN_STATE);

  if (!armed) {
    return (
      <div className="space-y-2 border-t pt-4">
        <p className="text-sm text-muted-foreground">
          Deleting the block removes its plan and every session still to come
          {sessionsOnCalendar > 0 ? ` — ${sessionsOnCalendar} on the calendar now` : ""}. Sessions that
          have already happened stay in the record.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-[44px] text-destructive lg:min-h-0"
          onClick={() => setArmed(true)}
        >
          Delete this block…
        </Button>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3 border-t pt-4">
      <input type="hidden" name="block_id" value={blockId} />
      <p className="text-sm font-medium">This cannot be undone.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="destructive" size="sm" disabled={pending} className="min-h-[44px] lg:min-h-0">
          {pending ? "Deleting…" : "Delete the block and its sessions"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setArmed(false)}
          disabled={pending}
          className="min-h-[44px] lg:min-h-0"
        >
          Keep it
        </Button>
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
    </form>
  );
}

export function DetailsCard({ block, sessionsOnCalendar }: { block: BlockDetails; sessionsOnCalendar: number }) {
  const [state, action] = useActionState(updateBlock, EMPTY_PLAN_STATE);

  return (
    <Card>
      <CardHeader className="p-4 lg:p-6">
        <CardTitle className="flex items-center gap-2 text-base">
          <Settings2 className="h-4 w-4 text-primary" aria-hidden /> The block
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-0 lg:p-6 lg:pt-0">
        <form action={action} className="space-y-4">
          <PlanFeedback state={state} />
          <input type="hidden" name="block_id" value={block.id} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="block-name">Name</Label>
              <Input id="block-name" name="name" defaultValue={block.name} maxLength={80} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="block-starts">First day</Label>
              <Input id="block-starts" type="date" name="starts_on" defaultValue={block.startsOn} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="block-ends">Last day</Label>
              <Input id="block-ends" type="date" name="ends_on" defaultValue={block.endsOn} required />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="block-title">What the sessions are called</Label>
              <Input id="block-title" name="session_title" defaultValue={block.sessionTitle} maxLength={80} required />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="block-notes">Notes</Label>
              <Textarea id="block-notes" name="notes" defaultValue={block.notes ?? ""} maxLength={1000} rows={2} />
            </div>
          </div>
          <SubmitButton size="sm" className="min-h-[44px] lg:min-h-0">
            Save
          </SubmitButton>
        </form>

        <DeleteBlock blockId={block.id} sessionsOnCalendar={sessionsOnCalendar} />
      </CardContent>
    </Card>
  );
}
