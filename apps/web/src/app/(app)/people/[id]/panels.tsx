"use client";

/**
 * The editable parts of one person's record: roles, guardianships, emergency
 * contacts, and the soft delete.
 *
 * Each panel writes through a server action that uses the caller's own client,
 * so what comes back is the database's answer. A P0001 refusal — the SG-4
 * guard explaining why a guardianship cannot exist, or the dob guard explaining
 * what a correction would break — is rendered exactly as it arrived.
 */

import Link from "next/link";
import { useActionState, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Select, Textarea } from "@/components/ui/field";
import { PersonPicker } from "@/components/person-picker";
import { EmergencyContactsFields } from "@/components/emergency-contacts-fields";
import { emergencyContactLine, type EmergencyContact } from "@/lib/emergency-contacts";
import { formatStamp } from "@/lib/people-display";

import {
  purgePerson,
  restorePerson,
  softDeletePerson,
  type PersonActionState,
} from "../actions";
import {
  addGuardianship,
  endGuardianship,
  grantRole,
  revokeRole,
  setPersonEmergencyContacts,
  setPersonReferee,
  type PersonDetailState,
} from "./actions";

const EMPTY: PersonDetailState = {};
const EMPTY_PERSON: PersonActionState = {};

export const APP_ROLE_LABELS: Record<string, string> = {
  club_admin: "Club admin",
  safeguarding_lead: "Safeguarding lead",
  coach: "Coach",
  staff: "Staff",
  member: "Member",
  parent: "Parent",
  hirer: "Hirer",
  referee: "Referee",
};

export const RELATIONSHIP_LABELS: Record<string, string> = {
  parent: "Parent",
  step_parent: "Step-parent",
  grandparent: "Grandparent",
  foster_carer: "Foster carer",
  legal_guardian: "Legal guardian",
  other: "Other",
};

export type RoleRow = {
  id: string;
  role: string;
  grantedAt: string;
  notes: string | null;
};

export type GuardianshipRow = {
  id: string;
  otherPersonId: string;
  otherName: string;
  relationship: string;
  /** True when the person on screen is the guardian in this link. */
  personIsGuardian: boolean;
  endedAt: string | null;
};

