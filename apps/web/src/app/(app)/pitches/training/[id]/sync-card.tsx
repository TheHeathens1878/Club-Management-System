"use client";

/**
 * The calendar and the plan, side by side, and the one button between them.
 *
 * `counts` is a DRY RUN of `sync_training_block()` made when the page
 * loaded: what pressing the button would do. After the press the card shows
 * what it did, in the past tense, from the same shape.
 */

import { useActionState } from "react";
import { CalendarCheck2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

  return (
    <Card className={waiting ? "border-primary/40" : undefined}>
      <CardHeader className="p-4 lg:p-6">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarCheck2 className="h-4 w-4 text-primary" aria-hidden /> The calendar
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-4 pt-0 lg:p-6 lg:pt-0">
        {dryRunError ? (
          <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Could not compare the plan with the calendar: {dryRunError}
          </p>
        ) : null}
        {state.error ? (
          <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {state.error}
          </p>
        ) : null}

        {shown ? (
          <div className="space-y-1">
            <p className={"text-[15px] font-semibold " + (waiting ? "text-primary" : done ? "text-emerald-700" : "")}>
              {syncSummary(shown, done)}
            </p>
            <p className="text-sm text-muted-foreground">{calendarSummary(shown)}.</p>
          </div>
        ) : null}

        {!hasPlan ? (
          <p className="text-sm text-muted-foreground">
            Add a slot below and put a team in it — then this button creates every session for the
            winter in one go.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Change the plan as much as you like; nothing moves on the calendar until you press this.
            Sessions that have already happened are never touched, and a session a coach has cancelled
            stays cancelled.
          </p>
        )}

        <form action={action} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="block_id" value={blockId} />
          <Button
            type="submit"
            disabled={pending || !hasPlan || (!!counts && !syncPending(counts) && !done)}
            className="min-h-[44px] lg:min-h-0"
          >
            <RefreshCw className={"h-4 w-4 " + (pending ? "animate-spin" : "")} aria-hidden />
            {pending ? "Updating…" : done ? "Update again" : "Update the calendar"}
          </Button>
          {lastSyncedAt ? (
            <span className="text-xs text-muted-foreground">
              Last updated{" "}
              {new Date(lastSyncedAt).toLocaleString("en-GB", {
                timeZone: "Europe/London",
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
