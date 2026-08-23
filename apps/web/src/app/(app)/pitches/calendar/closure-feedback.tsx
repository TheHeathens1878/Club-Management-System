"use client";

/**
 * What the database said about a closure, shown as it said it.
 *
 * A `"use server"` module may export only async functions and types, so the
 * empty state the closure forms start at lives here — the same split
 * `booking-feedback.tsx` uses for pitch bookings. `clashes` is the list of
 * pitches `booking_has_conflict()` — or the exclusion constraint — named, so
 * "close every pitch" can say exactly which one was already taken.
 */

import type { ClosureActionState } from "./closure-actions";

export const EMPTY_CLOSURE_STATE: ClosureActionState = {};

export function ClosureFeedback({ state }: { state: ClosureActionState }) {
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
