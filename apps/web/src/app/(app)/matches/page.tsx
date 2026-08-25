import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarPlus, LandPlot } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getCapabilities, getStoredRoleView } from "@/lib/capabilities";
import { formatEventDate, formatEventTime } from "@/app/(app)/events/shared";
import { createClient } from "@/lib/supabase/server";
import { LinkRow } from "@/components/link-row";

/**
 * Matches — the Matchday desk (spec §2). A coach sees their teams, an admin
 * the club; `matchday_fixtures()` does the scoping by identity, and the Coach
 * view narrows an administrator-who-coaches to their own teams on top — the
 * same "the active tile scopes the data" rule the Teams page follows (Adam,
 * 2026-08-24: "Coaches should only be able to see their own games"). Three
 * period tabs, the needs-attention chips, and the whole row links into the
 * fixture's event where the RSVP, remind and detail already live.
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

  const supabase = await createClient();
  // The active tile scopes the data, not just the menu: in the Coach view an
  // administrator-who-coaches sees only the teams they staff, exactly as on
  // /teams. `my_capabilities()` already carries those teams — no extra read.
  const roleView = await getStoredRoleView();
  const coachTeamIds =
    roleView === "coach" ? new Set(capabilities.staffTeams.map((team) => team.id)) : null;

  const { data, error } = await supabase.rpc("matchday_fixtures", {
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });
  const fixtures = (data ?? []).filter(
    (row) =>
      (period === "results" ? true : row.status === "scheduled") &&
      (coachTeamIds === null || coachTeamIds.has(row.team_id)),
  );

  const needPitch = fixtures.filter(
    (row) => period !== "results" && row.is_home && !row.allocated,
  ).length;
  const shortOfPlayers = fixtures.filter(
    (row) => period !== "results" && row.squad > 0 && row.accepted * 2 < row.squad,
  ).length;

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
            <Link href="/pitches" className={buttonVariants({ variant: "outline", size: "sm" })}>
              <LandPlot className="h-4 w-4" /> Allocate pitches
            </Link>
            <Link href="/teams" className={buttonVariants({ size: "sm" })}>
              <CalendarPlus className="h-4 w-4" /> Add a fixture
            </Link>
          </span>
        }
      />

      <div className="space-y-4 p-6">
        <div className="flex flex-wrap items-center gap-2">
          {tabs.map((tab) => (
            <Link
              key={tab.key}
              href={`/matches?period=${tab.key}`}
              className={
                "rounded-full px-3 py-1.5 text-xs font-semibold transition " +
                (period === tab.key
                  ? "bg-foreground text-background"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/70")
              }
            >
              {tab.label}
            </Link>
          ))}
          <span className="ml-auto flex gap-2">
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

        <Card>
          <CardContent className="p-0">
            {fixtures.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                {period === "results"
                  ? "No fixtures played in the last four weeks."
                  : "Nothing on the fixture list for this window."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-secondary/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-2 font-medium">Kick-off</th>
                      <th className="px-4 py-2 font-medium">Fixture</th>
                      <th className="px-4 py-2 font-medium">Competition</th>
                      <th className="px-4 py-2 font-medium">Pitch</th>
                      <th className="px-4 py-2 font-medium">Replies</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fixtures.map((row) => {
                      const short = row.squad > 0 && row.accepted * 2 < row.squad;
                      return (
                        <LinkRow
                          key={row.fixture_id}
                          href={row.event_id ? `/events/${row.event_id}` : `/teams/${row.team_id}`}
                          className="border-b last:border-b-0 hover:bg-secondary/40"
                        >
                          <td className="px-4 py-3 align-top text-muted-foreground">
                            <span className="font-semibold">{formatEventDate(row.kickoff_at)}</span>
                            <br />
                            {formatEventTime(row.kickoff_at)}
                          </td>
                          <td className="px-4 py-3 align-top">
                            <Link
                              href={row.event_id ? `/events/${row.event_id}` : `/teams/${row.team_id}`}
                              className="font-semibold hover:underline"
                            >
                              {row.team_name} v {row.opponent}
                            </Link>
                            <span className="block text-xs text-muted-foreground">
                              {row.is_home ? "Home" : `Away${row.venue_text ? ` · ${row.venue_text}` : ""}`}
                              {row.status !== "scheduled" ? ` · ${row.status}` : ""}
                            </span>
                          </td>
                          <td className="px-4 py-3 align-top">{row.competition ?? "League"}</td>
                          <td className="px-4 py-3 align-top">
                            {!row.is_home ? (
                              <span className="text-muted-foreground">Away</span>
                            ) : row.pitch_name ? (
                              <span>
                                {row.pitch_name}
                                {!row.allocated ? (
                                  <span className="block text-xs text-amber-700">not booked</span>
                                ) : null}
                              </span>
                            ) : (
                              <span className="text-amber-700">Unallocated</span>
                            )}
                          </td>
                          <td className="px-4 py-3 align-top">
                            <Badge variant={short ? "destructive" : row.accepted > 0 ? "success" : "muted"}>
                              {row.accepted} of {row.squad}
                            </Badge>
                            {row.declined > 0 ? (
                              <span className="ml-2 text-xs text-muted-foreground">
                                {row.declined} out
                              </span>
                            ) : null}
                          </td>
                        </LinkRow>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground">
          Replies come from the accept/decline on each fixture&apos;s event — open a fixture to
          chase the quiet ones with its Remind button.
        </p>
      </div>
    </>
  );
}
