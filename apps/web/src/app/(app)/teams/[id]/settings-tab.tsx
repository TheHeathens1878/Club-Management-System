import Link from "next/link";
import { CalendarClock, CalendarRange, Download, LandPlot, Link2, Power } from "lucide-react";

import type { Database } from "@club/db";

import { contextHref } from "@/lib/destinations";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { FoldCard } from "@/components/ui/fold-card";
import { faFormatFor } from "@/lib/fa-formats";
import {
  teamSettingsSummaries,
  type TeamHomeFixtures,
  type TeamImportRun,
} from "@/lib/team-next-action";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { createClient } from "@/lib/supabase/server";

import { setTeamActive } from "../actions";
import { AllocateAllPanel } from "./allocate-all-panel";
import { FullTimePanel, type ClubSeasonView, type FullTimeLinkView } from "./fulltime-panel";
import { ManualImportPanel, type ImportRunView } from "./import-panel";
import { MatchDayPanel, type MatchDayPitch } from "./matchday-panel";
import { TrainingDayCard } from "./training-day-card";

/**
 * The Settings tab: six rows that say what they are set to (P8.7a).
 *
 * It used to be six open `Card`s stacked down the page, so finding the
 * kick-off time meant scrolling past the Full-Time snippet box and ten import
 * runs. Now each is a `FoldCard` whose CLOSED row states its own setting —
 * "Banky Lane 1 · 10:30 · 2 × 35 min · 9v9", "Tuesdays", "Not linked" — so a
 * coach reads all six without opening any, and opens the one that says
 * something they did not expect.
 *
 * The summaries are computed on the server by `teamSettingsSummaries()`, a
 * pure function with its own tests. Nothing inside the folds changed: the
 * five panels are the panels, with the same props, the same server actions
 * and the same gates they have always carried.
 *
 * WHO SEES WHAT. `staffTools` admits a reader to the tab at all (Adam,
 * 2026-09-13: "coaches to have the ability to post their code snippet in
 * team settings"); `committeeTools` keeps Training, Manual import and Team
 * status; `allocationTools` keeps the home pitch and Allocate the season
 * (Adam, 2026-08-25: "make sure coaches cannot assign pitches"). A fold a
 * hat may not use is not rendered — except Match day, which a coach reads
 * with its fields locked, and the signpost above says where they went.
 */

/** Enough import history to see a pattern without becoming a log viewer. */
const RUN_LIMIT = 10;

type UserClient = Awaited<ReturnType<typeof createClient>>;
type AdminClient = ReturnType<typeof createAdminClient>;

export type SettingsTabData = {
  clubSeasons: ClubSeasonView[];
  currentSeason: ClubSeasonView | null;
  defaultFtName: string;
  runs: ImportRunView[];
  /** How much of the season is still to place, for the Allocate summary. */
  homeFixtures: TeamHomeFixtures;
};

export const EMPTY_SETTINGS: SettingsTabData = {
  clubSeasons: [],
  currentSeason: null,
  defaultFtName: "",
  runs: [],
  homeFixtures: { total: 0, unplaced: 0 },
};

/**
 * The committee's feed machinery: the club's seasons, the importer's run
 * history and the name Full-Time is likely to know this team by. Moved out of
 * `page.tsx` whole (P8.7a) — not one query changed.
 *
 * The one addition is the home-fixture count, which is what makes the
 * Allocate fold's closed row say "14 home fixtures, 9 unplaced" instead of
 * repeating its own title. Read as the caller, from `fixtures` — the same
 * table and the same policies the Overview tab reads.
 */
export async function loadSettingsTab({
  userClient,
  admin,
  teamId,
  teamName,
  nowIso,
}: {
  userClient: UserClient;
  admin: AdminClient;
  teamId: string;
  teamName: string;
  nowIso: string;
}): Promise<SettingsTabData> {
  const [seasonsResult, runRows, clubNameResult, homeResult] = await Promise.all([
    userClient.from("seasons").select("id,name,is_current").order("starts_on", { ascending: false }),
    admin
      .from("fixture_import_runs")
      .select("id,trigger,status,inserted,updated,unchanged,retired,kept_back,error,source_url,created_at")
      .eq("team_id", teamId)
      .order("created_at", { ascending: false })
      .limit(RUN_LIMIT)
      .then((result) => result.data ?? []),
    admin.from("site_settings").select("value").eq("key", "fulltime_club_name").maybeSingle(),
    userClient
      .from("fixtures")
      .select("id,booking_id")
      .eq("team_id", teamId)
      .eq("is_home", true)
      .eq("status", "scheduled")
      .gte("kickoff_at", nowIso),
  ]);

  const clubSeasons = (seasonsResult.data ?? []).map((season) => ({
    id: season.id,
    name: season.name,
    is_current: season.is_current,
  }));

  const home = homeResult.data ?? [];

  return {
    clubSeasons,
    currentSeason: clubSeasons.find((season) => season.is_current) ?? null,
    defaultFtName: `${(clubNameResult.data?.value ?? "").trim() || "Ashton On Mersey FC"} ${teamName}`,
    runs: runRows.map((run) => ({
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
    })),
    homeFixtures: {
      total: home.length,
      unplaced: home.filter((row) => !row.booking_id).length,
    },
  };
}

