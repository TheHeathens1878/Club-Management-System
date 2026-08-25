"use client";

/**
 * The family screen's forms (gap 9, plus SG-10's app-account consent).
 *
 * Plain server-action forms driven by `useActionState` — no client-side
 * validation stands in for the database's. The date of birth field carries its
 * safeguarding explanation next to it rather than in a tooltip: the parent is
 * being asked for their child's DOB and is entitled to know why before typing
 * it.
 */

import { useActionState, useState } from "react";
import { Plus, UserPlus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Select, Textarea } from "@/components/ui/field";
import { formatStamp } from "@/lib/people-display";
import {
  KIT_SIZES,
  PHOTO_PREFERENCE_LABELS,
  type PhotoPreferences,
} from "@/lib/registration-form";

import {
  addChild,
  allowAppAccess,
  registerForTeam,
  withdrawAppAccess,
  withdrawRegistration,
  type FamilyActionState,
} from "./actions";

export type TeamOption = { id: string; name: string; ageGroup: string | null };

function Feedback({ state }: { state: FamilyActionState }) {
  if (state.error) {
    return (
      <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
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

export function AddChildForm() {
  const [state, action, pending] = useActionState<FamilyActionState, FormData>(addChild, {});
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className="space-y-3">
        <Feedback state={state} />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          className="min-h-[44px] w-full lg:min-h-0 lg:w-auto"
        >
          <UserPlus className="h-4 w-4" /> Add a child
        </Button>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="child-first-name">
            First name <span className="text-destructive">*</span>
          </Label>
          <Input id="child-first-name" name="first_name" required autoComplete="off" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="child-last-name">
            Last name <span className="text-destructive">*</span>
          </Label>
          <Input id="child-last-name" name="last_name" required autoComplete="off" />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="child-preferred-name">Known as (optional)</Label>
        <Input
          id="child-preferred-name"
          name="preferred_name"
          placeholder="The name they are called at training"
          autoComplete="off"
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="child-dob">
          Date of birth <span className="text-destructive">*</span>
        </Label>
        <Input id="child-dob" name="dob" type="date" required />
        <p className="text-xs text-muted-foreground">
          The club needs this to place your child in the right age group and to apply its
          safeguarding rules — those rules treat anyone whose date of birth is unknown as a child,
          so a missing date makes things harder, not easier. Only a child can be added here; an
          adult creates their own account.
        </p>
      </div>

      <Feedback state={state} />

      <div className="flex flex-col items-stretch gap-2 lg:flex-row lg:flex-wrap lg:items-center">
        <Button type="submit" size="sm" disabled={pending} className="min-h-[44px] lg:min-h-0">
          {pending ? "Adding…" : "Add child"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setOpen(false)}
          className="min-h-[44px] lg:min-h-0"
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function RegisterForm({
  personId,
  personName,
  seasonId,
  seasonName,
  teams,
  isSelf = false,
}: {
  personId: string;
  personName: string;
  seasonId: string | null;
  seasonName: string | null;
  teams: TeamOption[];
  isSelf?: boolean;
}) {
  const [state, action, pending] = useActionState<FamilyActionState, FormData>(registerForTeam, {});
  const [open, setOpen] = useState(false);

  if (!seasonId) {
    return (
      <p className="text-sm text-muted-foreground">
        Registrations open once the club sets the current season.
      </p>
    );
  }

  if (!open) {
    return (
      <div className="space-y-3">
        <Feedback state={state} />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          className="min-h-[44px] w-full lg:min-h-0 lg:w-auto"
        >
          <Plus className="h-4 w-4" /> Register for a team
        </Button>
      </div>
    );
  }

  const photoKeys = Object.keys(PHOTO_PREFERENCE_LABELS) as (keyof PhotoPreferences)[];

  return (
    <form action={action} className="space-y-5 rounded-lg border bg-secondary/20 p-4">
      <input type="hidden" name="person_id" value={personId} />
      <input type="hidden" name="season_id" value={seasonId} />
      {isSelf && <input type="hidden" name="is_self" value="yes" />}

      <p className="text-sm">
        Registering <span className="font-medium">{personName}</span>
        {seasonName ? ` for ${seasonName}` : ""}.
      </p>

      <div className="space-y-1">
        <Label htmlFor={`team-${personId}`}>
          Team <span className="text-destructive">*</span>
        </Label>
        <Select id={`team-${personId}`} name="team_id" required defaultValue="">
          <option value="">Choose a team</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
              {team.ageGroup ? ` (${team.ageGroup})` : ""}
            </option>
          ))}
        </Select>
        <p className="text-xs text-muted-foreground">
          A club administrator confirms the team — ask for the one you think fits and they will
          move it if the age group is wrong.
        </p>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Emergency contact</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={`emergency-name-${personId}`}>
              Name <span className="text-destructive">*</span>
            </Label>
            <Input id={`emergency-name-${personId}`} name="emergency_name" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`emergency-phone-${personId}`}>
              Phone <span className="text-destructive">*</span>
            </Label>
            <Input id={`emergency-phone-${personId}`} name="emergency_phone" type="tel" required />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`emergency-rel-${personId}`}>Relationship to the player</Label>
          <Input
            id={`emergency-rel-${personId}`}
            name="emergency_relationship"
            placeholder="Mother, father, grandparent…"
          />
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Medical</legend>
        <p className="text-xs text-muted-foreground">
          Only club administrators and the club&apos;s safeguarding lead can read this. Coaches
          cannot — pitch-side access to a medical note is a separate, recorded request.
        </p>
        <div className="space-y-1">
          <Label htmlFor={`medical-conditions-${personId}`}>Conditions</Label>
          <Textarea
            id={`medical-conditions-${personId}`}
            name="medical_conditions"
            rows={2}
            placeholder="e.g. asthma, epilepsy — or leave blank if none"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={`medical-medication-${personId}`}>Medication</Label>
            <Input id={`medical-medication-${personId}`} name="medical_medication" />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`medical-allergies-${personId}`}>Allergies</Label>
            <Input id={`medical-allergies-${personId}`} name="medical_allergies" />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Playing details (optional)</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor={`previous-club-${personId}`}>Previous club</Label>
            <Input id={`previous-club-${personId}`} name="previous_club" />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`position-${personId}`}>Preferred position</Label>
            <Input id={`position-${personId}`} name="preferred_position" />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`kit-${personId}`}>Kit size</Label>
            <Select id={`kit-${personId}`} name="kit_size" defaultValue="">
              <option value="">Not sure yet</option>
              {KIT_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </fieldset>

      {isSelf ? (
        <fieldset className="space-y-2 rounded-lg border bg-card p-3">
          <legend className="px-1 text-sm font-semibold">Photos of you</legend>
          <p className="text-xs text-muted-foreground">
            Where you are happy for the club to use photographs of you. Leave them all unticked and
            the club uses none.
          </p>
          {photoKeys.map((key) => (
            <label key={key} className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                name={`photo_${key}`}
                value="yes"
                className="mt-0.5 h-4 w-4 accent-primary"
              />
              <span>{PHOTO_PREFERENCE_LABELS[key]}</span>
            </label>
          ))}
        </fieldset>
      ) : (
        <p className="rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground">
          Photo permissions for a child are recorded separately by the club, one decision at a time,
          and last for the season. The club will ask you for them — they are not a tick-box on this
          form.
        </p>
      )}

      <label className="flex cursor-pointer items-start gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
        <input
          type="checkbox"
          name="terms_accepted"
          value="yes"
          required
          className="mt-0.5 h-4 w-4 accent-primary"
        />
        <span>
          <span className="font-medium">I confirm</span> these details are correct and accept the
          club&apos;s playing terms for the season.{" "}
          <span className="text-destructive">*</span>
        </span>
      </label>

      <Feedback state={state} />

      <div className="flex flex-col items-stretch gap-2 lg:flex-row lg:flex-wrap lg:items-center">
        <Button type="submit" size="sm" disabled={pending} className="min-h-[44px] lg:min-h-0">
          {pending ? "Sending…" : "Send registration"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setOpen(false)}
          className="min-h-[44px] lg:min-h-0"
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function WithdrawForm({ registrationId }: { registrationId: string }) {
  const [state, action, pending] = useActionState<FamilyActionState, FormData>(
    withdrawRegistration,
    {},
  );

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="registration_id" value={registrationId} />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={pending}
        className="min-h-[44px] lg:min-h-0"
      >
        {pending ? "Withdrawing…" : "Withdraw"}
      </Button>
      {state.error && <span className="text-sm text-destructive">{state.error}</span>}
      {state.notice && <span className="text-sm text-muted-foreground">{state.notice}</span>}
    </form>
  );
}

