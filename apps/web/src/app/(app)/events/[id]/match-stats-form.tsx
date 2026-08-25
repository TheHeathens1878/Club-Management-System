"use client";

/**
 * The coach's match stats sheet: one line per live player in the squad, goals
 * and assists in a box, the armband and the award as one choice each across the
 * whole squad.
 *
 * Radios, not checkboxes, because a match has one captain and one player of the
 * match — the two partial unique indexes on `fixture_player_stats` say the same
 * thing, and `set_fixture_stats()` refuses a second of either by name. The
 * "Nobody" buttons exist because a coach who ticked the wrong name needs a way
 * back that is not a page reload.
 *
 * The sheet is saved whole: every line goes to the RPC and it replaces the
 * fixture's stats with that set, dropping the blank ones. Moving the armband is
 * therefore one save, not a delete and an insert that would briefly leave two
 * captains on the pitch.
 */

import { useActionState, useEffect, useState } from "react";
import { Award, ClipboardList, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import { saveFixtureStats, type MatchActionState } from "./match-actions";

const EMPTY: MatchActionState = {};

export type StatsPlayer = {
  personId: string;
  name: string;
  shirtNumber: number | null;
  goals: number;
  assists: number;
  captain: boolean;
  playerOfMatch: boolean;
};

export function MatchStatsForm({
  eventId,
  teamId,
  fixtureId,
  players,
}: {
  eventId: string;
  teamId: string;
  fixtureId: string;
  players: StatsPlayer[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action, saving] = useActionState(saveFixtureStats, EMPTY);
  const [captain, setCaptain] = useState(
    () => players.find((player) => player.captain)?.personId ?? "",
  );
  const [award, setAward] = useState(
    () => players.find((player) => player.playerOfMatch)?.personId ?? "",
  );

  // A save that went through closes the sheet, the way the other editors in the
  // app do; the notice stays on screen underneath.
  useEffect(() => {
    if (state.notice) setOpen(false);
  }, [state.notice]);

  if (players.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        There is nobody in this squad yet — add players to the team before recording stats.
      </p>
    );
  }

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
          <ClipboardList className="h-4 w-4" /> Record match stats
        </Button>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Record match stats</CardTitle>
        <p className="text-xs text-muted-foreground">
          Leave a player blank if they have nothing to record. One captain and one player of the
          match.
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
          <input type="hidden" name="captain" value={captain} />
          <input type="hidden" name="player_of_match" value={award} />

          <ul className="divide-y rounded-md border">
            {players.map((player) => (
              <li key={player.personId} className="space-y-2 p-3">
                <input type="hidden" name="person_id" value={player.personId} />
                <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                  {player.shirtNumber === null ? null : (
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {player.shirtNumber}
                    </span>
                  )}
                  {player.name}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    Goals
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={99}
                      name={`goals_${player.personId}`}
                      defaultValue={player.goals}
                      className="h-11 w-[4.5rem] text-center text-sm sm:h-9"
                      aria-label={`Goals for ${player.name}`}
                    />
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    Assists
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={99}
                      name={`assists_${player.personId}`}
                      defaultValue={player.assists}
                      className="h-11 w-[4.5rem] text-center text-sm sm:h-9"
                      aria-label={`Assists for ${player.name}`}
                    />
                  </label>
                  <label
                    className={`flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-md border px-3 text-xs sm:min-h-[36px] ${
                      captain === player.personId
                        ? "border-primary bg-primary/10 text-primary"
                        : "text-muted-foreground"
                    }`}
                  >
                    <input
                      type="radio"
                      name="captain_choice"
                      className="sr-only"
                      checked={captain === player.personId}
                      onChange={() => setCaptain(player.personId)}
                    />
                    <ShieldCheck className="h-4 w-4" />
                    <span>Captain</span>
                  </label>
                  <label
                    className={`flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-md border px-3 text-xs sm:min-h-[36px] ${
                      award === player.personId
                        ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                        : "text-muted-foreground"
                    }`}
                  >
                    <input
                      type="radio"
                      name="player_of_match_choice"
                      className="sr-only"
                      checked={award === player.personId}
                      onChange={() => setAward(player.personId)}
                    />
                    <Award className="h-4 w-4" />
                    <span>Player of the match</span>
                  </label>
                </div>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap gap-2 text-xs">
            <button
              type="button"
              onClick={() => setCaptain("")}
              className="min-h-[44px] rounded-md border px-3 text-muted-foreground sm:min-h-[32px]"
            >
              No captain
            </button>
            <button
              type="button"
              onClick={() => setAward("")}
              className="min-h-[44px] rounded-md border px-3 text-muted-foreground sm:min-h-[32px]"
            >
              No player of the match
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={saving} className="h-11 w-full sm:h-9 sm:w-auto">
              {saving ? "Saving…" : "Save match stats"}
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
