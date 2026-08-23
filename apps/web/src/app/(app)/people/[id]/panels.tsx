"use client";

/**
 * The editable parts of one person's record: roles, guardianships,
 * certifications, and the soft delete.
 *
 * Each panel writes through a server action that uses the caller's own client,
 * so what comes back is the database's answer. A P0001 refusal — the SG-4
 * guard explaining why a guardianship cannot exist, or the dob guard explaining
 * what a correction would break — is rendered exactly as it arrived.
 */

import Link from "next/link";
import { useActionState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Select, Textarea } from "@/components/ui/field";
import { PersonPicker } from "@/components/person-picker";
import { formatDate, formatStamp } from "@/lib/people-display";

import { softDeletePerson, restorePerson, type PersonActionState } from "../actions";
import {
  addGuardianship,
  addPersonCertification,
  endGuardianship,
  grantRole,
  revokePersonCertification,
  revokeRole,
  verifyPersonCertification,
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
};

export const RELATIONSHIP_LABELS: Record<string, string> = {
  parent: "Parent",
  step_parent: "Step-parent",
  grandparent: "Grandparent",
  foster_carer: "Foster carer",
  legal_guardian: "Legal guardian",
  other: "Other",
};

export const CERTIFICATION_LABELS: Record<string, string> = {
  fa_dbs: "FA DBS check",
  safeguarding_children: "Safeguarding children",
  first_aid: "First aid",
  coaching_badge: "Coaching badge",
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

export type PersonCertificationRow = {
  id: string;
  type: string;
  reference: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  verifiedAt: string | null;
  revokedAt: string | null;
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

  const held = roles.map((r) => r.role);

  return (
    <div className="space-y-4">
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
                <Button type="submit" size="sm" variant="outline" className="h-8 px-2 text-xs">
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
        <Button type="submit" size="sm" disabled={granting}>
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
                <Button type="submit" size="sm" variant="outline" className="h-8 px-2 text-xs">
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
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="guardianship-direction">This record is the…</Label>
            <Select id="guardianship-direction" name="direction" defaultValue="guardian_of">
              <option value="guardian_of">Guardian of the person chosen</option>
              <option value="child_of">Child of the person chosen</option>
            </Select>
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
        <Button type="submit" size="sm" disabled={adding}>
          {adding ? "Saving…" : "Add guardianship"}
        </Button>
        <Feedback state={addState} />
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function PersonCertificationsPanel({
  personId,
  certifications,
}: {
  personId: string;
  certifications: PersonCertificationRow[];
}) {
  const [addState, addAction, adding] = useActionState(addPersonCertification, EMPTY);
  const [verifyState, verifyAction] = useActionState(verifyPersonCertification, EMPTY);
  const [revokeState, revokeAction] = useActionState(revokePersonCertification, EMPTY);

  return (
    <div className="space-y-4">
      {certifications.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing recorded.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b text-xs text-muted-foreground">
              <tr>
                <th className="py-2 pr-3 font-medium">Type</th>
                <th className="py-2 pr-3 font-medium">Reference</th>
                <th className="py-2 pr-3 font-medium">Issued</th>
                <th className="py-2 pr-3 font-medium">Expires</th>
                <th className="py-2 pr-3 font-medium">State</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {certifications.map((cert) => (
                <tr key={cert.id} className="border-b align-top last:border-0">
                  <td className="py-2 pr-3">{CERTIFICATION_LABELS[cert.type] ?? cert.type}</td>
                  <td className="py-2 pr-3 break-all">{cert.reference ?? "—"}</td>
                  <td className="whitespace-nowrap py-2 pr-3">{formatDate(cert.issuedOn)}</td>
                  <td className="whitespace-nowrap py-2 pr-3">{formatDate(cert.expiresOn)}</td>
                  <td className="py-2 pr-3">
                    {cert.revokedAt ? (
                      <Badge variant="destructive">Revoked</Badge>
                    ) : cert.verifiedAt ? (
                      <Badge variant="success">Verified</Badge>
                    ) : (
                      <Badge variant="warning">Not verified</Badge>
                    )}
                  </td>
                  <td className="py-2">
                    {!cert.revokedAt && (
                      <div className="flex gap-1">
                        {!cert.verifiedAt && (
                          <form action={verifyAction}>
                            <input type="hidden" name="person_id" value={personId} />
                            <input type="hidden" name="certification_id" value={cert.id} />
                            <Button
                              type="submit"
                              size="sm"
                              variant="outline"
                              className="h-8 px-2 text-xs"
                            >
                              Verify
                            </Button>
                          </form>
                        )}
                        <form action={revokeAction}>
                          <input type="hidden" name="person_id" value={personId} />
                          <input type="hidden" name="certification_id" value={cert.id} />
                          <Button
                            type="submit"
                            size="sm"
                            variant="outline"
                            className="h-8 px-2 text-xs"
                          >
                            Revoke
                          </Button>
                        </form>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Feedback state={verifyState} />
      <Feedback state={revokeState} />

      <form action={addAction} className="space-y-3 rounded-lg border border-dashed p-4">
        <p className="text-sm font-medium">Record a certification</p>
        <input type="hidden" name="person_id" value={personId} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="cert-type">Type</Label>
            <Select id="cert-type" name="type" defaultValue="fa_dbs">
              {Object.keys(CERTIFICATION_LABELS).map((value) => (
                <option key={value} value={value}>
                  {CERTIFICATION_LABELS[value]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cert-reference">Reference</Label>
            <Input id="cert-reference" name="reference" placeholder="Certificate number" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cert-issued">Issued on</Label>
            <Input id="cert-issued" name="issued_on" type="date" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cert-expires">Expires on</Label>
            <Input id="cert-expires" name="expires_on" type="date" />
          </div>
        </div>
        <Button type="submit" size="sm" disabled={adding}>
          {adding ? "Saving…" : "Record certification"}
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
          <Button type="submit" size="sm" variant="outline" disabled={restoring}>
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
        <Button type="submit" size="sm" variant="destructive" disabled={deleting}>
          {deleting ? "Retiring…" : "Retire this person"}
        </Button>
      </form>
      <Feedback state={deleteState} />
    </div>
  );
}
