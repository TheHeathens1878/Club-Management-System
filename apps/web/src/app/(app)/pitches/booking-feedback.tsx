"use client";

/**
 * What the database said, shown as it said it.
 *
 * `bookings_team_guard()` raises P0001 with sentences written for a coach
 * ("only a club administrator can confirm a pitch booking"), and the actions
 * pass them through untouched; this is where they land. `clashes` is the list
 * of occurrences `booking_has_conflict()` — or the exclusion constraint —
 * named, so a weekly repeat can say which week is in the way.
 */

import type { PitchBookingActionState } from "./booking-actions";

export const EMPTY_BOOKING_STATE: PitchBookingActionState = {};

export function BookingFeedback({ state }: { state: PitchBookingActionState }) {
  if (state.error) {
    return (
      <div className="space-y-2 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        <p className="whitespace-pre-line">{state.error}</p>
        {state.clashes && state.clashes.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-xs">
            {state.clashes.map((clash) => (
              <li key={clash}>{clash}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  if (state.notice) {
    return (
      <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        {state.notice}
      </p>
    );
  }
  return null;
}
