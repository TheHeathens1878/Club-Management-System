import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardCheck, FileText, Settings2 } from "lucide-react";

import type { Database } from "@club/db";

import { Avatar } from "@/components/avatar";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionProfile } from "@/lib/auth";
import { signPeoplePhotos } from "@/lib/avatars";
import { signIdentityDocumentPaths } from "@/lib/identity-docs";
import { isClubAdmin, nameOf, resolveNames } from "@/lib/person";
import { formatStamp } from "@/lib/people-display";
import {
  REGISTRATION_STATUS_LABELS,
  hasMedicalDetail,
  parseRegistrationForm,
  registrationStatusVariant,
  type RegistrationStatusValue,
} from "@/lib/registration-form";
import { idDocumentKindLabel } from "@/lib/registration-questions";
import { createClient } from "@/lib/supabase/server";

import { DecisionPanel, IdVerifiedForm, type TeamChoice } from "./decision-forms";

/**
 * The registrations queue (gap 9) — a club administrator's screen.
 *
 * Read through the caller's own client. `registrations_admin_read` returns
 * rows to `club_admin` and `safeguarding_lead` and to nobody else, so what is
 * rendered here is what RLS handed over — the medical block included. That is
 * the point: this page does not decide who may see a medical note, the policy
 * does, and a coach reaching this URL gets an empty list rather than a
 * redacted one.
 *
 * The decision itself is one UPDATE; the database creates the team membership
 * and runs SG-6 inside the same statement. See ./actions.ts.
 */

export const dynamic = "force-dynamic";

const DECIDED_LIMIT = 25;

type RegistrationRow = Database["public"]["Tables"]["registrations"]["Row"];

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap">{children}</dd>
    </div>
  );
}

