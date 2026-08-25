import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { getSessionProfile, isCommittee } from "@/lib/auth";
import { isClubAdmin, isSafeguardingLead, nameOf, resolveNames } from "@/lib/person";
import { personLabel } from "@/lib/people-display";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { loadPitches, loadTeamPitchBookings } from "@/lib/pitch-booking-data";
import { bookingHeadcounts, fixtureHeadcounts, teamPlayerIds } from "@/lib/event-headcounts";
import type { Headcount } from "@/lib/headcount";
import type { PitchBookingItem } from "@/lib/pitch-booking";

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
import { MatchDayPanel, type MatchDayPitch } from "./matchday-panel";
import { AllocateAllPanel } from "./allocate-all-panel";
import { TeamPitchBookings } from "./pitch-bookings-card";
import { RecruitingPanel } from "./recruiting-panel";
import { FixturesSummary, FixturesTable, type TeamFixture } from "./fixtures-list";
import { PitchBookingsSummary } from "./bookings-summary";
import { TeamTabs, type TeamTab, type TeamTabKey } from "./team-tabs";
import { loadThread } from "../../messages/[id]/thread-data";
import { ThreadPanel } from "../../messages/[id]/thread-panel";

/** Next 20 fixtures, read-only — the importer (P2.4) is what writes them. */
const UPCOMING_LIMIT = 20;
/** Next pitch bookings shown on the Bookings tab (gap 3). */
const PITCH_BOOKING_LIMIT = 10;
/** Enough import history to see a pattern without becoming a log viewer. */
const RUN_LIMIT = 10;
/** Overview is a glance, not a list: three of each. */
const OVERVIEW_LIMIT = 3;

/**
 * One string literal, not a concatenation: supabase-js infers the row type
 * from the select text, and only a literal carries that type.
 */
const FIXTURE_SELECT =
  "id,booking_id,kickoff_at,is_home,opponent,competition,status,venue_text,allocation_conflict,seasons(name),resources!fixtures_venue_resource_id_fkey(name)";

/** The payload `migrate_neon()` queues for a held-back membership. */
function pendingMembershipPayload(payload: unknown): {
  teamId: string | null;
  role: string | null;
  displayName: string | null;
} {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { teamId: null, role: null, displayName: null };
  }
  const record = payload as Record<string, unknown>;
  const read = (key: string): string | null =>
    typeof record[key] === "string" ? (record[key] as string) : null;
  return { teamId: read("team_id"), role: read("role"), displayName: read("display_name") };
}

