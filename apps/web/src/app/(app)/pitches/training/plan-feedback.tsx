"use client";

/**
 * What the database said about the plan, shown as it said it. A `"use
 * server"` module may export only async functions and types, so the empty
 * state and the feedback strip live here — the same split the pitch closure
 * forms use.
 */

import type { PlanActionState } from "./actions";

export const EMPTY_PLAN_STATE: PlanActionState = {};

export function PlanFeedback({ state }: { state: PlanActionState }) {
  if (state.error) {
    return (
      <p className="whitespace-pre-line rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {state.error}
      </p>
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