function Feedback({ state }: { state: PersonDetailState | PersonActionState }) {
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

// ---------------------------------------------------------------------------

export function RolesPanel({ personId, roles }: { personId: string; roles: RoleRow[] }) {
  const [grantState, grantAction, granting] = useActionState(grantRole, EMPTY);
  const [revokeState, revokeAction] = useActionState(revokeRole, EMPTY);
  const [refState, refAction, refPending] = useActionState(setPersonReferee, EMPTY);

  const held = roles.map((r) => r.role);
  const isReferee = held.includes("referee");

  return (
    <div className="space-y-4">
      {/* Adam, 2026-09-01: "admins should be able to tick a box in a user record
          confirming they are a referee. That will add them to the referee
          group." The dropdown below could always grant it — but a dropdown is a
          place to look for something and a tick is a place to SEE it, and this
          is a fact about a person an administrator wants to read at a glance.
          The Referees group follows the role on its own. */}
      <form action={refAction} className="rounded-lg border bg-secondary/20 p-3">
        <input type="hidden" name="person_id" value={personId} />
        <input type="hidden" name="is_referee" value={isReferee ? "no" : "yes"} />
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={isReferee}
            disabled={refPending}
            onChange={(event) => event.currentTarget.form?.requestSubmit()}
            className="mt-0.5 h-4 w-4 accent-primary"
          />
          <span>
            <span className="font-medium">This person is a referee</span>
            <span className="block text-xs text-muted-foreground">
              Puts them in the Referees group, where games needing a referee are posted and
              claimed. The club registers referees from 14.
            </span>
          </span>
        </label>
        <Feedback state={refState} />
      </form>

      {roles.length === 0 ? (
        <p className="text-sm text-muted-foreground">No roles are held right now.</p>
      ) : (
        <ul className="space-y-2">
          {roles.map((role) => (
            <li key={role.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm">
                <Badge variant="default">{APP_ROLE_LABELS[role.role] ?? role.role}</Badge>
                <span className="ml-2 text-xs text-muted-foreground">
                  since {formatStamp(role.grantedAt)}
                  {role.notes ? ` · ${role.notes}` : ""}
                </span>
              </span>
              <form action={revokeAction}>
                <input type="hidden" name="person_id" value={personId} />
                <input type="hidden" name="role_id" value={role.id} />
                <Button type="submit" size="sm" variant="outline" className="min-h-[44px] px-2 text-xs lg:h-8 lg:min-h-0">
                  Revoke
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <Feedback state={revokeState} />

      <form action={grantAction} className="space-y-3 rounded-lg border border-dashed p-4">
        <input type="hidden" name="person_id" value={personId} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="grant-role">Grant a role</Label>
            <Select id="grant-role" name="role" defaultValue="">
              <option value="" disabled>
                Choose a role…
              </option>
              {Object.keys(APP_ROLE_LABELS)
                .filter((role) => !held.includes(role))
                .map((role) => (
                  <option key={role} value={role}>
                    {APP_ROLE_LABELS[role]}
                  </option>
                ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="grant-notes">Why (optional)</Label>
            <Input id="grant-notes" name="notes" placeholder="e.g. Elected at the 2026 AGM" />
          </div>
        </div>
        <Button
          type="submit"
          size="sm"
          disabled={granting}
          className="min-h-[44px] w-full lg:min-h-0 lg:w-auto"
        >
          {granting ? "Granting…" : "Grant role"}
        </Button>
        <Feedback state={grantState} />
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function GuardianshipsPanel({
  personId,
  personName,
  links,
}: {
  personId: string;
  personName: string;
  links: GuardianshipRow[];
}) {
  const [addState, addAction, adding] = useActionState(addGuardianship, EMPTY);
  const [endState, endAction] = useActionState(endGuardianship, EMPTY);
  // The direction options speak in names ("Adam Wareing is the guardian of
  // Matthew Wareing"), so the wrong way round is visible BEFORE the SG-4 guard
  // has to refuse it. Until someone is picked, a neutral placeholder stands in.
  const [otherName, setOtherName] = useState<string | null>(null);
  const [direction, setDirection] = useState<"guardian_of" | "child_of">("guardian_of");
  const other = otherName ?? "the person chosen";

  const children = links.filter((l) => l.personIsGuardian);
  const guardians = links.filter((l) => !l.personIsGuardian);

  const list = (rows: GuardianshipRow[], emptyText: string) =>
    rows.length === 0 ? (
      <p className="text-sm text-muted-foreground">{emptyText}</p>
    ) : (
      <ul className="space-y-2">
        {rows.map((link) => (
          <li key={link.id} className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm">
              <Link
                href={`/people/${link.otherPersonId}`}
                className="font-medium underline underline-offset-2"
              >
                {link.otherName}
              </Link>
              <span className="ml-2 text-xs text-muted-foreground">
                {RELATIONSHIP_LABELS[link.relationship] ?? link.relationship}
                {link.endedAt ? ` · ended ${formatStamp(link.endedAt)}` : ""}
              </span>
            </span>
            {!link.endedAt && (
              <form action={endAction}>
                <input type="hidden" name="person_id" value={personId} />
                <input type="hidden" name="guardianship_id" value={link.id} />
                <Button type="submit" size="sm" variant="outline" className="min-h-[44px] px-2 text-xs lg:h-8 lg:min-h-0">
                  End
                </Button>
              </form>
            )}
          </li>
        ))}
      </ul>
    );

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase text-muted-foreground">Children</p>
        {list(children, `${personName} is not recorded as anyone's guardian.`)}
      </div>
      <div>
        <p className="text-xs uppercase text-muted-foreground">Guardians</p>
        {list(guardians, "No guardian is recorded for this person.")}
      </div>
      <Feedback state={endState} />

      <form action={addAction} className="space-y-3 rounded-lg border border-dashed p-4">
        <p className="text-sm font-medium">Add a guardianship</p>
        <input type="hidden" name="person_id" value={personId} />
        <PersonPicker
          id="guardianship-other"
          name="other_person_id"
          label="The other person"
          excludeIds={[personId]}
          required
          onPick={(person) => setOtherName(person?.name ?? null)}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="guardianship-direction">Which way round?</Label>
            <Select
              id="guardianship-direction"
              name="direction"
              value={direction}
              onChange={(event) => setDirection(event.target.value as "guardian_of" | "child_of")}
            >
              <option value="guardian_of">
                {personName} is the guardian of {other}
              </option>
              <option value="child_of">
                {personName} is the child of {other}
              </option>
            </Select>
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {direction === "guardian_of"
                ? `${personName} will be recorded as the adult responsible for ${other}.`
                : `${other} will be recorded as the adult responsible for ${personName}.`}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="guardianship-relationship">Relationship</Label>
            <Select id="guardianship-relationship" name="relationship" defaultValue="parent">
              {Object.keys(RELATIONSHIP_LABELS).map((value) => (
                <option key={value} value={value}>
                  {RELATIONSHIP_LABELS[value]}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="guardianship-notes">Notes about the arrangement</Label>
          <Textarea id="guardianship-notes" name="notes" rows={2} />
          <p className="text-xs text-muted-foreground">
            The arrangement only. Nothing about a safeguarding concern (SG-7) — this table is read
            far more widely than the concern record.
          </p>
        </div>
        <Button
          type="submit"
          size="sm"
          disabled={adding}
          className="min-h-[44px] w-full lg:min-h-0 lg:w-auto"
        >
          {adding ? "Saving…" : "Add guardianship"}
        </Button>
        <Feedback state={addState} />
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function RetirePanel({
  personId,
  personName,
  deletedAt,
}: {
  personId: string;
  personName: string;
  deletedAt: string | null;
}) {
  const [deleteState, deleteAction, deleting] = useActionState(softDeletePerson, EMPTY_PERSON);
  const [restoreState, restoreAction, restoring] = useActionState(restorePerson, EMPTY_PERSON);

  if (deletedAt) {
    return (
      <div className="space-y-3">
        <p className="text-sm">
          Retired on <span className="font-medium">{formatStamp(deletedAt)}</span>. The record still
          exists — nothing about this person has been destroyed.
        </p>
        <form action={restoreAction}>
          <input type="hidden" name="person_id" value={personId} />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={restoring}
            className="min-h-[44px] w-full lg:min-h-0 lg:w-auto"
          >
            {restoring ? "Restoring…" : "Restore"}
          </Button>
        </form>
        <Feedback state={restoreState} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Retiring a person hides them from the lists. It is a soft delete and always has been: the
        row, their history and every audit trail stay exactly where they are (SG-2). There is no
        hard delete, and the database refuses one.
      </p>
      <form
        action={deleteAction}
        onSubmit={(event) => {
          const ok = window.confirm(
            `Retire ${personName}? The record is kept and can be restored, but they will disappear from the people list.`,
          );
          if (!ok) event.preventDefault();
        }}
      >
        <input type="hidden" name="person_id" value={personId} />
        <Button
          type="submit"
          size="sm"
          variant="destructive"
          disabled={deleting}
          className="min-h-[44px] w-full lg:min-h-0 lg:w-auto"
        >
          {deleting ? "Retiring…" : "Retire this person"}
        </Button>
      </form>
      <Feedback state={deleteState} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Emergency contacts (Adam, 2026-08-25) — on the person, up to two
// ---------------------------------------------------------------------------

export function EmergencyContactsPanel({
  personId,
  personName,
  contacts,
  canEdit,
}: {
  personId: string;
  personName: string;
  contacts: EmergencyContact[];
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState<PersonDetailState, FormData>(
    setPersonEmergencyContacts,
    EMPTY,
  );
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-3">
      {contacts.length === 0 ? (
        <p className="text-sm text-muted-foreground">None on record.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {contacts.map((contact) => (
            <li key={contact.position} className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">{contact.position}.</span>
              <span className="font-medium">{contact.name}</span>
              <a href={`tel:${contact.phone}`} className="text-primary hover:underline">
                {contact.phone}
              </a>
              {contact.relationship && (
                <span className="text-xs text-muted-foreground">{contact.relationship}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && !open && (
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          {contacts.length === 0 ? "Add emergency contacts" : "Edit emergency contacts"}
        </Button>
      )}

      {canEdit && open && (
        <form action={action} className="space-y-4 rounded-lg border bg-secondary/20 p-4">
          <input type="hidden" name="person_id" value={personId} />
          <EmergencyContactsFields
            idPrefix={`person-${personId}`}
            initial={contacts}
            lead={null}
            personName={personName}
            requireFirst={false}
          />
          <Feedback state={state} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save contacts"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {!open && <Feedback state={state} />}
      {contacts.length > 0 && !canEdit && (
        <p className="text-xs text-muted-foreground">
          {emergencyContactLine(contacts[0]!)} is who the club rings first.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Permanent deletion — super user only (Adam, 2026-08-25)
// ---------------------------------------------------------------------------
/**
 * The panel below the Retire panel, and only for a super user.
 *
 * Retiring is still the normal answer and still the one offered first. This is
 * the other thing: a real, irreversible destruction, for a GDPR erasure request
 * or for a test account that should never have existed.
 *
 * Three deliberate frictions, in the order a person meets them: a plain
 * statement of what will be destroyed and that it cannot be undone; a reason,
 * which is required because it is the only thing the surviving audit row will
 * be able to say; and the person's full name typed out, which is what enables
 * the button. None of these is the control — the control is `purge_person()`,
 * which refuses a legal hold, a safeguarding concern and the caller themselves
 * whatever this form sends. They are here so nobody arrives at that refusal by
 * accident.
 */
export function PurgePanel({
  personId,
  personName,
}: {
  personId: string;
  personName: string;
}) {
  const [state, action, pending] = useActionState(purgePerson, EMPTY_PERSON);
  const [typed, setTyped] = useState("");
  const armed = typed.trim().toLowerCase() === personName.trim().toLowerCase();

  return (
    <div className="mt-6 space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
      <p className="text-sm font-semibold text-destructive">Delete permanently</p>
      <p className="text-sm text-muted-foreground">
        This destroys {personName}&apos;s record and everything that references it — their sign-in,
        team memberships, registrations, messages, reactions, emergency contacts, uploaded ID and
        photo. Rows that belong to other people, and the club&apos;s own records, keep their place
        and simply stop naming them. <span className="font-medium">It cannot be undone.</span>
      </p>
      <p className="text-sm text-muted-foreground">
        The audit trail survives, including a new entry recording this deletion and your reason for
        it. The database refuses outright if this person is under a legal hold, is named by a
        safeguarding concern, or is in a conversation under a legal hold.
      </p>
      <form action={action} className="space-y-3">
        <input type="hidden" name="person_id" value={personId} />
        <input type="hidden" name="person_name" value={personName} />
        <div className="space-y-1">
          <Label htmlFor="purge-reason">Why is this record being destroyed?</Label>
          <Textarea id="purge-reason" name="reason" required rows={2} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="purge-confirm">
            Type <span className="font-semibold">{personName}</span> to confirm
          </Label>
          <Input
            id="purge-confirm"
            name="confirm_name"
            autoComplete="off"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
        </div>
        <Button
          type="submit"
          size="sm"
          variant="destructive"
          disabled={!armed || pending}
          className="min-h-[44px] w-full lg:min-h-0 lg:w-auto"
        >
          {pending ? "Deleting…" : "Delete permanently"}
        </Button>
      </form>
      <Feedback state={state} />
    </div>
  );
}
