import type { ReactNode } from "react";

import type { Database, Json } from "@club/db";

import type { LeadContact } from "@/components/emergency-contacts-fields";
import {
  RegistrationDetailsBody,
  registrationDetailsCaption,
} from "@/components/registration-details";
import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/callout";
import type { EmergencyContact } from "@/lib/emergency-contacts";
import { formatStamp } from "@/lib/people-display";
import {
  REGISTRATION_STATUS_LABELS,
  registrationStatusVariant,
  type RegistrationStatusValue,
} from "@/lib/registration-form";
import type { RegistrationQuestion } from "@/lib/registration-questions";

import type { ChildSheetPanelMode } from "./child-sheet-modes";
import {
  AppAccessForm,
  ChildDetailsForm,
  EmergencyContactsForm,
  RegisterForm,
  WithdrawForm,
  type ChildDetails,
  type TeamOption,
} from "./family-forms";

/**
 * What `ChildSheet` shows, one mode at a time (P8.6).
 *
 * `/family` does the reading; this file does the drawing — the body-module
 * pattern `people/[id]/sheet-bodies.tsx` established. It is a plain server
 * module, NOT `"use client"`: it composes the client forms that hold the
 * server actions, and every one of those keeps the action and the signature it
 * always had. The split exists so the page can be read as "here is the
 * household" without four hundred lines of form markup in the middle of it.
 *
 * Each mode gets only what it was given. The registration form's questions and
 * the answers from the last one arrive EMPTY unless the page was asked for
 * that mode, which is the whole point of addressing the panel with `?sheet=`:
 * a parent opening a phone number does not pay for the form builder's
 * questions and two registration reads.
 */

export type RegistrationRow = Pick<
  Database["public"]["Tables"]["registrations"]["Row"],
  | "id"
  | "person_id"
  | "season_id"
  | "team_id"
  | "status"
  | "decision_note"
  | "submitted_at"
  | "decided_at"
>;

export type ChildSheetData = {
  personId: string;
  /** The full name, as the club holds it. */
  name: string;
  /** What the parent calls them — `preferred_name || first_name`. */
  firstName: string;
  isMinor: boolean;
  dob: string | null;
  /** The contact half of the record, for the details form. */
  details: ChildDetails;
  /** The caller's own address in one line, so the tick-box is not a guess. */
  leadAddressLine: string | null;
  contacts: EmergencyContact[];
  /** The caller as "I am the first emergency contact". */
  lead: LeadContact | null;
  /** The live SG-10 app-account consent, or null. */
  consent: { id: string; grantedAt: string } | null;
  minAccountAge: number;
  registrations: RegistrationRow[];
  teamNames: Map<string, string>;
  seasonNames: Map<string, string>;
  /** Only read for the register mode; null when the club has no season. */
  register: {
    seasonId: string;
    seasonName: string | null;
    teams: TeamOption[];
    questions: RegistrationQuestion[];
    /** The club has neither seen their ID nor holds a document. */
    needsId: boolean;
    recordedSex: string | null;
    /** Only a club administrator is offered "show all teams". */
    isAdmin: boolean;
  } | null;
  /** Only read for the snapshot mode. */
  snapshot: { details: Json; seasonName: string | null; updatedAt: string } | null;
  photoConsents: Set<string>;
  questionLabels: Map<string, string>;
};

/**
 * Where each registration stands, and the one place a family may withdraw.
 *
 * Shared by the sheet's Registrations mode and the parent's own fold, because
 * a registration in their own name is the same row read under a different
 * policy (`registrations_self_read` rather than the guardian one).
 */
