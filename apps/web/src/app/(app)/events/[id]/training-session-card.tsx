"use client";

/**
 * The coach's tap on a winter training session (Adam, 2026-09-06: "Coaches
 * should be able to cancel them if they aren't training").
 *
 * One card, two states. Scheduled: "Not training this week?" with an
 * optional reason and a Cancel that arms first — the families are told,
 * reason included, and the block's next calendar update leaves the session
 * cancelled. Cancelled: "Put it back on", which reinstates and tells them
 * again through the details-changed path.
 */

import { useActionState, useState } from "react";
import { CalendarX2, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/field";

import { cancelTrainingSession, reinstateTrainingSession, type EventActionState } from "../actions";

const EMPTY: EventActionState = {};

export function TrainingSessionCard({
  eventId,
  cancelled,
  blockName,
  share,
  when,
}: {
  eventId: string;
  cancelled: boolean;
  blockName: string;
  share: string | null;
  /** "Tue 12 Jan, 18:00" — named in the confirmation. */
  when: string;
}) {
  const [armed, setArmed] = useState(false);
  const [cancelState, cancelAction, cancelling] = useActionState(cancelTrainingSession, EMPTY);
  const [backState, backAction, reinstating] = useActionState(reinstateTrainingSession, EMPTY);

  if (cancelled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Training back on?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            This session was called off. Putting it back on tells the families and keeps their
            earlier answers.
          </p>
          <form action={backAction} className="space-y-2">
            <input type="hidden" name="event_id" value={eventId} />
            <Button type="submit" variant="outline" size="sm" disabled={reinstating} className="min-h-11 lg:min-h-0">
              <RotateCcw className="h-4 w-4" aria-hidden /> {reinstating ? "Putting it back…" : "Put it back on"}
            </Button>
            {backState.error ? <p className="text-sm text-destructive">{backState.error}</p> : null}
            {backState.notice ? <p className="text-sm text-emerald-700">{backState.notice}</p> : null}
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-amber-300/60">
      <CardHeader>
        <CardTitle className="text-base">Not training this week?</CardTitle>
        <p className="text-xs text-muted-foreground">
          {blockName}
          {share ? ` · ${share}` : ""}
        </p>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!armed ? (
          <>
            <p className="text-muted-foreground">
              Cancel just this session — <span className="font-medium text-foreground">{when}</span>.
              The families are told straight away, and the rest of the winter is untouched.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11 lg:min-h-0"
              onClick={() => setArmed(true)}
            >
              <CalendarX2 className="h-4 w-4" aria-hidden /> Cancel this session…
            </Button>
          </>
        ) : (
          <form action={cancelAction} className="space-y-3">
            <input type="hidden" name="event_id" value={eventId} />
            <Textarea
              name="reason"
              maxLength={300}
              rows={2}
              placeholder="Why? (optional — the families see this) “Half the squad is at a tournament.”"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" variant="destructive" size="sm" disabled={cancelling} className="min-h-11 lg:min-h-0">
                {cancelling ? "Cancelling…" : "Cancel this session"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setArmed(false)}
                disabled={cancelling}
                className="min-h-11 lg:min-h-0"
              >
                Keep it
              </Button>
            </div>
            {cancelState.error ? <p className="text-sm text-destructive">{cancelState.error}</p> : null}
          </form>
        )}
      </CardContent>
    </Card>
  );
}
