"use client";

/**
 * The coach's score box. Two numbers, home first, the way a result is written
 * down — and clearing both hands the fixture back to Full-Time, which is the
 * only way to undo an override once it has been typed.
 */

import { useActionState, useEffect, useState } from "react";
import { PenLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import { saveCoachScore, type MatchActionState } from "./match-actions";

const EMPTY: MatchActionState = {};

export function ScorelineForm({
  eventId,
  teamId,
  fixtureId,
  homeName,
  awayName,
  coachHome,
  coachAway,
  importedHome,
  importedAway,
}: {
  eventId: string;
  teamId: string;
  fixtureId: string;
  homeName: string;
  awayName: string;
  coachHome: number | null;
  coachAway: number | null;
  importedHome: number | null;
  importedAway: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, saving] = useActionState(saveCoachScore, EMPTY);

  // A save that went through closes the box, the way the other editors in the
  // app do; the notice stays on screen underneath.
  useEffect(() => {
    if (state.notice) setOpen(false);
  }, [state.notice]);

  const hasCoachScore = coachHome !== null && coachAway !== null;

  if (!open) {
    return (
      <div className="space-y-2">
        {state.notice ? (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {state.notice}
          </p>
        ) : null}
        <Button
          type="button"
          variant="outline"
          onClick={() => setOpen(true)}
          className="h-11 w-full sm:h-9 sm:w-auto"
        >
          <PenLine className="h-4 w-4" /> {hasCoachScore ? "Change the score" : "Enter the score"}
        </Button>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {hasCoachScore ? "Change the score" : "Enter the score"}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Home score first. Clear both boxes to go back to Full-Time&apos;s result.
        </p>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-3">
          {state.error ? (
            <p className="whitespace-pre-line rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {state.error}
            </p>
          ) : null}
          <input type="hidden" name="event_id" value={eventId} />
          <input type="hidden" name="fixture_id" value={fixtureId} />
          <input type="hidden" name="team_id" value={teamId} />

          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              {homeName}
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                max={99}
                name="home"
                defaultValue={coachHome ?? ""}
                className="h-11 w-20 text-center text-base sm:h-9"
                aria-label={`Goals for ${homeName}`}
              />
            </label>
            <span className="pb-3 text-lg text-muted-foreground">–</span>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              {awayName}
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                max={99}
                name="away"
                defaultValue={coachAway ?? ""}
                className="h-11 w-20 text-center text-base sm:h-9"
                aria-label={`Goals for ${awayName}`}
              />
            </label>
          </div>

          {importedHome !== null && importedAway !== null ? (
            <p className="text-xs text-muted-foreground">
              Full-Time has this match as {importedHome}–{importedAway}. Whatever you type here is
              what the club sees instead.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Full-Time has no result for this match, so yours is the only one.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={saving} className="h-11 w-full sm:h-9 sm:w-auto">
              {saving ? "Saving…" : "Save the score"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              className="h-11 w-full sm:h-9 sm:w-auto"
            >
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