export default async function RegistrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const admin = await isClubAdmin();
  const params = await searchParams;
  const showDecided = params.show === "decided";

  const supabase = await createClient();

  let query = supabase.from("registrations").select("*");
  query = showDecided
    ? query.neq("status", "pending").order("decided_at", { ascending: false }).limit(DECIDED_LIMIT)
    : query.eq("status", "pending").order("submitted_at", { ascending: true });

  const [{ data: rows, error }, { data: teamRows }, { data: seasonRows }] = await Promise.all([
    query,
    supabase
      .from("teams")
      .select("id,name,age_group,sort_order")
      .eq("active", true)
      .order("sort_order")
      .order("name"),
    supabase.from("seasons").select("id,name"),
  ]);

  const registrations: RegistrationRow[] = rows ?? [];
  const teams: TeamChoice[] = (teamRows ?? []).map((team) => ({
    id: team.id,
    name: team.name,
    ageGroup: team.age_group,
  }));
  const teamNames = new Map((teamRows ?? []).map((team) => [team.id, team.name] as const));
  const seasonNames = new Map((seasonRows ?? []).map((season) => [season.id, season.name] as const));

  // Who is the guardian? Read through the caller's own client, which means a
  // committee reader gets the link and anyone else gets nothing.
  const personIds = registrations.map((registration) => registration.person_id);
  let guardiansByChild = new Map<string, string[]>();
  if (personIds.length > 0) {
    const { data: guardianships } = await supabase
      .from("guardianships")
      .select("child_person_id, guardian_person_id")
      .in("child_person_id", personIds)
      .is("ended_at", null);
    guardiansByChild = new Map();
    for (const link of guardianships ?? []) {
      const list = guardiansByChild.get(link.child_person_id);
      if (list) list.push(link.guardian_person_id);
      else guardiansByChild.set(link.child_person_id, [link.guardian_person_id]);
    }
  }

  const names = await resolveNames([
    ...personIds,
    ...Array.from(guardiansByChild.values()).flat(),
  ]);

  // The player photo, the ID tick and any documents on file. All three read
  // through the caller's own client, so a reader who is not entitled to a
  // person's record simply gets nothing back and the row renders initials and
  // no ID section — the page decides nothing for itself.
  const subjects = personIds.length > 0 ? personIds : ["00000000-0000-0000-0000-000000000000"];
  const [{ data: peopleRows }, { data: documentRows }, { data: questionRows }] = await Promise.all([
    supabase.from("people").select("id,photo_path,id_verified,id_verified_at").in("id", subjects),
    supabase
      .from("identity_documents")
      .select("id,person_id,kind,storage_path,created_at,purge_after,purged_at")
      .in("person_id", subjects)
      .order("created_at", { ascending: false }),
    supabase.from("registration_questions").select("qkey,label").order("position"),
  ]);

  const peopleById = new Map((peopleRows ?? []).map((row) => [row.id, row] as const));
  const photoUrls = await signPeoplePhotos(peopleRows ?? []);

  type IdentityDocumentRow = NonNullable<typeof documentRows>[number];
  const documentsByPerson = new Map<string, IdentityDocumentRow[]>();
  for (const document of documentRows ?? []) {
    const list = documentsByPerson.get(document.person_id);
    if (list) list.push(document);
    else documentsByPerson.set(document.person_id, [document]);
  }
  // Only a club administrator may open the file itself; everyone else sees the
  // row and no link. That is the storage policy, mirrored.
  const documentUrls = admin
    ? await signIdentityDocumentPaths((documentRows ?? []).map((row) => row.storage_path))
    : new Map<string, string>();

  const questionLabels = new Map((questionRows ?? []).map((row) => [row.qkey, row.label] as const));

  return (
    <>
      <PageHeader
        title="Registrations"
        subtitle={
          showDecided
            ? "The last decisions taken"
            : "Players waiting to be approved for a team this season"
        }
        action={
          <div className="flex w-full flex-col gap-2 lg:w-auto lg:flex-row">
            {admin && (
              <Link
                href="/registrations/form"
                className={
                  buttonVariants({ variant: "outline", size: "sm" }) +
                  " min-h-[44px] w-full lg:min-h-0 lg:w-auto"
                }
              >
                <Settings2 className="h-4 w-4" /> Edit the form
              </Link>
            )}
            <Link
              href={showDecided ? "/registrations" : "/registrations?show=decided"}
              className={
                buttonVariants({ variant: "outline", size: "sm" }) +
                " min-h-[44px] w-full lg:min-h-0 lg:w-auto"
              }
            >
              {showDecided ? "Back to pending" : "Recent decisions"}
            </Link>
          </div>
        }
      />

      <div className="space-y-6 p-4 lg:p-6">
        {!admin && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Only a club administrator can approve or reject a registration. You can read what the
            database lets you read below.
          </p>
        )}

        {error && (
          <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error.message}
          </p>
        )}

        <Card>
          <CardHeader className="p-4 lg:p-6">
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardCheck className="h-4 w-4" />
              {showDecided ? "Recent decisions" : "Pending"}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Approving a registration with a team adds the player to that team for the season, so
              the club&apos;s team composition rules are checked at that moment. If they refuse, the
              registration stays pending and the reason is shown here.
            </p>
          </CardHeader>
          <CardContent className="space-y-4 p-4 pt-0 lg:p-6 lg:pt-0">
            {registrations.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {showDecided ? "Nothing has been decided yet." : "Nothing is waiting."}
              </p>
            )}

            {registrations.map((registration) => {
              const form = parseRegistrationForm(registration.form);
              const status = registration.status as RegistrationStatusValue;
              const guardians = guardiansByChild.get(registration.person_id) ?? [];
              const person = peopleById.get(registration.person_id);
              const playerName = nameOf(names, registration.person_id);
              const documents = documentsByPerson.get(registration.person_id) ?? [];
              const liveDocuments = documents.filter((document) => !document.purged_at);
              const customAnswers = Object.entries(form.custom ?? {});

              return (
                <details key={registration.id} className="rounded-lg border bg-card" open={!showDecided}>
                  <summary className="flex min-h-[44px] cursor-pointer select-none flex-wrap items-center gap-2 px-4 py-3 text-sm hover:bg-secondary/40">
                    <Avatar
                      name={playerName}
                      photoUrl={photoUrls.get(registration.person_id)}
                      size="sm"
                    />
                    <span className="font-medium">{playerName}</span>
                    <Badge variant="outline">
                      {registration.team_id
                        ? (teamNames.get(registration.team_id) ?? "Team")
                        : "No team requested"}
                    </Badge>
                    <Badge variant="muted">
                      {seasonNames.get(registration.season_id) ?? "Season"}
                    </Badge>
                    <Badge variant={registrationStatusVariant(status)}>
                      {REGISTRATION_STATUS_LABELS[status]}
                    </Badge>
                    <span className="w-full text-xs text-muted-foreground lg:ml-auto lg:w-auto">
                      {formatStamp(registration.submitted_at)}
                    </span>
                  </summary>

                  <div className="space-y-4 border-t px-4 py-4">
                    <dl className="grid gap-3 text-sm sm:grid-cols-2">
                      <Detail label="Guardian">
                        {guardians.length === 0
                          ? "None recorded"
                          : guardians.map((id) => nameOf(names, id)).join(", ")}
                      </Detail>
                      <Detail label="Form version">{registration.form_version}</Detail>
                      <Detail label="Emergency contact">
                        {form.emergency_contact.name || "—"}
                        {form.emergency_contact.relationship
                          ? ` (${form.emergency_contact.relationship})`
                          : ""}
                      </Detail>
                      <Detail label="Emergency phone">
                        {form.emergency_contact.phone ? (
                          <a
                            href={`tel:${form.emergency_contact.phone}`}
                            className="text-primary hover:underline"
                          >
                            {form.emergency_contact.phone}
                          </a>
                        ) : (
                          "—"
                        )}
                      </Detail>
                      {form.previous_club && (
                        <Detail label="Previous club">{form.previous_club}</Detail>
                      )}
                      {form.preferred_position && (
                        <Detail label="Preferred position">{form.preferred_position}</Detail>
                      )}
                      {form.kit_size && <Detail label="Kit size">{form.kit_size}</Detail>}
                      {form.terms_accepted_at && (
                        <Detail label="Terms accepted">
                          {formatStamp(form.terms_accepted_at)}
                          {form.terms_version ? ` · ${form.terms_version}` : ""}
                        </Detail>
                      )}
                      <div className="sm:col-span-2">
                        <Detail label="Medical">
                          {hasMedicalDetail(form) ? (
                            <span className="space-y-1">
                              {form.medical.conditions && (
                                <span className="block">Conditions: {form.medical.conditions}</span>
                              )}
                              {form.medical.medication && (
                                <span className="block">Medication: {form.medical.medication}</span>
                              )}
                              {form.medical.allergies && (
                                <span className="block">Allergies: {form.medical.allergies}</span>
                              )}
                            </span>
                          ) : (
                            "Nothing declared"
                          )}
                        </Detail>
                      </div>
                      {registration.decision_note && (
                        <div className="sm:col-span-2">
                          <Detail label="Decision note">{registration.decision_note}</Detail>
                        </div>
                      )}
                      {customAnswers.length > 0 && (
                        <div className="sm:col-span-2">
                          <dt className="text-xs uppercase text-muted-foreground">
                            The club&apos;s own questions
                          </dt>
                          <dd className="mt-1 grid gap-2 sm:grid-cols-2">
                            {customAnswers.map(([qkey, value]) => (
                              <span key={qkey} className="block">
                                <span className="text-xs text-muted-foreground">
                                  {questionLabels.get(qkey) ?? qkey.replace(/_/g, " ")}:{" "}
                                </span>
                                {value === "yes" ? "Yes" : value}
                              </span>
                            ))}
                          </dd>
                        </div>
                      )}
                      {form.gdpr_accepted_at && (
                        <Detail label="Data protection">
                          Accepted {formatStamp(form.gdpr_accepted_at)}
                          {form.gdpr_notice_version ? ` · ${form.gdpr_notice_version}` : ""}
                        </Detail>
                      )}
                      {registration.decided_at && (
                        <Detail label="Decided">{formatStamp(registration.decided_at)}</Detail>
                      )}
                    </dl>

                    {/* Proof of identity. The rows are readable by the family
                        too; the FILE is a club_admin link and nothing else. */}
                    <div className="space-y-2 border-t pt-4">
                      <p className="text-xs uppercase text-muted-foreground">Proof of identity</p>
                      {liveDocuments.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          {person?.id_verified
                            ? "No document on file — the club has recorded that it has seen ID for this player."
                            : "Nothing on file."}
                        </p>
                      ) : (
                        <ul className="space-y-1 text-sm">
                          {liveDocuments.map((document) => {
                            const url = document.storage_path
                              ? documentUrls.get(document.storage_path)
                              : undefined;
                            return (
                              <li key={document.id} className="flex flex-wrap items-center gap-2">
                                <FileText className="h-4 w-4 text-muted-foreground" />
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
                                  <span className="font-medium">
                                    {idDocumentKindLabel(document.kind)}
                                  </span>
                                )}
                                <span className="text-xs text-muted-foreground">
                                  uploaded {formatStamp(document.created_at)} · destroyed{" "}
                                  {document.purge_after}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      {admin && person && (
                        <IdVerifiedForm
                          personId={registration.person_id}
                          verified={person.id_verified}
                          verifiedAt={person.id_verified_at}
                        />
                      )}
                    </div>

                    {admin && status === "pending" && (
                      <div className="border-t pt-4">
                        <DecisionPanel
                          registrationId={registration.id}
                          requestedTeamId={registration.team_id}
                          teams={teams}
                        />
                      </div>
                    )}
                  </div>
                </details>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
