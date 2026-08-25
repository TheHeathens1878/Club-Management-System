import { redirect } from "next/navigation";
import { Baby, Contact, ShieldCheck, Users } from "lucide-react";

import type { Database, Json } from "@club/db";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionProfile } from "@/lib/auth";
import { getCurrentPersonId } from "@/lib/person";
import { formatStamp, personLabel } from "@/lib/people-display";
import {
  REGISTRATION_STATUS_LABELS,
  registrationStatusVariant,
  type RegistrationStatusValue,
} from "@/lib/registration-form";
import { createClient } from "@/lib/supabase/server";
import { ageGroupFromDob } from "@/lib/waiting-list";

import {
  AddChildForm,
  AppAccessForm,
  ChildDetailsForm,
  RegisterForm,
  WithdrawForm,
  type ChildDetails,
  type TeamOption,
} from "./family-forms";

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
  if (!dob) return "Age group unknown";
  const parsed = new Date(`${dob}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "Age group unknown";
  return ageGroupFromDob(parsed);
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
            {canWithdraw && (status === "pending" || status === "approved") && (
              <div className="mt-2">
                <WithdrawForm registrationId={registration.id} />
              </div>
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

  const [childrenResult, teamsResult, seasonsResult] = await Promise.all([
    supabase.rpc("my_children"),
    supabase.from("teams").select("id,name,age_group,sort_order").eq("active", true).order("sort_order").order("name"),
    supabase.from("seasons").select("id,name,is_current").order("starts_on", { ascending: false }),
  ]);

  const children = childrenResult.data ?? [];
  const teams: TeamOption[] = (teamsResult.data ?? []).map((team) => ({
    id: team.id,
    name: team.name,
    ageGroup: team.age_group,
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
      ? supabase.from("people").select("id,preferred_name,email,phone,address").in("id", childIds)
      : Promise.resolve({
          data: [] as {
            id: string;
            preferred_name: string | null;
            email: string | null;
            phone: string | null;
            address: Json | null;
          }[],
          error: null,
        }),
    personId
      ? supabase.from("people").select("address").eq("id", personId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const leadAddress = leadResult.data?.address ?? null;
  const leadAddressLine = addressLine(leadAddress);
  const detailsByChild = new Map(
    (childContactResult.data ?? []).map((row) => {
      const line1 = addressField(row.address, "line1");
      const town = addressField(row.address, "town");
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
        postcode,
        // Ticked when the child's address IS the lead contact's, and for a
        // child with no address of their own — the common case, and the one
        // the tick-box exists to make one click long.
        sameAsLead: !!leadAddressLine && (!hasOwn || addressLine(row.address) === leadAddressLine),
      };
      return [row.id, details] as const;
    }),
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
            const name = personLabel({
              first_name: child.first_name,
              last_name: child.last_name,
              preferred_name: child.preferred_name,
            });

            return (
              <Card key={child.person_id}>
                <CardHeader className="p-4 lg:p-6">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
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
                          postcode: "",
                          sameAsLead: !!leadAddressLine,
                        }
                      }
                      leadAddressLine={leadAddressLine}
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
                    />
                  </div>

                  <div className="space-y-3 border-t pt-4">
                    <p className="text-xs uppercase text-muted-foreground">Registrations</p>
                    <RegistrationList
                      registrations={childRegistrations}
                      teamNames={teamNames}
                      seasonNames={seasonNames}
                      canWithdraw
                    />
                    <RegisterForm
                      personId={child.person_id}
                      personName={name}
                      seasonId={currentSeason?.id ?? null}
                      seasonName={currentSeason?.name ?? null}
                      teams={teams}
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
