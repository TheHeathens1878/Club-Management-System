"use client";

/**
 * "Close a pitch" (gap 6) — the club administrator's form.
 *
 * It writes an ordinary `maintenance` booking, so the calendar, the weekend
 * grid and the overlap constraint all see a closure the same way they see a
 * fixture. That is the point: a closed pitch has to be *in* the diary, or the
 * next coach books straight over it.
 *
 * Lifting a closure is done by clicking it on the calendar — the popover
 * offers "Re-open the pitch" to an administrator.
 */

import { useActionState } from "react";
import { CalendarX2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Input, Label } from "@/components/ui/input";
import type { PitchOption } from "@/lib/pitch-booking";

import { createPitchClosure } from "./closure-actions";
import { ClosureFeedback, EMPTY_CLOSURE_STATE } from "./closure-feedback";

export function ClosePitchForm({
  pitches,
  defaultDate,
}: {
  pitches: PitchOption[];
  defaultDate: string;
}) {
  const [state, action, pending] = useActionState(createPitchClosure, EMPTY_CLOSURE_STATE);

  return (
    <form action={action} className="space-y-4">
      <ClosureFeedback state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="closure-pitch">Pitch</Label>
          <Select id="closure-pitch" name="resource_id" defaultValue="all" required>
            <option value="all">All pitches</option>
            {pitches.map((pitch) => (
              <option key={pitch.id} value={pitch.id}>
                {pitch.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="closure-date">Date</Label>
          <Input id="closure-date" type="date" name="date" defaultValue={defaultDate} required />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="closure-start">From</Label>
          <Input id="closure-start" type="time" name="start_time" defaultValue="08:00" required />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="closure-end">Until</Label>
          <Input id="closure-end" type="time" name="end_time" defaultValue="22:00" required />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="closure-label">Reason</Label>
          <Input
            id="closure-label"
            name="label"
            maxLength={120}
            placeholder="Waterlogged"
            required
          />
          <p className="text-xs text-muted-foreground">
            This is what everyone sees on the calendar, so make it the reason a coach needs —
            &ldquo;Waterlogged&rdquo;, &ldquo;Frozen&rdquo;, &ldquo;Re-seeding&rdquo;.
          </p>
        </div>
      </div>

      <Button type="submit" disabled={pending}>
        <CalendarX2 className="h-4 w-4" /> Close the pitch
      </Button>
    </form>
  );
}
