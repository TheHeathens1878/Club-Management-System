"use client";

/**
 * Delete a manual event — the team's staff and club administrators (Adam,
 * 2026-09-02: "I still can't delete an event as club admin. This should be in
 * the event page for admins and coaches").
 *
 * Two clicks, the same shape as the fixture's delete card: the first says
 * what goes — everyone's answers go with the event, and a pitch it holds is
 * handed back first — and only then is the real button offered. A
 * fixture-mirrored event never renders this card; it gets the fixture's own.
 */

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { deleteEvent, type DeleteEventState } from "../actions";

const EMPTY: DeleteEventState = {};

export function DeleteEventCard({
  eventId,
  label,
  answers,
  hasPitch,
}: {
  eventId: string;
  /** "Tuesday training — Tue 9 Sep, 18:00" — named in the confirmation. */
  label: string;
  /** How many answers people have given — they are destroyed with it. */
  answers: number;
  hasPitch: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const [state, action, pending] = useActionState(deleteEvent, EMPTY);

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-base">Delete this event</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!armed ? (
          <>
            <p className="text-muted-foreground">
              Removes <span className="font-medium text-foreground">{label}</span> from the diary
              entirely — for a session that should never have existed. To call one off but keep the
              record, use Cancel on the edit screen instead.
            </p>
            <p className="text-muted-foreground">
              {answers > 0
                ? `${answers} answer${answers === 1 ? "" : "s"} from families go${answers === 1 ? "es" : ""} with it. `
                : "Nobody has answered it yet. "}
              {hasPitch ? "The pitch it is holding is handed back first." : ""}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11 text-destructive lg:min-h-0"
              onClick={() => setArmed(true)}
            >
              Delete…
            </Button>
          </>
        ) : (
          <form action={action} className="space-y-3">
            <input type="hidden" name="event_id" value={eventId} />
            <p className="font-medium">This cannot be undone.</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="submit"
                variant="destructive"
                size="sm"
                disabled={pending}
                className="min-h-11 lg:min-h-0"
              >
                {pending ? "Deleting…" : "Delete this event"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setArmed(false)}
                disabled={pending}
                className="min-h-11 lg:min-h-0"
              >
                Keep it
              </Button>
            </div>
            {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
          </form>
        )}
      </CardContent>
    </Card>
  );
}
