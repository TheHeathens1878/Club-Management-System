"use client";

/**
 * Delete a fixture — club administrators only (Adam, 2026-08-26: "Admin can't
 * delete fixtures, they need to be able to").
 *
 * Two clicks, and the second one is only offered after the first has said what
 * goes. A fixture carries the team sheet, everybody's availability, the match
 * stats and any diary event, and all of them are destroyed with it; none of
 * that is recoverable from this screen. So the armed state names the counts
 * rather than asking "are you sure?" over an unspecified amount of work.
 *
 * The pitch is the part that surprises people. `bookings.fixture_id` is ON
 * DELETE SET NULL, so deleting a fixture that holds a pitch leaves the booking
 * standing — still confirmed, still holding the slot, now attached to nothing.
 * The tick box is therefore ON by default and says so; clearing it is a
 * deliberate choice to keep the slot.
 */

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { deleteFixture, type DeleteFixtureState } from "./actions";

const EMPTY: DeleteFixtureState = {};

function countLine(counts: DeleteFixtureCounts): string {
  const parts: string[] = [];
  if (counts.availability) parts.push(`${counts.availability} availability answer${counts.availability === 1 ? "" : "s"}`);
  if (counts.lineups) parts.push(`the team sheet`);
  if (counts.playerStats) parts.push(`${counts.playerStats} player stat${counts.playerStats === 1 ? "" : "s"}`);
  if (counts.events) parts.push(`its diary event`);
  if (parts.length === 0) return "Nothing else is attached to it.";
  if (parts.length === 1) return `${parts[0]} goes with it.`;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]} go with it.`;
}

export type DeleteFixtureCounts = {
  availability: number;
  lineups: number;
  playerStats: number;
  events: number;
};

export function DeleteFixtureCard({
  fixtureId,
  teamId,
  label,
  hasPitch,
  isMirrored,
  stillPublished,
  counts,
}: {
  fixtureId: string;
  teamId: string;
  /** "Sat 6 Sep, 10:00 v Broadheath Central" — named in the confirmation. */
  label: string;
  hasPitch: boolean;
  /** One game on two teams' pages: deleting one side deletes both. */
  isMirrored: boolean;
  /**
   * Imported from Full-Time and not flagged as dropped from the feed, so the
   * next import will simply create it again. Worth saying before, not after.
   */
  stillPublished: boolean;
  counts: DeleteFixtureCounts;
}) {
  const [state, action, pending] = useActionState(deleteFixture, EMPTY);
  const [armed, setArmed] = useState(false);

  return (
    <Card className="border-destructive/40">
      <CardHeader className="p-4 lg:p-6">
        <CardTitle className="text-base text-destructive">Delete this fixture</CardTitle>
        <p className="text-sm text-muted-foreground">
          For a game that should never have been here — a Full-Time import that landed on the wrong
          team, one the league has withdrawn, or a friendly entered twice. If the game is simply
          off, set it to postponed or cancelled instead, which keeps the record.
        </p>
      </CardHeader>
      <CardContent className="space-y-3 p-4 pt-0 lg:p-6 lg:pt-0">
        {!armed ? (
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full lg:h-9 lg:w-auto"
            onClick={() => setArmed(true)}
          >
            Delete fixture…
          </Button>
        ) : (
          <form action={action} className="space-y-3">
            <input type="hidden" name="fixture_id" value={fixtureId} />
            <input type="hidden" name="team_id" value={teamId} />

            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <p className="font-medium">Delete {label}?</p>
              <p className="mt-1 text-muted-foreground">{countLine(counts)}</p>
              {isMirrored && (
                <p className="mt-1 text-muted-foreground">
                  This is an internal match, so the other team&apos;s side of it goes too — it is
                  one game on two pages.
                </p>
              )}
              <p className="mt-1 text-muted-foreground">This cannot be undone from here.</p>
              {stillPublished && (
                <p className="mt-1 text-muted-foreground">
                  Full-Time still publishes this game, so tonight&apos;s import will create it
                  again — but the team sheet, the availability answers and the stats above will
                  not come back with it.
                </p>
              )}
            </div>

            {hasPitch && (
              <label className="flex min-h-[44px] cursor-pointer items-start gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  name="release_pitch"
                  value="yes"
                  defaultChecked
                  className="mt-0.5 h-4 w-4 accent-primary"
                />
                <span>
                  Give the pitch back as well
                  <span className="block text-xs text-muted-foreground">
                    Leave this ticked. The booking does not go when the fixture does — it stays
                    confirmed and keeps holding the slot, attached to nothing.
                  </span>
                </span>
              </label>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                variant="destructive"
                className="h-11 lg:h-9"
                disabled={pending}
              >
                {pending ? "Deleting…" : "Yes, delete it"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11 lg:h-9"
                onClick={() => setArmed(false)}
                disabled={pending}
              >
                Keep it
              </Button>
            </div>
          </form>
        )}

        {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      </CardContent>
    </Card>
  );
}
