"use client";

/**
 * Approve / reject for one pending registration (gap 9).
 *
 * `blocked` is not an error to tidy away: the database refused because a
 * safeguarding requirement is not met, the registration is still pending, and
 * the message names the fix. It is shown in full.
 */

import { useActionState, useState } from "react";
import { AlertTriangle, Check, ShieldCheck, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Select } from "@/components/ui/field";

import {
  approveRegistration,
  rejectRegistration,
  setPersonIdVerified,
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
      <div className="flex flex-col items-stretch gap-2 lg:flex-row lg:flex-wrap lg:items-end">
        <form
          action={approve}
          className="flex flex-col items-stretch gap-2 lg:flex-row lg:flex-wrap lg:items-end"
        >
          <input type="hidden" name="registration_id" value={registrationId} />
          <div className="space-y-1 lg:min-w-56">
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
              className="min-h-[44px] lg:h-9 lg:min-h-0"
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
          <Button
            type="submit"
            size="sm"
            disabled={approving}
            className="min-h-[44px] lg:min-h-0"
          >
            <Check className="h-4 w-4" />
            {approving ? "Approving…" : "Approve"}
          </Button>
        </form>

        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setShowReject((open) => !open)}
          className="min-h-[44px] lg:min-h-0"
        >
          <X className="h-4 w-4" /> Reject
        </Button>
      </div>

      {showReject && (
        <form
          action={reject}
          className="flex flex-col items-stretch gap-2 lg:flex-row lg:flex-wrap lg:items-end"
        >
          <input type="hidden" name="registration_id" value={registrationId} />
          <div className="space-y-1 lg:min-w-64">
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
          <Button
            type="submit"
            size="sm"
            variant="destructive"
            disabled={rejecting}
            className="min-h-[44px] lg:min-h-0"
          >
            {rejecting ? "Rejecting…" : "Confirm rejection"}
          </Button>
        </form>
      )}

      <Outcome state={approveState} />
      <Outcome state={rejectState} />
    </div>
  );
}

/**
 * "ID seen — verified": the administrator's tick.
 *
 * Adam: the ID upload is "mandatory if we haven't certified that we have
 * previously seen it (tick box by admin)". This is that box, and it is the
 * only control on the queue that changes what a FAMILY is asked for next time
 * — which is why it is a deliberate submit rather than a checkbox that saves
 * itself, and why undoing it is offered in the same place.
 */
export function IdVerifiedForm({
  personId,
  verified,
  verifiedAt,
  verifiedByName,
}: {
  personId: string;
  verified: boolean;
  verifiedAt?: string | null;
  /**
   * Who ticked it (Adam, 2026-08-25: "it should put a name against the ID
   * approval"). Resolved on the server from `people.id_verified_by` through
   * `profiles.person_id`; absent when the caller may not see that name.
   */
  verifiedByName?: string | null;
}) {
  const [state, action, pending] = useActionState(setPersonIdVerified, {});

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="person_id" value={personId} />
      <input type="hidden" name="verified" value={verified ? "no" : "yes"} />
      {verified ? (
        <>
          <span className="flex items-center gap-1.5 text-sm text-emerald-700">
            <ShieldCheck className="h-4 w-4" /> ID seen and verified
            {verifiedByName ? ` by ${verifiedByName}` : ""}
            {verifiedAt ? ` · ${new Date(verifiedAt).toLocaleDateString("en-GB")}` : ""}
          </span>
          <Button
            type="submit"
            size="sm"
            variant="ghost"
            disabled={pending}
            className="min-h-[44px] lg:min-h-0"
          >
            {pending ? "Saving…" : "Undo"}
          </Button>
        </>
      ) : (
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={pending}
          className="min-h-[44px] lg:min-h-0"
        >
          <ShieldCheck className="mr-1 h-4 w-4" />
          {pending ? "Saving…" : "ID seen — verified"}
        </Button>
      )}
      <Outcome state={state} />
    </form>
  );
}
