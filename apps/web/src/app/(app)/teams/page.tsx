import { redirect } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Plus,
} from "lucide-react";

import { getSessionProfile, isCommittee } from "@/lib/auth";
import { getCapabilities, getStoredRoleView } from "@/lib/capabilities";
import { resolveRoleView } from "@/lib/role-view";
import { isClubAdmin } from "@/lib/person";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Select } from "@/components/ui/field";
import { STAFF_TEAM_ROLES } from "@/lib/pitch-booking";
import { formatBookingDateShort } from "@/lib/booking-time";
import { widgetUrl } from "@club/fulltime";

import { faFormatDetail, faFormatFor } from "@/lib/fa-formats";

import { createSeason, createTeam, setCurrentSeason } from "./actions";
import { ClubWidgetsPanel } from "./club-widgets-panel";
import { FormatsPanel } from "./formats-panel";
import { TeamFilterGrid, type TeamFilterItem } from "./team-filter";

/** The Full-Time link columns this list condenses into one dot and one label. */
type FullTimeLinkSummary = {
  team_id: string;
  enabled: boolean;
  last_import_status: string | null;
  last_import_at: string | null;
  last_import_count: number | null;
  last_error: string | null;
};

/** A club-feed team's latest import run — its only Full-Time record. */
type ClubRunSummary = {
  team_id: string;
  status: string;
  created_at: string;
  inserted: number;
  updated: number;
  unchanged: number;
  error: string | null;
};

type NextOut = {
  when: string;
  opponent: string;
  home: boolean;
  pitch: string | null;
  /** Home fixture with no booking — the design's "no pitch yet" amber note. */
  unallocated: boolean;
};

type TeamCard = {
  id: string;
  name: string;
  ageGroup: string | null;
  gender: string | null;
  active: boolean;
  homePitch: string | null;
  /** Which competition the team plays in — the teams outside the club
      Full-Time leagues are exactly the ones this column accounts for. */
  league: string | null;
  division: string | null;
  players: number;
  /** The manager's name, else the head coach's; null with `others` > 0 is the
      design's "No manager" state, null with 0 others is "No staff". */
  lead: string | null;
  /** Staff beyond the lead, condensed to "+ N assistants" / "+ N coaches". */
  others: number;
  /** "assistants" when any remaining staff is an assistant, else "coaches". */
  othersWord: string;
  nextOut: NextOut | null;
  /** null = no subscriptions set up for this squad, shown as an em-dash. */
  subsOwing: number | null;
};

/** "Sat 30 Aug · 09:30" — Adam: "next out needs a date and not just a day". */
function kickoffShort(iso: string): string {
  const at = new Date(iso);
  const day = at.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const time = at.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return `${day} · ${time}`;
}

const GENDER_LABELS: Record<string, string> = {
  mixed: "Mixed",
  boys: "Boys",
  girls: "Girls",
};

