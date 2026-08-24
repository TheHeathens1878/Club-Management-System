"use client";

/**
 * "Remind" — chases everyone who has not answered (a minor's reminder goes to
 * their guardians), in-app only. `remind_event_nonresponders` is staff/admin
 * only and refuses a second send within the hour, so the button can be pressed
 * in good faith.
 */

import { useActionState } from "react";
import { BellRing } from "lucide-react";

import { Button } from "@/components/ui/button";

import { remindEventNonResponders, type EventActionState } from "../actions";

const EMPTY: EventActionState = {};

export function RemindButton({ eventId }: { eventId: string }) {
  const [state, action, sending] = useActionState(remindEventNonResponders, EMPTY);

  return (
    <div className="space-y-2">
      <form action={action}>
        <input type="hidden" name="event_id" value={eventId} />
        <Button type="submit" size="sm" variant="outline" disabled={sending}>
          <BellRing className="h-4 w-4" /> {sending ? "Sending…" : "Remind"}
        </Button>
      </form>
      {state.error ? (
        <p className="whitespace-pre-line rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {state.notice}
        </p>
      ) : null}
    </div>
  );
}
