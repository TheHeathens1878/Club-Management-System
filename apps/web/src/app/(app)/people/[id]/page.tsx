import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, Clock } from "lucide-react";

import type { Json } from "@club/db";

import { Avatar } from "@/components/avatar";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { signPersonPhotoPath } from "@/lib/avatars";
import { signIdentityDocumentPaths } from "@/lib/identity-docs";
import { isClubAdmin, resolveNames, nameOf } from "@/lib/person";
import { idDocumentKindLabel } from "@/lib/registration-questions";
import {
  RegistrationDetailsBody,
  registrationDetailsCaption,
} from "@/components/registration-details";
import {
  loadLivePhotoConsents,
  loadRegistrationDetails,
} from "@/lib/registration-details-server";
import { resolveUserNames, verifierName } from "@/lib/registration-verifiers";
import {
  addressToFields,
  formatDate,
  formatStamp,
  isMinorDob,
  personLabel,
} from "@/lib/people-display";
import { createClient } from "@/lib/supabase/server";

import { IdVerifiedForm } from "../../registrations/decision-forms";
import { PersonForm } from "../person-form";
import { loadEmergencyContacts } from "@/lib/emergency-contacts-server";

import {
  EmergencyContactsPanel,
  GuardianshipsPanel,
  PersonCertificationsPanel,
  RetirePanel,
  RolesPanel,
  type GuardianshipRow,
  type PersonCertificationRow,
  type RoleRow,
} from "./panels";

/**
 * One person's record (gap 2).
 *
 * Everything is read through the caller's own client. Where a policy says no —
 * `registrations.form` is club_admin, safeguarding_lead, the subject or their
 * guardian, and nobody else — the read simply returns nothing and the section
 * is not rendered. That is the intended behaviour: the page shows what the
 * caller is entitled to see, and works out nothing for itself.
 */

const TEAM_ROLE_LABELS: Record<string, string> = {
  player: "Player",
  coach: "Coach",
  assistant_coach: "Assistant coach",
  manager: "Manager",
};

/** The queue payload `migrate_neon()` wrote, read defensively. */
function payloadField(payload: Json | null, key: string): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = (payload as Record<string, Json | undefined>)[key];
  return typeof value === "string" ? value : null;
}

/**
 * `/people` hands its own query string over in `from`, so Back returns to the
 * page, chip and filters the reader left rather than to an unfiltered page 1.
 * Only a relative query string is honoured — anything else falls back to the
 * bare list, so the parameter cannot be used to bounce somebody off-site.
 */
function backHref(from: string | undefined): string {
  if (!from) return "/people";
  const query = new URLSearchParams(from);
  const text = query.toString();
  return text ? `/people?${text}` : "/people";
}

