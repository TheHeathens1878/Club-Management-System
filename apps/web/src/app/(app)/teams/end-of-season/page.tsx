import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { getSessionProfile, isCommittee } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { EndOfSeasonForm, type EosSeasonOption, type EosTeamRow } from "./eos-form";

/**
 * End of season (P2 follow-on; Adam, 2026-08-25).
 *
 * One screen, one run: the preview table comes from
 * `end_of_season_preview()` — the SAME `bump_age_group()` the rollover
 * executes, so the "U14 → U15" shown is the change made, not a re-derivation
 * that could drift. The rollover itself is `end_of_season_rollover()`:
 * one transaction that bumps, renames, retires, carries the rosters and flips
 * the current season, with the double-run guard in the database where it
 * cannot be forgotten.
 */
export default async function EndOfSeasonPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isCommittee(session.profile?.role)) redirect("/teams");

  const supabase = await createClient();
  const [previewResult, seasonsResult] = await Promise.all([
    supabase.rpc("end_of_season_preview"),
    supabase.from("seasons").select("id,name,starts_on,ends_on,is_current").order("starts_on"),
  ]);

  const seasons = seasonsResult.data ?? [];
  const current = seasons.find((season) => season.is_current) ?? null;

  const teams: EosTeamRow[] = (previewResult.data ?? []).map((row) => ({
    id: row.team_id,
    name: row.name,
    ageGroup: row.age_group,
    proposedName: row.proposed_name ?? row.name,
    proposedAgeGroup: row.proposed_age_group,
    players: Number(row.live_players ?? 0),
    staff: Number(row.live_staff ?? 0),
  }));

  // Only seasons that follow the current one are rollover targets — the
  // database refuses anything else, so nothing else is offered.
  const targetSeasons: EosSeasonOption[] = current
    ? seasons
        .filter((season) => !season.is_current && season.starts_on > current.starts_on)
        .map((season) => ({
          id: season.id,
          name: season.name,
          startsOn: season.starts_on,
          endsOn: season.ends_on,
        }))
    : [];

  // The club's seasons run 1 July – 30 June (Adam, 2026-08-25), so the
  // create-a-season form opens on the year after the current one, named the
  // way the club names them ("2026/27" → "2027/28") when the pattern holds.
  let nextSeasonDefaults: { name: string; startsOn: string; endsOn: string } | null = null;
  if (current) {
    const startYear = new Date(current.ends_on).getFullYear();
    const nameMatch = /^(\d{4})\/(\d{2})$/.exec(current.name.trim());
    nextSeasonDefaults = {
      name: nameMatch
        ? `${Number(nameMatch[1]) + 1}/${String(Number(nameMatch[2]) + 1).padStart(2, "0")}`
        : "",
      startsOn: `${startYear}-07-01`,
      endsOn: `${startYear + 1}-06-30`,
    };
  }

  return (
    <>
      <PageHeader
        title="End of season"
        subtitle={
          current
            ? `Close ${current.name}: every team a year older, squads carried over, the new season made current`
            : "Set a current season first — the rollover closes one season into the next"
        }
      />
      <div className="space-y-6 p-4 lg:p-6">
        <Link
          href="/teams"
          className="inline-flex min-h-[44px] items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:underline lg:min-h-0"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Teams
        </Link>

        <Card>
          <CardHeader>
            <CardTitle>The rollover, in one run</CardTitle>
            <p className="text-sm text-muted-foreground">
              Each unticked team moves up an age group — in its age group and its name, so next
              season&apos;s Full-Time listings still match — and its full squad, staff and shirt
              numbers carry into the new season. Tick a team to retire it instead: it is marked
              inactive and its roster stays in the closing season. Registrations start afresh —
              health questions and consents are per season — so families re-join through the join
              page as usual.
            </p>
          </CardHeader>
          <CardContent>
            {current ? (
              <EndOfSeasonForm
                currentSeasonName={current.name}
                targetSeasons={targetSeasons}
                teams={teams}
                nextSeasonDefaults={nextSeasonDefaults}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                There is no current season. Set one on the Teams screen&apos;s season toolbar,
                then come back.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
