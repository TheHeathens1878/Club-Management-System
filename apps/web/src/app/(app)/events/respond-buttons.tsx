"use client";

/**
 * Accept / decline for every person the viewer answers for — themselves, and
 * any child in their care on the event's team. `respond_to_event` re-checks
 * `can_act_for` server-side; these buttons are the convenience, the function
 * is the rule.
 */

import { useActionState } from "react";
import { Check, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { respondToEvent, type EventActionState } from "./actions";
import { responseLabel, responseVariant, type EventPerson } from "./shared";

const EMPTY: EventActionState = {};

export function RespondButtons({
  eventId,
  people,
  disabled = false,
}: {
  eventId: string;
  people: EventPerson[];
  /** True for a cancelled or past event — the status still shows. */
  disabled?: boolean;
}) {
  const [state, action, saving] = useActionState(respondToEvent, EMPTY);

  if (people.length === 0) return null;

  return (
    <div className="space-y-2">
      {state.error ? (
        <p className="whitespace-pre-line rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      {people.map((person) => (
        <div
          key={person.personId}
          className="flex flex-wrap items-center gap-2 rounded-md border bg-card px-3 py-2"
        >
          <span className="text-sm font-medium">
            {person.isSelf ? `${person.name} (you)` : person.name}
          </span>
          <Badge variant={responseVariant(person.response)}>{responseLabel(person.response)}</Badge>
          {person.stale ? (
            <Badge variant="warning">Answered before the change — please check</Badge>
          ) : null}
          {!disabled ? (
            <span className="ml-auto flex gap-2">
              <form action={action}>
                <input type="hidden" name="event_id" value={eventId} />
                <input type="hidden" name="person_id" value={person.personId} />
                <input type="hidden" name="status" value="accepted" />
                <Button
                  type="submit"
                  size="sm"
                  variant={person.response === "accepted" ? "secondary" : "default"}
                  disabled={saving}
                >
                  <Check className="h-4 w-4" /> Accept
                </Button>
              </form>
              <form action={action}>
                <input type="hidden" name="event_id" value={eventId} />
                <input type="hidden" name="person_id" value={person.personId} />
                <input type="hidden" name="status" value="declined" />
                <Button
                  type="submit"
                  size="sm"
                  variant={person.response === "declined" ? "secondary" : "outline"}
                  disabled={saving}
                >
                  <X className="h-4 w-4" /> Decline
                </Button>
              </form>
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
