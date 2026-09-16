"use client";

/**
 * What the database said about the plan, shown as it said it. A `"use
 * server"` module may export only async functions and types, so the empty
 * state and the feedback strip live here — the same split the pitch closure
 * forms use.
 */

import { Callout } from "@/components/ui/callout";

import type { PlanActionState } from "./actions";

export const EMPTY_PLAN_STATE: PlanActionState = {};

export function PlanFeedback({ state }: { state: PlanActionState }) {
  // A guard's message can arrive as several lines — "3 slots are at this
  // venue", each named — so the line breaks are kept.
  if (state.error) {
    return (
      <Callout tone="danger" className="whitespace-pre-line" role="alert">
        {state.error}
      </Callout>
    );
  }
  if (state.notice) {
    return (
      <Callout tone="success" role="status">
        {state.notice}
      </Callout>
    );
  }
  return null;
}
