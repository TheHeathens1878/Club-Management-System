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

import { useActionState, useEffect, useState, useTransition } from "react";
import { Pencil, Plus, UserPlus } from "lucide-react";

import { DateOfBirthInput } from "@/components/date-of-birth-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { EmergencyContactsFields, type LeadContact } from "@/components/emergency-contacts-fields";
import { TownCountyFields } from "@/components/town-county-fields";
import {
  QuestionBlock,
  customQuestionsPayload,
  stageRegistrationUploads,
} from "@/components/registration-question-block";
import { emergencyContactLine, type EmergencyContact } from "@/lib/emergency-contacts";
import { formatStamp } from "@/lib/people-display";
import { TeamChoiceFields } from "@/components/registration-team-choice";
import type { RegistrationQuestion } from "@/lib/registration-questions";

import {
  addChild,
  allowAppAccess,
  registerForTeam,
  updateChildDetails,
  updateChildEmergencyContacts,
  withdrawAppAccess,
  withdrawRegistration,
  type FamilyActionState,
} from "./actions";

export type TeamOption = {
  id: string;
  name: string;
  ageGroup: string | null;
  /** `teams.gender`: null | "mixed" | "boys" | "girls". */
  gender: string | null;
};

/** The contact half of a child's record — the only half a guardian may edit. */
export type ChildDetails = {
  preferredName: string;
  email: string;
  phone: string;
  line1: string;
  line2: string;
  town: string;
  /** Settled by the town where the club knows it (see lib/address). */
  county: string;
  postcode: string;
  /** The child's address is the lead contact's, so the box starts ticked. */
  sameAsLead: boolean;
};

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
        {/* Left blank on purpose: 1 January 1990 would open the wheel further
            from a child's birth year than today already is. */}
        <DateOfBirthInput id="child-dob" required />
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

/**
 * Edit one child's details (Adam, 2026-08-25).
 *
 * Contact only, and the form says why: the name and the date of birth are not
 * fields here because `update_child_details()` has no argument for them.
 *
 * The address is one control with two states. "Same address as lead contact"
 * ticked hands the whole question to the server, which copies the signed-in
 * guardian's own address; unticked reveals the four fields the join wizard
 * uses, which is the case Adam named — separated parents, two households, one
 * child, and neither address allowed to overwrite the other.
 */
