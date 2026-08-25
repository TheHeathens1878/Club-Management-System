import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import type { Database } from "@club/db";

import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { getSessionProfile } from "@/lib/auth";
import { formatBookingDateShort, instantToLocal } from "@/lib/booking-time";
import { formationByName, playingFormatFor } from "@/lib/formations";
import { isClubAdmin, nameOf, resolveNames } from "@/lib/person";
import { createClient } from "@/lib/supabase/server";

import { LineupBuilder, type SquadPlayer } from "./lineup-builder";

type AvailabilityStatus = Database["public"]["Enums"]["availability_status"];

/**
 * One fixture's lineup (Adam, 2026-08-25: "Within a match event, I want the
 * ability to select a formation and assign players to it").
 *
 * The formations on offer come from the team's playing format, which the FA
 * table derives from `teams.age_group` — a U13 side is shown 9v9 shapes and
 * nothing else. Team staff and club admins get the board; everyone else who
 * may read the lineup (the squad, their parents) gets the same pitch without
 * the controls, so a player can see where they are standing.
 */
export default async function FixtureLineupPage({
  params,
}: {
  params: Promise<{ id: string; fixtureId: string }>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const { id: teamId, fixtureId } = await params;
  const supabase = await createClient();

  const { data: fixture } = await supabase
    .from("fixtures")
    .select("id,team_id,kickoff_at,is_home,opponent,venue_text,teams:team_id(name,age_group)")
    .eq("id", fixtureId)
    .eq("team_id", teamId)
    .maybeSingle();
  if (!fixture) notFound();

  const team = fixture.teams as { name: string; age_group: string | null } | null;
  const format = playingFormatFor(team?.age_group);

  const [staffResult, admin, lineupResult, membershipResult, availabilityResult] = await Promise.all([
    supabase.rpc("is_team_staff", { p_team_id: teamId }),
    isClubAdmin(),
    supabase.from("fixture_lineups").select("id,formation").eq("fixture_id", fixtureId).maybeSingle(),
    supabase
      .from("team_memberships")
      .select("person_id,role,shirt_number")
      .eq("team_id", teamId)
      .is("left_at", null),
    supabase.from("availability").select("person_id,status").eq("fixture_id", fixtureId),
  ]);
  const canManage = staffResult.data === true || admin;
  const lineup = lineupResult.data ?? null;

  const { data: slotRows } = lineup
    ? await supabase
        .from("fixture_lineup_slots")
        .select("slot,person_id")
        .eq("lineup_id", lineup.id)
    : { data: [] };

  // A formation saved before the age group rolled over may no longer exist for
  // this format; `formationByName` lands on the format's first shape instead,
  // and only the placements whose slot key survives that come with it.
  const formation = formationByName(format, lineup?.formation);
  const liveSlots = new Set(formation.slots.map((slot) => slot.key));
  const placements: Record<string, string> = {};
  for (const row of slotRows ?? []) {
    if (liveSlots.has(row.slot)) placements[row.slot] = row.person_id;
  }

  // The squad is the live players the caller can see, plus anyone already on
  // the pitch — a parent's client only gets their own household's membership
  // rows back, and a token with no name would be worse than a fallback one.
  const playerIds = (membershipResult.data ?? [])
    .filter((row) => row.role === "player")
    .map((row) => row.person_id);
  const shirtByPerson = new Map(
    (membershipResult.data ?? []).map((row) => [row.person_id, row.shirt_number]),
  );
  const peopleIds = Array.from(new Set([...playerIds, ...Object.values(placements)]));
  const names = await resolveNames(peopleIds);

  const availability = new Map(
    (availabilityResult.data ?? []).map((row) => [
      row.person_id,
      row.status as AvailabilityStatus,
    ]),
  );

  const squad: SquadPlayer[] = peopleIds
    .map((personId) => ({
      personId,
      name: nameOf(names, personId),
      shirtNumber: shirtByPerson.get(personId) ?? null,
      availability: availability.get(personId) ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const local = instantToLocal(fixture.kickoff_at);
  const teamName = team?.name ?? "Team";
  const title = fixture.is_home
    ? `${teamName} v ${fixture.opponent}`
    : `${fixture.opponent} v ${teamName}`;
  const whereLine = `${formatBookingDateShort(local.date)} · ${local.time} · ${
    fixture.is_home ? "Home" : (fixture.venue_text ?? "Away")
  }`;

  return (
    <>
      <div className="hidden lg:block">
        <PageHeader
          title={`Lineup — ${title}`}
          subtitle={`${whereLine} · ${format}`}
          action={
            <Link
              href={`/teams/${teamId}/fixtures/${fixtureId}`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <ChevronLeft className="h-4 w-4" /> Back to the fixture
            </Link>
          }
        />
      </div>

      <div className="theme-ink bg-background px-4 pb-4 pt-3 text-foreground lg:hidden">
        <div className="flex items-center gap-2">
          <Link
            href={`/teams/${teamId}/fixtures/${fixtureId}`}
            aria-label="Back to the fixture"
            className="-ml-2 flex h-11 w-9 shrink-0 items-center justify-center text-accent"
          >
            <ChevronLeft className="h-[22px] w-[22px]" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="font-display truncate text-[10.5px] uppercase tracking-[0.16em] text-foreground/55">
              {whereLine}
            </p>
            <h1 className="font-display mt-1 truncate text-[19px] font-semibold uppercase leading-none tracking-wide">
              Lineup
            </h1>
            <p className="mt-1.5 truncate text-[12px] text-foreground/60">
              {title} · {format}
            </p>
          </div>
        </div>
      </div>

      <div className="p-4 lg:p-6">
        {canManage && (
          <p className="mx-auto mb-4 w-full max-w-md text-sm text-muted-foreground">
            Pick a shape, then tap a position to name a player. Nothing is saved until you press
            Save.
          </p>
        )}
        <LineupBuilder
          fixtureId={fixtureId}
          teamId={teamId}
          format={format}
          initialFormation={formation.name}
          initialPlacements={placements}
          squad={squad}
          canManage={canManage}
        />
      </div>
    </>
  );
}
