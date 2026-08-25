/**
 * The lineup board, loaded once and rendered in two places.
 *
 * It has its own page (`/teams/[id]/fixtures/[fixtureId]/lineup`, where a coach
 * lands from the fixture screen) and it is the Lineup tab of the Event & RSVP
 * page (Adam, 2026-08-25: "The event (match) page should have tabs showing
 * details, line-up, match-stats and scoreline"). Both render exactly this, so
 * there is one implementation of "what the board is" and one set of queries.
 *
 * `loadLineupSection` is the reading half — it also hands back the fixture's
 * title, kickoff line and playing format, so the lineup page can draw its own
 * header without asking the database the same questions twice.
 */

import type { Database } from "@club/db";

import { formatBookingDateShort, instantToLocal } from "@/lib/booking-time";
import { formationByName, playingFormatFor, type PlayingFormat } from "@/lib/formations";
import { isClubAdmin, nameOf, resolveNames } from "@/lib/person";
import { createClient } from "@/lib/supabase/server";

import { LineupBuilder, type SquadPlayer } from "./lineup-builder";

type AvailabilityStatus = Database["public"]["Enums"]["availability_status"];

export type LineupSectionData = {
  fixtureId: string;
  teamId: string;
  /** "AoM U13s v Angel FC", the club's team first when it is at home. */
  title: string;
  /** "Sat 10 Sep · 10:30 · Home". */
  whereLine: string;
  format: PlayingFormat;
  formationName: string;
  placements: Record<string, string>;
  squad: SquadPlayer[];
  canManage: boolean;
};

/**
 * Everything the board needs, or `null` when the fixture is not this team's
 * (or is not visible to the caller at all).
 *
 * `canManage` is asked of the database (`is_team_staff`) rather than inferred;
 * it only decides whether the controls are drawn, and every write is policed
 * again by `fixture_lineups_staff_write`.
 */
export async function loadLineupSection(
  teamId: string,
  fixtureId: string,
  options: { canManage?: boolean } = {},
): Promise<LineupSectionData | null> {
  const supabase = await createClient();

  const { data: fixture } = await supabase
    .from("fixtures")
    .select("id,team_id,kickoff_at,is_home,opponent,venue_text,teams:team_id(name,age_group)")
    .eq("id", fixtureId)
    .eq("team_id", teamId)
    .maybeSingle();
  if (!fixture) return null;

  const team = fixture.teams as { name: string; age_group: string | null } | null;
  const format = playingFormatFor(team?.age_group);

  const [staff, admin, lineupResult, membershipResult, availabilityResult] = await Promise.all([
    // The caller may already know both answers (the event page computes them
    // for its own tab bar); asking again would be two more round trips.
    options.canManage === undefined
      ? supabase.rpc("is_team_staff", { p_team_id: teamId }).then((r) => r.data === true)
      : Promise.resolve(options.canManage),
    options.canManage === undefined ? isClubAdmin() : Promise.resolve(false),
    supabase.from("fixture_lineups").select("id,formation").eq("fixture_id", fixtureId).maybeSingle(),
    supabase
      .from("team_memberships")
      .select("person_id,role,shirt_number")
      .eq("team_id", teamId)
      .is("left_at", null),
    supabase.from("availability").select("person_id,status").eq("fixture_id", fixtureId),
  ]);
  const canManage = staff || admin;
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

  return {
    fixtureId,
    teamId,
    title: fixture.is_home
      ? `${teamName} v ${fixture.opponent}`
      : `${fixture.opponent} v ${teamName}`,
    whereLine: `${formatBookingDateShort(local.date)} · ${local.time} · ${
      fixture.is_home ? "Home" : (fixture.venue_text ?? "Away")
    }`,
    format,
    formationName: formation.name,
    placements,
    squad,
    canManage,
  };
}

/** The board itself. Give it what `loadLineupSection` returned. */
export function LineupSection({ data }: { data: LineupSectionData }) {
  return (
    <>
      {data.canManage ? (
        <p className="mx-auto mb-4 w-full max-w-md text-sm text-muted-foreground">
          Pick a shape, then tap a position to name a player. Nothing is saved until you press
          Save.
        </p>
      ) : null}
      <LineupBuilder
        fixtureId={data.fixtureId}
        teamId={data.teamId}
        format={data.format}
        initialFormation={data.formationName}
        initialPlacements={data.placements}
        squad={data.squad}
        canManage={data.canManage}
      />
    </>
  );
}
