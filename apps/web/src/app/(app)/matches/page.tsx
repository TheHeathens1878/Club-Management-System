import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarPlus, LandPlot } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getCapabilities, getStoredRoleView, getTeamScope } from "@/lib/capabilities";
import { resolveRoleView } from "@/lib/role-view";
import { formatEventDate, formatEventTime } from "@/app/(app)/events/shared";
import { instantToLocal } from "@/lib/booking-time";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

import { MatchesDesk, type DeskRow } from "./matches-desk";

/**
 * Matches — the Matchday desk (spec §2). A coach sees their teams, an admin
 * the club; `matchday_fixtures()` does the scoping. Three period tabs, the
 * needs-attention chips, and every row links into the fixture's event where
 * the RSVP, remind and detail already live.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Matches" };

const DAY_MS = 86_400_000;

type Period = "weekend" | "month" | "results";

function periodWindow(period: Period): { from: Date; to: Date } {
  const now = new Date();
  if (period === "results") return { from: new Date(now.getTime() - 28 * DAY_MS), to: now };
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
  searchParams: Promise<{ period?: string }>;
}) {
  const capabilities = await getCapabilities();
  if (!capabilities.isTeamStaff && !capabilities.isClubAdmin && !capabilities.isCommittee) {
    redirect("/events");
  }

  const params = await searchParams;
  const period: Period =
    params.period === "month" ? "month" : params.period === "results" ? "results" : "weekend";
  const { from, to } = periodWindow(period);

  // The chosen hat scopes the desk (Adam, 2026-08-25: "I should just be able
  // to see my own team" in the coach view): the RPC answers for everything the
  // caller may see, and the VIEW narrows it — coach → their staffed teams,
  // further narrowed by a team-scoped switcher pick.
  const view = resolveRoleView(await getStoredRoleView(), capabilities);
  const scope = await getTeamScope(view, capabilities);
  const coachTeamIds =
    view === "coach" ? new Set(capabilities.staffTeams.map((team) => team.id)) : null;
  const inView = (teamId: string): boolean =>
    scope ? teamId === scope.id : coachTeamIds ? coachTeamIds.has(teamId) : true;

  // The desk's whole management strip is one gate, page-wide (the teams-page
  // lesson): the admin capability, worn as the admin hat.
  const canManage = capabilities.isClubAdmin && (view === "admin" || view === null);

  const supabase = await createClient();
  const adminDb = createAdminClient();
  const [{ data, error }, teamVenuesResult, pitchesResult] = await Promise.all([
    supabase.rpc("matchday_fixtures", {
      p_from: from.toISOString(),
      p_to: to.toISOString(),
    }),
    // Which teams play at a central venue (their "home" needs no pitch), and
    // which venue each pitch belongs to — both for honest Pitch/Venue columns.
    adminDb.from("teams").select("id,central_venue_name"),
    adminDb
      .from("resources")
      .select("id,name,venues(name)")
      .neq("type", "function_room")
      .eq("active", true)
      .order("sort_order")
      .order("name"),
  ]);
  const fixtures = (data ?? []).filter(
    (row) => inView(row.team_id) && (period === "results" ? true : row.status === "scheduled"),
  );

  const centralVenue = new Map(
    (teamVenuesResult.data ?? []).map((team) => [team.id, (team.central_venue_name ?? "").trim()]),
  );
  const playsCentrally = (teamId: string): string => centralVenue.get(teamId) ?? "";
  const pitchRows = pitchesResult.data ?? [];
  const venueByPitch = new Map(pitchRows.map((row) => [row.name, row.venues?.name ?? null]));

  const needPitch = fixtures.filter(
    (row) =>
      period !== "results" && row.is_home && !row.allocated && playsCentrally(row.team_id) === "",
  ).length;
  const shortOfPlayers = fixtures.filter(
    (row) => period !== "results" && row.squad > 0 && row.accepted * 2 < row.squad,
  ).length;

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

  const tabs: { key: Period; label: string }[] = [
    { key: "weekend", label: "This weekend" },
    { key: "month", label: "Next 4 weeks" },
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
            {(capabilities.isCommittee || capabilities.isClubAdmin) &&
            (view === "admin" || view === null) ? (
              <Link href="/pitches" className={buttonVariants({ variant: "outline", size: "sm" })}>
                <LandPlot className="h-4 w-4" /> Allocate pitches
              </Link>
            ) : null}
            <Link href="/teams" className={buttonVariants({ size: "sm" })}>
              <CalendarPlus className="h-4 w-4" /> Add a fixture
            </Link>
          </span>
        }
      />

      <div className="space-y-4 p-4 lg:p-6">
        {/* The period chips scroll in their own strip on a phone rather than
            wrapping into three lines; on lg they are the row they always were
            (`lg:contents` puts them straight back into the parent flex). */}
        <div className="space-y-2 lg:flex lg:flex-wrap lg:items-center lg:gap-2 lg:space-y-0">
          <div className="-mx-4 flex gap-2 overflow-x-auto whitespace-nowrap px-4 lg:mx-0 lg:contents lg:overflow-visible lg:px-0">
            {tabs.map((tab) => (
              <Link
                key={tab.key}
                href={`/matches?period=${tab.key}`}
                className={
                  "inline-flex min-h-[44px] flex-none items-center rounded-full px-4 py-1.5 text-xs font-semibold transition lg:min-h-0 lg:px-3 " +
                  (period === tab.key
                    ? "bg-foreground text-background"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/70")
                }
              >
                {tab.label}
              </Link>
            ))}
          </div>
          <span className="flex flex-wrap gap-2 lg:ml-auto">
            {needPitch > 0 ? (
              <Badge variant="destructive">
                {needPitch} need{needPitch === 1 ? "s" : ""} a pitch
              </Badge>
            ) : null}
            {shortOfPlayers > 0 ? (
              <Badge variant="warning">{shortOfPlayers} short of replies</Badge>
            ) : null}
          </span>
        </div>

        {error ? (
          <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Could not load the fixtures: {error.message}
          </p>
        ) : null}

        {fixtures.length === 0 ? (
          <Card>
            <CardContent className="p-0">
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                {period === "results"
                  ? "No fixtures played in the last four weeks."
                  : "Nothing on the fixture list for this window."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <MatchesDesk
            rows={deskRows}
            canManage={canManage}
            pitches={canManage ? pitchRows.map(({ id, name }) => ({ id, name })) : []}
            focusFirst={period !== "results"}
          />
        )}

        <p className="text-xs text-muted-foreground">
          Replies come from the accept/decline on each fixture&apos;s event — open a fixture to
          chase the quiet ones with its Remind button.
        </p>
      </div>
    </>
  );
}