export default async function TeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const { id } = await params;
  const { tab: requestedTab } = await searchParams;

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
  const canManageTeam = committee || teamStaff === true;

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  // --------------------------------------------------------------------
  // What every tab needs: the team itself, the pitch list behind the home
  // pitch badge, and — for the committee only — the Full-Time link that the
  // header condenses into a badge. A coach never triggers the Full-Time read.
  // --------------------------------------------------------------------
  const [teamResult, matchDayPitches, linkRow, otherUpcomingCount] = await Promise.all([
    admin.from("teams").select("*").eq("id", id).maybeSingle(),
    loadPitches(),
    committee
      ? admin
          .from("team_fulltime_links")
          .select("*")
          .eq("team_id", id)
          .maybeSingle()
          .then((result) => result.data)
      : Promise.resolve(null),
    // Only asked when the Fixtures tab is not already the committee's by
    // right: it decides whether a coach is offered the tab at all.
    committee
      ? Promise.resolve(0)
      : userClient
          .from("fixtures")
          .select("id", { count: "exact", head: true })
          .eq("team_id", id)
          .gte("kickoff_at", nowIso)
          .then((result) => result.count ?? 0),
  ]);

  const team = teamResult.data;
  if (!team) notFound();

  const homePitch: MatchDayPitch | null =
    matchDayPitches.find((pitch) => pitch.id === team.home_resource_id) ?? null;

  const link: FullTimeLinkView | null = linkRow
    ? {
        source_url: linkRow.source_url,
        widget_code: linkRow.widget_code,
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

  // A tab the caller cannot use is not rendered. Chat opens first — the team
  // room is where a team lives day to day (Adam, 2026-08-24) — and the
  // committee's feed machinery (Match day, Full-Time, imports) sits in an
  // admin-only Settings tab rather than among the everyday tabs.
  const tabs: TeamTab[] = [
    { key: "chat", label: "Chat" },
    { key: "overview", label: "Overview" },
    { key: "members", label: "Members" },
    ...(committee || otherUpcomingCount > 0
      ? [{ key: "fixtures", label: "Fixtures" } as TeamTab]
      : []),
    { key: "bookings", label: "Bookings" },
    { key: "notices", label: "Notice board" },
    ...(committee ? [{ key: "settings", label: "Settings" } as TeamTab] : []),
  ];
  const tab: TeamTabKey = tabs.some((t) => t.key === requestedTab)
    ? (requestedTab as TeamTabKey)
    : "chat";

  // --------------------------------------------------------------------
  // Chat / Notice board — the team's own conversation rooms (P5.3), found
  // AS THE CALLER: the participant policies decide whether there is a room
  // to show, so a committee member who is not in the room is told so rather
  // than silently reading it (SG-9 — oversight lives in /safeguarding).
  // --------------------------------------------------------------------
  let threadData: Awaited<ReturnType<typeof loadThread>> = null;
  if (tab === "chat" || tab === "notices") {
    const wanted = tab === "chat" ? "team" : "announcement";
    const { data: room } = await userClient
      .from("conversations")
      .select("id")
      .eq("team_id", id)
      .eq("type", wanted)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (room) threadData = await loadThread(room.id);
  }

  // --------------------------------------------------------------------
  // Overview — the glance: recruiting, the next three fixtures and the next
  // three pitch slots. (Match day moved to the Settings tab.)
  // --------------------------------------------------------------------
  let overviewFixtures: TeamFixture[] = [];
  let overviewBookings: PitchBookingItem[] = [];
  let bookingCounts: Record<string, Headcount> = {};
  if (tab === "overview") {
    const [fixturesResult, bookings, playerIds] = await Promise.all([
      userClient
        .from("fixtures")
        .select(FIXTURE_SELECT)
        .eq("team_id", id)
        .gte("kickoff_at", nowIso)
        .order("kickoff_at")
        .limit(OVERVIEW_LIMIT),
      loadTeamPitchBookings(id, OVERVIEW_LIMIT),
      teamPlayerIds(userClient, id),
    ]);
    // "How many children will be there?" — squad availability per event. This
    // page only admits staff and committee, whose RLS returns every answer.
    const [fixtureCounts, bookingCountMap] = await Promise.all([
      fixtureHeadcounts(
        userClient,
        (fixturesResult.data ?? []).map((row) => row.id),
        playerIds,
      ),
      bookingHeadcounts(
        userClient,
        bookings.map((booking) => booking.id),
        playerIds,
      ),
    ]);
    bookingCounts = Object.fromEntries(bookingCountMap);
    overviewFixtures = (fixturesResult.data ?? []).map((row) => ({
      id: row.id,
      bookingId: row.booking_id,
      kickoffAt: row.kickoff_at,
      isHome: row.is_home,
      opponent: row.opponent,
      competition: row.competition,
      status: row.status,
      venueText: row.venue_text,
      allocationConflict: row.allocation_conflict,
      seasonName: row.seasons?.name ?? null,
      pitchName: row.resources?.name ?? null,
      headcount: fixtureCounts.get(row.id) ?? null,
    }));
    overviewBookings = bookings;
  }

  // --------------------------------------------------------------------
  // Members — the season's roster, the held-back imports, and (committee
  // only) the SG-6 paperwork for everyone in a child-facing role.
  //
  // The roster is read through the caller's own client, so `team_memberships`
  // RLS decides: `_admin_read` for a club_admin or the safeguarding lead,
  // `_staff_read` for this team's own child-facing staff. Editing is offered
  // only to a club_admin, which is who `_admin_insert` / `_admin_update`
  // accept — and if the app ever got that wrong, the policy would still
  // refuse and the refusal is what the panel shows.
  //
  // NO DATE OF BIRTH IS READ HERE. `is_minor()` is SECURITY DEFINER and
  // returns a boolean, which is all a roster needs; the date itself lives on
  // the person's record behind /people.
  // --------------------------------------------------------------------
  let members: MemberRow[] = [];
  let pending: PendingRow[] = [];
  let clubAdmin = false;
  let memberSeason: { id: string; name: string } | null = null;
  let staff: StaffMember[] = [];
  let certifications: CertificationRow[] = [];
  let exemptions: ExemptionRow[] = [];
  let lead = false;

  if (tab === "members") {
    const [
      seasonsResult,
      childFacingResult,
      pendingResult,
      adminAnswer,
      leadAnswer,
    ] = await Promise.all([
      userClient.from("seasons").select("id,name,is_current").order("starts_on", {
        ascending: false,
      }),
      userClient.from("child_facing_roles").select("role,child_facing"),
      // Imported memberships the SG-0 gate is holding back.
      // `neon_import_pending` RLS is club_admin (or the subject), so a
      // non-admin simply gets no rows — which is the right answer, not a
      // failure to handle. The team lives inside the payload
      // `migrate_neon()` wrote, so the filter is applied here.
      userClient
        .from("neon_import_pending")
        .select(
          "id,person_id,payload,created_at,attempts,last_error,people(first_name,last_name,preferred_name)",
        )
        .eq("kind", "membership")
        .is("applied_at", null)
        .order("created_at"),
      isClubAdmin(),
      committee ? isSafeguardingLead() : Promise.resolve(false),
    ]);

    clubAdmin = adminAnswer;
    lead = leadAnswer;

    const currentSeason = (seasonsResult.data ?? []).find((season) => season.is_current) ?? null;
    memberSeason = currentSeason ? { id: currentSeason.id, name: currentSeason.name } : null;

    const childFacingByRole = new Map(
      (childFacingResult.data ?? []).map((row) => [row.role, row.child_facing]),
    );
    // Fail closed, exactly as `is_child_facing_role()` does with its coalesce.
    const isChildFacing = (role: TeamRoleValue): boolean => childFacingByRole.get(role) ?? true;

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

    pending = (pendingResult.data ?? [])
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

    // ------------------------------------------------------------------
    // SG-6: the team's child-facing staff and their paperwork.
    //
    // The roster comes from the admin client, as the rest of this page does.
    // The safeguarding rows do NOT: `certifications`,
    // `certification_exemptions` and `person_compliance_status()` are read
    // through the signed-in user's own client so that RLS and the lead-only
    // policies are what decide, not the service key.
    // ------------------------------------------------------------------
    if (committee) {
      const { data: staffRows } = await admin
        .from("team_memberships")
        .select("person_id,role,people(first_name,last_name,preferred_name)")
        .eq("team_id", id)
        .is("left_at", null)
        .neq("role", "player");

      const staffIds = (staffRows ?? []).map((member) => member.person_id);
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
              userClient.rpc("person_compliance_status", {
                p_person_id: personId,
                p_type: "fa_dbs",
              }),
              userClient.rpc("person_compliance_status", {
                p_person_id: personId,
                p_type: "safeguarding_children",
              }),
            ]);
            return {
              personId,
              dbs: dbs.data ?? "missing",
              safeguarding: safeguarding.data ?? "missing",
            };
          }),
        ),
      ]);

      const complianceByPerson = new Map(complianceRows.map((row) => [row.personId, row]));
      staff = (staffRows ?? []).map((member) => {
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
      certifications = certRows ?? [];
      exemptions = exemptionRows ?? [];
    }
  }

  // --------------------------------------------------------------------
  // Fixtures — the list everyone the page admits may read, plus the
  // committee's Full-Time link and manual importer.
  // --------------------------------------------------------------------
  let fixtures: TeamFixture[] = [];
  let fixturesFailed = false;
  let clubSeasons: ClubSeasonView[] = [];
  let currentSeason: ClubSeasonView | null = null;
  let defaultFtName = "";
  let runs: ImportRunView[] = [];

  if (tab === "fixtures") {
    const fixturesResult = await userClient
      .from("fixtures")
      .select(FIXTURE_SELECT)
      .eq("team_id", id)
      .gte("kickoff_at", nowIso)
      .order("kickoff_at")
      .limit(UPCOMING_LIMIT);

    fixturesFailed = !!fixturesResult.error;
    const playerIds = await teamPlayerIds(userClient, id);
    const fixtureCounts = await fixtureHeadcounts(
      userClient,
      (fixturesResult.data ?? []).map((row) => row.id),
      playerIds,
    );
    fixtures = (fixturesResult.data ?? []).map((row) => ({
      id: row.id,
      bookingId: row.booking_id,
      kickoffAt: row.kickoff_at,
      isHome: row.is_home,
      opponent: row.opponent,
      competition: row.competition,
      status: row.status,
      venueText: row.venue_text,
      allocationConflict: row.allocation_conflict,
      seasonName: row.seasons?.name ?? null,
      pitchName: row.resources?.name ?? null,
      headcount: fixtureCounts.get(row.id) ?? null,
    }));
  }

  // --------------------------------------------------------------------
  // Settings — the committee's feed machinery: match day, the Full-Time
  // link and the importer with its run history. Admin-only by tab guard,
  // and every write still meets the same RLS as anywhere else.
  // --------------------------------------------------------------------
  if (tab === "settings" && committee) {
    const [seasonsResult, runRows, clubNameResult] = await Promise.all([
      userClient
        .from("seasons")
        .select("id,name,is_current")
        .order("starts_on", { ascending: false }),
      admin
        .from("fixture_import_runs")
        .select("id,trigger,status,inserted,updated,unchanged,error,source_url,created_at")
        .eq("team_id", id)
        .order("created_at", { ascending: false })
        .limit(RUN_LIMIT)
        .then((result) => result.data ?? []),
      admin.from("site_settings").select("value").eq("key", "fulltime_club_name").maybeSingle(),
    ]);

    defaultFtName = `${(clubNameResult.data?.value ?? "").trim() || "Ashton On Mersey FC"} ${team.name}`;
    clubSeasons = (seasonsResult.data ?? []).map((season) => ({
      id: season.id,
      name: season.name,
      is_current: season.is_current,
    }));
    currentSeason = clubSeasons.find((season) => season.is_current) ?? null;
    runs = runRows.map((run) => ({
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
  }

  // --------------------------------------------------------------------
  // Bookings — this team's pitch diary (gap 3). Read as the caller: a coach
  // gets the rows through `bookings_team_staff_read`, and anyone else this
  // page admits falls back to `pitch_calendar()`, which carries no booker PII.
  // --------------------------------------------------------------------
  let pitchBookings: PitchBookingItem[] = [];
  if (tab === "bookings") {
    pitchBookings = await loadTeamPitchBookings(id, PITCH_BOOKING_LIMIT);
    const playerIds = await teamPlayerIds(userClient, id);
    bookingCounts = Object.fromEntries(
      await bookingHeadcounts(
        userClient,
        pitchBookings.map((booking) => booking.id),
        playerIds,
      ),
    );
  }

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
          <Badge variant={team.active ? "success" : "muted"}>
            {team.active ? "Active" : "Inactive"}
          </Badge>
          {team.gender && <Badge variant="muted" className="capitalize">{team.gender}</Badge>}
          {homePitch && <Badge variant="outline">Home pitch: {homePitch.name}</Badge>}
          {team.recruiting && <Badge variant="default">Recruiting</Badge>}
          {link && (
            <Badge variant={link.enabled ? "default" : "muted"}>
              {link.enabled ? "Full-Time import enabled" : "Full-Time import paused"}
            </Badge>
          )}
        </div>

        <TeamTabs teamId={team.id} tabs={tabs} active={tab} />

        {/* ---------------------------------------------------------------- */}
        {/* Overview                                                         */}
        {/* ---------------------------------------------------------------- */}
        {/* ---------------------------------------------------------------- */}
        {/* Chat / Notice board — the team's rooms, embedded                 */}
        {/* ---------------------------------------------------------------- */}
        {(tab === "chat" || tab === "notices") &&
          (threadData ? (
            <div className="max-w-3xl">
              <ThreadPanel data={threadData} showLeave={false} />
            </div>
          ) : (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                {tab === "chat"
                  ? "This team's chat room isn't open to you. Players, their parents and the team's staff are added automatically when they join the team — if that's you and you still can't see it, ask a club administrator."
                  : "This team's notice board isn't open to you. Members and staff are added automatically when they join the team."}
              </CardContent>
            </Card>
          ))}

        {tab === "overview" && (
          <div className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Next fixtures</CardTitle>
                </CardHeader>
                <CardContent>
                  <FixturesSummary fixtures={overviewFixtures} teamId={team.id} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Next pitch bookings</CardTitle>
                </CardHeader>
                <CardContent>
                  <PitchBookingsSummary teamId={team.id} items={overviewBookings} headcounts={bookingCounts} />
                </CardContent>
              </Card>
            </div>

            {/* Gap 10: what the public /recruitment page says about this team.
                Written through the caller's own client, so `teams_staff_update`
                lets a coach maintain it and the guard refuses anything else. */}
            <Card>
              <CardHeader>
                <CardTitle>Recruiting</CardTitle>
                <p className="text-sm text-muted-foreground">
                  What a parent looking for a team sees on the club&apos;s public recruitment page.
                  The team&apos;s name and age group are a club administrator&apos;s to change;
                  everything here belongs to the people who run the team.
                </p>
              </CardHeader>
              <CardContent>
                <RecruitingPanel
                  teamId={team.id}
                  canEdit={canManageTeam}
                  values={{
                    recruiting: team.recruiting,
                    gender: team.gender,
                    join_type: team.join_type,
                    join_instructions: team.join_instructions,
                    session_details: team.session_details,
                    contact_name: team.contact_name,
                    contact_email: team.contact_email,
                    contact_phone: team.contact_phone,
                    show_coach_contact: team.show_coach_contact,
                  }}
                />
              </CardContent>
            </Card>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Members                                                          */}
        {/* ---------------------------------------------------------------- */}
        {tab === "members" && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Members</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Everyone in this team for the current season, players included. Adding someone,
                  changing their role or ending their membership goes straight to{" "}
                  <code>team_memberships</code> as you — so the SG-6 guard runs, and if it refuses
                  it tells you exactly which certification is missing. Memberships end; they are
                  never deleted.
                </p>
              </CardHeader>
              <CardContent>
                <MembersPanel
                  teamId={team.id}
                  seasonId={memberSeason?.id ?? null}
                  seasonName={memberSeason?.name ?? null}
                  members={members}
                  pending={pending}
                  canEdit={clubAdmin}
                />
              </CardContent>
            </Card>

            {committee && (
              <Card>
                <CardHeader>
                  <CardTitle>Certifications</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    DBS checks, safeguarding and coaching qualifications for everyone in a
                    child-facing role on this team (SG-6). A certification counts once it has been
                    verified; expiry nudges go out at 90, 30 and 7 days. Only the club&apos;s
                    safeguarding lead can grant a short exemption while paperwork clears.
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
            )}
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Fixtures                                                         */}
        {/* ---------------------------------------------------------------- */}
        {tab === "fixtures" && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Upcoming fixtures</CardTitle>
                <p className="text-sm text-muted-foreground">
                  The next {UPCOMING_LIMIT} kick-offs for this team, in Europe/London. Read-only
                  here — fixtures arrive from the importer or the manual entry screen. Home fixtures
                  are given a pitch on{" "}
                  <Link href="/pitches" className="underline underline-offset-2">
                    Pitches
                  </Link>
                  .
                </p>
              </CardHeader>
              <CardContent>
                {fixturesFailed ? (
                  <p className="text-sm text-destructive">
                    Could not load this team&apos;s fixtures.
                  </p>
                ) : (
                  <FixturesTable fixtures={fixtures} canManage={canManageTeam} teamId={team.id} />
                )}
              </CardContent>
            </Card>

          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Settings — admin-only: match day, Full-Time link, import runs    */}
        {/* ---------------------------------------------------------------- */}
        {tab === "settings" && committee && (
          <div className="space-y-6">
            {/* Where this team plays and how long a match takes. Written
                through the caller's own client, so `teams_staff_update` lets a
                coach maintain it and `trg_teams_home_resource_guard` is what
                refuses a home resource that is not a pitch. */}
            <Card>
              <CardHeader>
                <CardTitle>Match day</CardTitle>
                <p className="text-sm text-muted-foreground">
                  The team&apos;s home pitch and the shape of its matches. Allocating a home fixture
                  on{" "}
                  <Link href="/pitches" className="underline underline-offset-2">
                    Pitches
                  </Link>{" "}
                  starts from the home pitch, and the halves and half time give new fixtures their
                  pitch slot in place of the club&apos;s standard 90 minutes.
                </p>
              </CardHeader>
              <CardContent>
                <MatchDayPanel
                  teamId={team.id}
                  canEdit={canManageTeam}
                  pitches={matchDayPitches}
                  values={{
                    home_resource_id: team.home_resource_id,
                    home_kickoff_time: team.home_kickoff_time,
                    central_venue_name: team.central_venue_name,
                    match_halves: team.match_halves,
                    half_length_minutes: team.half_length_minutes,
                    half_time_minutes: team.half_time_minutes,
                    default_pre_buffer_minutes: team.default_pre_buffer_minutes,
                    default_post_buffer_minutes: team.default_post_buffer_minutes,
                  }}
                />
              </CardContent>
            </Card>

            {/* The whole season in one go: every future home fixture onto one
                pitch at one kick-off — or, for a central-venue team, every
                fixture pointed at the league's venue and our pitches freed.
                The RPCs are club_admin-only; committee holds that through the
                profiles → person_roles sync. */}
            <Card>
              <CardHeader>
                <CardTitle>
                  {team.central_venue_name ? "Central venue" : "Allocate the season"}
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  {team.central_venue_name
                    ? `${team.name} plays at ${team.central_venue_name}, which the club does not manage — its fixtures never occupy our pitch calendar.`
                    : "Put every future home fixture on a pitch in one go, starting from the team's saved defaults. Individual fixtures can still be moved afterwards on the Pitches screen."}
                </p>
              </CardHeader>
              <CardContent>
                <AllocateAllPanel
                  teamId={team.id}
                  pitches={matchDayPitches}
                  homeResourceId={team.home_resource_id}
                  homeKickoffTime={team.home_kickoff_time}
                  centralVenueName={team.central_venue_name}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>FA Full-Time link</CardTitle>
                <p className="text-sm text-muted-foreground">
                  The FA publishes no fixtures API, so fixtures and results are read from the
                  team&apos;s Full-Time widget — the &ldquo;add to your website&rdquo; snippet.
                  Paste it, preview what the parser reads, then save. Imports run nightly;
                  re-linking for a new season updates this link and keeps the fixtures already
                  imported.
                </p>
              </CardHeader>
              <CardContent>
                <FullTimePanel
                  teamId={team.id}
                  teamName={team.name}
                  defaultFtName={defaultFtName}
                  link={link}
                  clubSeasons={clubSeasons}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Manual import &amp; run history</CardTitle>
                <p className="text-sm text-muted-foreground">
                  The fallback that keeps working when the nightly importer does not: paste a
                  Full-Time address, or paste the fixtures as CSV. Either way you see them
                  before anything is written, and the import reconciles by fixture reference —
                  reschedules become updates, never duplicates.
                </p>
              </CardHeader>
              <CardContent>
                <ManualImportPanel
                  teamId={team.id}
                  teamName={team.name}
                  ftTeamName={link?.ft_team_name ?? team.name}
                  currentSeason={
                    currentSeason ? { id: currentSeason.id, name: currentSeason.name } : null
                  }
                  runs={runs}
                />
              </CardContent>
            </Card>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Bookings                                                         */}
        {/* ---------------------------------------------------------------- */}
        {tab === "bookings" && (
          <Card>
            <CardHeader>
              <CardTitle>Pitch bookings</CardTitle>
              <p className="text-sm text-muted-foreground">
                The next {PITCH_BOOKING_LIMIT} pitch slots for this team — its own training and
                block bookings, plus any session another team is sharing with it. Coaches request a
                slot and a club administrator confirms it; until then it reads as awaiting
                confirmation.
              </p>
            </CardHeader>
            <CardContent>
              <TeamPitchBookings
                teamId={team.id}
                items={pitchBookings}
                canManage={canManageTeam}
                headcounts={bookingCounts}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
