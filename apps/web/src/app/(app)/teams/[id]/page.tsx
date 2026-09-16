import { notFound, redirect } from "next/navigation";
import Link from "next/link";

import { ChevronLeft, Wrench } from "lucide-react";

import { getSessionProfile, isCommittee } from "@/lib/auth";
import { getCapabilities, getStoredRoleView } from "@/lib/capabilities";
import { nameOf, resolveNames } from "@/lib/person";
import { isMemberView, resolveRoleView } from "@/lib/role-view";
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

import { type FullTimeLinkView } from "./fulltime-panel";
import { type MatchDayPitch } from "./matchday-panel";
import { TeamPitchBookings } from "./pitch-bookings-card";
import { FixturesTable, type TeamFixture } from "./fixtures-list";
import { ManageMatchesPanel } from "../../matches/manage-matches-panel";
import { fixtureHref, lineupHref } from "./fixtures-shared";
import { BoardPanel, type BoardPost } from "./board-panel";
import { TeamTabs, type TeamTab, type TeamTabKey } from "./team-tabs";
import { EMPTY_SETTINGS, SettingsTab, loadSettingsTab, type SettingsTabData } from "./settings-tab";
import { EMPTY_SQUAD, loadSquadTab, type SquadTabData } from "./squad-data";
import { SquadTab } from "./squad-tab";
import { squadSheetModeFrom, type SquadSheetMode } from "./squad-sheet-modes";
import { SubsTab, loadSubsTab, type SubsRow } from "./subs-tab";
import { formatBookingDateShort } from "@/lib/booking-time";
import { faFormatFor } from "@/lib/fa-formats";

// The team's name would mean re-reading `teams` in `generateMetadata`, a query
// this page already makes for itself; a tab is not worth a second one.
export const metadata = { title: "Team" };
import { loadThread } from "../../messages/[id]/thread-data";
import { ThreadPanel } from "../../messages/[id]/thread-panel";
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

  // Overview derivations: the FA rules strip, the availability tallies, and
  // the chat tail. All cheap, all from data already in hand.
  const formatRules = faFormatFor(team.age_group);
  // The club's own answer wins over the FA table where it has given one
  // (20260902150000): an adult side playing 9v9 is a thing no age group says.
  const playedFormat = team.playing_format ?? formatRules?.format ?? null;
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
            ["Format", playedFormat ?? formatRules.format],
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
                <BoardPanel teamId={team.id} posts={boardPosts} canPost={staffTools} />
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

              {staffTools && (
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
                      ["Format", playedFormat ?? formatRules.format],
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
                {staffTools && fixtures[0] && availabilityList.length > 0 && (
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
                  <FixturesTable fixtures={fixtures} canManage={staffTools} teamId={team.id} />
                )}
              </CardContent>
            </Card>

            {/* Bulk cancel, delete and kick-off for this team (Adam,
                2026-09-02: "…for an individual team and the matches tab").
                Shut until an administrator opens it, and admin-only — under
                the ADMIN hat, the same rule as the photos export and the
                allocate door: a coach (or an admin wearing the coach hat)
                still deletes and moves one match at a time on the match
                itself, where the counts of what goes with it are in front of
                them. */}
            {clubAdmin && (view === "admin" || view === null) && fixtures.length > 0 && (
              <details className="rounded-xl border bg-card">
                <summary className="flex min-h-[44px] cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
                  <Wrench className="h-4 w-4 text-muted-foreground" />
                  Manage these matches
                  <span className="text-xs font-normal text-muted-foreground">
                    cancel, delete or set a kick-off for several at once
                  </span>
                </summary>
                <div className="border-t p-4">
                  <ManageMatchesPanel
                    heading={`${fixtures.length} upcoming ${fixtures.length === 1 ? "match" : "matches"}`}
                    matches={fixtures.map((fixture) => ({
                      id: fixture.id,
                      kickoffAt: fixture.kickoffAt,
                      isHome: fixture.isHome,
                      opponent: fixture.opponent,
                      status: fixture.status,
                      notInFullTime: !!fixture.noLongerPublishedAt,
                      hasPitch: !!fixture.bookingId,
                    }))}
                  />
                </div>
              </details>
            )}

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
