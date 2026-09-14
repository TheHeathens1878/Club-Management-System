"use client";

/**
 * The calendar and the plan, side by side, and the one button between them —
 * as one bar above the timetable (2026-09-14: the page is the timetable;
 * this is its status line).
 *
 * `counts` is a DRY RUN of `sync_training_block()` made when the page
 * loaded: what pressing the button would do. After the press the bar shows
 * what it did, in the past tense, from the same shape.
 */

import { useActionState } from "react";
import { CalendarCheck2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { calendarSummary, syncPending, syncSummary, type SyncCounts } from "@/lib/training-plan";

import { syncBlock } from "../actions";
import { EMPTY_PLAN_STATE } from "../plan-feedback";

export function SyncCard({
  blockId,
  counts,
  dryRunError,
  lastSyncedAt,
  hasPlan,
}: {
  blockId: string;
  counts: SyncCounts | null;
  dryRunError: string | null;
  lastSyncedAt: string | null;
  /** At least one team is in a slot — otherwise there is nothing to put on. */
  hasPlan: boolean;
}) {
  const [state, action, pending] = useActionState(syncBlock, EMPTY_PLAN_STATE);
  const shown = state.synced ?? counts;
  const done = !!state.synced;
  const waiting = !done && !!counts && syncPending(counts);

  const last = lastSyncedAt
    ? new Date(lastSyncedAt).toLocaleString("en-GB", {
        timeZone: "Europe/London",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <form
      action={action}
      className={
        "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card px-4 py-3 shadow-sm lg:px-5 " +
        (waiting ? "border-primary/40" : "")
      }
    >
      <input type="hidden" name="block_id" value={blockId} />
      <span className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-primary/10 text-primary">
        <CalendarCheck2 className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 basis-56">
        {dryRunError ? (
          <p className="text-sm text-destructive">Could not compare the plan with the calendar: {dryRunError}</p>
        ) : state.error ? (
          <p className="text-sm text-destructive">{state.error}</p>
        ) : shown ? (
          <>
            <p className={"text-[15px] font-semibold leading-tight " + (waiting ? "text-primary" : done ? "text-emerald-700" : "")}>
              {syncSummary(shown, done)}
            </p>
            <p className="text-[12.5px] text-muted-foreground">
              {calendarSummary(shown)}
              {last ? ` · last updated ${last}` : ""}
              {!hasPlan ? " · put a team in a slot and this button creates every session in one go" : waiting ? " · nothing moves until you press" : ""}
            </p>
          </>
        ) : null}
      </div>
      <Button
        type="submit"
        disabled={pending || !hasPlan || (!!counts && !syncPending(counts) && !done)}
        className="min-h-[44px] lg:min-h-0"
        title="Sessions that have already happened are never touched, and a session a coach has cancelled stays cancelled."
      >
        <RefreshCw className={"h-4 w-4 " + (pending ? "animate-spin" : "")} aria-hidden />
        {pending ? "Updating…" : done ? "Update again" : "Update the calendar"}
      </Button>
    </form>
  );
}
