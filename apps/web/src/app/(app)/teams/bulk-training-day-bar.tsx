"use client";

/**
 * The second thing the ticks bar can do (Adam, 2026-09-13): give every ticked
 * team the same default training day, so the training planner knows which
 * teams to offer for a Tuesday. Sits under the home-venue bar and shares its
 * rule: the ticks stay up after a save so the answer can be read.
 */

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";

import { ActionBar } from "@/components/ui/action-bar";
import { Button } from "@/components/ui/button";
import { WEEKDAYS } from "@/lib/training-plan";

import { bulkSetTrainingDay, type TrainingDayState } from "./training-day-actions";

const EMPTY: TrainingDayState = {};

export function BulkTrainingDayBar({ teamIds, onDone }: { teamIds: string[]; onDone: () => void }) {
  const router = useRouter();
  const [state, action, saving] = useActionState(bulkSetTrainingDay, EMPTY);

  useEffect(() => {
    if (!state.notice) return;
    router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- notice is the signal
  }, [state.notice]);

  return (
    <ActionBar
      as="form"
      formAction={action}
      className="border-primary/30"
      icon={<CalendarClock className="h-4 w-4" aria-hidden />}
      tone={state.error ? "error" : state.notice ? "done" : "idle"}
      status="Training evening"
      detail="The evening these teams usually train. The training planner offers a day's teams first."
      action={
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
          {teamIds.map((id) => (
            <input key={id} type="hidden" name="team_id" value={id} />
          ))}
          <label className="space-y-1 text-xs text-muted-foreground">
            Default training day
            <select
              name="default_training_day"
              defaultValue=""
              aria-label="Default training day"
              className="touch block h-9 w-full min-w-0 max-w-56 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">Not set</option>
              {WEEKDAYS.map((day) => (
                <option key={day.value} value={day.value}>
                  {day.label}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" size="touch" variant="outline" disabled={saving}>
            {saving ? "Saving…" : "Set training day"}
          </Button>
        </div>
      }
    >
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state.notice && (
        <p className="text-sm text-success">
          {state.notice}{" "}
          <button type="button" onClick={onDone} className="font-medium underline underline-offset-2">
            Put the ticks down
          </button>
        </p>
      )}
    </ActionBar>
  );
}
