import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { isClubAdmin, isSafeguardingLead, nameOf, resolveNames } from "@/lib/person";
import { personLabel } from "@/lib/people-display";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { formatBookingDateShort, instantToLocal } from "@/lib/booking-time";
import { ChevronLeft } from "lucide-react";
import {
  CertificationsPanel,
  type CertificationRow,
  type ExemptionRow,
  type StaffMember,
} from "./certifications-panel";
import { FullTimePanel, type ClubSeasonView, type FullTimeLinkView } from "./fulltime-panel";
import { ManualImportPanel, type ImportRunView } from "./import-panel";
import {
  MembersPanel,
  type MemberRow,
  type PendingRow,
  type TeamRoleValue,
} from "./members-panel";

/** Next 20 fixtures, read-only — the importer (P2.4) is what writes them. */
const UPCOMING_LIMIT = 20;
/** Enough import history to see a pattern without becoming a log viewer. */
const RUN_LIMIT = 10;

function statusVariant(status: string): "success" | "muted" | "destructive" | "warning" | "default" {
  if (status === "played") return "success";
  if (status === "cancelled" || status === "abandoned") return "destructive";
  if (status === "postponed") return "warning";
  return "default";
}

/** The payload `migrate_neon()` queues for a held-back membership. */
function pendingMembershipPayload(payload: unknown): { teamId: string | null; role: string | null; displayName: string | null } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { teamId: null, role: null, displayName: null };
  }
  const record = payload as Record<string, unknown>;
  const read = (key: string): string | null =>
    typeof record[key] === "string" ? (record[key] as string) : null;
  return { teamId: read("team_id"), role: read("role"), displayName: read("display_name") };
}

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const { id } = await params;

  // --------------------------------------------------------------------
  // Who may be here. Committee sign-ins run the teams (and hold club_admin
  // through the profiles → person_roles sync). A team's own child-facing
  // staff may read their roster and nothing else: `is_team_staff()` is the
  // same predicate `team_memberships_staff_read` uses, asked through the
  // caller's own client so the database gives the answer.
  // --------------------------------------------------------------------
  const userClient = await createClient();
  const committee = isCommittee(session.profile?.role);
  const { data: teamStaff } = await userClient.rpc("is_team_staff", { p_team_id: id });
  if (!committee && teamStaff !== true) redirect("/room-bookings");

  const admin = createAdminClient();

  const nowIso = new Date().toISOString();
  const [teamResult, linkResult, seasonsResult, fixturesResult, runsResult] = await Promise.all([
    admin.from("teams").select("*").eq("id", id).maybeSingle(),
    admin.from("team_fulltime_links").select("*").eq("team_id", id).maybeSingle(),
    admin.from("seasons").select("id,name,is_current").order("starts_on", { ascending: false }),
    admin
      .from("fixtures")
      // One string literal, not a concatenation: supabase-js infers the row
      // type from the select text, and only a literal carries that type.
      .select(
        "id,kickoff_at,is_home,opponent,competition,status,source,venue_text,allocation_conflict,venue_resource_id,seasons(name),resources!fixtures_venue_resource_id_fkey(name)",
      )
      .eq("team_id", id)
      .gte("kickoff_at", nowIso)
      .order("kickoff_at")
      .limit(UPCOMING_LIMIT),
    admin
      .from("fixture_import_runs")
      .select("id,trigger,status,inserted,updated,unchanged,error,source_url,created_at")
      .eq("team_id", id)
      .order("created_at", { ascending: false })
      .limit(RUN_LIMIT),
  ]);

  const team = teamResult.data;
  if (!team) notFound();

  const linkRow = linkResult.data;
  const link: FullTimeLinkView | null = linkRow
    ? {
        source_url: linkRow.source_url,
        league_id: linkRow.league_id,
        ft_season_id: linkRow.ft_season_id,
        division_id: linkRow.division_id,
        fixture_group_key: linkRow.fixture_group_key,
        ft_team_id: linkRow.ft_team_id,
        ft_team_name: linkRow.ft_team_name,
        enabled: linkRow.enabled,
        last_import_at: linkRow.last_import_at,
        last_import_status: linkRow.last_import_status,
        last_import_count: linkRow.last_import_count,
        last_error: linkRow.last_error,
      }
    : null;

  const clubSeasons: ClubSeasonView[] = (seasonsResult.data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    is_current: s.is_current,
  }));

  const fixtures = fixturesResult.data ?? [];
  const currentSeason = clubSeasons.find((s) => s.is_current) ?? null;
  // --------------------------------------------------------------------
  // SG-6: the team's child-facing staff and their paperwork.
  //
  // The roster comes from the admin client, as the rest of this page does.
  // The safeguarding rows do NOT: `certifications`, `certification_exemptions`
  // and `person_compliance_status()` are read through the signed-in user's own
  // client so that RLS and the lead-only policies are what decide, not the
  // service key.
  // --------------------------------------------------------------------
  const lead = await isSafeguardingLead();

  const { data: staffRows } = await admin
    .from("team_memberships")
    .select("person_id,role,people(first_name,last_name,preferred_name)")
    .eq("team_id", id)
    .is("left_at", null)
    .neq("role", "player");

  const staffIds = (staffRows ?? []).map((m) => m.person_id);
  const [{ data: certRows }, { data: exemptionRows }, complianceRows] = await Promise.all([
    userClient
      .from("certifications")
      .select("id,person_id,type,reference,issued_on,expires_on,verified_at,revoked_at")
      .in("person_id", staffIds)
      .order("expires_on", { nullsFirst: false }),
    userClient
      .from("certification_exemptions")
      .select("id,person_id,reason,expires_on,revoked_at")
      .eq("team_id", id),
    Promise.all(
      staffIds.map(async (personId) => {
        const [dbs, safeguarding] = await Promise.all([
          userClient.rpc("person_compliance_status", { p_person_id: personId, p_type: "fa_dbs" }),
          userClient.rpc("person_compliance_status", {
            p_person_id: personId,
            p_type: "safeguarding_children",
          }),
        ]);
        return { personId, dbs: dbs.data ?? "missing", safeguarding: safeguarding.data ?? "missing" };
      }),
    ),
  ]);

  const complianceByPerson = new Map(complianceRows.map((row) => [row.personId, row]));
  const staff: StaffMember[] = (staffRows ?? []).map((member) => {
    const person = member.people;
    const compliance = complianceByPerson.get(member.person_id);
    return {
      personId: member.person_id,
      name: person
        ? `${person.preferred_name || person.first_name} ${person.last_name}`.trim()
        : "Club member",
      role: member.role,
      dbs: compliance?.dbs ?? "missing",
      safeguarding: compliance?.safeguarding ?? "missing",
    };
  });
  const certifications: CertificationRow[] = certRows ?? [];
  const exemptions: ExemptionRow[] = exemptionRows ?? [];

  const runs: ImportRunView[] = (runsResult.data ?? []).map((run) => ({
    id: run.id,
    trigger: run.trigger,
    status: run.status,
    inserted: run.inserted,
    updated: run.updated,
    unchanged: run.unchanged,
    error: run.error,
    source_url: run.source_url,
    created_at: run.created_at,
  }));

  // --------------------------------------------------------------------
  // The season's roster — players included, not just staff.
  //
  // Read through the caller's own client, so `team_memberships` RLS is what
  // decides: `_admin_read` for a club_admin or the safeguarding lead,
  // `_staff_read` for this team's own child-facing staff. Editing is offered
  // only to a club_admin, which is who `_admin_insert` / `_admin_update`
  // accept — and if the app ever got that wrong, the policy would still
  // refuse and the refusal is what the panel shows.
  //
  // NO DATE OF BIRTH IS READ HERE. `is_minor()` is SECURITY DEFINER and
  // returns a boolean, which is all a roster needs; the date itself lives on
  // the person's record behind /people.
  // --------------------------------------------------------------------
  const clubAdmin = await isClubAdmin();

  const { data: childFacingRows } = await userClient
    .from("child_facing_roles")
    .select("role,child_facing");
  const childFacingByRole = new Map((childFacingRows ?? []).map((r) => [r.role, r.child_facing]));
  // Fail closed, exactly as `is_child_facing_role()` does with its coalesce.
  const isChildFacing = (role: TeamRoleValue): boolean => childFacingByRole.get(role) ?? true;

  let members: MemberRow[] = [];
  if (currentSeason) {
    const { data: membershipRows } = await userClient
      .from("team_memberships")
      .select("id,person_id,role,shirt_number,joined_at")
      .eq("team_id", id)
      .eq("season_id", currentSeason.id)
      .is("left_at", null)
      .order("role")
      .order("joined_at");

    // `resolveNames` reads `people` first and falls back to `display_name()`,
    // the SECURITY DEFINER helper that names a member to their team's staff.
    // A coach reading this roster holds no `people` grant, so without the
    // fallback every row would read "Club member".
    const memberNames = await resolveNames((membershipRows ?? []).map((row) => row.person_id));

    members = await Promise.all(
      (membershipRows ?? []).map(async (row) => {
        const childFacing = isChildFacing(row.role);
        const [minor, dbs, safeguarding] = await Promise.all([
          userClient.rpc("is_minor", { person_id: row.person_id }),
          childFacing
            ? userClient.rpc("person_compliance_status", {
                p_person_id: row.person_id,
                p_type: "fa_dbs",
              })
            : Promise.resolve({ data: null }),
          childFacing
            ? userClient.rpc("person_compliance_status", {
                p_person_id: row.person_id,
                p_type: "safeguarding_children",
              })
            : Promise.resolve({ data: null }),
        ]);
        return {
          id: row.id,
          personId: row.person_id,
          name: nameOf(memberNames, row.person_id),
          role: row.role,
          shirtNumber: row.shirt_number,
          joinedAt: row.joined_at,
          isMinor: minor.data === true,
          childFacing,
          dbs: dbs.data ?? (childFacing ? "missing" : null),
          safeguarding: safeguarding.data ?? (childFacing ? "missing" : null),
        } satisfies MemberRow;
      }),
    );
  }

  // Imported memberships the SG-0 gate is holding back. `neon_import_pending`
  // RLS is club_admin (or the subject), so a non-admin simply gets no rows —
  // which is the right answer, not a failure to handle. The team lives inside
  // the payload `migrate_neon()` wrote, so the filter is applied here.
  const { data: pendingRows } = await userClient
    .from("neon_import_pending")
    .select("id,person_id,payload,created_at,attempts,last_error,people(first_name,last_name,preferred_name)")
    .eq("kind", "membership")
    .is("applied_at", null)
    .order("created_at");

  const pending: PendingRow[] = (pendingRows ?? [])
    .map((row) => ({ row, parsed: pendingMembershipPayload(row.payload) }))
    .filter((entry) => entry.parsed.teamId === id)
    .map(({ row, parsed }) => ({
      id: row.id,
      personId: row.person_id,
      personName: row.people ? personLabel(row.people) : "Club member",
      role: parsed.role,
      displayName: parsed.displayName,
      createdAt: row.created_at,
      attempts: row.attempts,
      lastError: row.last_error,
    }));

  return (
    <>
      <PageHeader
        title={team.name}
        subtitle={team.age_group ?? "No age group"}
        action={
          <Link href="/teams" className={buttonVariants({ variant: "outline", size: "sm" })}>
            <ChevronLeft className="h-4 w-4" /> Back to teams
          </Link>
        }
      />
      <div className="max-w-4xl space-y-6 p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={team.active ? "success" : "muted"}>{team.active ? "Active" : "Inactive"}</Badge>
          {link && (
            <Badge variant={link.enabled ? "default" : "muted"}>
              {link.enabled ? "Full-Time import enabled" : "Full-Time import paused"}
            </Badge>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
            <p className="text-sm text-muted-foreground">
              Everyone in this team for the current season, players included. Adding someone, changing
              their role or ending their membership goes straight to <code>team_memberships</code> as
              you — so the SG-6 guard runs, and if it refuses it tells you exactly which certification
              is missing. Memberships end; they are never deleted.
            </p>
          </CardHeader>
          <CardContent>
            <MembersPanel
              teamId={team.id}
              seasonId={currentSeason?.id ?? null}
              seasonName={currentSeason?.name ?? null}
              members={members}
              pending={pending}
              canEdit={clubAdmin}
            />
          </CardContent>
        </Card>

        {/* Running the team — the Full-Time link, the manual importer and the
            SG-6 paperwork — is committee work. A coach reading their own roster
            above sees none of it. */}
        {committee && (
          <>
        <Card>
          <CardHeader>
            <CardTitle>FA Full-Time link</CardTitle>
            <p className="text-sm text-muted-foreground">
              The FA publishes no fixtures API, so fixtures are read from public Full-Time pages. Paste the
              team&apos;s Full-Time address, preview what the parser reads, then save. Re-linking for a new
              season or a new league updates this link and keeps the fixtures already imported.
            </p>
          </CardHeader>
          <CardContent>
            <FullTimePanel teamId={team.id} teamName={team.name} link={link} clubSeasons={clubSeasons} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Manual import</CardTitle>
            <p className="text-sm text-muted-foreground">
              The fallback that keeps working when the nightly importer does not: paste a Full-Time
              address, or paste the fixtures as CSV. Either way you see them before anything is
              written, and the import reconciles by fixture reference — reschedules become updates,
              never duplicates.
            </p>
          </CardHeader>
          <CardContent>
            <ManualImportPanel
              teamId={team.id}
              teamName={team.name}
              ftTeamName={link?.ft_team_name ?? team.name}
              currentSeason={currentSeason ? { id: currentSeason.id, name: currentSeason.name } : null}
              runs={runs}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Certifications</CardTitle>
            <p className="text-sm text-muted-foreground">
              DBS checks, safeguarding and coaching qualifications for everyone in a child-facing
              role on this team (SG-6). A certification counts once it has been verified; expiry
              nudges go out at 90, 30 and 7 days. Only the club&apos;s safeguarding lead can grant a
              short exemption while paperwork clears.
            </p>
          </CardHeader>
          <CardContent>
            <CertificationsPanel
              teamId={team.id}
              staff={staff}
              certifications={certifications}
              exemptions={exemptions}
              isLead={lead}
            />
          </CardContent>
        </Card>
          </>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Upcoming fixtures</CardTitle>
            <p className="text-sm text-muted-foreground">
              The next {UPCOMING_LIMIT} kick-offs for this team, in Europe/London. Read-only here — fixtures
              arrive from the importer or the manual entry screen. Home fixtures are given a pitch on{" "}
              <Link href="/pitches" className="underline underline-offset-2">
                Pitches
              </Link>
              .
            </p>
          </CardHeader>
          <CardContent>
            {fixturesResult.error && (
              <p className="text-sm text-destructive">Could not load this team&apos;s fixtures.</p>
            )}
            {!fixturesResult.error && fixtures.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No upcoming fixtures for this team.
              </p>
            )}
            {fixtures.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b text-xs text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Date</th>
                      <th className="py-2 pr-3 font-medium">Time</th>
                      <th className="py-2 pr-3 font-medium">H/A</th>
                      <th className="py-2 pr-3 font-medium">Opponent</th>
                      <th className="py-2 pr-3 font-medium">Competition</th>
                      <th className="py-2 pr-3 font-medium">Season</th>
                      <th className="py-2 pr-3 font-medium">Pitch</th>
                      <th className="py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fixtures.map((fixture) => {
                      const local = instantToLocal(fixture.kickoff_at);
                      return (
                        <tr key={fixture.id} className="border-b last:border-0">
                          <td className="whitespace-nowrap py-2 pr-3">
                            {formatBookingDateShort(local.date)}
                          </td>
                          <td className="whitespace-nowrap py-2 pr-3">{local.time}</td>
                          <td className="py-2 pr-3">{fixture.is_home ? "Home" : "Away"}</td>
                          <td className="py-2 pr-3">
                            {fixture.opponent}
                            {fixture.venue_text && (
                              <span className="block text-xs text-muted-foreground">{fixture.venue_text}</span>
                            )}
                          </td>
                          <td className="py-2 pr-3">{fixture.competition ?? "—"}</td>
                          <td className="py-2 pr-3">{fixture.seasons?.name ?? "—"}</td>
                          <td className="py-2 pr-3">
                            {fixture.resources?.name ?? (fixture.is_home ? "Not allocated" : "—")}
                          </td>
                          <td className="py-2">
                            <div className="flex flex-wrap items-center gap-1">
                              <Badge variant={statusVariant(fixture.status)} className="capitalize">
                                {fixture.status}
                              </Badge>
                              {fixture.allocation_conflict && (
                                <Badge variant="warning">Pitch clash</Badge>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
