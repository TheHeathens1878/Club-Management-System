import { redirect } from "next/navigation";
import { Baby, Contact, FileText, ShieldCheck, Users } from "lucide-react";

import type { Database, Json } from "@club/db";

import { Avatar } from "@/components/avatar";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { signPeoplePhotos } from "@/lib/avatars";
import { getCurrentPersonId } from "@/lib/person";
import { formatStamp, personLabel } from "@/lib/people-display";
import {
  REGISTRATION_STATUS_LABELS,
  registrationStatusVariant,
  type RegistrationStatusValue,
} from "@/lib/registration-form";
import { createClient } from "@/lib/supabase/server";
import { ageGroupFromDobString } from "@/lib/waiting-list";

import type { LeadContact } from "@/components/emergency-contacts-fields";
import { loadEmergencyContacts } from "@/lib/emergency-contacts-server";
import { questionFromRow, type RegistrationQuestion } from "@/lib/registration-questions";
import {
  RegistrationDetailsBody,
  registrationDetailsCaption,
} from "@/components/registration-details";
import {
  loadLivePhotoConsents,
  loadRegistrationDetails,
} from "@/lib/registration-details-server";

import {
  AddChildForm,
  AppAccessForm,
  ChildDetailsForm,
  EmergencyContactsForm,
  RegisterForm,
  WithdrawForm,
  type ChildDetails,
  type TeamOption,
} from "./family-forms";

export const metadata = { title: "Children" };

/**
 * Children (gap 9) — the first screen a parent has ever had on this platform.
 *
 * Everything is read through the caller's own client, and every list is
 * therefore the database's answer rather than this page's:
 *
 *   · `my_children()` returns the caller's live guardianships with the child's
 *     name and current teams. It is SECURITY DEFINER because a guardian may
 *     not join `team_memberships` themselves — the function does the joins the
 *     caller is not allowed to make, and only for their own children.
 *   · `registrations` comes back under `registrations_guardian_read` and
 *     `registrations_self_read`. Nothing is filtered here to achieve that.
 *
 * The list shows an age group hint, not the date of birth: a parent already
 * knows their child's birthday, and a screen that prints children's dates of
 * birth is a screen that leaks them over someone's shoulder.
 *
 * Editing is CONTACT ONLY (Adam, 2026-08-25), through
 * `update_child_details()`. `people` still has a guardian READ policy and no
 * guardian WRITE policy (P1.2 / SG-4) — the RPC is the whole authority — and
 * the name and the date of birth are not fields on the form because they are
 * not arguments to the function. The card says so rather than offering a
 * button the database would refuse.
 */

export const dynamic = "force-dynamic";

type RegistrationRow = Pick<
  Database["public"]["Tables"]["registrations"]["Row"],
  "id" | "person_id" | "season_id" | "team_id" | "status" | "decision_note" | "submitted_at" | "decided_at"
>;

type ChildTeam = { team_id: string; team_name: string; role: string };

/** `my_children().teams` is jsonb built by the function; read it defensively. */
function parseTeams(value: Json | null | undefined): ChildTeam[] {
  if (!Array.isArray(value)) return [];
  const out: ChildTeam[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, Json | undefined>;
    const id = record["team_id"];
    const name = record["team_name"];
    const role = record["role"];
    if (typeof id !== "string" || typeof name !== "string") continue;
    out.push({ team_id: id, team_name: name, role: typeof role === "string" ? role : "player" });
  }
  return out;
}

function addressField(address: Json | null | undefined, key: string): string {
  if (!address || typeof address !== "object" || Array.isArray(address)) return "";
  const value = (address as Record<string, Json | undefined>)[key];
  return typeof value === "string" ? value : "";
}

/** "1 Lead Street, Sale, M33 1AA" — the tick-box's label, so it is not a guess. */
function addressLine(address: Json | null | undefined): string | null {
  const parts = ["line1", "line2", "town", "postcode"]
    .map((key) => addressField(address, key))
    .filter((part) => part !== "");
  return parts.length > 0 ? parts.join(", ") : null;
}

function ageGroupHint(dob: string | null): string {
  // The DATE STRING, never a Date: `new Date("2014-09-01")` is midnight UTC,
  // which is the previous evening west of Greenwich, and the FA cohort
  // cut-off is 31 August.
  return ageGroupFromDobString(dob) ?? "Age group unknown";
}