/**
 * The app-account consent for one child (SG-10).
 *
 * Two buttons and a sentence. The sentence matters: a guardian is being asked
 * to decide something, and "Allow app access" on its own does not tell them
 * what they are allowing. Nothing here is disabled on a guess — if the club's
 * records do not show the caller as an active guardian, or the child is too
 * young, the database says so and its words are printed unchanged.
 */
export function AppAccessForm({
  childPersonId,
  childName,
  consent,
  minAccountAge,
}: {
  childPersonId: string;
  childName: string;
  consent: { id: string; grantedAt: string } | null;
  minAccountAge: number;
}) {
  const [grantState, grantAction, granting] = useActionState<FamilyActionState, FormData>(
    allowAppAccess,
    {},
  );
  const [revokeState, revokeAction, revoking] = useActionState<FamilyActionState, FormData>(
    withdrawAppAccess,
    {},
  );

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Allowing app access lets {childName} create their own login at{" "}
        <span className="font-medium">/register</span> once they are {minAccountAge} or over, using
        their own email address; without it the club&apos;s records stay yours to see and theirs to
        be told about.
      </p>

      {consent ? (
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="success">App access allowed</Badge>
          <span className="text-xs text-muted-foreground">
            Recorded {formatStamp(consent.grantedAt)}
          </span>
          <form action={revokeAction} className="w-full lg:w-auto">
            <input type="hidden" name="consent_id" value={consent.id} />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={revoking}
              className="min-h-[44px] w-full lg:min-h-0 lg:w-auto"
            >
              {revoking ? "Withdrawing…" : "Withdraw"}
            </Button>
          </form>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="muted">No app access</Badge>
          <form action={grantAction} className="w-full lg:w-auto">
            <input type="hidden" name="child_person_id" value={childPersonId} />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={granting}
              className="min-h-[44px] w-full lg:min-h-0 lg:w-auto"
            >
              {granting ? "Recording…" : "Allow app access"}
            </Button>
          </form>
        </div>
      )}

      <Feedback state={grantState} />
      <Feedback state={revokeState} />
    </div>
  );
}