export function RegistrationList({
  registrations,
  teamNames,
  seasonNames,
  canWithdraw,
}: {
  registrations: RegistrationRow[];
  teamNames: Map<string, string>;
  seasonNames: Map<string, string>;
  canWithdraw: boolean;
}) {
  if (registrations.length === 0) {
    return <p className="text-sm text-muted-foreground">No registrations yet.</p>;
  }

  return (
    <ul className="space-y-2">
      {registrations.map((registration) => {
        const status = registration.status as RegistrationStatusValue;
        return (
          <li key={registration.id} className="rounded-lg border bg-card px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-full font-medium lg:w-auto">
                {registration.team_id
                  ? (teamNames.get(registration.team_id) ?? "Team")
                  : "No team requested"}
              </span>
              <Badge variant="outline">
                {seasonNames.get(registration.season_id) ?? "Season"}
              </Badge>
              <Badge variant={registrationStatusVariant(status)}>
                {REGISTRATION_STATUS_LABELS[status]}
              </Badge>
              <span className="w-full text-xs text-muted-foreground lg:ml-auto lg:w-auto">
                Sent {formatStamp(registration.submitted_at)}
              </span>
            </div>
            {registration.decision_note && (
              <p className="mt-1 text-xs text-muted-foreground">
                Club note: {registration.decision_note}
              </p>
            )}
            {/* Adam, 2026-08-25: "Parents can't withdraw registration after
                it's been granted, only admin." The button is offered only
                where the database would accept it — `registrations_guard()`
                refuses a family's withdrawal once the club has approved it,
                and says so. Once approved there is a squad place hanging off
                this row, and undoing that is the club's job. */}
            {canWithdraw && status === "pending" && (
              <div className="mt-2">
                <WithdrawForm registrationId={registration.id} />
              </div>
            )}
            {status === "approved" && (
              <p className="mt-1 text-xs text-muted-foreground">
                Approved — ask a club administrator to withdraw.
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function ChildSheetBody({
  mode,
  data,
}: {
  mode: ChildSheetPanelMode;
  data: ChildSheetData;
}): ReactNode {
  if (mode === "details") {
    return (
      <div className="space-y-3">
        {/* The sentence the old card carried, kept word for word: it is the
            honest answer to "why can I not fix the spelling of their name?"
            — `update_child_details()` has no argument for a name or a date of
            birth, so the screen says so rather than offering a button the
            database would refuse. */}
        <p className="text-sm text-muted-foreground">
          Names and dates of birth are corrected by the club, not here — ask a club administrator
          and they will change it on the record.
        </p>
        <ChildDetailsForm
          childPersonId={data.personId}
          childName={data.name}
          initial={data.details}
          leadAddressLine={data.leadAddressLine}
        />
      </div>
    );
  }

  if (mode === "contacts") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Up to two, kept on {data.firstName}&apos;s record rather than on a registration form, so
          they follow them from season to season.
        </p>
        <EmergencyContactsForm
          childPersonId={data.personId}
          childName={data.firstName}
          initial={data.contacts}
          lead={data.lead}
        />
      </div>
    );
  }

  if (mode === "access") {
    return (
      <AppAccessForm
        childPersonId={data.personId}
        childName={data.name}
        consent={data.consent}
        minAccountAge={data.minAccountAge}
        dob={data.dob}
      />
    );
  }

  if (mode === "register") {
    if (!data.register) {
      return (
        <p className="text-sm text-muted-foreground">
          Registrations open once the club sets the current season.
        </p>
      );
    }
    return (
      <RegisterForm
        bare
        personId={data.personId}
        personName={data.name}
        firstName={data.firstName}
        minor={data.isMinor}
        needsId={data.register.needsId}
        contactsOnRecord={data.contacts.length}
        seasonId={data.register.seasonId}
        seasonName={data.register.seasonName}
        teams={data.register.teams}
        questions={data.register.questions}
        dob={data.dob}
        recordedSex={data.register.recordedSex}
        isAdmin={data.register.isAdmin}
      />
    );
  }

  if (mode === "registrations") {
    return (
      <div className="space-y-3">
        <RegistrationList
          registrations={data.registrations}
          teamNames={data.teamNames}
          seasonNames={data.seasonNames}
          canWithdraw
        />
      </div>
    );
  }

  // snapshot — what the club holds from the last registration, read-only.
  if (!data.snapshot) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing yet. The answers {data.firstName}&apos;s registration form gives — the medical
        notes, the permissions, the rest — appear here once one has been sent.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <Callout tone="info">
        {registrationDetailsCaption(data.snapshot.seasonName, data.snapshot.updatedAt)}. Read-only:
        registering {data.firstName} again replaces these answers.
      </Callout>
      <RegistrationDetailsBody
        details={data.snapshot.details}
        photoConsents={data.photoConsents}
        questionLabels={data.questionLabels}
      />
    </div>
  );
}
