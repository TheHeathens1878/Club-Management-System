"use client";

/**
 * "I also coach" / "I also referee", for somebody who is already here.
 *
 * Adam, 2026-09-02. The joining form asks both on its first step, which serves
 * everybody who arrives from today and nobody who arrived before. This is the
 * same two questions in the place a member goes to look at what the club
 * thinks they are.
 *
 * Two separate forms rather than one with a pair of ticks: they are two
 * different requests, they are decided separately in /approvals, and one of
 * them carries a team. Each says its own answer back — including the referee
 * age refusal, which names the date the person may ask on and is shown whole.
 */

import { useActionState } from "react";

import { TeamPicker, type TeamOption } from "@/components/team-picker";
import { Button } from "@/components/ui/button";

import { requestClubRole, type RequestState } from "./actions";

const EMPTY: RequestState = {};

function Feedback({ state }: { state: RequestState }) {
  if (state.error) {
    return (
      <p className="whitespace-pre-line rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {state.error}
      </p>
    );
  }
  if (state.notice) {
    return (
      <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        {state.notice}
      </p>
    );
  }
  return null;
}

export function AskToCoachForm({ teams }: { teams: TeamOption[] }) {
  const [state, action, pending] = useActionState(requestClubRole, EMPTY);

  return (
    <form action={action} className="space-y-3 rounded-lg border p-3">
      <input type="hidden" name="role" value="coach" />
      <p className="text-sm font-medium">I coach a team</p>
      <TeamPicker
        id="ask-coach-team"
        name="team_id"
        teams={teams}
        label="Which team?"
        help="Leave it blank if you do not know yet — the club will place you."
      />
      <Feedback state={state} />
      <Button type="submit" size="sm" disabled={pending} className="min-h-[44px] lg:min-h-0">
        {pending ? "Asking…" : "Ask to coach"}
      </Button>
    </form>
  );
}

export function AskToRefereeForm() {
  const [state, action, pending] = useActionState(requestClubRole, EMPTY);

  return (
    <form action={action} className="space-y-3 rounded-lg border p-3">
      <input type="hidden" name="role" value="referee" />
      <p className="text-sm font-medium">I referee</p>
      <p className="text-xs text-muted-foreground">
        The club registers referees from 14. Once an administrator confirms it you join the
        referees group, where games needing one are posted and claimed.
      </p>
      <Feedback state={state} />
      <Button type="submit" size="sm" disabled={pending} className="min-h-[44px] lg:min-h-0">
        {pending ? "Asking…" : "Ask to referee"}
      </Button>
    </form>
  );
}

/** Both, under one heading. */
export function AskRoleCard({ teams }: { teams: TeamOption[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <AskToCoachForm teams={teams} />
      <AskToRefereeForm />
    </div>
  );
}