function formatStamp(iso: string | null): string {
  if (!iso) return "never";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "never";
  return at.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

/**
 * The whole Full-Time story for one team as a dot, a label and a tooltip —
 * the same four columns the old list spread across three badges and two
 * paragraphs. Nothing is dropped: the timing, the count and the error text
 * all live in `detail`, and the team page still shows them in full.
 *
 * The label names the source ("which link is feeding this team?" — Adam,
 * 2026-08-25): a team's own widget is a "Team FT link", a team matched by
 * name out of the club-wide widgets is a "Club FT link". A club-feed team
 * has no `team_fulltime_links` row, so its state is read from its latest
 * club-widget import run instead.
 */
function fullTimeState(
  link: FullTimeLinkSummary | undefined,
  clubRun: ClubRunSummary | undefined,
  clubConfigured: boolean,
): {
  dot: string;
  label: string;
  detail: string;
} {
  if (link) {
    const when = `Last import ${formatStamp(link.last_import_at)}${
      typeof link.last_import_count === "number" ? ` · ${link.last_import_count} fixtures` : ""
    }`;
    const detail = `This team's own Full-Time widget. ${when}`;

    if (!link.enabled) {
      return { dot: "bg-muted-foreground/60", label: "Team FT link · paused", detail };
    }
    if (link.last_import_status === "ok") {
      return { dot: "bg-emerald-500", label: "Team FT link", detail };
    }
    if (link.last_import_status === "error") {
      return {
        dot: "bg-destructive",
        label: "Team FT link · import failed",
        detail: link.last_error ? `${detail}\n${link.last_error}` : detail,
      };
    }
    if (link.last_import_status === "challenge") {
      return { dot: "bg-amber-500", label: "Team FT link · blocked by Cloudflare", detail };
    }
    return { dot: "bg-amber-500", label: "Team FT link · not imported yet", detail };
  }

  if (clubRun) {
    const count = clubRun.inserted + clubRun.updated + clubRun.unchanged;
    const detail = `Fed from the club-wide Full-Time widgets, matched by team name. Last import ${formatStamp(
      clubRun.created_at,
    )} · ${count} fixtures`;
    if (clubRun.status === "ok") {
      return { dot: "bg-emerald-500", label: "Club FT link", detail };
    }
    if (clubRun.status === "error") {
      return {
        dot: "bg-destructive",
        label: "Club FT link · import failed",
        detail: clubRun.error ? `${detail}\n${clubRun.error}` : detail,
      };
    }
    if (clubRun.status === "challenge") {
      return { dot: "bg-amber-500", label: "Club FT link · blocked by Cloudflare", detail };
    }
    return { dot: "bg-amber-500", label: `Club FT link · ${clubRun.status}`, detail };
  }

  if (clubConfigured) {
    return {
      dot: "bg-muted-foreground/40",
      label: "Club FT link · nothing imported yet",
      detail:
        "The club-wide widgets are set up, but no fixtures have been imported for this team yet — its name has not been matched in the club feed, or the nightly run has not happened since it was added.",
    };
  }

  return {
    dot: "bg-muted-foreground/40",
    label: "No FT link",
    detail: "No Full-Time widget saved for this team, and no club-wide widget feeds it.",
  };
}

/**
 * "Under 12s" before "Under 14s" before "Open age" — the order a club reads
 * its teams in, which plain alphabetical sorting gets wrong.
 */
function ageGroupKey(ageGroup: string | null): [number, string] {
  if (!ageGroup) return [3, ""];
  const digits = ageGroup.match(/\d+/);
  if (digits) return [1, digits[0].padStart(4, "0")];
  return [2, ageGroup.toLocaleLowerCase("en-GB")];
}

function compareTeams(a: TeamCard, b: TeamCard): number {
  const [aRank, aKey] = ageGroupKey(a.ageGroup);
  const [bRank, bKey] = ageGroupKey(b.ageGroup);
  if (aRank !== bRank) return aRank - bRank;
  if (aKey !== bKey) return aKey < bKey ? -1 : 1;
  return a.name.localeCompare(b.name, "en-GB");
}

export default async function TeamsPage({
  searchParams,
}: {
  searchParams: Promise<{
    saved?: string;
    error?: string;
    q?: string;
    status?: string;
    tab?: string;
  }>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const { saved, error: errorParam, q, status, tab } = await searchParams;
  const query = (q ?? "").trim();
  const showAll = status === "all";
  const formatsTab = tab === "formats";
  const nowIso = new Date().toISOString();

  // ------------------------------------------------------------------
  // Who may be here, and which teams they get.
  //
  // Committee sign-ins and club administrators run the club, so they see
  // every team. A coach, assistant coach or manager sees the teams they
  // actually staff and nothing else — the list comes from their own
  // `team_memberships` rows through `team_memberships_self_read`, so the
  // database is what decides, not this page.
  // ------------------------------------------------------------------
  const supabase = await createClient();
  const committee = isCommittee(session.profile?.role);
  const [clubAdmin, personResult, capabilities] = await Promise.all([
    isClubAdmin(),
    supabase.rpc("current_person_id"),
    getCapabilities(),
  ]);
  // The active tile scopes the data, not just the menu: an administrator who
  // is also a coach sees ONLY their own teams while in the Coach view
  // ("coaches and managers should only be able to see the teams they are
  // associated with" — Adam, 2026-08-24). Switching to the Admin tile brings
  // the full list back.
  //
  // The club-wide list is now the ADMIN HAT'S, not merely "not the coach's"
  // (Adam, 2026-09-01: "as a parent and coach, I should only see things
  // relevant to my team — so I shouldn't see a full list of teams and coaches,
  // also whether they are FT linked"). Naming the one view that earns the
  // whole club, rather than listing the views that do not, is also what stops
  // the next view added to the app from quietly inheriting it.
  const view = resolveRoleView(await getStoredRoleView(), capabilities);
  const coachView = view === "coach";
  const canAdmin = (committee || clubAdmin) && (view === "admin" || view === null);

  let staffTeamIds: string[] = [];
  if (!canAdmin && personResult.data) {
    const { data } = await supabase
      .from("team_memberships")
      .select("team_id")
      .eq("person_id", personResult.data)
      .is("left_at", null)
      .in("role", STAFF_TEAM_ROLES);
    staffTeamIds = Array.from(new Set((data ?? []).map((row) => row.team_id)));
  }
  if (!canAdmin && staffTeamIds.length === 0) {
    // In the coach view an admin with no coached team gets sent back to their
    // role picker rather than a booking page they did not ask for. A parent or
    // a player has no business on this screen at all — their teams live on the
    // lobby, which is that view's own home — and only the function room keeps
    // the diary it used to land on.
    if (coachView && (committee || clubAdmin)) redirect("/welcome");
    redirect(view === "function_room" ? "/room-bookings" : "/lobby");
  }

  // `teams_read` is open to any signed-in user, so the caller's own client is
  // enough — the admin client is kept for the two admin-only reads below.
  let teamsQuery = supabase
    .from("teams")
    .select("id,name,age_group,gender,active,home_resource_id,league,division");
  if (!canAdmin) teamsQuery = teamsQuery.in("id", staffTeamIds);

  const [teamsResult, seasonsResult] = await Promise.all([
    teamsQuery,
    supabase.from("seasons").select("id,name,starts_on,ends_on,is_current").order("starts_on", {
      ascending: false,
    }),
  ]);

  const teamRows = teamsResult.data ?? [];
  const seasons = seasonsResult.data ?? [];
  const teamIds = teamRows.map((team) => team.id);

  // Counts and pitch names for the teams already on screen. Memberships are
  // read as the caller too: `_admin_read` answers for an administrator,
  // `_staff_read` for a coach reading their own team.
  const pitchIds = Array.from(
    new Set(teamRows.map((team) => team.home_resource_id).filter((id): id is string => !!id)),
  );

  // `team_fulltime_links` and `site_settings` are club-admin-only, and the
  // link state is an administrator's concern — a coach never pays for either.
  const adminClient = canAdmin ? createAdminClient() : null;
  const [memberships, pitches, links, clubCodeRows, upcomingFixtures, subscriptionRows] =
    await Promise.all([
    teamIds.length > 0
      ? supabase
          .from("team_memberships")
          .select("team_id,person_id,role")
          .in("team_id", teamIds)
          .is("left_at", null)
          .then((result) => result.data ?? [])
      : Promise.resolve([]),
    pitchIds.length > 0
      ? supabase
          .from("resources")
          .select("id,name")
          .in("id", pitchIds)
          .then((result) => result.data ?? [])
      : Promise.resolve([]),
    adminClient
      ? adminClient
          .from("team_fulltime_links")
          .select("team_id,enabled,last_import_status,last_import_at,last_import_count,last_error")
          .then((result) => (result.data ?? []) as FullTimeLinkSummary[])
      : Promise.resolve([] as FullTimeLinkSummary[]),
    adminClient
      ? adminClient
          .from("site_settings")
          .select("key,value")
          .in("key", ["fulltime_club_fixtures_code", "fulltime_club_results_code"])
          .then((result) => result.data ?? [])
      : Promise.resolve([] as { key: string; value: string | null }[]),
    // The table's Next-out column: the earliest upcoming fixture per team.
    teamIds.length > 0
      ? supabase
          .from("fixtures")
          .select("team_id,kickoff_at,opponent,is_home,booking_id,resources!fixtures_venue_resource_id_fkey(name)")
          .in("team_id", teamIds)
          .eq("status", "scheduled")
          .gte("kickoff_at", nowIso)
          .order("kickoff_at")
          .then((result) => result.data ?? [])
      : Promise.resolve([]),
    // The Subs pill. Owing = a live past_due subscription; a squad with no
    // subscriptions at all shows an em-dash rather than claiming "All paid".
    adminClient
      ? adminClient
          .from("subscriptions")
          .select("person_id,status")
          .in("status", ["active", "past_due", "pending"])
          .then((result) => result.data ?? [])
      : Promise.resolve([] as { person_id: string; status: string }[]),
  ]);

  // Staff names need the people rows behind the staff memberships — a second
  // hop because the ids only exist once the memberships are in hand.
  const staffPersonIds = Array.from(
    new Set(
      memberships
        .filter((row) => STAFF_TEAM_ROLES.includes(row.role))
        .map((row) => row.person_id),
    ),
  );
  const staffPeople =
    staffPersonIds.length > 0
      ? await supabase
          .from("people")
          .select("id,first_name,last_name")
          .in("id", staffPersonIds)
          .then((result) => result.data ?? [])
      : [];

  const pitchNames = new Map(pitches.map((row) => [row.id, row.name]));
  const linkByTeam = new Map(links.map((link) => [link.team_id, link]));
  const clubCodes = new Map(clubCodeRows.map((row) => [row.key, row.value]));

  // Which teams the club-wide widgets are feeding. A club-feed team has no
  // `team_fulltime_links` row — its record is `fixture_import_runs` rows whose
  // source is a club widget URL, so the latest of those is its badge state.
  // Codes are split from the settings exactly as `fulltime_club_codes()` does.
  const clubWidgetUrls = Array.from(
    new Set(
      clubCodeRows
        .flatMap((row) => (row.value ?? "").split(/[^0-9]+/))
        .filter((code) => /^[0-9]{6,12}$/.test(code))
        .map((code) => widgetUrl(code)),
    ),
  );
  const clubRunByTeam = new Map<string, ClubRunSummary>();
  if (adminClient && clubWidgetUrls.length > 0 && teamIds.length > 0) {
    const { data: clubRuns } = await adminClient
      .from("fixture_import_runs")
      .select("team_id,status,created_at,inserted,updated,unchanged,error")
      .in("team_id", teamIds)
      .in("source_url", clubWidgetUrls)
      .order("created_at", { ascending: false })
      .limit(300);
    for (const run of (clubRuns ?? []) as ClubRunSummary[]) {
      if (!clubRunByTeam.has(run.team_id)) clubRunByTeam.set(run.team_id, run);
    }
  }
  const personName = new Map(
    staffPeople.map((person) => [
      person.id,
      `${person.first_name ?? ""} ${person.last_name ?? ""}`.trim(),
    ]),
  );

  const playerIds = new Map<string, Set<string>>();
  const managerBy = new Map<string, string>();
  const coachBy = new Map<string, string>();
  const staffIds = new Map<string, Set<string>>();
  for (const row of memberships) {
    if (row.role === "player") {
      if (!playerIds.has(row.team_id)) playerIds.set(row.team_id, new Set());
      playerIds.get(row.team_id)?.add(row.person_id);
    }
    if (STAFF_TEAM_ROLES.includes(row.role)) {
      if (!staffIds.has(row.team_id)) staffIds.set(row.team_id, new Set());
      staffIds.get(row.team_id)?.add(row.person_id);
      // The name on the Staff cell: the manager, else the (head) coach.
      if (row.role === "manager" && !managerBy.has(row.team_id)) {
        managerBy.set(row.team_id, row.person_id);
      }
      if (row.role === "coach" && !coachBy.has(row.team_id)) {
        coachBy.set(row.team_id, row.person_id);
      }
    }
  }

  // Earliest upcoming fixture per team — rows arrive kickoff-ordered.
  const nextFixture = new Map<string, (typeof upcomingFixtures)[number]>();
  for (const fixture of upcomingFixtures) {
    if (!nextFixture.has(fixture.team_id)) nextFixture.set(fixture.team_id, fixture);
  }

  const owingPeople = new Set(
    subscriptionRows.filter((row) => row.status === "past_due").map((row) => row.person_id),
  );
  const subscribedPeople = new Set(subscriptionRows.map((row) => row.person_id));

  // Which roles the non-lead staff hold, for the "+ N assistants" wording.
  const rolesByTeamPerson = new Map<string, string>();
  for (const row of memberships) {
    if (STAFF_TEAM_ROLES.includes(row.role)) {
      rolesByTeamPerson.set(`${row.team_id}:${row.person_id}`, row.role);
    }
  }

  const allTeams: TeamCard[] = teamRows
    .map((team) => {
      const players = playerIds.get(team.id) ?? new Set<string>();
      const staff = staffIds.get(team.id) ?? new Set<string>();
      // The design's Staff cell: the manager (else the head coach) by name,
      // everyone else condensed to a count — "+ 2 assistants" / "+ 1 coach".
      const lead = managerBy.get(team.id) ?? coachBy.get(team.id) ?? null;
      const fixture = nextFixture.get(team.id) ?? null;
      const squadSubscribed = Array.from(players).some((id) => subscribedPeople.has(id));
      const rest = Array.from(staff).filter((personId) => personId !== lead);
      const restRoles = rest.map(
        (personId) => rolesByTeamPerson.get(`${team.id}:${personId}`) ?? "coach",
      );
      return {
        id: team.id,
        name: team.name,
        ageGroup: team.age_group,
        gender: team.gender,
        active: team.active,
        homePitch: team.home_resource_id ? pitchNames.get(team.home_resource_id) ?? null : null,
        league: team.league,
        division: team.division,
        players: players.size,
        lead: lead ? personName.get(lead) ?? "Club member" : null,
        others: rest.length,
        othersWord: restRoles.some((role) => role === "assistant_coach")
          ? "assistant"
          : "coach",
        nextOut: fixture
          ? {
              when: kickoffShort(fixture.kickoff_at),
              opponent: fixture.opponent,
              home: fixture.is_home,
              pitch: fixture.resources?.name ?? null,
              unallocated: fixture.is_home && fixture.booking_id === null,
            }
          : null,
        subsOwing: squadSubscribed
          ? Array.from(players).filter((id) => owingPeople.has(id)).length
          : null,
      };
    })
    .sort(compareTeams);

  const currentSeason = seasons.find((season) => season.is_current) ?? null;
  const loadError = teamsResult.error ?? seasonsResult.error;

  // The header eyebrow: "31 teams · 612 players" — active teams, distinct
  // live players across them.
  const activeTeams = allTeams.filter((team) => team.active);
  const distinctPlayers = new Set<string>();
  for (const team of activeTeams) {
    for (const personId of playerIds.get(team.id) ?? []) distinctPlayers.add(personId);
  }

  // The Formats & rules tab wants every active pitch by name.
  const allPitches = formatsTab
    ? await supabase
        .from("resources")
        .select("id,name")
        .eq("type", "pitch")
        .eq("active", true)
        .order("sort_order")
        .order("name")
        .then((result) => result.data ?? [])
    : [];

  return (
    <>
      <PageHeader
        title="Teams"
        subtitle={
          canAdmin
            ? `${activeTeams.length} teams · ${distinctPlayers.size} players`
            : "The teams you help run — open one to see its members, fixtures and pitches"
        }
      />
      <div className="space-y-6 p-4 lg:p-6">
        {/* The design's two sub-tabs: the list, and the FA formats reference.
            They scroll rather than wrap on a phone (mobile design). */}
        <div className="-mx-4 flex gap-6 overflow-x-auto whitespace-nowrap border-b px-4 lg:mx-0 lg:px-0">
          {[
            { href: "/teams", label: "All teams", active: !formatsTab },
            { href: "/teams?tab=formats", label: "Formats & rules", active: formatsTab },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={
                "-mb-px flex min-h-[44px] shrink-0 items-center border-b-2 pb-2.5 text-sm transition-colors lg:block lg:min-h-0 " +
                (item.active
                  ? "border-primary font-semibold text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground")
              }
            >
              {item.label}
            </Link>
          ))}
        </div>
        {saved && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {saved === "season" ? "Season saved." : "Team saved."}
          </div>
        )}
        {errorParam && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {errorParam}
          </div>
        )}
        {loadError && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Could not load teams and seasons.
          </div>
        )}

        {formatsTab && (
          <FormatsPanel
            teams={allTeams.map((team) => ({
              id: team.id,
              name: team.name,
              ageGroup: team.ageGroup,
              active: team.active,
            }))}
            pitches={allPitches}
          />
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Find a team — the box filters as you type (client-side over the  */}
        {/* server-rendered cards), and the URL keeps up so the view shares. */}
        {/* ---------------------------------------------------------------- */}
        {!formatsTab && (
        <TeamFilterGrid
          initialQuery={query}
          initialShowAll={showAll}
          noTeamsMessage={
            canAdmin
              ? "No teams yet. Use “New team” to add the first one."
              : "You are not listed as staff on any team yet."
          }
          actions={
            canAdmin ? (
              <details className="group">
                <summary className="flex min-h-[44px] w-full cursor-pointer list-none [&::-webkit-details-marker]:hidden items-center justify-center gap-2 whitespace-nowrap rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 lg:inline-flex lg:min-h-0 lg:w-auto">
                  <Plus className="h-4 w-4" /> New team
                </summary>
                <Card className="mt-3 w-full sm:w-96">
                  <CardContent className="pt-6">
                    <form action={createTeam} className="space-y-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="team-name">Team name *</Label>
                        <Input
                          id="team-name"
                          name="name"
                          placeholder="e.g. AoM FC First Team"
                          required
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="team-age">Age group</Label>
                        <Input
                          id="team-age"
                          name="age_group"
                          placeholder="e.g. Under 12s, Open age"
                        />
                      </div>
                      <Button type="submit">
                        <Plus className="h-3.5 w-3.5" /> Create team
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              </details>
            ) : null
          }
          head={
            <tr>
              <th className="px-4 py-2.5 font-medium">Team</th>
              <th className="px-4 py-2.5 font-medium">
                Format
                <span className="block font-normal normal-case tracking-normal text-muted-foreground/80">
                  from age group
                </span>
              </th>
              <th className="px-4 py-2.5 font-medium">Staff</th>
              <th className="px-4 py-2.5 font-medium">Squad</th>
              <th className="px-4 py-2.5 font-medium">Next out</th>
              {canAdmin && <th className="px-4 py-2.5 font-medium">Subs</th>}
            </tr>
          }
          footerNote="Format is read from the age group, not stored per team"
          items={allTeams.map((team): TeamFilterItem => {
            const ft = canAdmin
              ? fullTimeState(
                  linkByTeam.get(team.id),
                  clubRunByTeam.get(team.id),
                  clubWidgetUrls.length > 0,
                )
              : null;
            const needsStaff = team.lead === null && team.others === 0;
            const rules = faFormatFor(team.ageGroup);
            return {
              key: team.id,
              haystack: `${team.name} ${team.ageGroup ?? ""} ${team.league ?? ""} ${
                team.division ?? ""
              }`.toLocaleLowerCase("en-GB"),
              active: team.active,
              needsStaff,
              row: (
                <tr className={"transition-colors hover:bg-secondary/40" + (team.active ? "" : " opacity-60")}>
                  <td className="px-4 py-3 align-top">
                    <Link
                      href={`/teams/${team.id}`}
                      className="font-semibold leading-tight hover:underline"
                    >
                      {team.name}
                      <ChevronRight className="ml-0.5 inline h-3.5 w-3.5 text-muted-foreground" />
                    </Link>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                      {team.ageGroup ?? "No age group"}
                      {team.gender ? <> · {GENDER_LABELS[team.gender] ?? team.gender}</> : null}
                      {team.league ? (
                        <>
                          {" · "}
                          {team.league}
                          {team.division ? `, ${team.division}` : ""}
                        </>
                      ) : null}
                      {!team.active && <Badge variant="muted">Inactive</Badge>}
                      {ft && (
                        <span className="inline-flex items-center gap-1" title={ft.detail}>
                          <span className={`h-2 w-2 shrink-0 rounded-full ${ft.dot}`} aria-hidden />
                          {ft.label}
                        </span>
                      )}
                    </p>
                  </td>
                  <td className="px-4 py-3 align-top">
                    {rules ? (
                      <>
                        <p>{rules.format}</p>
                        <p className="text-xs text-muted-foreground">{faFormatDetail(rules)}</p>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top">
                    {team.lead !== null || team.others > 0 ? (
                      <>
                        {team.lead !== null ? (
                          <p>{team.lead}</p>
                        ) : (
                          <p className="font-medium text-primary">No manager</p>
                        )}
                        {team.others > 0 && (
                          <p className="text-xs text-muted-foreground">
                            {team.lead !== null ? "+ " : ""}
                            {team.others} {team.othersWord}
                            {team.others === 1 ? "" : team.othersWord === "coach" ? "es" : "s"}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="font-medium text-primary">No staff</p>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top">{team.players}</td>
                  <td className="px-4 py-3 align-top">
                    {team.nextOut ? (
                      <>
                        <p>{team.nextOut.when}</p>
                        <p className="text-xs text-muted-foreground">
                          v {team.nextOut.opponent}
                          {team.nextOut.unallocated ? (
                            <span className="ml-1 font-medium text-amber-700">no pitch yet</span>
                          ) : team.nextOut.home && team.nextOut.pitch ? (
                            <> · {team.nextOut.pitch}</>
                          ) : team.nextOut.home ? null : (
                            <> · away</>
                          )}
                        </p>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  {canAdmin && (
                    <td className="px-4 py-3 align-top">
                      {team.subsOwing === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : team.subsOwing === 0 ? (
                        <Badge variant="success">All paid</Badge>
                      ) : team.subsOwing >= 5 ? (
                        <Badge variant="destructive">{team.subsOwing} owing</Badge>
                      ) : (
                        <Badge variant="warning">{team.subsOwing} owing</Badge>
                      )}
                    </td>
                  )}
                </tr>
              ),
              // The same team on a phone: name and chevron, the format line
              // underneath, staff and squad, then next out and the pills
              // (mobile design — a dense table becomes a stack of cards).
              card: (
                <Link
                  href={`/teams/${team.id}`}
                  className={
                    "flex min-h-[44px] items-start gap-3 px-4 py-3.5" +
                    (team.active ? "" : " opacity-60")
                  }
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold leading-tight">{team.name}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {team.ageGroup ?? "No age group"}
                      {team.gender ? ` · ${GENDER_LABELS[team.gender] ?? team.gender}` : ""}
                      {rules ? ` · ${rules.format}` : ""}
                      {team.league
                        ? ` · ${team.league}${team.division ? `, ${team.division}` : ""}`
                        : ""}
                    </span>
                    <span className="mt-1.5 block text-xs">
                      {team.lead !== null ? (
                        <span>{team.lead}</span>
                      ) : (
                        <span className="font-medium text-primary">
                          {team.others > 0 ? "No manager" : "No staff"}
                        </span>
                      )}
                      {team.others > 0 && (
                        <span className="text-muted-foreground">
                          {team.lead !== null ? " + " : " · "}
                          {team.others} {team.othersWord}
                          {team.others === 1 ? "" : team.othersWord === "coach" ? "es" : "s"}
                        </span>
                      )}
                      <span className="text-muted-foreground">
                        {" · "}
                        {team.players} {team.players === 1 ? "player" : "players"}
                      </span>
                    </span>
                    {team.nextOut && (
                      <span className="mt-1 block text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{team.nextOut.when}</span>
                        {` · v ${team.nextOut.opponent}`}
                        {team.nextOut.unallocated ? (
                          <span className="ml-1 font-medium text-amber-700">no pitch yet</span>
                        ) : team.nextOut.home && team.nextOut.pitch ? (
                          ` · ${team.nextOut.pitch}`
                        ) : team.nextOut.home ? null : (
                          " · away"
                        )}
                      </span>
                    )}
                    <span className="mt-2 flex flex-wrap items-center gap-1.5">
                      {!team.active && <Badge variant="muted">Inactive</Badge>}
                      {canAdmin && team.subsOwing !== null && (
                        team.subsOwing === 0 ? (
                          <Badge variant="success">All paid</Badge>
                        ) : team.subsOwing >= 5 ? (
                          <Badge variant="destructive">{team.subsOwing} owing</Badge>
                        ) : (
                          <Badge variant="warning">{team.subsOwing} owing</Badge>
                        )
                      )}
                      {ft && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                          <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${ft.dot}`}
                            aria-hidden
                          />
                          {ft.label}
                        </span>
                      )}
                    </span>
                  </span>
                  <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              ),
            };
          })}
        />
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Season toolbar — administrators only                             */}
        {/* ---------------------------------------------------------------- */}
        {!formatsTab && canAdmin && (
          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Season</p>
                  <p className="text-xs text-muted-foreground">
                    {currentSeason
                      ? `${currentSeason.name} · ${formatBookingDateShort(
                          currentSeason.starts_on,
                        )} – ${formatBookingDateShort(currentSeason.ends_on)}`
                      : "No current season. Fixtures and rosters need one."}
                  </p>
                </div>
                {seasons.length > 0 && (
                  <form action={setCurrentSeason} className="flex flex-wrap items-center gap-2">
                    <Label htmlFor="current-season" className="sr-only">
                      Current season
                    </Label>
                    <Select
                      id="current-season"
                      name="season_id"
                      defaultValue={currentSeason?.id ?? seasons[0]?.id}
                      className="w-auto min-w-[10rem]"
                    >
                      {seasons.map((season) => (
                        <option key={season.id} value={season.id}>
                          {season.name} · {formatBookingDateShort(season.starts_on)} –{" "}
                          {formatBookingDateShort(season.ends_on)}
                          {season.is_current ? " (current)" : ""}
                        </option>
                      ))}
                    </Select>
                    <Button type="submit" variant="outline" size="sm">
                      Make current
                    </Button>
                  </form>
                )}
                <Link
                  href="/teams/end-of-season"
                  className="ml-auto inline-flex min-h-[44px] items-center text-sm font-medium text-primary underline-offset-4 hover:underline lg:min-h-0"
                >
                  End of season…
                </Link>
                <details>
                  <summary className="flex min-h-[44px] cursor-pointer list-none [&::-webkit-details-marker]:hidden items-center text-sm font-medium text-primary underline-offset-4 hover:underline lg:min-h-0">
                    Add a season
                  </summary>
                  <form action={createSeason} className="mt-4 space-y-4">
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="season-name">Name *</Label>
                        <Input id="season-name" name="name" placeholder="e.g. 2026/27" required />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="season-start">Starts on *</Label>
                        <Input id="season-start" name="starts_on" type="date" required />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="season-end">Ends on *</Label>
                        <Input id="season-end" name="ends_on" type="date" required />
                      </div>
                    </div>
                    <Button type="submit">
                      <Plus className="h-3.5 w-3.5" /> Create season
                    </Button>
                  </form>
                </details>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Club-wide Full-Time widgets — administrators only                */}
        {/* ---------------------------------------------------------------- */}
        {!formatsTab && canAdmin && (
          <Card>
            <CardContent className="pt-6">
              <details>
                <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                  <CardTitle className="text-base">Club Full-Time widgets</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    One pair of codes for the whole club: Full-Time&apos;s club <em>fixtures</em>{" "}
                    and club <em>results</em> widgets. Every active team is matched by name and
                    imported nightly — no per-team setup. A team with its own Full-Time link keeps
                    that instead.
                  </p>
                </summary>
                <div className="pt-4">
                  <ClubWidgetsPanel
                    fixturesCode={clubCodes.get("fulltime_club_fixtures_code") ?? null}
                    resultsCode={clubCodes.get("fulltime_club_results_code") ?? null}
                  />
                </div>
              </details>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
