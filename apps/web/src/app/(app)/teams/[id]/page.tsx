import { notFound, redirect } from "next/navigation";
import Link from "next/link";

import { CalendarDays, ChevronLeft, Users } from "lucide-react";

import { getSessionProfile, isCommittee } from "@/lib/auth";
import { getCapabilities, getStoredRoleView } from "@/lib/capabilities";
import { nameOf, resolveNames } from "@/lib/person";
import { isMemberView, resolveRoleView } from "@/lib/role-view";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { FoldCard } from "@/components/ui/fold-card";
import { StatRow, StatTile } from "@/components/ui/stat-tile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { loadPitches, loadTeamPitchBookings } from "@/lib/pitch-booking-data";
import { bookingHeadcounts, fixtureHeadcounts, teamPlayerIds } from "@/lib/event-headcounts";
import type { Headcount } from "@/lib/headcount";
import type { PitchBookingItem } from "@/lib/pitch-booking";

import { type FullTimeLinkView } from "./fulltime-panel";
import { type MatchDayPitch } from "./matchday-panel";
import { TeamPitchBookings } from "./pitch-bookings-card";
import { FixturesTable, type TeamFixture } from "./fixtures-list";
import { fixtureHref, lineupHref } from "./fixtures-shared";
import { type BoardPost } from "./board-panel";
import { CommunicationsTab, TeamConversations, initialsOf } from "./board-tab";
import { TeamTabs, type TeamTab, type TeamTabKey } from "./team-tabs";
import { EMPTY_SETTINGS, SettingsTab, loadSettingsTab, type SettingsTabData } from "./settings-tab";
import { EMPTY_SQUAD, loadSquadTab, type SquadTabData } from "./squad-data";
import { SquadTab } from "./squad-tab";
import { squadSheetModeFrom, type SquadSheetMode } from "./squad-sheet-modes";
import { SubsTab, loadSubsTab, type SubsRow } from "./subs-tab";
import { TeamOverviewGrid } from "./team-overview-grid";
import { loadMarkedSessions } from "../../training/training-reads";
import { instantToLocal, londonToday } from "@/lib/booking-time";
import { faFormatFor } from "@/lib/fa-formats";
import { fixtureGridRows, type FixtureGridFixture, type FixtureGridTeam } from "@/lib/fixture-grid";
import { teamNextAction } from "@/lib/team-next-action";
import { dayMonthLabel, weekdayLabel } from "@/lib/training-plan";
import {
  londonWeekday,
  trainingWeekDays,
  trainingWeekRows,
  dayWord,
  type TrainingWeekSession,
} from "@/lib/training-week";

// The team's name would mean re-reading `teams` in `generateMetadata`, a query
// this page already makes for itself; a tab is not worth a second one.
export const metadata = { title: "Team" };
import { loadThread } from "../../messages/[id]/thread-data";
import { googleMapsUrl } from "../../events/shared";

/** Next 20 fixtures, read-only — the importer (P2.4) is what writes them. */
const UPCOMING_LIMIT = 20;
/** Next pitch bookings shown on the Bookings tab (gap 3). */
const PITCH_BOOKING_LIMIT = 10;
/**
 * One string literal, not a concatenation: supabase-js infers the row type
 * from the select text, and only a literal carries that type.
 */
const FIXTURE_SELECT =
  "id,booking_id,kickoff_at,no_longer_published_at,is_home,opponent,competition,status,venue_text,allocation_conflict,seasons(name),resources!fixtures_venue_resource_id_fkey(name,address)";