function RegistrationList({
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
          <li key={registration.id} className="rounded-md border bg-card px-3 py-2 text-sm">
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

export default async function FamilyPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const supabase = await createClient();
  const personId = await getCurrentPersonId();

  const [childrenResult, teamsResult, seasonsResult, questionsResult] = await Promise.all([
    supabase.rpc("my_children"),
    supabase.from("teams").select("id,name,age_group,gender,sort_order").eq("active", true).order("sort_order").order("name"),
    supabase.from("seasons").select("id,name,is_current").order("starts_on", { ascending: false }),
    // The registration form as the club currently asks it — the same rows
    // /join renders, so "Register for a team" here IS the registration form.
    supabase
      .from("registration_questions")
      .select("id,qkey,label,help_text,qtype,options,required,system,locked,position,archived_at")
      .is("archived_at", null)
      .order("position"),
  ]);
  const questions: RegistrationQuestion[] = (questionsResult.data ?? [])
    .map((row) => questionFromRow(row))
    .filter((question): question is RegistrationQuestion => question !== null);

  const children = childrenResult.data ?? [];
  const teams: TeamOption[] = (teamsResult.data ?? []).map((team) => ({
    id: team.id,
    name: team.name,
    ageGroup: team.age_group,
    gender: team.gender,
  }));
  const seasons = seasonsResult.data ?? [];
  const currentSeason = seasons.find((season) => season.is_current) ?? null;

  const teamNames = new Map(teams.map((team) => [team.id, team.name] as const));
  const seasonNames = new Map(seasons.map((season) => [season.id, season.name] as const));

  // One read for every registration the caller may see — their children's
  // through `registrations_guardian_read`, their own through
  // `registrations_self_read`.
  const subjectIds = [...children.map((child) => child.person_id), ...(personId ? [personId] : [])];
  let registrations: RegistrationRow[] = [];
  let registrationsError: string | null = null;
  if (subjectIds.length > 0) {
    const { data, error } = await supabase
      .from("registrations")
      .select("id,person_id,season_id,team_id,status,decision_note,submitted_at,decided_at")
      .in("person_id", subjectIds)
      .order("submitted_at", { ascending: false });
    registrations = data ?? [];
    registrationsError = error?.message ?? null;
  }

  const byPerson = new Map<string, RegistrationRow[]>();
  for (const registration of registrations) {
    const list = byPerson.get(registration.person_id);
    if (list) list.push(registration);
    else byPerson.set(registration.person_id, [registration]);
  }

  const myRegistrations = personId ? (byPerson.get(personId) ?? []) : [];

  // ------------------------------------------------------------------
  // SG-10 — the app-account consent, one live row per child at most.
  //
  // `guardian_consents_guardian_read` is what narrows this to the caller's own
  // children; the `.in(...)` is only so the query is one round trip for the
  // children already on screen. The age threshold is read from
  // `site_settings` rather than hard-coded, because it is admin-editable and
  // the database validates it (P1.7 §6).
  // ------------------------------------------------------------------
  const childIds = children.map((child) => child.person_id);

  // The photo the club holds for each child — `people_guardian_read` is what
  // lets a parent see the row at all, so an unentitled reader gets initials.
  const { data: childPhotoRows } =
    childIds.length > 0
      ? await supabase.from("people").select("id,photo_path").in("id", childIds)
      : { data: [] as { id: string; photo_path: string | null }[] };
  const childPhotoUrls = await signPeoplePhotos(childPhotoRows ?? []);

  const [consentsResult, minAgeResult] = await Promise.all([
    childIds.length > 0
      ? supabase
          .from("guardian_consents")
          .select("id,child_person_id,granted_at")
          .in("child_person_id", childIds)
          .eq("consent_type", "app_account")
          .is("revoked_at", null)
      : Promise.resolve({
          data: [] as { id: string; child_person_id: string; granted_at: string }[],
          error: null,
        }),
    supabase
      .from("site_settings")
      .select("value")
      .eq("key", "safeguarding.min_account_age")
      .maybeSingle(),
  ]);

  // ------------------------------------------------------------------
  // The contact half of each child's record, for the edit form, plus the
  // caller's OWN address — the thing "Same address as lead contact" copies.
  // Both reads are the caller's: the children under `people_guardian_read`,
  // the caller under `people_self_read`. Nothing here is filtered by hand.
  // ------------------------------------------------------------------
  const [childContactResult, leadResult] = await Promise.all([
    childIds.length > 0
      ? supabase.from("people").select("id,preferred_name,email,phone,address,dob").in("id", childIds)
      : Promise.resolve({
          data: [] as {
            id: string;
            preferred_name: string | null;
            email: string | null;
            phone: string | null;
            address: Json | null;
            dob: string | null;
          }[],
          error: null,
        }),
    personId
      ? supabase
          .from("people")
          .select("first_name,last_name,phone,address")
          .eq("id", personId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const leadAddress = leadResult.data?.address ?? null;
  // The caller as "I am the first emergency contact" — name and number from
  // their own record, which is what the server copies when the box is ticked.
  const lead: LeadContact | null = leadResult.data
    ? {
        name: `${leadResult.data.first_name} ${leadResult.data.last_name}`.trim(),
        phone: leadResult.data.phone,
      }
    : null;

  // Emergency contacts (Adam, 2026-08-25: on the person, not the form), read
  // under `emergency_contacts_self_read`; and whether each child still owes
  // the club an ID, asked of `needs_id_document()` the way /join asks it.
  const contactsByChild = await loadEmergencyContacts(childIds);
  const needsIdByChild = new Map(
    await Promise.all(
      childIds.map(async (id) => {
        const { data } = await supabase.rpc("needs_id_document", { p_person_id: id });
        return [id, data === true] as const;
      }),
    ),
  );
  // The sex the club already holds for each child, so the registration form
  // defaults to it rather than asking again; and whether the caller is a club
  // administrator, which is the only role offered "show all teams"
  // (Adam, 2026-08-26).
  const { data: subjectFacts } = await supabase.rpc("registration_subjects", {
    p_person_ids: childIds,
  });
  const sexByChild = new Map((subjectFacts ?? []).map((row) => [row.person_id, row.sex] as const));
  const isAdmin = isCommittee(session.profile?.role);

  const leadAddressLine = addressLine(leadAddress);
  // Just the dates of birth, so the App access block can name the day it
  // starts. The family TREE deliberately carries no dob (it shows an age group
  // instead); this is the guardian's own read of their own child's row.
  const dobByChild = new Map(
    (childContactResult.data ?? []).map((row) => [row.id, row.dob as string | null] as const),
  );
  const detailsByChild = new Map(
    (childContactResult.data ?? []).map((row) => {
      const line1 = addressField(row.address, "line1");
      const town = addressField(row.address, "town");
      const county = addressField(row.address, "county");
      const postcode = addressField(row.address, "postcode");
      const line2 = addressField(row.address, "line2");
      const hasOwn = !!(line1 || line2 || town || postcode);
      const details: ChildDetails = {
        preferredName: row.preferred_name ?? "",
        email: row.email ?? "",
        phone: row.phone ?? "",
        line1,
        line2,
        town,
        county,
        postcode,
        // Ticked when the child's address IS the lead contact's, and for a
        // child with no address of their own — the common case, and the one
        // the tick-box exists to make one click long.
        sameAsLead: !!leadAddressLine && (!hasOwn || addressLine(row.address) === leadAddressLine),
      };
      return [row.id, details] as const;
    }),
  );

  // What the club holds from the last registration, per child, and the live
  // SG-5 photo permissions beside it (Adam, 2026-08-25: "the registration form
  // should update read-only information in the contact record"). Both are the
  // caller's own reads — `person_registration_details` carries the
  // `registrations` read policies, so a parent sees their own children's and
  // nothing else, and nothing here is filtered by hand.
  const [detailsByPerson, photoConsentsByChild] = await Promise.all([
    loadRegistrationDetails(subjectIds),
    loadLivePhotoConsents(childIds),
  ]);
  const questionLabels = new Map(
    questions.map((question) => [question.qkey, question.label] as const),
  );

  const consentByChild = new Map(
    (consentsResult.data ?? []).map(
      (row) => [row.child_person_id, { id: row.id, grantedAt: row.granted_at }] as const,
    ),
  );
  const minAccountAge = Number(minAgeResult.data?.value ?? "13") || 13;

  return (
    <>
      <PageHeader
        title="Children"
        subtitle="The children the club has you down as a guardian for, and their registrations"
      />

      <div className="space-y-6 p-4 lg:p-6">
        {childrenResult.error && (
          <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {childrenResult.error.message}
          </p>
        )}
        {registrationsError && (
          <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {registrationsError}
          </p>
        )}
        {childContactResult.error && (
          <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {childContactResult.error.message}
          </p>
        )}
        {consentsResult.error && (
          <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {consentsResult.error.message}
          </p>
        )}

        <Card>
          <CardHeader className="p-4 lg:p-6">
            <CardTitle className="flex items-center gap-2 text-base">
              <Baby className="h-4 w-4" /> Add a child
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Adding a child here creates their record and records you as their guardian in one
              step. Once they are here you can register them for a team.
            </p>
          </CardHeader>
          <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
            <AddChildForm />
          </CardContent>
        </Card>

        {children.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              The club has no children recorded against your account yet. Add one above, or ask the
              club if you think a child should already be linked to you.
            </CardContent>
          </Card>
        ) : (
          children.map((child) => {
            const childTeams = parseTeams(child.teams);
            const childRegistrations = byPerson.get(child.person_id) ?? [];
            const snapshot = detailsByPerson.get(child.person_id) ?? null;
            const name = personLabel({
              first_name: child.first_name,
              last_name: child.last_name,
              preferred_name: child.preferred_name,
            });

            return (
              <Card key={child.person_id}>
                <CardHeader className="p-4 lg:p-6">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    <Avatar name={name} photoUrl={childPhotoUrls.get(child.person_id)} size="sm" />
                    {name}
                    <Badge variant="outline">{ageGroupHint(child.dob)}</Badge>
                    {child.is_minor && <Badge variant="warning">Under 18</Badge>}
                    <span className="text-xs font-normal text-muted-foreground">
                      {child.relationship}
                    </span>
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Names and dates of birth are corrected by the club, not here — ask a club
                    administrator and they will change it on the record.
                  </p>
                </CardHeader>
                <CardContent className="space-y-4 p-4 pt-0 lg:p-6 lg:pt-0">
                  <div>
                    <p className="mb-1 flex items-center gap-2 text-xs uppercase text-muted-foreground">
                      <Users className="h-3.5 w-3.5" /> Teams
                    </p>
                    {childTeams.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Not in a team yet.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {childTeams.map((team) => (
                          <Badge key={team.team_id} variant="default">
                            {team.team_name} · {team.role.replace(/_/g, " ")}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-3 border-t pt-4">
                    <p className="mb-1 flex items-center gap-2 text-xs uppercase text-muted-foreground">
                      <Contact className="h-3.5 w-3.5" /> Contact details
                    </p>
                    <ChildDetailsForm
                      childPersonId={child.person_id}
                      childName={name}
                      initial={
                        detailsByChild.get(child.person_id) ?? {
                          preferredName: child.preferred_name ?? "",
                          email: "",
                          phone: "",
                          line1: "",
                          line2: "",
                          town: "",
                          county: "",
                          postcode: "",
                          sameAsLead: !!leadAddressLine,
                        }
                      }
                      leadAddressLine={leadAddressLine}
                    />
                    <EmergencyContactsForm
                      childPersonId={child.person_id}
                      childName={child.preferred_name || child.first_name}
                      initial={contactsByChild.get(child.person_id) ?? []}
                      lead={lead}
                    />
                  </div>

                  <div className="space-y-3 border-t pt-4">
                    <p className="mb-1 flex items-center gap-2 text-xs uppercase text-muted-foreground">
                      <ShieldCheck className="h-3.5 w-3.5" /> App access
                    </p>
                    <AppAccessForm
                      childPersonId={child.person_id}
                      childName={name}
                      consent={consentByChild.get(child.person_id) ?? null}
                      minAccountAge={minAccountAge}
                      dob={dobByChild.get(child.person_id) ?? null}
                    />
                  </div>

                  {snapshot && (
                    <details className="space-y-3 border-t pt-4">
                      <summary className="flex min-h-[44px] cursor-pointer select-none items-center gap-2 text-xs uppercase text-muted-foreground">
                        <FileText className="h-3.5 w-3.5" /> From the latest registration
                      </summary>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {registrationDetailsCaption(snapshot.seasonName, snapshot.updatedAt)}.
                        Read-only: registering {child.preferred_name || child.first_name} again
                        replaces these answers.
                      </p>
                      <div className="mt-3">
                        <RegistrationDetailsBody
                          details={snapshot.details}
                          photoConsents={photoConsentsByChild.get(child.person_id) ?? new Set()}
                          questionLabels={questionLabels}
                        />
                      </div>
                    </details>
                  )}

                  <div className="space-y-3 border-t pt-4">
                    <p className="text-xs uppercase text-muted-foreground">Registrations</p>
                    <RegistrationList
                      registrations={childRegistrations}
                      teamNames={teamNames}
                      seasonNames={seasonNames}
                      canWithdraw
                    />
                    {/* The same form the Register a player screen offers for
                        every member of the household (Adam, 2026-08-25); it
                        stays here too, beside the child it is about. */}
                    <RegisterForm
                      personId={child.person_id}
                      personName={name}
                      firstName={child.preferred_name || child.first_name}
                      minor={child.is_minor}
                      needsId={needsIdByChild.get(child.person_id) ?? true}
                      contactsOnRecord={(contactsByChild.get(child.person_id) ?? []).length}
                      seasonId={currentSeason?.id ?? null}
                      seasonName={currentSeason?.name ?? null}
                      teams={teams}
                      questions={questions}
                      dob={child.dob}
                      recordedSex={sexByChild.get(child.person_id) ?? null}
                      isAdmin={isAdmin}
                    />
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}

        {myRegistrations.length > 0 && (
          <Card>
            <CardHeader className="p-4 lg:p-6">
              <CardTitle className="text-base">Your own registrations</CardTitle>
              <p className="text-sm text-muted-foreground">
                Registrations in your own name, as a player.
              </p>
            </CardHeader>
            <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
              <RegistrationList
                registrations={myRegistrations}
                teamNames={teamNames}
                seasonNames={seasonNames}
                canWithdraw
              />
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
