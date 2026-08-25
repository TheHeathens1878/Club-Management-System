import { redirect } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Plus,
} from "lucide-react";

import { getSessionProfile, isCommittee } from "@/lib/auth";
import { getStoredRoleView } from "@/lib/capabilities";
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

import { createSeason, createTeam, setCurrentSeason, setTeamActive } from "./actions";
import { ClubWidgetsPanel } from "./club-widgets-panel";
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

type TeamCard = {
  id: string;
  name: string;
  ageGroup: string | null;
  gender: string | null;
  active: boolean;
  homePitch: string | null;
  members: number;
  staff: number;
};

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
 */
function fullTimeState(link: FullTimeLinkSummary | undefined): {
  dot: string;
  label: string;
  detail: string;
} {
  if (!link) {
    return {
      dot: "bg-muted-foreground/40",
      label: "No Full-Time link",
      detail: "No Full-Time widget saved for this team yet.",
    };
  }

  const when = `Last import ${formatStamp(link.last_import_at)}${
    typeof link.last_import_count === "number" ? ` · ${link.last_import_count} fixtures` : ""
  }`;

  if (!link.enabled) {
    return { dot: "bg-muted-foreground/60", label: "Import paused", detail: when };
  }
  if (link.last_import_status === "ok") {
    return { dot: "bg-emerald-500", label: "Full-Time linked", detail: when };
  }
  if (link.last_import_status === "error") {
    return {
      dot: "bg-destructive",
      label: "Last import failed",
      detail: link.last_error ? `${when}\n${link.last_error}` : when,
    };
  }
  if (link.last_import_status === "challenge") {
    return { dot: "bg-amber-500", label: "Blocked by Cloudflare", detail: when };
  }
  return { dot: "bg-amber-500", label: "Not imported yet", detail: when };
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
  searchParams: Promise<{ saved?: string; error?: string; q?: string; status?: string }>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const { saved, error: errorParam, q, status } = await searchParams;
  const query = (q ?? "").trim();
  const showAll = status === "all";

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
  const [clubAdmin, personResult] = await Promise.all([
    isClubAdmin(),
    supabase.rpc("current_person_id"),
  ]);
  // The active tile scopes the data, not just the menu: an administrator who
  // is also a coach sees ONLY their own teams while in the Coach view
  // ("coaches and managers should only be able to see the teams they are
  // associated with" — Adam, 2026-08-24). Switching to the Admin tile brings
  // the full list back.
  const roleView = await getStoredRoleView();
  const coachView = roleView === "coach";
  const canAdmin = (committee || clubAdmin) && !coachView;

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
    // role picker rather than a booking page they did not ask for.
    redirect(coachView && (committee || clubAdmin) ? "/welcome" : "/room-bookings");
  }

  // `teams_read` is open to any signed-in user, so the caller's own client is
  // enough — the admin client is kept for the two admin-only reads below.
  let teamsQuery = supabase
    .from("teams")
    .select("id,name,age_group,gender,active,home_resource_id");
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
  const [memberships, pitches, links, clubCodeRows] = await Promise.all([
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
  ]);

  const pitchNames = new Map(pitches.map((row) => [row.id, row.name]));
  const linkByTeam = new Map(links.map((link) => [link.team_id, link]));
  const clubCodes = new Map(clubCodeRows.map((row) => [row.key, row.value]));

  const memberIds = new Map<string, Set<string>>();
  const staffIds = new Map<string, Set<string>>();
  for (const row of memberships) {
    if (!memberIds.has(row.team_id)) memberIds.set(row.team_id, new Set());
    memberIds.get(row.team_id)?.add(row.person_id);
    if (STAFF_TEAM_ROLES.includes(row.role)) {
      if (!staffIds.has(row.team_id)) staffIds.set(row.team_id, new Set());
      staffIds.get(row.team_id)?.add(row.person_id);
    }
  }

  const allTeams: TeamCard[] = teamRows
    .map((team) => ({
      id: team.id,
      name: team.name,
      ageGroup: team.age_group,
      gender: team.gender,
      active: team.active,
      homePitch: team.home_resource_id ? pitchNames.get(team.home_resource_id) ?? null : null,
      members: memberIds.get(team.id)?.size ?? 0,
      staff: staffIds.get(team.id)?.size ?? 0,
    }))
    .sort(compareTeams);

  const currentSeason = seasons.find((season) => season.is_current) ?? null;
  const loadError = teamsResult.error ?? seasonsResult.error;

  return (
    <>
      <PageHeader
        title="Teams"
        subtitle={
          canAdmin
            ? "Every team in the club — open one to run it"
            : "The teams you help run — open one to see its members, fixtures and pitches"
        }
      />
      <div className="max-w-5xl space-y-6 p-6">
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

        {/* ---------------------------------------------------------------- */}
        {/* Find a team — the box filters as you type (client-side over the  */}
        {/* server-rendered cards), and the URL keeps up so the view shares. */}
        {/* ---------------------------------------------------------------- */}
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
                <summary className="inline-flex cursor-pointer list-none [&::-webkit-details-marker]:hidden items-center justify-center gap-2 whitespace-nowrap rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90">
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
          items={allTeams.map((team): TeamFilterItem => {
            const ft = canAdmin ? fullTimeState(linkByTeam.get(team.id)) : null;
            return {
              key: team.id,
              haystack: `${team.name} ${team.ageGroup ?? ""}`.toLocaleLowerCase("en-GB"),
              active: team.active,
              card: (
                <div className="relative flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm transition-colors hover:border-primary/40 focus-within:border-primary/40">
                  <div className="min-w-0">
                    {/* The stretched link makes the whole card the target;
                        the active toggle below sits above it on the z-axis so
                        it stays a button, not part of the link. */}
                    <Link
                      href={`/teams/${team.id}`}
                      className="flex items-center gap-1 font-semibold leading-tight after:absolute after:inset-0 after:content-[''] hover:underline"
                    >
                      <span className="truncate">{team.name}</span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </Link>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {team.ageGroup ?? "No age group"}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {team.gender && (
                      <Badge variant="muted">
                        {GENDER_LABELS[team.gender] ?? team.gender}
                      </Badge>
                    )}
                    <Badge variant={team.active ? "success" : "muted"}>
                      {team.active ? "Active" : "Inactive"}
                    </Badge>
                    {team.homePitch && (
                      <Badge variant="outline" className="max-w-[11rem] truncate">
                        {team.homePitch}
                      </Badge>
                    )}
                  </div>

                  <p className="text-xs text-muted-foreground">
                    {team.members} {team.members === 1 ? "member" : "members"} · {team.staff}{" "}
                    {team.staff === 1 ? "coach" : "coaches"}
                  </p>

                  {ft && (
                    <p
                      className="flex items-center gap-1.5 text-xs text-muted-foreground"
                      title={ft.detail}
                    >
                      <span className={`h-2 w-2 shrink-0 rounded-full ${ft.dot}`} aria-hidden />
                      {ft.label}
                    </p>
                  )}

                  {canAdmin && (
                    <form action={setTeamActive} className="relative z-10 mt-auto pt-1">
                      <input type="hidden" name="team_id" value={team.id} />
                      <input type="hidden" name="active" value={team.active ? "false" : "true"} />
                      <Button type="submit" variant="outline" size="sm">
                        {team.active ? "Mark inactive" : "Mark active"}
                      </Button>
                    </form>
                  )}
                </div>
              ),
            };
          })}
        />

        {/* ---------------------------------------------------------------- */}
        {/* Season toolbar — administrators only                             */}
        {/* ---------------------------------------------------------------- */}
        {canAdmin && (
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
                <details className="ml-auto">
                  <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden text-sm font-medium text-primary underline-offset-4 hover:underline">
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
        {canAdmin && (
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