export function ChildDetailsForm({
  childPersonId,
  childName,
  initial,
  leadAddressLine,
}: {
  childPersonId: string;
  childName: string;
  initial: ChildDetails;
  /** The lead contact's address in one line, so the tick-box is not a guess. */
  leadAddressLine: string | null;
}) {
  const [state, action, pending] = useActionState<FamilyActionState, FormData>(
    updateChildDetails,
    {},
  );
  const [open, setOpen] = useState(false);
  const [sameAsLead, setSameAsLead] = useState(initial.sameAsLead && !!leadAddressLine);

  // A save closes the form (Adam, 2026-08-25: the tick "re-adds" itself after
  // saving). React 19 resets a form once its action completes, and a reset
  // snaps a checkbox back to the state it was MOUNTED with — ticked — while
  // the address fields React had opened stayed open, so the screen showed
  // the lead's address chosen over the one just typed. Closing on success
  // means the reset lands on nothing, and reopening derives the tick from
  // what the server now holds rather than from a stale mount.
  useEffect(() => {
    if (state.notice) setOpen(false);
  }, [state]);

  function openForm() {
    setSameAsLead(initial.sameAsLead && !!leadAddressLine);
    setOpen(true);
  }

  if (!open) {
    return (
      <div className="space-y-3">
        <Feedback state={state} />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={openForm}
          className="min-h-[44px] w-full lg:min-h-0 lg:w-auto"
        >
          <Pencil className="h-4 w-4" /> Edit details
        </Button>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4 rounded-lg border bg-secondary/20 p-4">
      <input type="hidden" name="child_person_id" value={childPersonId} />

      <p className="text-sm text-muted-foreground">
        {childName}&apos;s contact details. Their name and date of birth are the club&apos;s record
        to correct — ask a club administrator.
      </p>

      <div className="space-y-1">
        <Label htmlFor={`child-known-as-${childPersonId}`}>Known as</Label>
        <Input
          id={`child-known-as-${childPersonId}`}
          name="preferred_name"
          defaultValue={initial.preferredName}
          placeholder="The name they are called at training"
          autoComplete="off"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`child-email-${childPersonId}`}>Email</Label>
          <Input
            id={`child-email-${childPersonId}`}
            name="email"
            type="email"
            defaultValue={initial.email}
            autoComplete="off"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`child-phone-${childPersonId}`}>Phone</Label>
          <Input
            id={`child-phone-${childPersonId}`}
            name="phone"
            type="tel"
            defaultValue={initial.phone}
            autoComplete="off"
          />
        </div>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Home address</legend>

        <label className="flex min-h-[44px] cursor-pointer items-start gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
          <input
            type="checkbox"
            name="same_as_lead"
            value="yes"
            checked={sameAsLead}
            onChange={(event) => setSameAsLead(event.target.checked)}
            disabled={!leadAddressLine}
            className="mt-0.5 h-4 w-4 accent-primary"
          />
          <span>
            Same address as lead contact
            <span className="block text-xs text-muted-foreground">
              {leadAddressLine
                ? leadAddressLine
                : "Your own address is not on record yet — add it on My profile, or type your child's below."}
            </span>
          </span>
        </label>

        {!sameAsLead && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor={`child-line1-${childPersonId}`}>Address line 1</Label>
              <Input
                id={`child-line1-${childPersonId}`}
                name="address_line1"
                defaultValue={initial.line1}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor={`child-line2-${childPersonId}`}>Address line 2 (optional)</Label>
              <Input
                id={`child-line2-${childPersonId}`}
                name="address_line2"
                defaultValue={initial.line2}
                autoComplete="off"
              />
            </div>
            <TownCountyFields
              idPrefix={`child-address-${childPersonId}`}
              defaultTown={initial.town}
              defaultCounty={initial.county}
            />
            <div className="space-y-1">
              <Label htmlFor={`child-postcode-${childPersonId}`}>Postcode</Label>
              <Input
                id={`child-postcode-${childPersonId}`}
                name="address_postcode"
                defaultValue={initial.postcode}
                autoComplete="off"
              />
            </div>
          </div>
        )}
      </fieldset>

      <Feedback state={state} />

      <div className="flex flex-col items-stretch gap-2 lg:flex-row lg:flex-wrap lg:items-center">
        <Button type="submit" size="sm" disabled={pending} className="min-h-[44px] lg:min-h-0">
          {pending ? "Saving…" : "Save details"}
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

/**
 * "Register for a team" — the family screen's copy of /join step 3 (Adam,
 * 2026-08-25: "Why is the main registration form not showing when register a
 * player? There is no photo upload or ID upload"). The form IS the builder's
 * questions, drawn by the same <QuestionBlock/> the wizard uses, and the photo
 * and the ID go to their buckets from the browser before the action runs —
 * which is why this form drives the action itself rather than through
 * useActionState. The emergency contact is not asked here any more: it lives
 * on the child's record above, and the action refuses a registration for a
 * child with none.
 */
