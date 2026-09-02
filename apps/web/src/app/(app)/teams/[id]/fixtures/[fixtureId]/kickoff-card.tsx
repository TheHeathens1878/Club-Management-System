"use client";

/**
 * Move this match's kick-off.
 *
 * Adam, 2026-09-02: "I (admin) need the ability to change KO times, by
 * clicking into the event and also bulk on the matches screen. Coaches to have
 * the ability on the event." So this card is offered to whoever can manage the
 * team, not to administrators alone — a coach is who gets told on a Thursday
 * night that the game has moved to half nine.
 *
 * The date is here as well as the time. "The kick-off moved" and "it moved to
 * Sunday" are the same act to the person doing it, and `fixtures_sync_booking`
 * treats them the same way too.
 *
 * It is deliberately blunt about what it sets off, because a kick-off is not a
 * quiet field: the pitch booking moves with it (or refuses, and says so), the
 * diary entry moves and gains a change note, and everybody who answered gets
 * told. Nobody should discover that by doing it.
 */

import { useActionState } from "react";
import { AlertCircle, CalendarClock, CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";

import {
  setFixtureKickoff,
  type MatchAdminState,
} from "../../../../matches/fixture-admin-actions";

const EMPTY: MatchAdminState = {};

export function KickoffCard({
  fixtureId,
  date,
  time,
  hasPitch,
  fromFullTime,
}: {
  fixtureId: string;
  /** Local (Europe/London) date and time, as the inputs want them. */
  date: string;
  time: string;
  hasPitch: boolean;
  /** Imported from Full-Time, so the next import may move it back. */
  fromFullTime: boolean;
}) {
  const [state, action, pending] = useActionState(setFixtureKickoff, EMPTY);

  return (
    <Card>
      <CardHeader className="p-4 lg:p-6">
        <CardTitle className="text-base">Kick-off</CardTitle>
        <p className="text-sm text-muted-foreground">
          {hasPitch
            ? "The pitch booking moves with it. If something else is already on the new slot the booking stays put and says so."
            : "This match has no pitch booked, so only the diary entry moves."}{" "}
          Everybody who has answered is told.
        </p>
      </CardHeader>
      <CardContent className="space-y-3 p-4 pt-0 lg:p-6 lg:pt-0">
        <form action={action} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="fixture_id" value={fixtureId} />
          <div className="space-y-1">
            <Label htmlFor="kickoff-date">Date</Label>
            <Input id="kickoff-date" name="kickoff_date" type="date" defaultValue={date} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="kickoff-time">Time</Label>
            <Input
              id="kickoff-time"
              name="kickoff_time"
              type="time"
              defaultValue={time}
              required
              className="w-32"
            />
          </div>
          <Button type="submit" disabled={pending} className="gap-1.5">
            <CalendarClock className="h-4 w-4" />
            {pending ? "Moving…" : "Move kick-off"}
          </Button>
        </form>

        {fromFullTime && (
          <p className="text-xs text-muted-foreground">
            This game came from Full-Time. If the league is still publishing it, the next import
            will put its own kick-off back — change it in Full-Time as well, or the change will not
            stick.
          </p>
        )}

        {state.error && (
          <p className="flex items-start gap-1.5 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{state.error}</span>
          </p>
        )}
        {state.notice && (
          <p className="flex items-start gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{state.notice}</span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