/**
 * The `teams` columns these six folds read. A `Pick` of the row itself rather
 * than a hand-written shape, so a column that changes nullability in the
 * schema is a type error here and not a surprise in a panel.
 */
export type SettingsTeam = Pick<
  Database["public"]["Tables"]["teams"]["Row"],
  | "id"
  | "name"
  | "age_group"
  | "active"
  | "playing_format"
  | "home_resource_id"
  | "home_kickoff_time"
  | "central_venue_name"
  | "league"
  | "division"
  | "match_halves"
  | "half_length_minutes"
  | "half_time_minutes"
  | "default_pre_buffer_minutes"
  | "default_post_buffer_minutes"
  | "default_training_day"
>;

export function SettingsTab({
  team,
  data,
  link,
  pitches,
  homePitchName,
  allocationTools,
  committeeTools,
  clubAdmin,
}: {
  team: SettingsTeam;
  data: SettingsTabData;
  link: FullTimeLinkView | null;
  pitches: MatchDayPitch[];
  /** The name behind `home_resource_id`, resolved by the page. */
  homePitchName: string | null;
  allocationTools: boolean;
  committeeTools: boolean;
  clubAdmin: boolean;
}) {
  const lastImport: TeamImportRun | null = data.runs[0]
    ? {
        createdAt: data.runs[0].created_at,
        inserted: data.runs[0].inserted ?? 0,
        updated: data.runs[0].updated ?? 0,
      }
    : null;

  const summaries = teamSettingsSummaries(
    {
      name: team.name,
      ageGroup: team.age_group,
      playingFormat: team.playing_format,
      homePitchName,
      homeKickoffTime: team.home_kickoff_time,
      centralVenueName: team.central_venue_name,
      matchHalves: team.match_halves,
      halfLengthMinutes: team.half_length_minutes,
      defaultTrainingDay: team.default_training_day,
      active: team.active,
    },
    link
      ? {
          ftTeamName: link.ft_team_name,
          enabled: link.enabled,
          lastImportAt: link.last_import_at,
          lastImportCount: link.last_import_count,
        }
      : null,
    lastImport,
    data.homeFixtures,
  );

  return (
    <div className="space-y-2">
      {/* The home pitch and "Allocate the season" are the admin hat's (Adam,
          2026-08-25: "make sure coaches cannot assign pitches"). A committee
          member wearing the coach hat lands here and finds them read-only, so
          say where they went (Adam, 2026-09-08: "How do I allocate a pitch to
          a team … It used to be in team settings"). It stays ABOVE the folds:
          a signpost inside a fold is a signpost nobody reads. */}
      {!allocationTools ? (
        <Callout tone="info" className="mb-4">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              The home pitch, kick-off and &ldquo;Allocate the season&rdquo; are set under Club
              administration.
            </span>
            <Link
              href={contextHref({ view: "admin" }, `/teams/${team.id}?tab=settings`)}
              className="touch inline-flex items-center font-medium underline underline-offset-2"
            >
              Open these settings as Club administration
            </Link>
          </span>
        </Callout>
      ) : null}

      {/* Where this team plays and how long a match takes. Written through
          the caller's own client, so `teams_staff_update` lets a coach
          maintain it and `trg_teams_home_resource_guard` is what refuses a
          home resource that is not a pitch. */}
      <FoldCard
        icon={<CalendarClock className="h-4 w-4" aria-hidden />}
        title="Match day"
        summary={summaries.matchDay}
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            The team&apos;s home pitch and the shape of its matches. Allocating a home fixture on{" "}
            <Link href="/pitches" className="touch inline-flex items-center underline underline-offset-2">
              Pitches
            </Link>{" "}
            starts from the home pitch, and the halves and half time give new fixtures their pitch
            slot in place of the club&apos;s standard 90 minutes.
          </p>
          <MatchDayPanel
            teamId={team.id}
            canEdit={allocationTools}
            canRename={clubAdmin}
            pitches={pitches}
            values={{
              name: team.name,
              playing_format: team.playing_format,
              derived_format: faFormatFor(team.age_group)?.format ?? null,
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
        </div>
      </FoldCard>

      {/* Which evening the team trains (2026-09-13): what the training
          planner offers first for that day. The club's to set, like the home
          pitch; the bulk version is the ticks bar on the Teams table. */}
      {committeeTools ? (
        <FoldCard
          icon={<CalendarRange className="h-4 w-4" aria-hidden />}
          title="Training evening"
          summary={summaries.trainingEvening}
        >
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              The evening this team usually trains. The winter training planner offers a day&apos;s
              teams first, so a Tuesday team lands on a Tuesday slot.
            </p>
            <TrainingDayCard teamId={team.id} trainingDay={team.default_training_day} />
          </div>
        </FoldCard>
      ) : null}

      {/* The whole season in one go: every future home fixture onto one pitch
          at one kick-off — or, for a central-venue team, every fixture
          pointed at the league's venue and our pitches freed. The RPCs are
          club_admin-only; committee holds that through the profiles →
          person_roles sync. */}
      {allocationTools ? (
        <FoldCard
          icon={<LandPlot className="h-4 w-4" aria-hidden />}
          title={team.central_venue_name ? "Central venue" : "Allocate the season"}
          summary={summaries.season}
        >
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {team.central_venue_name
                ? `${team.name} plays at ${team.central_venue_name}, which the club does not manage — its fixtures never occupy our pitch calendar.`
                : "Put every future home fixture on a pitch in one go, starting from the team's saved defaults. Individual fixtures can still be moved afterwards on the Pitches screen."}
            </p>
            <AllocateAllPanel
              teamId={team.id}
              pitches={pitches}
              homeResourceId={team.home_resource_id}
              homeKickoffTime={team.home_kickoff_time}
              centralVenueName={team.central_venue_name}
            />
          </div>
        </FoldCard>
      ) : null}

      <FoldCard
        icon={<Link2 className="h-4 w-4" aria-hidden />}
        title="FA Full-Time link"
        summary={summaries.fullTime}
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            The FA publishes no fixtures API, so fixtures and results are read from the team&apos;s
            Full-Time code snippet. Copy it from Full-Time admin (the steps are below), paste it,
            preview what the parser reads, then save. Imports run nightly; re-linking for a new
            season updates this link and keeps the fixtures already imported.
          </p>
          <FullTimePanel
            teamId={team.id}
            teamName={team.name}
            defaultFtName={data.defaultFtName}
            link={link}
            clubSeasons={data.clubSeasons}
          />
        </div>
      </FoldCard>

      {committeeTools ? (
        <FoldCard
          icon={<Download className="h-4 w-4" aria-hidden />}
          title="Manual import &amp; history"
          summary={summaries.imports}
        >
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              The fallback that keeps working when the nightly importer does not: paste a Full-Time
              address, or paste the fixtures as CSV. Either way you see them before anything is
              written, and the import reconciles by fixture reference — reschedules become updates,
              never duplicates.
            </p>
            <ManualImportPanel
              teamId={team.id}
              teamName={team.name}
              ftTeamName={link?.ft_team_name ?? team.name}
              currentSeason={
                data.currentSeason
                  ? { id: data.currentSeason.id, name: data.currentSeason.name }
                  : null
              }
              runs={data.runs}
            />
          </div>
        </FoldCard>
      ) : null}

      {/* Active/inactive moved here from the teams table (the design drops
          that column — the list's "Active only" filter shows the state, this
          is where it changes). */}
      {committeeTools ? (
        <FoldCard
          icon={<Power className="h-4 w-4" aria-hidden />}
          title="Team status"
          summary={summaries.status}
        >
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              An inactive team keeps its history but drops out of the default teams list, the
              rollover and the allocator&apos;s work lists.
            </p>
            <form action={setTeamActive} className="flex items-center gap-3">
              <input type="hidden" name="team_id" value={team.id} />
              <input type="hidden" name="active" value={team.active ? "false" : "true"} />
              <Badge variant={team.active ? "success" : "muted"}>
                {team.active ? "Active" : "Inactive"}
              </Badge>
              <button type="submit" className={buttonVariants({ variant: "outline", size: "touch" })}>
                {team.active ? "Mark inactive" : "Mark active"}
              </button>
            </form>
          </div>
        </FoldCard>
      ) : null}
    </div>
  );
}