export function RegisterForm({
  personId,
  personName,
  firstName,
  minor,
  needsId,
  contactsOnRecord,
  seasonId,
  seasonName,
  teams,
  questions,
  dob,
  recordedSex,
  isAdmin,
  isSelf = false,
}: {
  personId: string;
  personName: string;
  firstName: string;
  minor: boolean;
  /** The club has neither seen their ID nor holds a document. */
  needsId: boolean;
  /** How many emergency contacts are on the person's record. */
  contactsOnRecord: number;
  seasonId: string | null;
  seasonName: string | null;
  teams: TeamOption[];
  /** The live registration form, in position order. */
  questions: RegistrationQuestion[];
  /** yyyy-mm-dd, or null when the club holds no date of birth. */
  dob: string | null;
  /** `people.sex` as the club already has it, or null. */
  recordedSex: string | null;
  /** Only a club administrator is offered "show all teams". */
  isAdmin: boolean;
  isSelf?: boolean;
}) {
  const [state, setState] = useState<FamilyActionState>({});
  const [pending, startTransition] = useTransition();
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

  const player = { personId, firstName, isSelf, minor, needsId };

  function submit(formData: FormData) {
    formData.set("person_id", personId);
    formData.set("season_id", seasonId ?? "");
    formData.set("is_self", isSelf ? "yes" : "no");
    formData.set("is_minor", minor ? "yes" : "no");
    formData.set("gdpr_asked", questions.some((q) => q.qtype === "gdpr_consent") ? "yes" : "no");
    formData.set("custom_questions", customQuestionsPayload(questions));
    startTransition(async () => {
      // The files go to their buckets first; the action is handed the paths.
      const staged = await stageRegistrationUploads(formData, personId);
      if ("error" in staged) {
        setState({ error: staged.error });
        return;
      }
      const result = await registerForTeam({}, formData);
      setState(result);
      if (result.notice) setOpen(false);
    });
  }

  return (
    <form
      action={submit}
      className="space-y-5 rounded-lg border bg-secondary/20 p-4"
      onChange={() => {
        // Adam, 2026-09-01: a photo over 5MB was refused, "when I chose a
        // different file, the same error message remains". The message was only
        // cleared by a save that worked, so somebody who fixed the thing was
        // still being told it was broken — and the refusal is about a file that
        // is no longer the one in the box.
        if (state.error) setState({});
      }}
    >
      <p className="text-sm">
        Registering <span className="font-medium">{personName}</span>
        {seasonName ? ` for ${seasonName}` : ""}.
      </p>

      {/* The same picker /join uses: own age band or the one above, and a
          girls' team for female players only (Adam, 2026-08-26). Both rules
          are re-asked by `registrations_guard()` when the row is written. */}
      <TeamChoiceFields
        idPrefix={`register-${personId}`}
        teamFieldName="team_id"
        teams={teams}
        dob={dob}
        recordedSex={recordedSex}
        isAdmin={isAdmin}
        firstName={firstName}
        helpText="A club administrator confirms the team. Only the player's own age group and the one above it are offered."
      />

      {contactsOnRecord === 0 ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Add an emergency contact for {firstName} first — it is kept on their record, under
          Contact details above, and the club will not take a registration without one.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Emergency contacts on record: {contactsOnRecord}. Change them under Contact details
          above.
        </p>
      )}

      {questions.map((question) => (
        <QuestionBlock key={question.id} question={question} player={player} />
      ))}

      {questions.length === 0 && (
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
          <input
            type="checkbox"
            name="terms_accepted"
            value="yes"
            required
            className="mt-0.5 h-4 w-4 accent-primary"
          />
          <span>
            <span className="font-medium">I confirm</span> these details are correct and accept
            the club&apos;s playing terms for the season.{" "}
            <span className="text-destructive">*</span>
          </span>
        </label>
      )}

      <Feedback state={state} />

      <div className="flex flex-col items-stretch gap-2 lg:flex-row lg:flex-wrap lg:items-center">
        <Button
          type="submit"
          size="sm"
          disabled={pending || contactsOnRecord === 0}
          className="min-h-[44px] lg:min-h-0"
        >
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

/**
 * A child's emergency contacts (Adam, 2026-08-25): up to two, on the child's
 * record, with "I am the first emergency contact" for the signed-in guardian.
 * Closes on a successful save for the same reason the address form does — a
 * reset must never land on a live tick-box.
 */
export function EmergencyContactsForm({
  childPersonId,
  childName,
  initial,
  lead,
}: {
  childPersonId: string;
  childName: string;
  initial: EmergencyContact[];
  lead: LeadContact | null;
}) {
  const [state, action, pending] = useActionState<FamilyActionState, FormData>(
    updateChildEmergencyContacts,
    {},
  );
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (state.notice) setOpen(false);
  }, [state]);

  if (!open) {
    return (
      <div className="space-y-2">
        {initial.length === 0 ? (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            No emergency contact on record yet — the club cannot register {childName} for a team
            without one.
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {initial.map((contact) => (
              <li key={contact.position}>
                <span className="text-muted-foreground">{contact.position}.</span>{" "}
                {emergencyContactLine(contact)}
              </li>
            ))}
          </ul>
        )}
        <Feedback state={state} />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          className="min-h-[44px] w-full lg:min-h-0 lg:w-auto"
        >
          <Pencil className="h-4 w-4" />{" "}
          {initial.length === 0 ? "Add emergency contacts" : "Edit emergency contacts"}
        </Button>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4 rounded-lg border bg-secondary/20 p-4">
      <input type="hidden" name="child_person_id" value={childPersonId} />
      <EmergencyContactsFields
        idPrefix={`ec-${childPersonId}`}
        initial={initial}
        lead={lead}
        personName={childName}
      />
      <Feedback state={state} />
      <div className="flex flex-col items-stretch gap-2 lg:flex-row lg:flex-wrap lg:items-center">
        <Button type="submit" size="sm" disabled={pending} className="min-h-[44px] lg:min-h-0">
          {pending ? "Saving…" : "Save contacts"}
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
  dob,
}: {
  childPersonId: string;
  childName: string;
  consent: { id: string; grantedAt: string } | null;
  minAccountAge: number;
  /** The child's date of birth, so the screen can name the day access starts. */
  dob: string | null;
}) {
  const [grantState, grantAction, granting] = useActionState<FamilyActionState, FormData>(
    allowAppAccess,
    {},
  );
  const [revokeState, revokeAction, revoking] = useActionState<FamilyActionState, FormData>(
    withdrawAppAccess,
    {},
  );

  // Adam, 2026-09-01: "it must only allow access on the 13th birthday and must
  // say this under grant access."
  //
  // The database has always been the one that decides: SG-10's guard on
  // `profiles` refuses an account to anyone below min_account_age, so a consent
  // granted early buys nothing. What it does do is mislead — the badge reads
  // "App access allowed" and the child cannot have an account for years. So the
  // button waits for the day, and says which day it is waiting for.
  const eligibleFrom = (() => {
    if (!dob) return null;
    const birth = new Date(`${dob}T00:00:00Z`);
    if (Number.isNaN(birth.getTime())) return null;
    const at = new Date(birth);
    at.setUTCFullYear(at.getUTCFullYear() + minAccountAge);
    return at;
  })();
  const notYet = !!eligibleFrom && eligibleFrom.getTime() > Date.now();
  const eligibleLabel = eligibleFrom
    ? eligibleFrom.toLocaleDateString("en-GB", {
        timeZone: "Europe/London",
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

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
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="muted">No app access</Badge>
            <form action={grantAction} className="w-full lg:w-auto">
              <input type="hidden" name="child_person_id" value={childPersonId} />
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={granting || notYet}
                className="min-h-[44px] w-full lg:min-h-0 lg:w-auto"
              >
                {granting ? "Recording…" : "Allow app access"}
              </Button>
            </form>
          </div>
          {/* The sentence sits UNDER the button, which is where somebody who has
              just tried to press it is looking. */}
          {notYet ? (
            <p className="text-sm text-amber-800">
              Not yet — {childName} can have their own login from{" "}
              <span className="font-medium">{eligibleLabel}</span>, their {minAccountAge}th
              birthday. Allowing it before then would record a permission that cannot take effect,
              so the button waits: come back on the day and it will work.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {childName} is {minAccountAge} or over, so this takes effect as soon as it is
              recorded.
            </p>
          )}
        </div>
      )}

      <Feedback state={grantState} />
      <Feedback state={revokeState} />
    </div>
  );
}
