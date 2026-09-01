import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { getSessionProfile, isCommittee } from "@/lib/auth";
import { signPeoplePhotos } from "@/lib/avatars";
import { emergencyContactLine, type EmergencyContact } from "@/lib/emergency-contacts";
import { loadEmergencyContacts } from "@/lib/emergency-contacts-server";
import { getCapabilities, getStoredRoleView } from "@/lib/capabilities";
import { isClubAdmin, nameOf, resolveNames } from "@/lib/person";
import { resolveRoleView } from "@/lib/role-view";
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

import { FullTimePanel, type ClubSeasonView, type FullTimeLinkView } from "./fulltime-panel";
import { ManualImportPanel, type ImportRunView } from "./import-panel";
import {
  MembersPanel,
  type MemberRow,
  type PendingRow,
  type SquadAvailability,
  type SquadLeave,
  type SquadSubs,
} from "./members-panel";
import { MatchDayPanel, type MatchDayPitch } from "./matchday-panel";
import { AllocateAllPanel } from "./allocate-all-panel";
import { TeamPitchBookings } from "./pitch-bookings-card";
import { RecruitingPanel } from "./recruiting-panel";
import { FixturesTable, type TeamFixture } from "./fixtures-list";
import { fixtureHref, lineupHref } from "./fixtures-shared";
import { BoardPanel, type BoardPost } from "./board-panel";
import { TeamTabs, type TeamTab, type TeamTabKey } from "./team-tabs";
import { formatBookingDateShort } from "@/lib/booking-time";
import { faFormatFor } from "@/lib/fa-formats";
import { fixtureDayLabel, fixtureWhenLabel, type AvailabilityStatus } from "@/lib/squad-cards";
import { setTeamActive } from "../actions";
import { loadThread } from "../../messages/[id]/thread-data";
import { ThreadPanel } from "../../messages/[id]/thread-panel";
import { googleMapsUrl } from "../../events/shared";

/** Next 20 fixtures, read-only — the importer (P2.4) is what writes them. */
const UPCOMING_LIMIT = 20;
/** Next pitch bookings shown on the Bookings tab (gap 3). */
const PITCH_BOOKING_LIMIT = 10;
/** Enough import history to see a pattern without becoming a log viewer. */
const RUN_LIMIT = 10;

/**
 * One string literal, not a concatenation: supabase-js infers the row type
 * from the select text, and only a literal carries that type.
 */
