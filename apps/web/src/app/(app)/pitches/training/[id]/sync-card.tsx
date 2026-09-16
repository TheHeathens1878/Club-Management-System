"use client";

/**
 * The calendar and the plan, side by side, and the one button between them —
 * as one bar above the timetable (2026-09-14: the page is the timetable;
 * this is its status line). It is the shared `ActionBar` now (P8.0d): this
 * bar was the shape every other screen's status bar is copied from, so it
 * moved into `components/ui` and this file supplies the sentences.
 *
 * `counts` is a DRY RUN of `sync_training_block()` made when the page
 * loaded: what pressing the button would do. After the press the bar shows
 * what it did, in the past tense, from the same shape.
 */

import { useActionState } from "react";
import { CalendarCheck2, RefreshCw } from "lucide-react";

import { ActionBar } from "@/components/ui/action-bar";
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
  const failed = !!dryRunError || !!state.error;

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
    <ActionBar
      as="form"
      formAction={action}
      icon={<CalendarCheck2 className="h-4 w-4" aria-hidden />}
      tone={failed ? "error" : waiting ? "waiting" : done ? "done" : "idle"}
      status={
        dryRunError
          ? `Could not compare the plan with the calendar: ${dryRunError}`
          : state.error
            ? state.error
            : shown
              ? syncSummary(shown, done)
              : ""
      }
      detail={
        failed || !shown
          ? undefined
          : `${calendarSummary(shown)}${last ? ` · last updated ${last}` : ""}${
              !hasPlan
                ? " · put a team in a slot and this button creates every session in one go"
                : waiting
                  ? " · nothing moves until you press"
                  : ""
            }`
      }
      action={
        <>
          <input type="hidden" name="block_id" value={blockId} />
          <Button
            type="submit"
            size="touch"
            disabled={pending || !hasPlan || (!!counts && !syncPending(counts) && !done)}
            title="Sessions that have already happened are never touched, and a session a coach has cancelled stays cancelled."
          >
            <RefreshCw className={"h-4 w-4 " + (pending ? "animate-spin" : "")} aria-hidden />
            {pending ? "Updating…" : done ? "Update again" : "Update the calendar"}
          </Button>
        </>
      }
    />
  );
}
