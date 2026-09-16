import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarPlus, LandPlot } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { ChipStrip } from "@/components/ui/chip-strip";
import { ToggleChipLink } from "@/components/ui/toggle-chip";
import { getCapabilities, getStoredRoleView, getTeamScope } from "@/lib/capabilities";
import { isAdminHat, isMemberView, resolveRoleView } from "@/lib/role-view";
import { formatEventDate, formatEventTime } from "@/app/(app)/events/shared";
import { instantToLocal } from "@/lib/booking-time";
import { matchesNextAction, type FixtureGridTeam } from "@/lib/fixture-grid";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

import { AddFixtureButton } from "./add-fixture-form";
import { MatchesGrid } from "./matches-grid";
import type { DeskRow } from "./types";

/**
 * Matches — the Matchday desk (spec §2). A coach sees their teams, an admin
 * the club; `matchday_fixtures()` does the scoping. Three period tabs, the
 * needs-attention chips, and every fixture opens where it sits.
 *
 * The desk is a GRID (P8.4): a row per team in age order, a column per day in
 * the window, and every fixture on its own card. Everything the page reads —
 * the RPC, its `p_scope`, the central-venue rule below — is unchanged; what
 * changed is that the rows are handed to `lib/fixture-grid.ts`, which is pure,
 * and drawn as a timetable instead of a table. The table itself survives for
 * the printer, where a grid is no use.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Matches" };

const DAY_MS = 86_400_000;

type Period = "weekend" | "month" | "all" | "results";

function periodWindow(period: Period): { from: Date; to: Date } {
  const now = new Date();
  if (period === "results") return { from: new Date(now.getTime() - 28 * DAY_MS), to: now };
  // "All" is every upcoming fixture (Adam, 2026-09-04) — a year forward
  // covers the season however early the imports run ahead.
  if (period === "all") return { from: now, to: new Date(now.getTime() + 365 * DAY_MS) };
  if (period === "weekend") {
    // Through the coming Sunday night — the desk's default question.
    const day = now.getDay();
    const untilMonday = ((8 - day) % 7) + (day === 1 ? 7 : 0);
    return { from: now, to: new Date(now.getTime() + Math.max(untilMonday, 3) * DAY_MS) };
  }
  return { from: now, to: new Date(now.getTime() + 28 * DAY_MS) };
}

export default async function MatchesPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; scope?: string }>;
}) {
  const capabilities = await getCapabilities();
  if (!capabilities.isTeamStaff && !capabilities.isClubAdmin && !capabilities.isCommittee) {
    redirect("/events");
  }

  const params = await searchParams;
  const period: Period =
    params.period === "month"
      ? "month"
      : params.period === "all"
        ? "all"
        : params.period === "results"
          ? "results"
          : "weekend";
  const { from, to } = periodWindow(period);

  // The chosen hat scopes the desk (Adam, 2026-08-25: "I should just be able
  // to see my own team" in the coach view): the RPC answers for everything the
  // caller may see, and the VIEW narrows it — coach → their staffed teams,
  // further narrowed by a team-scoped switcher pick.
  const view = resolveRoleView(await getStoredRoleView(), capabilities);
  const scope = await getTeamScope(view, capabilities);
  const coachTeamIds =
    view === "coach" ? new Set(capabilities.staffTeams.map((team) => team.id)) : null;

  // The desk defaults to the caller's own teams, and anyone who holds a desk
  // at all may widen it to the whole club (Adam, 2026-09-04: "the view should
  // default to the coach's team's matches but they should also be able to
  // view the whole club"). The database enforces the same rule — p_scope
  // 'club' only widens for live team staff, committee and admins — so this
  // flag is presentation, not permission.
  const narrowedByDefault = scope !== null || coachTeamIds !== null;
  const wholeClub = params.scope === "club" && narrowedByDefault;
  const inView = (teamId: string): boolean =>
    wholeClub
      ? true
      : scope
        ? teamId === scope.id
        : coachTeamIds
          ? coachTeamIds.has(teamId)
          : true;

  // The desk's whole management strip is one gate, page-wide (the teams-page
  // lesson): the admin capability, worn as a hat that RUNS the club.
  //
  // `isMemberView()` is the rule (`lib/role-view.ts`) — a capability admits
  // you, the hat is what puts it away. The coach hat is named beside it
  // because on THIS screen it is deliberately a member-ish hat: an admin
  // looking at the fixture desk as a coach is meant to see what a coach sees
  // (Adam, 2026-08-25), and the same rule governs the Allocate door below.
  const runningTheClub = isAdminHat(view);
  const canManage = capabilities.isClubAdmin && runningTheClub;

  const supabase = await createClient();
  const adminDb = createAdminClient();
  const [{ data, error }, teamVenuesResult, pitchesResult] = await Promise.all([
    supabase.rpc("matchday_fixtures", {
      p_from: from.toISOString(),
      p_to: to.toISOString(),
      ...(wholeClub ? { p_scope: "club" } : {}),
    }),
    // Which teams play at a central venue (their "home" needs no pitch),
    // each team's age group (the desk's age-order sort), names for the
    // Add-a-fixture picker, and which venue each pitch belongs to for
    // honest Pitch/Venue columns.
    adminDb.from("teams").select("id,name,active,central_venue_name,age_group"),
    adminDb
      .from("resources")
      .select("id,name,venues(name)")
      .neq("type", "function_room")
      .eq("for_matches", true)
      .eq("active", true)
      .order("sort_order")
      .order("name"),
  ]);
  // Every status stays on the desk (Adam, 2026-09-14: "I need the ability to
  // delete matches (as admin) which also deletes the event" — the matches he
  // had cancelled that morning had vanished from the upcoming views, so there
  // was nothing left to tick). A cancelled or postponed match shows its
  // status and can be ticked and deleted like any other; only the attention
  // counts below are scheduled-only, because a cancelled match needs neither
  // a pitch nor a squad.
  const fixtures = (data ?? []).filter((row) => inView(row.team_id));

  const centralVenue = new Map(
    (teamVenuesResult.data ?? []).map((team) => [team.id, (team.central_venue_name ?? "").trim()]),
  );
  const playsCentrally = (teamId: string): string => centralVenue.get(teamId) ?? "";
  const ageGroupByTeam = new Map(
    (teamVenuesResult.data ?? []).map((team) => [team.id, team.age_group]),
  );
  const pitchRows = pitchesResult.data ?? [];
  const venueByPitch = new Map(pitchRows.map((row) => [row.name, row.venues?.name ?? null]));

  // Who the caller may add a fixture FOR (Adam, 2026-09-04: "I need to be
  // able to add it directly from there"): an admin hat gets every active
  // team, a coach their own — the same people `fixtures_staff_insert` will
  // say yes to. Anyone else keeps the old door to the team pages.
  const addableTeams = canManage
    ? (teamVenuesResult.data ?? [])
        .filter((team) => team.active)
        .map(({ id, name }) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name, "en-GB"))
    : view === "coach" || capabilities.isTeamStaff
      ? capabilities.staffTeams.map(({ id, name }) => ({ id, name }))
      : [];

  // The desk's rows, formatted once on the server: London wall clock for the
  // display strings, the ISO day for the date-range filter, and one honest
  // word for the pitch column.
  const deskRows: DeskRow[] = fixtures.map((row) => {
    const local = instantToLocal(row.kickoff_at);
    // A central-venue team's home game is not waiting for a pitch: it shows
    // where it is actually played — the fixture's own venue text first
    // ("…PLATT LANE… Pitch 1"), the standing central venue otherwise — never
    // an amber "Unallocated" (Adam, 2026-09-04: "put the venue from the
    // fixtures in all relevant places").
    const central = row.is_home ? playsCentrally(row.team_id) : "";
    const pitch = !row.is_home
      ? "Away"
      : central !== ""
        ? row.venue_text?.trim() || central
        : row.pitch_name ?? "Unallocated";
    return {
      id: row.fixture_id,
      eventId: row.event_id,
      teamId: row.team_id,
      teamName: row.team_name,
      ageGroup: ageGroupByTeam.get(row.team_id) ?? null,
      opponent: row.opponent,
      isHome: row.is_home,
      competition: row.competition ?? "League",
      status: row.status,
      date: formatEventDate(row.kickoff_at),
      time: formatEventTime(row.kickoff_at),
      dateIso: local.date,
      pitch,
      allocated: row.allocated === true || central !== "",
      venue: !row.is_home
        ? "Away"
        : central !== ""
          ? central
          : row.pitch_name
            ? venueByPitch.get(row.pitch_name) ?? "No venue"
            : "Unallocated",
      venueText: row.venue_text ?? null,
      accepted: row.accepted,
      declined: row.declined,
      squad: row.squad,
    };
  });

  // The grid's rows: the teams that actually have a fixture in this window,
  // with their age group (the row order) and their central venue (a home game
  // there is never waiting for one of our pitches).
  const teamsInView = new Set(deskRows.map((row) => row.teamId));
  const gridTeams: FixtureGridTeam[] = (teamVenuesResult.data ?? [])
    .filter((team) => teamsInView.has(team.id))
    .map((team) => ({
      id: team.id,
      name: team.name,
      ageGroup: team.age_group,
      centralVenueName: team.central_venue_name,
    }));

  // The column headings, formatted once here: "Sat 6 Sept". Doing it in the
  // grid would mean Intl running in both Node and the browser, and the two
  // abbreviate September differently.
  const dayLabel = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Europe/London",
  });
  const dayLabels: Record<string, string> = {};
  for (const row of deskRows) {
    // Midday keeps the label on the right side of midnight whatever the offset.
    dayLabels[row.dateIso] ??= dayLabel.format(new Date(`${row.dateIso}T12:00:00Z`));
  }

  // What the desk is waiting for, and the one button that does it. Results are
  // history — nothing there needs a pitch or a squad — so that tab gets a
  // count instead of a demand, which is the rule the attention chips followed.
  const nextAction =
    period === "results"
      ? {
          label: "Add a fixture",
          detail: `${deskRows.length} match${deskRows.length === 1 ? "" : "es"} in the last four weeks`,
          action: "add" as const,
          fixtureIds: [],
        }
      : matchesNextAction(deskRows);

  const tabs: { key: Period; label: string }[] = [
    { key: "weekend", label: "This weekend" },
    { key: "month", label: "Next 4 weeks" },
    { key: "all", label: "All" },
    { key: "results", label: "Results" },
  ];

  return (
    <>
      <PageHeader
        title="Matches"
        subtitle="Every fixture on the desk — pitch, replies and what still needs doing"
        action={
          <span className="flex gap-2">
            {/* Allocation is the club's job, not the coach's (Adam,
                2026-08-25) — the destination page is committee-guarded, so
                the door only shows to people it opens for, and only while
                they are wearing the admin hat. An admin looking at the
                fixture desk as a coach sees what a coach sees; the same rule
                the team page and the event page follow. */}
            {(capabilities.isCommittee || capabilities.isClubAdmin) && runningTheClub ? (
              <Link href="/pitches" className={buttonVariants({ variant: "outline", size: "sm" })}>
                <LandPlot className="h-4 w-4" /> Allocate pitches
              </Link>
            ) : null}
            {addableTeams.length > 0 ? (
              <AddFixtureButton teams={addableTeams} />
            ) : (
              <Link href="/teams" className={buttonVariants({ size: "sm" })}>
                <CalendarPlus className="h-4 w-4" /> Add a fixture
              </Link>
            )}
          </span>
        }
      />

      <div className="space-y-4 p-4 lg:p-6">
        {/* The window, and who it is about. Both stay in the URL, which is
            what makes a desk shareable and the back button undo a tap. The
            strip scrolls on a phone rather than wrapping into three lines.
            A narrowed desk (a coach's, or a team pick) can widen to the whole
            club and back (Adam, 2026-09-04); an admin hat already sees
            everything, so it gets no switch.
            What used to be two attention chips on this row is the status
            bar's own sentence now — "8 to place, 3 short of replies" — said
            once, beside the button that acts on it. */}
        <ChipStrip className="gap-2">
          {tabs.map((tab) => (
            <ToggleChipLink
              key={tab.key}
              href={`/matches?period=${tab.key}${wholeClub ? "&scope=club" : ""}`}
              active={period === tab.key}
            >
              {tab.label}
            </ToggleChipLink>
          ))}
          {narrowedByDefault ? (
            <>
              <span className="mx-1 h-5 w-px flex-none bg-border" aria-hidden />
              <ToggleChipLink href={`/matches?period=${period}`} active={!wholeClub}>
                My teams
              </ToggleChipLink>
              <ToggleChipLink href={`/matches?period=${period}&scope=club`} active={wholeClub}>
                Whole club
              </ToggleChipLink>
            </>
          ) : null}
        </ChipStrip>

        {/* The PDF says what it is: on paper the chips above are gone. */}
        <p className="hidden text-sm text-muted-foreground print:block">
          {tabs.find((tab) => tab.key === period)?.label ?? "Matches"} ·{" "}
          {wholeClub || !narrowedByDefault ? "Whole club" : scope ? scope.name : "My teams"} ·
          printed{" "}
          {new Date().toLocaleDateString("en-GB", {
            timeZone: "Europe/London",
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </p>

        {error ? (
          <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Could not load the fixtures: {error.message}
          </p>
        ) : null}

        <MatchesGrid
          rows={deskRows}
          teams={gridTeams}
          dayLabels={dayLabels}
          nextAction={nextAction}
          canManage={canManage}
          pitches={canManage ? pitchRows.map(({ id, name }) => ({ id, name })) : []}
          addableTeams={addableTeams}
          focusFirst={period !== "results"}
        />

        <p className="text-xs text-muted-foreground">
          Replies come from the accept/decline on each fixture&apos;s event — open a fixture to
          chase the quiet ones with its Remind button.
        </p>
      </div>
    </>
  );
}
