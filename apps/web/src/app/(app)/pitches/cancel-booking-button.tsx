"use client";

/**
 * Cancel a pitch booking, with the second look that a cancellation deserves
 * (Adam, 2026-08-25: "allow coaches to cancel bookings").
 *
 * The permission is already the database's: `bookings_team_guard()` has always
 * let a team's coach move their own booking — pending or confirmed — to
 * `cancelled`, and refuses every other change. So this is a screen, not a new
 * rule, and it is the same button whether it is drawn on My pitch bookings or
 * on the team's Bookings tab.
 *
 * Two clicks, never one. A pitch slot let go by a mis-tap is not recoverable
 * from this screen — the coach has to ask the administrator to make it again —
 * so the first click only arms the button and names what is being given up.
 *
 * Whatever the database says on the way back is shown WORD FOR WORD through
 * `BookingFeedback`: the trigger's refusals name where the decision is made
 * ("it is waiting on Pitch requests", "a club administrator unallocates it on
 * Pitches"), and a paraphrase would lose that. A refusal that comes back as
 * zero rows instead of an error is caught in `cancelPitchBooking` itself.
 */

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";

import { cancelPitchBooking, cancelPitchBookingSeries } from "./booking-actions";
import { BookingFeedback, EMPTY_BOOKING_STATE } from "./booking-feedback";

export function CancelPitchBookingButton({
  bookingId,
  teamId,
  recurrenceGroupId,
  variant = "one",
  slot,
  className = "",
}: {
  bookingId: string;
  teamId: string | null;
  /** Required for the series variant: the id the whole weekly repeat shares. */
  recurrenceGroupId?: string | null;
  /** "one" cancels this session; "series" cancels the rest of the repeat. */
  variant?: "one" | "series";
  /** "Sat, 1 Mar · 18:00–19:30" — named in the confirmation, so it is clear. */
  slot?: string;
  className?: string;
}) {
  const series = variant === "series";
  const [state, action, pending] = useActionState(
    series ? cancelPitchBookingSeries : cancelPitchBooking,
    EMPTY_BOOKING_STATE,
  );
  const [armed, setArmed] = useState(false);

  if (series && !recurrenceGroupId) return null;

  // Once it is done, the row is gone from the list on the next render; until
  // then the feedback is all there is to show.
  if (state.notice) return <BookingFeedback state={state} />;

  if (!armed) {
    return (
      <div className={className}>
        <Button
          type="button"
          variant={series ? "ghost" : "outline"}
          size="sm"
          className="h-11 w-full lg:h-9 lg:w-auto"
          onClick={() => setArmed(true)}
        >
          {series ? "Cancel whole series" : "Cancel"}
        </Button>
        <BookingFeedback state={state} />
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <p className="text-xs text-muted-foreground">
        {series
          ? "Cancel every session still to come in this weekly series? The pitch is given back for all of them."
          : `Cancel ${slot ? `${slot}? ` : "this booking? "}The pitch is given back, and getting the slot again means asking for it again.`}
      </p>
      <div className="flex flex-wrap gap-2">
        <form action={action}>
          {series ? (
            <input type="hidden" name="recurrence_group_id" value={recurrenceGroupId ?? ""} />
          ) : (
            <input type="hidden" name="booking_id" value={bookingId} />
          )}
          <input type="hidden" name="team_id" value={teamId ?? ""} />
          <Button
            type="submit"
            variant="destructive"
            size="sm"
            className="h-11 lg:h-9"
            disabled={pending}
          >
            {pending ? "Cancelling…" : series ? "Yes, cancel them all" : "Yes, cancel it"}
          </Button>
        </form>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-11 lg:h-9"
          onClick={() => setArmed(false)}
          disabled={pending}
        >
          Keep it
        </Button>
      </div>
      <BookingFeedback state={state} />
    </div>
  );
}
