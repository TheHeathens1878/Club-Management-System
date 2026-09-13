"use client";

/**
 * The team's default training day (Adam, 2026-09-13): which evening it usually
 * trains, so the training planner offers this team first for that day. One
 * select and a save; the bulk version is the ticks bar on the Teams table.
 */

import { useActionState } from "react";

import { SubmitButton } from "@/components/submit-button";
import { Select } from "@/components/ui/field";
import { Label } from "@/components/ui/input";
import { WEEKDAYS } from "@/lib/training-plan";

import { setTeamTrainingDay, type TrainingDayState } from "../training-day-actions";

const EMPTY: TrainingDayState = {};

export function TrainingDayCard({ teamId, trainingDay }: { teamId: string; trainingDay: number | null }) {
  const [state, action] = useActionState(setTeamTrainingDay, EMPTY);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="team_id" value={teamId} />
      <div className="w-56 space-y-1.5">
        <Label htmlFor={`training-day-${teamId}`}>Default training day</Label>
        <Select id={`training-day-${teamId}`} name="default_training_day" defaultValue={trainingDay === null ? "" : String(trainingDay)}>
          <option value="">Not set</option>
          {WEEKDAYS.map((day) => (
            <option key={day.value} value={day.value}>
              {day.label}
            </option>
          ))}
        </Select>
      </div>
      <SubmitButton size="sm" variant="outline" className="min-h-[44px] lg:min-h-0" pendingLabel="Saving…">
        Save
      </SubmitButton>
      {state.error ? <p className="basis-full text-sm text-destructive">{state.error}</p> : null}
      {state.notice ? <p className="basis-full text-sm text-emerald-700">{state.notice}</p> : null}
    </form>
  );
}