const FIXTURE_SELECT =
  "id,booking_id,kickoff_at,no_longer_published_at,is_home,opponent,competition,status,venue_text,allocation_conflict,seasons(name),resources!fixtures_venue_resource_id_fkey(name,address)";

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
  // caller's own client so the database gives the answer. And — Adam,
  // 2026-08-25: "if I select parent from the drop down, it should just go to
  // the team page for that child" — a parent of a squad member, or an adult
  // player on the team, gets the member view: Matchday, Communications and
  // Training, with nothing staff-only computed on their behalf. The hats come
  // from `my_capabilities()`, the same guardianship-aware answer the role
  // switcher itself is built from.
  // --------------------------------------------------------------------
  const userClient = await createClient();
  const committee = isCommittee(session.profile?.role);
  const [staffResult, capabilities] = await Promise.all([
    userClient.rpc("is_team_staff", { p_team_id: id }),
    getCapabilities(),
  ]);
  const teamStaff = staffResult.data;
  const teamMember =
    capabilities.parentTeams.some((teamRef) => teamRef.id === id) ||
    capabilities.playerTeams.some((teamRef) => teamRef.id === id);
  if (!committee && teamStaff !== true && !teamMember) redirect("/lobby");
  const canManageTeam = committee || teamStaff === true;
  // The hat being worn (Adam, 2026-08-25: "Pick the team on parent view
  // shouldn't be available"): a coach who is also a parent looks at the team
  // as a parent when the switcher says so, and the staff shortcuts step back
  // to the member ones. The data gates above are unchanged — this is only
  // which button the page draws.
  const view = resolveRoleView(await getStoredRoleView(), capabilities);
  const staffTools = canManageTeam && view !== "parent" && view !== "player" && view !== "me";
  // Adam, 2026-08-25: "make sure coaches cannot assign pitches". Allocation
  // — the season in one go, and the team's home-pitch defaults the allocator
  // starts from — is the club admin's, and only while wearing the admin hat.
  // The RPCs behind it are club_admin-only already; this is the screen agreeing.
  const allocationTools =
    (committee || capabilities.isClubAdmin) && (view === "admin" || view === null);

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  // --------------------------------------------------------------------
  // What every tab needs: the team itself, the pitch list behind the home
  // pitch badge, and — for the committee only — the Full-Time link that the
  // header condenses into a badge. A coach never triggers the Full-Time read.
  // --------------------------------------------------------------------
  const [teamResult, matchDayPitches, linkRow] = await Promise.all([
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

  // The design's five tabs (spec §2.4, matchday-led): Matchday opens first,
  // Communications holds the bulletin board and the team chat, Squad is the
  // roster, Training the pitch diary — and the committee keeps Subs and the
  // Settings machinery. A tab the caller cannot use is not rendered.
  const tabs: TeamTab[] = [
    // The design's rename (2026-08-25): the first tab is the team's Overview —
    // same key, so ?tab=matchday links and the alias map keep working.
    { key: "matchday", label: "Overview" },
    { key: "board", label: "Communications" },
    // A parent or player gets the team's life, not its management: no roster
    // page, no money, no settings ("Parents don't need to see pitch
    // calendars" — the same instinct, applied to the tabs).
    ...(staffTools ? [{ key: "squad", label: "Squad" } as TeamTab] : []),
    { key: "training", label: "Training" },
    ...(committee
      ? [
          { key: "subs", label: "Subs" } as TeamTab,
          { key: "settings", label: "Settings" } as TeamTab,
        ]
      : []),
  ];
  // Old bookmarks keep working: every pre-design tab maps to its new home.
  const LEGACY_TABS: Record<string, TeamTabKey> = {
    chat: "board",
    notices: "board",
    overview: "matchday",
    fixtures: "matchday",
    members: "squad",
    bookings: "training",
  };
  const requested = LEGACY_TABS[requestedTab ?? ""] ?? requestedTab;
  const tab: TeamTabKey = tabs.some((t) => t.key === requested)
    ? (requested as TeamTabKey)
    : "matchday";

  // --------------------------------------------------------------------
  // Chat / Notice board — the team's own conversation rooms (P5.3), found
  // AS THE CALLER: the participant policies decide whether there is a room
  // to show, so a committee member who is not in the room is told so rather
  // than silently reading it (SG-9 — oversight lives in /safeguarding).
  // --------------------------------------------------------------------
  let threadData: Awaited<ReturnType<typeof loadThread>> = null;
  let boardPosts: BoardPost[] = [];
  let glancePlayers = 0;
  let glanceNextSlot: PitchBookingItem | null = null;
  if (tab === "board") {
    const [roomResult, postsResult, playerIdRows, nextSlots] = await Promise.all([
      userClient
        .from("conversations")
        .select("id")
        .eq("team_id", id)
        .eq("type", "team")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      userClient.rpc("team_board_posts", { p_team_id: id, p_limit: 20 }),
      // The glance card is staff furniture; a parent's client would count
      // only their own household as "the squad", so it is not asked.
      canManageTeam ? teamPlayerIds(userClient, id) : Promise.resolve([]),
      loadTeamPitchBookings(id, 1),
    ]);
    if (roomResult.data) threadData = await loadThread(roomResult.data.id);
    boardPosts = (postsResult.data ?? []).map((row) => ({
      postId: row.post_id,
      title: row.title,
      body: row.body,
      audience: row.audience,
      pinned: row.pinned,
      authorName: row.author_name,
      createdAt: row.created_at,
      readCount: row.read_count,
      readOf: row.read_of,
      replyCount: row.reply_count,
      canManage: row.can_manage,
    }));
    glancePlayers = playerIdRows.length;
    glanceNextSlot = nextSlots[0] ?? null;
    // Opening the tab is reading the board. Idempotent by construction (a
    // bare INSERT … ON CONFLICT DO NOTHING) so a re-render costs nothing and
    // read_at keeps its first value.
    const unread = (postsResult.data ?? []).filter((row) => !row.my_read).map((row) => row.post_id);
    if (unread.length > 0) {
      await userClient.rpc("mark_board_posts_read", { p_post_ids: unread });
    }
  }

  // --------------------------------------------------------------------
  // Overview — the glance: recruiting, the next three fixtures and the next
  // three pitch slots. (Match day moved to the Settings tab.)
  // --------------------------------------------------------------------
  let bookingCounts: Record<string, Headcount> = {};

  // --------------------------------------------------------------------
  // Members — the season's roster and the held-back imports.
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
  let squadLeave: SquadLeave = { canRequest: false, pendingMembershipIds: [] };
  // The two extra columns on a squad card. Both stay null unless the reader is
  // entitled to the whole answer — see where they are filled in below.
  let squadAvailability: SquadAvailability | null = null;
  let squadSubs: SquadSubs | null = null;
  let clubAdmin = false;
  let memberSeason: { id: string; name: string } | null = null;

  // The roster is the coach's and the club's screen. Adam, 2026-08-25:
  // "parents should not see emergency contacts in the Squad page" — so the
  // tab follows the hat, not just the capability. A coach who is also a
  // parent, looking at the team as a parent, gets the team's life and not
  // its management, and `?tab=squad` typed by hand lands on Overview.
  if (tab === "squad" && staffTools) {
    const [seasonsResult, pendingResult, adminAnswer] = await Promise.all([
      userClient.from("seasons").select("id,name,is_current").order("starts_on", {
        ascending: false,
      }),
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
    ]);

    clubAdmin = adminAnswer;

    const currentSeason = (seasonsResult.data ?? []).find((season) => season.is_current) ?? null;
    memberSeason = currentSeason ? { id: currentSeason.id, name: currentSeason.name } : null;

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

      // The face by the name (Adam, 2026-08-25). Read through the CALLER'S own
      // client, which is the whole safety of `signPeoplePhotos`: it only ever
      // signs `photo_path` values that reader's own `people` row returned.
      // `people_staff_read` (20260825280000, Adam: "I want coaches to … see
      // photos") lets a team's staff read their live members' rows, so a
      // coach sees faces too; anyone the policies refuse gets initials.
      const memberPersonIds = Array.from(
        new Set((membershipRows ?? []).map((row) => row.person_id)),
      );
      const { data: memberPhotoRows } = memberPersonIds.length
        ? await userClient.from("people").select("id,photo_path").in("id", memberPersonIds)
        : { data: [] as { id: string; photo_path: string | null }[] };
      const memberPhotos = await signPeoplePhotos(memberPhotoRows ?? []);
      // Emergency contacts beside the player (Adam, 2026-08-25: "I want
      // coaches to read emergency contacts"): `emergency_contacts_staff_read`
      // admits the team's staff for its live members; a reader the policies
      // refuse simply gets none. Read through the caller's client.
      // Only the people who ring them: the emergency contacts are drawn on
      // the roster for staff wearing the coach or admin hat and nobody else.
      const memberContacts = staffTools
        ? await loadEmergencyContacts(memberPersonIds)
        : new Map<string, EmergencyContact[]>();

      // What is already on the administrator's desk, so a row that has been
      // reported says so instead of offering the button again.
      // `_staff_read` / `_admin_read` decide; a reader entitled to neither
      // simply gets nothing back, which reads as "no requests".
      const { data: leaveRows } = await userClient
        .from("team_membership_leave_requests")
        .select("team_membership_id")
        .eq("team_id", id)
        .eq("status", "pending");
      squadLeave = {
        // A club administrator has End, which does it immediately; offering
        // them the queue as well would only be a slower End.
        canRequest: teamStaff === true && !adminAnswer,
        pendingMembershipIds: (leaveRows ?? []).map((row) => row.team_membership_id),
      };

      members = await Promise.all(
        (membershipRows ?? []).map(async (row) => {
          const minor = await userClient.rpc("is_minor", { person_id: row.person_id });
          return {
            id: row.id,
            personId: row.person_id,
            name: nameOf(memberNames, row.person_id),
            role: row.role,
            shirtNumber: row.shirt_number,
            joinedAt: row.joined_at,
            isMinor: minor.data === true,
            photoUrl: memberPhotos.get(row.person_id) ?? null,
            emergencyContacts: (memberContacts.get(row.person_id) ?? []).map(emergencyContactLine),
          } satisfies MemberRow;
        }),
      );

      const squadPlayerIds = members
        .filter((member) => member.role === "player")
        .map((member) => member.personId);

      // ----------------------------------------------------------------
      // The card's "Saturday" row, and the line above the grid.
      //
      // Exactly what the Overview tab does: the next fixture, then the
      // `availability` rows against it. STAFF AND ADMINISTRATORS ONLY —
      // which the Squad tab already is (`canManageTeam` gates the tab and
      // its render) — because a parent's client returns only their own
      // household's availability rows, and a partial read shown as a squad
      // status would lie.
      // ----------------------------------------------------------------
      if (canManageTeam && squadPlayerIds.length > 0) {
        const { data: nextFixture } = await userClient
          .from("fixtures")
          .select("id,kickoff_at")
          .eq("team_id", id)
          .gte("kickoff_at", nowIso)
          .order("kickoff_at")
          .limit(1)
          .maybeSingle();
        if (nextFixture) {
          const { data: availRows } = await userClient
            .from("availability")
            .select("person_id,status")
            .eq("fixture_id", nextFixture.id);
          // Everyone starts silent; an answer overwrites it. A player with no
          // row has not replied, which is the thing worth chasing.
          const statusByPerson: Record<string, AvailabilityStatus> = {};
          for (const personId of squadPlayerIds) statusByPerson[personId] = null;
          for (const row of availRows ?? []) {
            if (row.person_id in statusByPerson) {
              statusByPerson[row.person_id] = row.status as AvailabilityStatus;
            }
          }
          squadAvailability = {
            fixtureLabel: fixtureWhenLabel(nextFixture.kickoff_at),
            dayLabel: fixtureDayLabel(nextFixture.kickoff_at),
            statusByPerson,
          };
        }
      }

      // ----------------------------------------------------------------
      // The card's "Subs" row — COMMITTEE ONLY, and the row is not rendered
      // at all for anyone else (`subs` stays null). Same read as the Subs
      // tab: the newest `subscriptions` row per player through the admin
      // client, which is where money already lives on this page. No policy
      // is widened; a reader who is not committee simply never asks.
      // ----------------------------------------------------------------
      if (committee && squadPlayerIds.length > 0) {
        const { data: subRows } = await admin
          .from("subscriptions")
          .select("person_id,status,amount_due_pence,created_at")
          .in("person_id", squadPlayerIds)
          .order("created_at", { ascending: false });
        const byPerson: Record<string, { status: string | null; amountDuePence: number | null }> =
          {};
        for (const row of subRows ?? []) {
          // Newest first, so the first row seen per player is the current one.
          if (!(row.person_id in byPerson)) {
            byPerson[row.person_id] = {
              status: row.status,
              amountDuePence: row.amount_due_pence,
            };
          }
        }
        squadSubs = { byPerson };
      }
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

  // Overview extras: the board's latest posts, the chat's tail and — for
  // staff — the next match's availability by name.
  type OverviewAvailability = {
    personId: string;
    name: string;
    status: "available" | "unavailable" | "maybe" | null;
  };
  let overviewPosts: BoardPost[] = [];
  let overviewThread: Awaited<ReturnType<typeof loadThread>> = null;
  let availabilityList: OverviewAvailability[] = [];

  if (tab === "matchday") {
    const squadIds = canManageTeam ? await teamPlayerIds(userClient, id) : [];
    const [fixturesResult, postsResult, roomResult] = await Promise.all([
      userClient
        .from("fixtures")
        .select(FIXTURE_SELECT)
        .eq("team_id", id)
        .gte("kickoff_at", nowIso)
        .order("kickoff_at")
        .limit(UPCOMING_LIMIT),
      userClient.rpc("team_board_posts", { p_team_id: id, p_limit: 3 }),
      userClient
        .from("conversations")
        .select("id")
        .eq("team_id", id)
        .eq("type", "team")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    overviewPosts = (postsResult.data ?? []).map((row) => ({
      postId: row.post_id,
      title: row.title,
      body: row.body,
      audience: row.audience,
      pinned: row.pinned,
      authorName: row.author_name,
      createdAt: row.created_at,
      readCount: row.read_count,
      readOf: row.read_of,
      replyCount: row.reply_count,
      canManage: row.can_manage,
    }));
    if (roomResult.data) overviewThread = await loadThread(roomResult.data.id);

    fixturesFailed = !!fixturesResult.error;
    // Staff only: a parent's client reads just their own household's
    // availability rows, and a partial read shown as a squad count would lie.
    const fixtureCounts = canManageTeam
      ? await fixtureHeadcounts(
          userClient,
          (fixturesResult.data ?? []).map((row) => row.id),
          squadIds,
        )
      : new Map<string, Headcount>();
    // The RSVP event mirroring each fixture (events module): a game on this
    // page opens the Event & RSVP page (Adam, 2026-08-25) — the fixture's own
    // marker page stays reachable from there for staff. Read as the caller:
    // the events policy admits the team, its parents, its staff and admins.
    const fixtureIds = (fixturesResult.data ?? []).map((row) => row.id);
    const { data: eventRows } =
      fixtureIds.length > 0
        ? await userClient.from("events").select("id,fixture_id").in("fixture_id", fixtureIds)
        : { data: [] as { id: string; fixture_id: string | null }[] };
    const eventByFixture = new Map<string, string>();
    for (const row of eventRows ?? []) {
      if (row.fixture_id) eventByFixture.set(row.fixture_id, row.id);
    }
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
      pitchAddress: row.resources?.address ?? null,
      headcount: fixtureCounts.get(row.id) ?? null,
      eventId: eventByFixture.get(row.id) ?? null,
      noLongerPublishedAt: row.no_longer_published_at,
    }));

    // The Availability card: the squad by name against the next match, the
    // exceptions surfaced first. Staff only, same reason as the headcounts.
    if (canManageTeam && fixtures[0] && squadIds.length > 0) {
      const [{ data: availRows }, names] = await Promise.all([
        userClient
          .from("availability")
          .select("person_id,status")
          .eq("fixture_id", fixtures[0].id),
        resolveNames(squadIds),
      ]);
      const statusBy = new Map(
        (availRows ?? []).map((row) => [row.person_id, row.status] as const),
      );
      const weight = (status: OverviewAvailability["status"]): number =>
        status === "unavailable" ? 0 : status === "maybe" ? 1 : status === null ? 2 : 3;
      availabilityList = squadIds
        .map((personId) => ({
          personId,
          name: nameOf(names, personId),
          status: (statusBy.get(personId) ?? null) as OverviewAvailability["status"],
        }))
        .sort(
          (a, b) => weight(a.status) - weight(b.status) || a.name.localeCompare(b.name, "en-GB"),
        );
    }
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
        .select("id,trigger,status,inserted,updated,unchanged,retired,kept_back,error,source_url,created_at")
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
      retired: run.retired,
      keptBack: run.kept_back,
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
  if (tab === "training") {
    pitchBookings = await loadTeamPitchBookings(id, PITCH_BOOKING_LIMIT);
    if (canManageTeam) {
      const playerIds = await teamPlayerIds(userClient, id);
      bookingCounts = Object.fromEntries(
        await bookingHeadcounts(
          userClient,
          pitchBookings.map((booking) => booking.id),
          playerIds,
        ),
      );
    }
  }

  // --------------------------------------------------------------------
  // Subs — committee only: each player's latest subscription, plainly. The
  // club bills people, not teams, so this is a per-player read joined to the
  // roster; a squad with no subscriptions says so instead of pretending.
  // --------------------------------------------------------------------
  type SubsRow = {
    personId: string;
    name: string;
    planName: string | null;
    status: string | null;
    amountDuePence: number | null;
    payerName: string | null;
  };
  let subsRows: SubsRow[] = [];
  if (tab === "subs" && committee) {
    const { data: roster } = await admin
      .from("team_memberships")
      .select("person_id,people(first_name,last_name,preferred_name)")
      .eq("team_id", id)
      .is("left_at", null)
      .eq("role", "player");
    const playerRows = roster ?? [];
    const playerIdList = Array.from(new Set(playerRows.map((row) => row.person_id)));
    const { data: subs } = playerIdList.length
      ? await admin
          .from("subscriptions")
          .select("person_id,status,amount_due_pence,payer_person_id,created_at,subscription_plans(name)")
          .in("person_id", playerIdList)
          .order("created_at", { ascending: false })
      : { data: [] };
    // Newest subscription per player is the one that speaks for them.
    const latest = new Map<string, NonNullable<typeof subs>[number]>();
    for (const row of subs ?? []) {
      if (!latest.has(row.person_id)) latest.set(row.person_id, row);
    }
    const payerIds = Array.from(
      new Set(
        Array.from(latest.values())
          .map((row) => row.payer_person_id)
          .filter((value): value is string => !!value),
      ),
    );
    const { data: payers } = payerIds.length
      ? await admin.from("people").select("id,first_name,last_name,preferred_name").in("id", payerIds)
      : { data: [] };
    const payerName = new Map(
      (payers ?? []).map((person) => [
        person.id,
        `${person.preferred_name || person.first_name} ${person.last_name}`.trim(),
      ]),
    );
    subsRows = playerRows
      .map((row) => {
        const person = row.people;
        const sub = latest.get(row.person_id) ?? null;
        return {
          personId: row.person_id,
          name: person
            ? `${person.preferred_name || person.first_name} ${person.last_name}`.trim()
            : "Club member",
          planName: sub?.subscription_plans?.name ?? null,
          status: sub?.status ?? null,
          amountDuePence: sub?.amount_due_pence ?? null,
          payerName: sub?.payer_person_id ? payerName.get(sub.payer_person_id) ?? null : null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "en-GB"));
  }

  // Overview derivations: the FA rules strip, the availability tallies, and
  // the chat tail. All cheap, all from data already in hand.
  const formatRules = faFormatFor(team.age_group);
  // The phone's next-match card (mobile artboard) says the same thing as the
  // ink card, on one line under the opponent.
  const nextMatch = fixtures[0] ?? null;
  const nextMatchLine = nextMatch
    ? [
        new Date(nextMatch.kickoffAt).toLocaleString("en-GB", {
          timeZone: "Europe/London",
          weekday: "short",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }),
        nextMatch.isHome ? "Home" : "Away",
        nextMatch.pitchName ?? nextMatch.venueText,
        nextMatch.competition,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  const availTally = {
    available: availabilityList.filter((row) => row.status === "available").length,
    away: availabilityList.filter((row) => row.status === "unavailable").length,
    maybe: availabilityList.filter((row) => row.status === "maybe").length,
    noReply: availabilityList.filter((row) => row.status === null).length,
  };
  const chatMessages = overviewThread
    ? overviewThread.messages.filter((message) => !message.deleted_at).slice(-3)
    : [];
  let chatUnread = 0;
  if (overviewThread) {
    const lastRead = overviewThread.myLive?.last_read_message_id ?? null;
    const index = lastRead
      ? overviewThread.messages.findIndex((message) => message.id === lastRead)
      : -1;
    chatUnread =
      index >= 0 ? overviewThread.messages.length - index - 1 : overviewThread.messages.length;
  }
  const initialsOf = (name: string): string =>
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toLocaleUpperCase("en-GB") ?? "")
      .join("");
  const chatTime = (iso: string): string =>
    new Date(iso).toLocaleTimeString("en-GB", {
      timeZone: "Europe/London",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });

  return (
    <>
      <div className="hidden lg:block">
        <PageHeader
          title={team.name}
          subtitle={team.age_group ?? "No age group"}
          action={
            <Link href="/teams" className={buttonVariants({ variant: "outline", size: "sm" })}>
              <ChevronLeft className="h-4 w-4" /> Back to teams
            </Link>
          }
        />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* The phone's team band (mobile design, "Team overview" artboard):    */}
      {/* back, the age group and league as an eyebrow, the team's name, and  */}
      {/* the tab strip scrolling inside the dark band.                       */}
      {/* ------------------------------------------------------------------ */}
      <div className="theme-ink bg-background px-4 pb-3 pt-3 text-foreground lg:hidden">
        <div className="flex items-center gap-2">
          <Link
            href="/teams"
            aria-label="Back to teams"
            className="-ml-2 flex h-11 w-9 shrink-0 items-center justify-center text-accent"
          >
            <ChevronLeft className="h-[22px] w-[22px]" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="font-display truncate text-[10.5px] uppercase tracking-[0.16em] text-foreground/55">
              {[team.age_group, team.league].filter(Boolean).join(" · ") || "Team"}
            </p>
            <h1 className="font-display mt-1 truncate text-[21px] font-semibold uppercase leading-none tracking-wide">
              {team.name}
            </h1>
          </div>
        </div>
        <div className="mt-3">
          <TeamTabs teamId={team.id} tabs={tabs} active={tab} tone="ink" />
        </div>
      </div>

      {/* The format strip the artboard puts under the tabs: the FA's rules for
          this age group, derived from it and never stored. */}
      {tab === "matchday" && formatRules && (
        <div className="theme-ink grid grid-cols-4 gap-2 border-b border-border bg-card px-4 py-3 text-foreground lg:hidden">
          {[
            ["Format", formatRules.format],
            ["Halves", formatRules.matchLength],
            ["Pitch", formatRules.pitchSize],
            ["Ball", formatRules.ball],
          ].map(([label, value]) => (
            <div key={label} className="min-w-0">
              <p className="font-display text-[8px] font-medium uppercase tracking-[0.14em] text-foreground/50">
                {label}
              </p>
              <p className="mt-1 truncate text-[12.5px] font-semibold">{value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-6 p-4 lg:p-6">
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

        <div className="hidden lg:block">
          <TeamTabs teamId={team.id} tabs={tabs} active={tab} />
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* Communications — the bulletin board and the team chat (§2.4)     */}
        {/* ---------------------------------------------------------------- */}
        {tab === "board" && (
          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <Card>
              <CardHeader>
                <CardTitle>Team Lobby</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Visible to squad, parents and staff. A post marked Club-wide came from the club
                  lobby — replies to it belong on the club post, so its link takes you there.
                </p>
              </CardHeader>
              <CardContent>
                <BoardPanel teamId={team.id} posts={boardPosts} canPost={canManageTeam} />
              </CardContent>
            </Card>

            <div className="space-y-6">
              {threadData ? (
                <ThreadPanel data={threadData} showLeave={false} />
              ) : (
                <Card>
                  <CardContent className="p-6 text-sm text-muted-foreground">
                    This team&apos;s chat room isn&apos;t open to you. Players, their parents and
                    the team&apos;s staff are added automatically when they join the team — if
                    that&apos;s you and you still can&apos;t see it, ask a club administrator.
                  </CardContent>
                </Card>
              )}

              {canManageTeam && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Team at a glance</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="space-y-2 text-sm">
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-muted-foreground">Squad</dt>
                      <dd className="font-medium">
                        {glancePlayers} {glancePlayers === 1 ? "player" : "players"}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-muted-foreground">Next pitch slot</dt>
                      <dd className="text-right font-medium">
                        {glanceNextSlot ? (
                          <Link
                            href={`/teams/${team.id}?tab=training`}
                            className="underline underline-offset-2"
                          >
                            {formatBookingDateShort(glanceNextSlot.date)} ·{" "}
                            {glanceNextSlot.startTime}
                          </Link>
                        ) : (
                          "None booked"
                        )}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-muted-foreground">Board</dt>
                      <dd className="font-medium">
                        {boardPosts.length} {boardPosts.length === 1 ? "post" : "posts"}
                      </dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>
              )}
            </div>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Squad — the roster, the paperwork, and what recruitment says     */}
        {/* ---------------------------------------------------------------- */}
        {tab === "squad" && staffTools && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle>Squad</CardTitle>
                  {/* Club administrators only, wearing the admin hat (Adam,
                      2026-08-25: "coaches should not be able to download photos
                      in a zip file") — and the route refuses anyone else again. */}
                  {clubAdmin && (view === "admin" || view === null) && (
                    <a
                      href={`/teams/${team.id}/photos.zip`}
                      className={`${buttonVariants({ variant: "outline", size: "sm" })} min-h-11 sm:min-h-0`}
                    >
                      Export photos for FA Clubs Portal
                    </a>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  Everyone in this team for the current season, players included — a card each,
                  with the next match&apos;s answer and the person to ring. Adding someone,
                  changing their role or ending their membership (under <strong>Manage</strong> on
                  the card) goes straight to <code>team_memberships</code> as you, so the database
                  decides and any refusal is shown as it arrived. Memberships end; they are never
                  deleted.
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
                  squadLeave={squadLeave}
                  availability={squadAvailability}
                  subs={squadSubs}
                  ageGroup={team.age_group}
                />
              </CardContent>
            </Card>

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
        {/* Matchday — the next match up top, then every coming kick-off     */}
        {/* ---------------------------------------------------------------- */}
        {tab === "matchday" && (
          <div className="space-y-6">
            {/* The artboard's next-match card: paper, accent rim, the kickoff
                details, then the availability count against "Pick the team".
                The ink card that follows is the lg+ view of the same fixture. */}
            {nextMatch && (
              <div className="overflow-hidden rounded-xl border border-accent/30 bg-card lg:hidden">
                <div className="border-b px-4 py-3.5">
                  <p className="font-display text-[9px] font-medium uppercase tracking-[0.16em] text-primary">
                    Next match
                  </p>
                  <p className="mt-2 text-[17px] font-semibold leading-tight">
                    v {nextMatch.opponent}
                  </p>
                  <p className="mt-1.5 text-[12.5px] leading-snug text-muted-foreground">
                    {nextMatchLine}
                  </p>
                  {(nextMatch.pitchName || nextMatch.venueText) && (
                    <a
                      href={googleMapsUrl(
                        (nextMatch.isHome ? nextMatch.pitchAddress : null) ??
                          nextMatch.pitchName ??
                          nextMatch.venueText ??
                          "",
                      )}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1.5 inline-flex min-h-[32px] items-center text-xs text-primary underline underline-offset-2"
                    >
                      Open in Google Maps
                    </a>
                  )}
                </div>
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  {nextMatch.headcount ? (
                    <div>
                      <p className="text-[19px] font-semibold leading-none">
                        {nextMatch.headcount.going}
                        <span className="text-[13px] text-muted-foreground">
                          /{nextMatch.headcount.squad}
                        </span>
                      </p>
                      <p className="mt-1.5 text-[11.5px] text-muted-foreground">available</p>
                    </div>
                  ) : (
                    <p className="text-[12.5px] text-muted-foreground">
                      {nextMatch.isHome ? "At home" : "Away"}
                    </p>
                  )}
                  <Link
                    href={
                      staffTools ? lineupHref(team.id, nextMatch) : fixtureHref(team.id, nextMatch)
                    }
                    className={
                      buttonVariants({ size: "sm" }) + " min-h-[44px] shrink-0 px-4 text-[12.5px]"
                    }
                  >
                    {staffTools ? "Pick the team" : "Event & RSVP"}
                  </Link>
                </div>
              </div>
            )}

            {fixtures[0] && (
              <div className="theme-ink hidden rounded-xl border border-border bg-background p-5 text-foreground lg:block">
                <p className="font-display text-[10px] font-medium uppercase tracking-[0.16em] text-accent">
                  Next match
                </p>
                <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <p className="text-xl font-semibold leading-tight">
                      {team.name} <span className="font-normal text-muted-foreground">v</span>{" "}
                      {fixtures[0].opponent}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {new Date(fixtures[0].kickoffAt).toLocaleString("en-GB", {
                        timeZone: "Europe/London",
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                        hourCycle: "h23",
                      })}
                      {" · "}
                      {fixtures[0].isHome ? "Home" : "Away"}
                      {fixtures[0].pitchName ? ` · ${fixtures[0].pitchName}` : ""}
                      {!fixtures[0].pitchName && fixtures[0].venueText
                        ? ` · ${fixtures[0].venueText}`
                        : ""}
                      {fixtures[0].competition ? ` · ${fixtures[0].competition}` : ""}
                    </p>
                    {(fixtures[0].pitchName || fixtures[0].venueText) && (
                      <a
                        href={googleMapsUrl(
                          (fixtures[0].isHome ? fixtures[0].pitchAddress : null) ??
                            fixtures[0].pitchName ??
                            fixtures[0].venueText ??
                            "",
                        )}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                      >
                        Open in Google Maps
                      </a>
                    )}
                  </div>
                  <div className="text-right">
                    {fixtures[0].headcount && (
                      <>
                        <p className="text-2xl font-semibold leading-none">
                          {fixtures[0].headcount.going}/{fixtures[0].headcount.squad}
                        </p>
                        <p className="text-xs text-muted-foreground">available</p>
                      </>
                    )}
                    <Link
                      href={
                        staffTools ? lineupHref(team.id, fixtures[0]) : fixtureHref(team.id, fixtures[0])
                      }
                      className={buttonVariants({ size: "sm" }) + " mt-2"}
                    >
                      {staffTools ? "Pick the team" : "Event & RSVP"}
                    </Link>
                  </div>
                </div>

                {/* The format strip: the FA's rules for this age group, derived
                    — never stored — so rollover changes them automatically. */}
                {formatRules && (
                  <div className="mt-4 flex flex-wrap items-end gap-x-8 gap-y-3 border-t border-border pt-4">
                    {[
                      ["Format", formatRules.format],
                      ["Match length", formatRules.matchLength],
                      ["Pitch size", formatRules.pitchSize],
                      ["Ball", formatRules.ball],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <p className="font-display text-[9px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                          {label}
                        </p>
                        <p className="mt-0.5 text-sm font-semibold">{value}</p>
                      </div>
                    ))}
                    <p className="ml-auto max-w-[34ch] text-xs text-muted-foreground">
                      FA rules for {formatRules.age}. Changes automatically when the age group
                      moves up at rollover.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* -------------------------------------------------------------- */}
            {/* The Overview grid: availability + jobs on the left, the board  */}
            {/* and chat previews on the right (design build, 2026-08-25).     */}
            {/* -------------------------------------------------------------- */}
            {/* The phone stacks these the way the artboard does — the board and
                the chat first, the availability summary underneath; on lg+ the
                source order is the column order again. */}
            <div className="grid items-start gap-4 lg:grid-cols-2">
              <div className="order-2 space-y-4 lg:order-1">
                {canManageTeam && fixtures[0] && availabilityList.length > 0 && (
                  <Card className="overflow-hidden">
                    <CardHeader className="flex-row items-center justify-between space-y-0 border-b py-4">
                      <CardTitle className="text-base">Availability</CardTitle>
                      {availTally.noReply > 0 && (
                        <Link
                          href={fixtureHref(team.id, fixtures[0])}
                          className="inline-flex min-h-[44px] items-center rounded-full bg-amber-100 px-2.5 text-xs font-semibold text-amber-800 hover:bg-amber-200 lg:min-h-0 lg:py-1"
                        >
                          Chase the {availTally.noReply} no-
                          {availTally.noReply === 1 ? "reply" : "replies"}
                        </Link>
                      )}
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="px-4 pb-1 pt-4">
                        <div className="flex h-2 overflow-hidden rounded-full bg-muted">
                          {availTally.available > 0 && (
                            <div
                              className="bg-emerald-600"
                              style={{
                                width: `${(availTally.available / availabilityList.length) * 100}%`,
                              }}
                            />
                          )}
                          {availTally.away + availTally.maybe > 0 && (
                            <div
                              className="bg-primary"
                              style={{
                                width: `${((availTally.away + availTally.maybe) / availabilityList.length) * 100}%`,
                              }}
                            />
                          )}
                        </div>
                        <p className="mt-2 flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                          <span>
                            <strong className="text-emerald-700">{availTally.available}</strong>{" "}
                            available
                          </span>
                          <span>
                            <strong className="text-primary">{availTally.away}</strong> away
                          </span>
                          {availTally.maybe > 0 && (
                            <span>
                              <strong className="text-amber-700">{availTally.maybe}</strong> maybe
                            </span>
                          )}
                          <span>
                            <strong className="text-foreground">{availTally.noReply}</strong> no
                            reply
                          </span>
                        </p>
                      </div>
                      <ul className="mt-2">
                        {availabilityList.slice(0, 5).map((row) => (
                          <li
                            key={row.personId}
                            className="flex min-h-[44px] items-center gap-3 border-t px-4 py-2.5"
                          >
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                              {initialsOf(row.name)}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-sm">{row.name}</span>
                            <span
                              className={
                                "text-xs font-semibold " +
                                (row.status === "available"
                                  ? "text-emerald-700"
                                  : row.status === "unavailable"
                                    ? "text-primary"
                                    : row.status === "maybe"
                                      ? "text-amber-700"
                                      : "text-amber-700")
                              }
                            >
                              {row.status === "available"
                                ? "Available"
                                : row.status === "unavailable"
                                  ? "Away"
                                  : row.status === "maybe"
                                    ? "Maybe"
                                    : "No reply"}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <Link
                        href={`/teams/${team.id}?tab=squad`}
                        className="flex min-h-[44px] items-center border-t px-4 py-2.5 text-xs text-primary hover:underline lg:min-h-0 lg:block"
                      >
                        Show all {availabilityList.length} in the squad
                      </Link>
                    </CardContent>
                  </Card>
                )}
              </div>

              <div className="order-1 space-y-4 lg:order-2">
                <Card className="overflow-hidden">
                  <CardHeader className="flex-row items-baseline justify-between space-y-0 border-b py-4">
                    <CardTitle className="text-base">Team Lobby</CardTitle>
                    <Link
                      href={`/teams/${team.id}?tab=board`}
                      className="inline-flex min-h-[44px] items-center text-xs text-primary hover:underline lg:min-h-0"
                    >
                      All posts
                    </Link>
                  </CardHeader>
                  <CardContent className="p-0">
                    {overviewPosts.length === 0 ? (
                      <p className="px-4 py-4 text-sm text-muted-foreground">
                        Nothing on the board yet.
                      </p>
                    ) : (
                      overviewPosts.map((post, index) => (
                        <div
                          key={post.postId}
                          className={
                            "px-4 py-3" +
                            (index > 0 ? " border-t" : "") +
                            (post.pinned ? " bg-primary/5" : "")
                          }
                        >
                          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            {post.pinned && (
                              <span className="font-display text-[9.5px] font-semibold uppercase tracking-[0.14em] text-primary">
                                Pinned
                              </span>
                            )}
                            {post.audience === "club" ? "Club-wide" : post.authorName}
                            {" · "}
                            {new Date(post.createdAt).toLocaleDateString("en-GB", {
                              timeZone: "Europe/London",
                              day: "numeric",
                              month: "short",
                            })}
                          </p>
                          <p className="mt-1 text-sm font-semibold">{post.title}</p>
                          {post.pinned && post.body && (
                            <p className="mt-1 line-clamp-3 max-w-[52ch] text-sm text-muted-foreground">
                              {post.body}
                            </p>
                          )}
                          <p className="mt-1.5 flex gap-4 text-xs text-muted-foreground">
                            <span>
                              {post.readCount} of {post.readOf} read
                            </span>
                            <span>
                              {post.replyCount} {post.replyCount === 1 ? "reply" : "replies"}
                            </span>
                          </p>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>

                {overviewThread && (
                  <Card className="overflow-hidden">
                    <CardHeader className="flex-row items-center justify-between space-y-0 border-b py-4">
                      <CardTitle className="text-base">Team chat</CardTitle>
                      {chatUnread > 0 && (
                        <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
                          {chatUnread > 9 ? "9+" : chatUnread}
                        </span>
                      )}
                    </CardHeader>
                    <CardContent className="space-y-3 bg-secondary/30 p-4">
                      {chatMessages.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No messages yet.</p>
                      ) : (
                        chatMessages.map((message) => {
                          const mine = message.sender_person_id === overviewThread.personId;
                          const senderName =
                            overviewThread.nameMap[message.sender_person_id] ??
                            overviewThread.unnamedLabel;
                          return (
                            <div
                              key={message.id}
                              className={"flex gap-2.5" + (mine ? " flex-row-reverse" : "")}
                            >
                              <span
                                className={
                                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold " +
                                  (mine
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-muted text-muted-foreground")
                                }
                              >
                                {initialsOf(senderName)}
                              </span>
                              <div className={"min-w-0" + (mine ? " text-right" : "")}>
                                <p className="text-[11px] text-muted-foreground">
                                  {senderName} · {chatTime(message.created_at)}
                                </p>
                                <p
                                  className={
                                    "mt-1 inline-block max-w-[38ch] rounded-lg px-3 py-2 text-left text-sm " +
                                    (mine
                                      ? "bg-foreground text-background"
                                      : "border bg-card")
                                  }
                                >
                                  {message.body}
                                </p>
                              </div>
                            </div>
                          );
                        })
                      )}
                      <Link
                        href={`/teams/${team.id}?tab=board`}
                        className="flex min-h-[44px] items-center pt-1 text-xs text-primary hover:underline lg:block lg:min-h-0"
                      >
                        Open the chat
                      </Link>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>

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
                  canEdit={allocationTools}
                  pitches={matchDayPitches}
                  values={{
                    home_resource_id: team.home_resource_id,
                    home_kickoff_time: team.home_kickoff_time,
                    central_venue_name: team.central_venue_name,
                    league: team.league,
                    division: team.division,
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
            {allocationTools && (
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
            )}

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

            {/* Active/inactive moved here from the teams table (the design
                drops that column — the list's "Active only" filter shows the
                state, this is where it changes). */}
            <Card>
              <CardHeader>
                <CardTitle>Team status</CardTitle>
                <p className="text-sm text-muted-foreground">
                  An inactive team keeps its history but drops out of the default teams list, the
                  rollover and the allocator&apos;s work lists.
                </p>
              </CardHeader>
              <CardContent>
                <form action={setTeamActive} className="flex items-center gap-3">
                  <input type="hidden" name="team_id" value={team.id} />
                  <input type="hidden" name="active" value={team.active ? "false" : "true"} />
                  <Badge variant={team.active ? "success" : "muted"}>
                    {team.active ? "Active" : "Inactive"}
                  </Badge>
                  <button
                    type="submit"
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    {team.active ? "Mark inactive" : "Mark active"}
                  </button>
                </form>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Training — the team's pitch diary, headcounts included           */}
        {/* ---------------------------------------------------------------- */}
        {tab === "training" && (
          <Card>
            <CardHeader>
              <CardTitle>Training &amp; pitch slots</CardTitle>
              <p className="text-sm text-muted-foreground">
                The next {PITCH_BOOKING_LIMIT} pitch slots for this team — its own training,
                matches and other bookings, plus any session another team is sharing with it.
                Coaches request a slot and a club administrator confirms it; until then it reads as
                awaiting confirmation. The headcount beside a session is the squad&apos;s
                availability.
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

        {/* ---------------------------------------------------------------- */}
        {/* Subs — committee only: who is billed what, player by player      */}
        {/* ---------------------------------------------------------------- */}
        {tab === "subs" && committee && (
          <Card>
            <CardHeader>
              <CardTitle>Subs</CardTitle>
              <p className="text-sm text-muted-foreground">
                Each player&apos;s latest subscription. The club bills the payer — usually a parent
                — so &ldquo;billed to&rdquo; names them. Payments themselves are handled on the
                money screens; this is the team&apos;s view of where everyone stands.
              </p>
            </CardHeader>
            <CardContent>
              {subsRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No players on the roster yet.</p>
              ) : (
                <>
                  <div className="mb-4 flex flex-wrap gap-4 text-sm">
                    <p>
                      <span className="text-2xl font-semibold">
                        {subsRows.filter((row) => row.status === "active" || row.status === "completed").length}
                      </span>{" "}
                      <span className="text-muted-foreground">of {subsRows.length} covered</span>
                    </p>
                    {subsRows.some((row) => row.status === "past_due") && (
                      <p className="text-amber-700">
                        <span className="text-2xl font-semibold">
                          {subsRows.filter((row) => row.status === "past_due").length}
                        </span>{" "}
                        owing
                      </p>
                    )}
                    {subsRows.some((row) => row.status === null) && (
                      <p className="text-muted-foreground">
                        <span className="text-2xl font-semibold">
                          {subsRows.filter((row) => row.status === null).length}
                        </span>{" "}
                        no subscription yet
                      </p>
                    )}
                  </div>
                  {/* A phone reads the roster as cards; the table is lg+. */}
                  <ul className="divide-y rounded-lg border lg:hidden">
                    {subsRows.map((row) => (
                      <li
                        key={row.personId}
                        className="flex min-h-[44px] items-start justify-between gap-3 px-3 py-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{row.name}</p>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {row.planName ?? "No plan"}
                            {row.payerName ? ` · billed to ${row.payerName}` : ""}
                          </p>
                        </div>
                        <div className="shrink-0">
                          {row.status === null ? (
                            <span className="text-xs text-muted-foreground">No subscription</span>
                          ) : row.status === "past_due" ? (
                            <Badge variant="warning">
                              {row.amountDuePence !== null
                                ? `£${(row.amountDuePence / 100).toFixed(2)} owing`
                                : "Owing"}
                            </Badge>
                          ) : row.status === "completed" ? (
                            <Badge variant="success">Paid</Badge>
                          ) : row.status === "active" ? (
                            <Badge variant="success">On plan</Badge>
                          ) : row.status === "cancelled" ? (
                            <Badge variant="muted">Cancelled</Badge>
                          ) : (
                            <Badge variant="muted">Pending</Badge>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="hidden overflow-x-auto lg:block">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b text-xs text-muted-foreground">
                        <tr>
                          <th className="py-2 pr-3 font-medium">Player</th>
                          <th className="py-2 pr-3 font-medium">Plan</th>
                          <th className="py-2 pr-3 font-medium">Billed to</th>
                          <th className="py-2 pr-3 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {subsRows.map((row) => (
                          <tr key={row.personId}>
                            <td className="py-2 pr-3 font-medium">{row.name}</td>
                            <td className="py-2 pr-3 text-muted-foreground">
                              {row.planName ?? "—"}
                            </td>
                            <td className="py-2 pr-3 text-muted-foreground">
                              {row.payerName ?? "—"}
                            </td>
                            <td className="py-2 pr-3">
                              {row.status === null ? (
                                <span className="text-muted-foreground">No subscription</span>
                              ) : row.status === "past_due" ? (
                                <Badge variant="warning">
                                  {row.amountDuePence !== null
                                    ? `£${(row.amountDuePence / 100).toFixed(2)} owing`
                                    : "Owing"}
                                </Badge>
                              ) : row.status === "completed" ? (
                                <Badge variant="success">Paid</Badge>
                              ) : row.status === "active" ? (
                                <Badge variant="success">On plan</Badge>
                              ) : row.status === "cancelled" ? (
                                <Badge variant="muted">Cancelled</Badge>
                              ) : (
                                <Badge variant="muted">Pending</Badge>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