export default async function TeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; sheet?: string | string[]; person?: string }>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const { id } = await params;
  const { tab: requestedTab, sheet: rawSheet, person: rawPerson } = await searchParams;

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
  // Parent, Player and Me are the views a person wears to look at the team as
  // a member of it. Everything a manager does is off in all three — for a
  // coach, and for a club administrator too (Adam, 2026-09-01: "parents should
  // not see the team settings tab whilst using that role, even if they are a
  // coach or admin").
  const memberView = isMemberView(view);
  const staffTools = canManageTeam && !memberView;
  // The committee's own furniture — Subs, Settings, and the Full-Time badge in
  // the header — answers to the hat as well. Being on the committee is what
  // ADMITS you to it; wearing a member's hat is what puts it away.
  const committeeTools = committee && !memberView;
  // The hat you wear to RUN something rather than to belong to something.
  // This was written out longhand here as `view === "admin" || view === null`;
  // it is the named helper now, the same sentence `/matches` writes (P8.4),
  // so the rule lives in one place rather than being remembered screen by
  // screen. The coach carve-out is deliberate and is Adam's (2026-08-25).
  const adminHat = !isMemberView(view) && view !== "coach";
  // Adam, 2026-08-25: "make sure coaches cannot assign pitches". Allocation
  // — the season in one go, and the team's home-pitch defaults the allocator
  // starts from — is the club admin's, and only while wearing the admin hat.
  // The RPCs behind it are club_admin-only already; this is the screen agreeing.
  const allocationTools = (committee || capabilities.isClubAdmin) && adminHat;

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  // --------------------------------------------------------------------
  // What every tab needs: the team itself, the pitch list behind the home
  // pitch badge, and — for staff wearing a staff hat — the Full-Time link
  // that the header condenses into a badge and the Settings tab lets a coach
  // maintain (2026-09-13). An administrator looking at their own child's
  // team as a parent never triggers the read: whether a team is linked to
  // the FA feed is a thing the team's staff do, not a thing its families see.
  // --------------------------------------------------------------------
  const [teamResult, matchDayPitches, linkRow] = await Promise.all([
    admin.from("teams").select("*").eq("id", id).maybeSingle(),
    loadPitches(),
    staffTools
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
    ...(committeeTools ? [{ key: "subs", label: "Subs" } as TeamTab] : []),
    // Settings is the coach's too (Adam, 2026-09-13: "coaches to have the
    // ability to post their code snippet in team settings") — the match-day
    // card and the Full-Time link; the committee-only cards inside it keep
    // their own gate.
    ...(staffTools ? [{ key: "settings", label: "Settings" } as TeamTab] : []),
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

  /**
   * The Squad tab's panel is a URL (P8.7a): `?tab=squad&sheet=details&person=`.
   * The mode is addressed rather than held in state, so a half-typed shirt
   * number survives a refresh, the exact panel can be sent to a colleague, and
   * a server action re-rendering the page underneath does not slam it shut.
   * `?tab=` keeps its place in front, so every existing team link is untouched.
   */
  const squadSheet: SquadSheetMode | null = squadSheetModeFrom(rawSheet);
  const squadPerson = typeof rawPerson === "string" && rawPerson ? rawPerson : null;
  const sheetHref = (mode: SquadSheetMode | null, personId?: string | null): string => {
    const query = new URLSearchParams({ tab: "squad" });
    if (mode && personId) {
      query.set("sheet", mode);
      query.set("person", personId);
    }
    return `/teams/${id}?${query.toString()}`;
  };

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
      staffTools ? teamPlayerIds(userClient, id) : Promise.resolve([]),
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
  // Squad — the season's roster and the held-back imports, read in
  // `squad-data.ts` (P8.7a) with every query and every comment it had.
  //
  // The roster is the coach's and the club's screen. Adam, 2026-08-25:
  // "parents should not see emergency contacts in the Squad page" — so the
  // tab follows the hat, not just the capability. A coach who is also a
  // parent, looking at the team as a parent, gets the team's life and not
  // its management, and `?tab=squad` typed by hand lands on Overview.
  // --------------------------------------------------------------------
  // One answer for the whole page, hat included. This used to be a `let`
  // filled in ONLY by the Squad tab's branch — so the rename field on
  // Settings and the bulk match panel on Match day, both gated on it, never
  // rendered for anyone (Adam, 2026-09-02: "The team name field is not there
  // for club admin"). `my_capabilities()` already answered, so this costs no
  // extra round trip.
  const clubAdmin = capabilities.isClubAdmin && !memberView;
  let squad: SquadTabData = EMPTY_SQUAD;
  if (tab === "squad" && staffTools) {
    squad = await loadSquadTab({
      userClient,
      admin,
      teamId: id,
      nowIso,
      staffTools,
      committee,
      clubAdmin,
      teamStaff,
    });
  }

  // --------------------------------------------------------------------
  // Fixtures — the list everyone the page admits may read.
  // --------------------------------------------------------------------
  let fixtures: TeamFixture[] = [];
  let fixturesFailed = false;

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
  /** This team's pitch slots that are not a match's own allocated slot. */
  let overviewSessions: TrainingWeekSession[] = [];

  if (tab === "matchday") {
    const squadIds = staffTools ? await teamPlayerIds(userClient, id) : [];
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
    const fixtureCounts = staffTools
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
      // A central-venue team's home games are played at that venue, not
      // waiting for a pitch — say where the fixture is actually played (its
      // own venue text first, the standing central venue otherwise) rather
      // than "no pitch yet" (Adam, 2026-09-04: "Even though U8 Sparrows
      // Black are at a central venue, it keeps saying pitch unallocated";
      // "put the venue from the fixtures in all relevant places").
      pitchName:
        row.resources?.name ??
        (row.is_home && (team.central_venue_name ?? "").trim() !== ""
          ? row.venue_text?.trim() || (team.central_venue_name ?? "").trim()
          : null),
      pitchAddress: row.resources?.address ?? null,
      headcount: fixtureCounts.get(row.id) ?? null,
      eventId: eventByFixture.get(row.id) ?? null,
      noLongerPublishedAt: row.no_longer_published_at,
    }));

    // The Availability card: the squad by name against the next match, the
    // exceptions surfaced first. Staff only, same reason as the headcounts.
    if (staffTools && fixtures[0] && squadIds.length > 0) {
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

    // ------------------------------------------------------------------
    // The week's training row (P8.7b). The same read the Training tab
    // makes — `loadTeamPitchBookings`, which is `bookings_team_staff_read`
    // for a coach and `pitch_calendar()` (no booker PII) for everyone else
    // — plus the register flag `/training` reads beside its own sessions,
    // because no session read carries one and "11 of 14 coming, register
    // not taken" is the fact a week is for.
    //
    // A booking that IS a match's allocated slot is left out: it is already
    // on the fixtures row, and one game drawn twice is a week that does not
    // add up.
    // ------------------------------------------------------------------
    const slots = (await loadTeamPitchBookings(id, PITCH_BOOKING_LIMIT)).filter(
      (slot) => !slot.fixtureId,
    );
    const slotIds = slots.map((slot) => slot.id);
    const [slotCounts, markedSlots] = await Promise.all([
      staffTools
        ? bookingHeadcounts(userClient, slotIds, squadIds)
        : Promise.resolve(new Map<string, Headcount>()),
      loadMarkedSessions(slotIds),
    ]);
    overviewSessions = slots.map((slot) => {
      const count = slotCounts.get(slot.id);
      return {
        bookingId: slot.id,
        eventId: null,
        teamId: id,
        teamName: team.name,
        startsAt: slot.startsAt,
        pitchName: slot.resourceName,
        status: slot.status,
        accepted: count?.going ?? 0,
        declined: count?.notGoing ?? 0,
        squad: count?.squad ?? 0,
        marked: markedSlots.has(slot.id),
      } satisfies TrainingWeekSession;
    });
  }

  // --------------------------------------------------------------------
  // Settings — the committee's feed machinery: match day, the Full-Time
  // link and the importer with its run history, read in `settings-tab.tsx`
  // (P8.7a). Admin-only by tab guard, and every write still meets the same
  // RLS as anywhere else.
  // --------------------------------------------------------------------
  let settings: SettingsTabData = EMPTY_SETTINGS;
  if (tab === "settings" && staffTools) {
    settings = await loadSettingsTab({
      userClient,
      admin,
      teamId: id,
      teamName: team.name,
      nowIso,
    });
  }

  // --------------------------------------------------------------------
  // Bookings — this team's pitch diary (gap 3). Read as the caller: a coach
  // gets the rows through `bookings_team_staff_read`, and anyone else this
  // page admits falls back to `pitch_calendar()`, which carries no booker PII.
  // --------------------------------------------------------------------
  let pitchBookings: PitchBookingItem[] = [];
  if (tab === "training") {
    pitchBookings = await loadTeamPitchBookings(id, PITCH_BOOKING_LIMIT);
    if (staffTools) {
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
  // Subs — committee only: each player's latest subscription, read in
  // `subs-tab.tsx` (P8.7a) with the same queries it always made. The club
  // bills people, not teams, so this is a per-player read joined to the
  // roster; a squad with no subscriptions says so instead of pretending.
  // --------------------------------------------------------------------
  let subsRows: SubsRow[] = [];
  if (tab === "subs" && committeeTools) {
    subsRows = await loadSubsTab({ admin, teamId: id });
  }

  // Overview derivations: the FA rules strip, the week's grid, the
  // availability tallies and the chat tail. All cheap, all from data already
  // in hand.
  const formatRules = faFormatFor(team.age_group);
  // The club's own answer wins over the FA table where it has given one
  // (20260902150000): an adult side playing 9v9 is a thing no age group says.
  const playedFormat = team.playing_format ?? formatRules?.format ?? null;

  // --------------------------------------------------------------------
  // The week (P8.7b). The grid's columns are seven fixed days starting
  // today — an empty Thursday is the answer to "when could we train?", and
  // its `+` books a pitch with the team and the date already in it.
  //
  // The BAR, though, is about the team and not about the window: a fixture
  // eleven days out is still the next thing this team is waiting on, so
  // `teamNextAction()` is asked over every kick-off the page read. When that
  // fixture is outside the seven days the grid draws, the bar's button
  // becomes a door to Pitches rather than a sheet over a card that is not
  // on screen — the grid works that out for itself.
  // --------------------------------------------------------------------
  const todayIso = londonToday();
  const weekDays = trainingWeekDays(todayIso);
  const gridTeam: FixtureGridTeam = {
    id: team.id,
    name: team.name,
    ageGroup: team.age_group,
    centralVenueName: team.central_venue_name,
  };
  const gridFixtures: FixtureGridFixture[] = fixtures.map((row) => {
    const local = instantToLocal(row.kickoffAt);
    return {
      id: row.id,
      eventId: row.eventId,
      teamId: team.id,
      teamName: team.name,
      ageGroup: team.age_group,
      opponent: row.opponent,
      isHome: row.isHome,
      status: row.status,
      time: local.time,
      dateIso: local.date,
      // The desk's three pitch words, from the name this page already
      // resolved (which folds in the central venue).
      pitch: row.pitchName ?? (row.isHome ? "Unallocated" : "Away"),
      allocated: !!row.bookingId,
      accepted: row.headcount?.going ?? 0,
      declined: row.headcount?.notGoing ?? 0,
      squad: row.headcount?.squad ?? 0,
    } satisfies FixtureGridFixture;
  });
  const allFixtureDays = Array.from(new Set(gridFixtures.map((row) => row.dateIso))).sort();
  const nextFixtureCard =
    fixtureGridRows(gridFixtures, [gridTeam], allFixtureDays)[0]?.cards.find(
      (card) => card.dayIso >= todayIso,
    ) ?? null;
  const allSessionDays = Array.from(
    new Set(overviewSessions.map((session) => instantToLocal(session.startsAt).date)),
  ).sort();
  const nextSessionCard =
    trainingWeekRows(
      overviewSessions,
      [{ id: team.id, name: team.name, ageGroup: team.age_group }],
      allSessionDays,
    )[0]?.cards.find((card) => card.dayIso >= todayIso) ?? null;
  const nextAction = teamNextAction({
    nextFixture: nextFixtureCard,
    nextSession: nextSessionCard,
    today: todayIso,
  });
  // Two labels per column: the long one the sheet prints as a date, and the
  // short one a chip can hold at 390. Both made here, once, on the server.
  const dayLabels: Record<string, string> = {};
  const dayChips: Record<string, string> = {};
  for (const iso of weekDays) {
    dayLabels[iso] = `${weekdayLabel(londonWeekday(iso), true)} ${dayMonthLabel(iso)}`;
    const word = dayWord(iso, "00:00", todayIso);
    dayChips[iso] =
      word === "Today" || word === "Tomorrow"
        ? word
        : `${weekdayLabel(londonWeekday(iso), true)} ${Number(iso.slice(8, 10))}`;
  }

  const availTally = {
    available: availabilityList.filter((row) => row.status === "available").length,
    away: availabilityList.filter((row) => row.status === "unavailable").length,
    maybe: availabilityList.filter((row) => row.status === "maybe").length,
    noReply: availabilityList.filter((row) => row.status === null).length,
  };

  return (
    <>
      <div className="hidden lg:block">
        <PageHeader
          title={team.name}
          subtitle={team.age_group ?? "No age group"}
          back={{ href: "/teams", label: "Teams" }}
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
            <p className="font-display truncate text-2xs uppercase tracking-[0.16em] text-foreground/55">
              {[team.age_group, team.league].filter(Boolean).join(" · ") || "Team"}
            </p>
            <h1 className="font-display mt-1 truncate text-xl font-semibold uppercase leading-none tracking-wide">
              {team.name}
            </h1>
          </div>
        </div>
        <div className="mt-3">
          <TeamTabs teamId={team.id} tabs={tabs} active={tab} tone="ink" />
        </div>
      </div>

      {/* The FA rules used to be printed twice on the Overview: an ink strip
          under the phone's tabs and again in the desk's next-match card. They
          are one `StatRow` in the body now, which a phone reads two across. */}

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
          <CommunicationsTab
            team={team}
            boardPosts={boardPosts}
            threadData={threadData}
            staffTools={staffTools}
            glancePlayers={glancePlayers}
            glanceNextSlot={glanceNextSlot}
          />
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Squad — the roster as one list, a member opened over it          */}
        {/* ---------------------------------------------------------------- */}
        {tab === "squad" && staffTools && (
          <SquadTab
            team={team}
            data={squad}
            sheet={squadSheet}
            personId={squadPerson}
            sheetHref={sheetHref}
            canEdit={clubAdmin}
            canExportPortal={clubAdmin && adminHat}
          />
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Overview — the team's week as a grid, and the one thing it needs */}
        {/* ---------------------------------------------------------------- */}
        {tab === "matchday" && (
          <div className="space-y-6">
            <TeamOverviewGrid
              team={gridTeam}
              fixtures={gridFixtures}
              sessions={overviewSessions}
              days={weekDays}
              dayLabels={dayLabels}
              dayChips={dayChips}
              today={todayIso}
              next={nextAction}
              canManage={allocationTools}
              pitches={matchDayPitches}
              canTakeRegister={staffTools}
            />

            {/* The three doors the next-match card carried. The card itself is
                the grid now, but "Pick the team" is this page's only way into
                the line-up and the map is how a parent finds the ground, so
                they keep a press each of their own. */}
            {fixtures[0] && (
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={fixtureHref(team.id, fixtures[0])}
                  className={buttonVariants({ variant: "outline", size: "touch" })}
                >
                  Event &amp; RSVP for the next match
                </Link>
                {staffTools && (
                  <Link
                    href={lineupHref(team.id, fixtures[0])}
                    className={buttonVariants({ variant: "outline", size: "touch" })}
                  >
                    Pick the team
                  </Link>
                )}
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
                    className={buttonVariants({ variant: "ghost", size: "touch" })}
                  >
                    Open the ground in Google Maps
                  </a>
                )}
              </div>
            )}

            {/* The FA's rules for this age group, derived and never stored, so
                rollover changes them on its own. Four figures, said the way
                every other band of figures in the app is said. */}
            {formatRules && (
              <div className="space-y-2">
                <StatRow>
                  <StatTile label="Format" value={playedFormat ?? formatRules.format} />
                  <StatTile label="Match length" value={formatRules.matchLength} />
                  <StatTile label="Pitch size" value={formatRules.pitchSize} />
                  <StatTile label="Ball" value={formatRules.ball} />
                </StatRow>
                <p className="text-xs text-muted-foreground">
                  FA rules for {formatRules.age}. Changes automatically when the age group moves up
                  at rollover.
                </p>
              </div>
            )}

            {/* The phone stacks these the way the artboard does — the board and
                the chat first, the availability summary underneath; on lg+ the
                source order is the column order again. */}
            <div className="grid items-start gap-4 lg:grid-cols-2">
              <div className="order-2 space-y-4 lg:order-1">
                {/* Who has answered, by name. The grid above says how many; this
                    says who, and it folds because the count is usually enough. */}
                {staffTools && availabilityList.length > 0 && (
                  <FoldCard
                    icon={<Users className="h-4 w-4" aria-hidden />}
                    title="Availability"
                    summary={`${availTally.available} available · ${availTally.away} away${availTally.maybe > 0 ? ` · ${availTally.maybe} maybe` : ""} · ${availTally.noReply} no reply`}
                  >
                    <div className="space-y-3">
                      <div className="flex h-2 overflow-hidden rounded-full bg-muted">
                        {availTally.available > 0 && (
                          <div
                            className="bg-success"
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
                      <ul className="-mx-4 divide-y border-y lg:-mx-5">
                        {availabilityList.slice(0, 5).map((row) => (
                          <li
                            key={row.personId}
                            className="touch flex items-center gap-3 px-4 py-2.5 lg:px-5"
                          >
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-2xs font-semibold text-muted-foreground">
                              {initialsOf(row.name)}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-sm">{row.name}</span>
                            <span
                              className={
                                "text-xs font-semibold " +
                                (row.status === "available"
                                  ? "text-success"
                                  : row.status === "unavailable"
                                    ? "text-primary"
                                    : "text-warning")
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
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/teams/${team.id}?tab=squad`}
                          className={buttonVariants({ variant: "outline", size: "touch" })}
                        >
                          All {availabilityList.length} in the squad
                        </Link>
                        {availTally.noReply > 0 && fixtures[0] && (
                          <Link
                            href={fixtureHref(team.id, fixtures[0])}
                            className={buttonVariants({ size: "touch" })}
                          >
                            Chase the {availTally.noReply} no-
                            {availTally.noReply === 1 ? "reply" : "replies"}
                          </Link>
                        )}
                      </div>
                    </div>
                  </FoldCard>
                )}
              </div>

              <div className="order-1 space-y-4 lg:order-2">
                <TeamConversations team={team} posts={overviewPosts} thread={overviewThread} />
              </div>
            </div>
            {/* The week is the grid; the rest of the season folds. Bulk work
                on a match further out than seven days lives on the fixture
                desk, which P8.4 gave filters and a Select mode of its own. */}
            <FoldCard
              icon={<CalendarDays className="h-4 w-4" aria-hidden />}
              title="Every coming kick-off"
              summary={
                fixturesFailed
                  ? "Could not load this team's fixtures"
                  : fixtures.length === 0
                    ? "Nothing on the fixture list"
                    : `The next ${fixtures.length} ${fixtures.length === 1 ? "match" : "matches"}, in Europe/London`
              }
            >
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Read-only here — fixtures arrive from the importer or the manual entry screen.
                  Home fixtures are given a pitch on{" "}
                  <Link
                    href="/pitches"
                    className="touch inline-flex items-center underline underline-offset-2"
                  >
                    Pitches
                  </Link>
                  , and{" "}
                  <Link
                    href="/matches"
                    className="touch inline-flex items-center underline underline-offset-2"
                  >
                    the fixture desk
                  </Link>{" "}
                  works on several at once beyond this week.
                </p>
                {fixturesFailed ? (
                  <p className="text-sm text-destructive">
                    Could not load this team&apos;s fixtures.
                  </p>
                ) : (
                  <FixturesTable fixtures={fixtures} canManage={staffTools} teamId={team.id} />
                )}
              </div>
            </FoldCard>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Settings — six folds that say what they are set to               */}
        {/* ---------------------------------------------------------------- */}
        {tab === "settings" && staffTools && (
          <SettingsTab
            team={team}
            data={settings}
            link={link}
            pitches={matchDayPitches}
            homePitchName={homePitch?.name ?? null}
            allocationTools={allocationTools}
            committeeTools={committeeTools}
            clubAdmin={clubAdmin}
          />
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
                canManage={staffTools}
                headcounts={bookingCounts}
              />
            </CardContent>
          </Card>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Subs — committee only: who is billed what, player by player      */}
        {/* ---------------------------------------------------------------- */}
        {tab === "subs" && committeeTools && <SubsTab rows={subsRows} />}
      </div>
    </>
  );
}