export default async function PersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isCommittee(session.profile?.role)) redirect("/room-bookings");

  const { id } = await params;
  const { from } = await searchParams;
  const supabase = await createClient();

  const { data: person } = await supabase.from("people").select("*").eq("id", id).maybeSingle();
  if (!person) notFound();

  const [
    { data: roleRows },
    { data: guardianshipRows },
    { data: membershipRows },
    { data: certificationRows },
    { data: registration },
    { data: pendingRows },
    { data: profileRow },
  ] = await Promise.all([
    supabase
      .from("person_roles")
      .select("id,role,granted_at,notes")
      .eq("person_id", id)
      .is("revoked_at", null)
      .order("granted_at"),
    supabase
      .from("guardianships")
      .select("id,guardian_person_id,child_person_id,relationship,ended_at")
      .or(`guardian_person_id.eq.${id},child_person_id.eq.${id}`)
      .order("created_at"),
    supabase
      .from("team_memberships")
      .select("id,team_id,role,shirt_number,joined_at,left_at,teams(name),seasons(name,is_current)")
      .eq("person_id", id)
      .order("joined_at", { ascending: false }),
    supabase
      .from("certifications")
      .select("id,type,reference,issued_on,expires_on,verified_at,revoked_at")
      .eq("person_id", id)
      .order("expires_on", { nullsFirst: false }),
    supabase
      .from("registrations")
      .select("id,status,submitted_at,seasons(name)")
      .eq("person_id", id)
      .order("submitted_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("neon_import_pending")
      .select("id,kind,payload,created_at,attempts,last_error,applied_at")
      .eq("person_id", id)
      .is("applied_at", null)
      .order("created_at"),
    supabase.from("profiles").select("id,full_name,role").eq("person_id", id).maybeSingle(),
  ]);

  const roles: RoleRow[] = (roleRows ?? []).map((row) => ({
    id: row.id,
    role: row.role,
    grantedAt: row.granted_at,
    notes: row.notes,
  }));

  // Names for the other end of each guardianship, through the helper that asks
  // `display_name()` for anyone the bulk `people` read would not return.
  const otherIds = (guardianshipRows ?? []).map((row) =>
    row.guardian_person_id === id ? row.child_person_id : row.guardian_person_id,
  );
  const names = await resolveNames(otherIds);
  const guardianships: GuardianshipRow[] = (guardianshipRows ?? []).map((row) => {
    const personIsGuardian = row.guardian_person_id === id;
    const otherPersonId = personIsGuardian ? row.child_person_id : row.guardian_person_id;
    return {
      id: row.id,
      otherPersonId,
      otherName: nameOf(names, otherPersonId),
      relationship: row.relationship,
      personIsGuardian,
      endedAt: row.ended_at,
    };
  });

  const certifications: PersonCertificationRow[] = (certificationRows ?? []).map((row) => ({
    id: row.id,
    type: row.type,
    reference: row.reference,
    issuedOn: row.issued_on,
    expiresOn: row.expires_on,
    verifiedAt: row.verified_at,
    revokedAt: row.revoked_at,
  }));

  const pending = pendingRows ?? [];
  const name = personLabel(person);

  // What the latest registration said about this person — the read-only copy
  // on the contact record (20260825230000). It carries the `registrations`
  // read policies, so a reader who is not entitled to the form gets nothing
  // back and the card is not rendered. The SG-5 photo consents beside it are
  // `guardian_consents` rows, read the same way.
  const [snapshots, photoConsents, { data: questionRows }, verifierNames] = await Promise.all([
    loadRegistrationDetails([id]),
    isMinorDob(person.dob) ? loadLivePhotoConsents([id]) : Promise.resolve(new Map()),
    supabase.from("registration_questions").select("qkey,label").order("position"),
    resolveUserNames([person.id_verified_by]),
  ]);
  const snapshot = snapshots.get(id) ?? null;
  const questionLabels = new Map((questionRows ?? []).map((row) => [row.qkey, row.label] as const));

  // The registration photo, and any identity document the club holds. The
  // document ROWS come back to anyone the policy admits; the FILES are signed
  // only for a club administrator, which is the storage policy mirrored.
  const admin = await isClubAdmin();
  // Emergency contacts (Adam, 2026-08-25): on the person, read under
  // `emergency_contacts_admin_read` — club_admin and safeguarding_lead.
  const emergencyContacts = (await loadEmergencyContacts([id])).get(id) ?? [];
  const photoUrl = await signPersonPhotoPath(person.photo_path);
  const { data: documentRows } = await supabase
    .from("identity_documents")
    .select("id,kind,storage_path,created_at,purge_after,purged_at")
    .eq("person_id", id)
    .is("purged_at", null)
    .order("created_at", { ascending: false });
  const documents = documentRows ?? [];
  const documentUrls = admin
    ? await signIdentityDocumentPaths(documents.map((row) => row.storage_path))
    : new Map<string, string>();

  return (
    <>
      <PageHeader
        title={name}
        subtitle={person.email ?? "No email on file"}
        action={
          <Link
            href={backHref(from)}
            className={
              buttonVariants({ variant: "outline", size: "sm" }) + " min-h-[44px] lg:min-h-0"
            }
          >
            <ChevronLeft className="h-4 w-4" /> Back to people
          </Link>
        }
      />
      <div className="space-y-6 p-4 lg:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <Avatar name={name} photoUrl={photoUrl} size="lg" />
          {person.deleted_at && <Badge variant="destructive">Retired</Badge>}
          {isMinorDob(person.dob) && (
            <Badge variant="warning">{person.dob ? "Minor" : "No date of birth — treated as a minor"}</Badge>
          )}
          {person.legal_hold && <Badge variant="warning">Legal hold</Badge>}
          {profileRow ? (
            <Badge variant="default">Login linked · {profileRow.role}</Badge>
          ) : (
            <Badge variant="muted">No login linked</Badge>
          )}
        </div>

        {pending.length > 0 && (
          <Card className="border-amber-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-amber-900">
                <Clock className="h-4 w-4" /> Waiting to be applied
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Records imported from the pitch-booking app that SG-4 and SG-6 will not accept until
                this person&apos;s date of birth is known. Save a date of birth below and they are
                applied straight away.
              </p>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {pending.map((row) => (
                  <li key={row.id}>
                    <span className="font-medium capitalize">{row.kind}</span>
                    <span className="text-muted-foreground">
                      {payloadField(row.payload, "role") ? ` · ${payloadField(row.payload, "role")}` : ""}
                      {` · queued ${formatStamp(row.created_at)}`}
                      {row.attempts > 0
                        ? ` · ${row.attempts} attempt${row.attempts === 1 ? "" : "s"}`
                        : ""}
                    </span>
                    {row.last_error && (
                      <p className="text-xs text-amber-900">{row.last_error}</p>
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <PersonForm
              mode="edit"
              personId={person.id}
              pendingImports={pending.length}
              values={{
                first_name: person.first_name,
                last_name: person.last_name,
                preferred_name: person.preferred_name ?? "",
                dob: person.dob ?? "",
                email: person.email ?? "",
                phone: person.phone ?? "",
                address: addressToFields(person.address),
                notes: person.notes ?? "",
              }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Emergency contacts</CardTitle>
            <p className="text-sm text-muted-foreground">
              Up to two, kept on the person&apos;s record rather than on a registration form.
              Only a club administrator can change them here; the person and their guardians
              change them from their own screens.
            </p>
          </CardHeader>
          <CardContent>
            <EmergencyContactsPanel
              personId={person.id}
              personName={name}
              contacts={emergencyContacts}
              canEdit={admin}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Roles</CardTitle>
            <p className="text-sm text-muted-foreground">
              The real role model — <code>person_roles</code>, not the login&apos;s
              <code> profiles.role</code>. Only a club administrator may grant or revoke, and every
              change is written to the audit log by a trigger.
            </p>
          </CardHeader>
          <CardContent>
            <RolesPanel personId={person.id} roles={roles} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Guardianships</CardTitle>
            <p className="text-sm text-muted-foreground">
              SG-4. A guardian must be an adult with a known date of birth and a child must be a
              minor, so the database refuses the rest and says why. Links end; they are not deleted,
              and turning 18 is not an ending — the reading policies lapse on their own.
            </p>
          </CardHeader>
          <CardContent>
            <GuardianshipsPanel personId={person.id} personName={name} links={guardianships} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Teams</CardTitle>
            <p className="text-sm text-muted-foreground">
              Every membership this person has held, in every season.
            </p>
          </CardHeader>
          <CardContent>
            {(membershipRows ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No team memberships recorded.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b text-xs text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Team</th>
                      <th className="py-2 pr-3 font-medium">Season</th>
                      <th className="py-2 pr-3 font-medium">Role</th>
                      <th className="py-2 pr-3 font-medium">Shirt</th>
                      <th className="py-2 pr-3 font-medium">Joined</th>
                      <th className="py-2 font-medium">Left</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(membershipRows ?? []).map((row) => (
                      <tr key={row.id} className="border-b last:border-0">
                        <td className="py-2 pr-3">
                          <Link
                            href={`/teams/${row.team_id}`}
                            className="font-medium underline underline-offset-2"
                          >
                            {row.teams?.name ?? "Team"}
                          </Link>
                        </td>
                        <td className="py-2 pr-3">
                          {row.seasons?.name ?? "—"}
                          {row.seasons?.is_current && (
                            <Badge variant="success" className="ml-2">
                              Current
                            </Badge>
                          )}
                        </td>
                        <td className="py-2 pr-3">{TEAM_ROLE_LABELS[row.role] ?? row.role}</td>
                        <td className="py-2 pr-3">{row.shirt_number ?? "—"}</td>
                        <td className="whitespace-nowrap py-2 pr-3">{formatStamp(row.joined_at)}</td>
                        <td className="whitespace-nowrap py-2">
                          {row.left_at ? formatStamp(row.left_at) : <Badge variant="success">Live</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Proof of identity</CardTitle>
            <p className="text-sm text-muted-foreground">
              A passport or birth certificate is asked for at registration unless a club
              administrator has recorded that the club has already seen one. Documents are held for
              three years and then destroyed automatically; the record that one was held survives.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {documents.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing on file.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {documents.map((document) => {
                  const url = document.storage_path
                    ? documentUrls.get(document.storage_path)
                    : undefined;
                  return (
                    <li key={document.id} className="flex flex-wrap items-center gap-2">
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-primary hover:underline"
                        >
                          {idDocumentKindLabel(document.kind)}
                        </a>
                      ) : (
                        <span className="font-medium">{idDocumentKindLabel(document.kind)}</span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        uploaded {formatStamp(document.created_at)} · destroyed {document.purge_after}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {admin ? (
              <IdVerifiedForm
                personId={person.id}
                verified={person.id_verified}
                verifiedAt={person.id_verified_at}
                verifiedByName={
                  person.id_verified ? verifierName(verifierNames, person.id_verified_by) : null
                }
              />
            ) : (
              person.id_verified && (
                <p className="text-sm text-emerald-700">
                  ID seen and verified by {verifierName(verifierNames, person.id_verified_by)}
                  {person.id_verified_at
                    ? ` · ${formatStamp(person.id_verified_at)}`
                    : ""}
                </p>
              )
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Certifications</CardTitle>
            <p className="text-sm text-muted-foreground">
              DBS checks, safeguarding and coaching qualifications. A certification counts towards
              SG-6 only once it has been verified, and it is revoked, never deleted.
            </p>
          </CardHeader>
          <CardContent>
            <PersonCertificationsPanel personId={person.id} certifications={certifications} />
          </CardContent>
        </Card>

        {snapshot && (
          <Card>
            <CardHeader>
              <CardTitle>From the latest registration</CardTitle>
              <p className="text-sm text-muted-foreground">
                {registrationDetailsCaption(snapshot.seasonName, snapshot.updatedAt)}
                {registration?.status ? ` · ${registration.status}` : ""}. Read-only here: each new
                registration overwrites these answers, and they are changed by registering again.
              </p>
            </CardHeader>
            <CardContent>
              <RegistrationDetailsBody
                details={snapshot.details}
                photoConsents={
                  isMinorDob(person.dob) ? (photoConsents.get(id) ?? new Set<string>()) : undefined
                }
                questionLabels={questionLabels}
              />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Record</CardTitle>
            <p className="text-sm text-muted-foreground">
              Created {formatStamp(person.created_at)} · last changed {formatStamp(person.updated_at)}
              {person.dob ? ` · date of birth recorded (${formatDate(person.dob)})` : ""}
            </p>
          </CardHeader>
          <CardContent>
            <RetirePanel
              personId={person.id}
              personName={name}
              deletedAt={person.deleted_at}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
