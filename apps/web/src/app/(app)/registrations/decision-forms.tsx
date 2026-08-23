"use client";

/**
 * Approve / reject for one pending registration (gap 9).
 *
 * `blocked` is not an error to tidy away: the database refused because a
 * safeguarding requirement is not met (most often SG-6 — a coach on that team
 * without an in-date DBS or safeguarding certificate), the registration is
 * still pending, and the message names the fix. It is shown in full.
 */

import { useActionState, useState } from "react";
import { AlertTriangle, Check, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Select } from "@/components/ui/field";

import {
  approveRegistration,
  rejectRegistration,
  type RegistrationDecisionState,
} from "./actions";

export type TeamChoice = { id: string; name: string; ageGroup: string | null };

function Outcome({ state }: { state: RegistrationDecisionState }) {
  return (
    <>
      {state.blocked && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="whitespace-pre-wrap">{state.blocked}</span>
        </p>
      )}
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state.notice && <p className="text-sm text-muted-foreground">{state.notice}</p>}
    </>
  );
}

export function DecisionPanel({
  registrationId,
  requestedTeamId,
  teams,
}: {
  registrationId: string;
  requestedTeamId: string | null;
  teams: TeamChoice[];
}) {
  const [approveState, approve, approving] = useActionState<RegistrationDecisionState, FormData>(
    approveRegistration,
    {},
  );
  const [rejectState, reject, rejecting] = useActionState<RegistrationDecisionState, FormData>(
    rejectRegistration,
    {},
  );
  const [showReject, setShowReject] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <form action={approve} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="registration_id" value={registrationId} />
          <div className="min-w-56 space-y-1">
            <Label
              htmlFor={`team-${registrationId}`}
              className="text-xs text-muted-foreground"
            >
              Team
            </Label>
            <Select
              id={`team-${registrationId}`}
              name="team_id"
              defaultValue={requestedTeamId ?? ""}
              className="h-9"
            >
              <option value="">Choose a team</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                  {team.ageGroup ? ` (${team.ageGroup})` : ""}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" size="sm" disabled={approving}>
            <Check className="h-4 w-4" />
            {approving ? "Approving…" : "Approve"}
          </Button>
        </form>

        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setShowReject((open) => !open)}
        >
          <X className="h-4 w-4" /> Reject
        </Button>
      </div>

      {showReject && (
        <form action={reject} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="registration_id" value={registrationId} />
          <div className="min-w-64 space-y-1">
            <Label htmlFor={`note-${registrationId}`} className="text-xs text-muted-foreground">
              Why (the family sees this)
            </Label>
            <Input
              id={`note-${registrationId}`}
              name="note"
              required
              placeholder="No space in that age group this season"
            />
          </div>
          <Button type="submit" size="sm" variant="destructive" disabled={rejecting}>
            {rejecting ? "Rejecting…" : "Confirm rejection"}
          </Button>
        </form>
      )}

      <Outcome state={approveState} />
      <Outcome state={rejectState} />
    </div>
  );
}
