"use server";

/**
 * The teams list's two match-day acts, done without opening the team.
 *
 * Adam, 2026-09-02: "From the teams page (listing all teams), I want the
 * ability to assign teams to pitches and allocate all home games rather than
 * having to go into the team itself. So the team should show allocated home
 * venue and time."
 *
 * Both of these already existed on `/teams/[id]` and neither is re-implemented
 * here — the rules live where they lived:
 *
 *   · the home pitch and kick-off are two columns on `teams`, written through
 *     the caller's own client so `teams_admin_write` and
 *     `trg_teams_home_resource_guard` (own pitch and central venue are mutually
 *     exclusive) both still answer. This is a NARROWER write than
 *     `updateTeamMatchDay`: it touches those two columns and nothing else, so a
 *     row on a list cannot quietly blank a team's halves or its league.
 *   · allocating the season is `allocate_team_fixtures()` (20260824340000),
 *     which is club_admin-only in the database, home fixtures only, and takes
 *     one sub-transaction per fixture so a clash on one Sunday leaves the rest
 *     standing. Its per-fixture conflict messages come back verbatim: they name
 *     the booking in the way, and rewriting them would throw that away.
 */

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

import type { BulkAllocationState, BulkConflict } from "./[id]/matchday-actions";

export type HomeVenueState = { error?: string; notice?: string };

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function setTeamHomeVenue(
  _prev: HomeVenueState,
  formData: FormData,
): Promise<HomeVenueState> {
  const teamId = String(formData.get("team_id") ?? "").trim();
  if (!teamId) return { error: "Missing team." };

  const resourceId = String(formData.get("home_resource_id") ?? "").trim() || null;
  const kickoff = String(formData.get("home_kickoff_time") ?? "").trim();
  if (kickoff !== "" && !TIME_RE.test(kickoff)) {
    return { error: "The kick-off must be a time like 10:30, or blank for none." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("teams")
    .update({ home_resource_id: resourceId, home_kickoff_time: kickoff || null })
    .eq("id", teamId)
    .select("id");

  if (error) {
    // The home-pitch guard speaks P0001 and names what it refused — most often
    // "this team plays at a central venue", which is the answer, not an error
    // to translate.
    if (error.code === "P0001") return { error: error.message };
    if (error.code === "42501") {
      return { error: "Only a club administrator can set a team's home pitch." };
    }
    if (error.code === "23503") return { error: "That pitch no longer exists." };
    return { error: error.message };
  }
  if ((data ?? []).length === 0) {
    return { error: "Only a club administrator can set a team's home pitch." };
  }

  revalidatePath("/teams");
  revalidatePath(`/teams/${teamId}`);
  revalidatePath("/pitches");
  return {
    notice: resourceId
      ? kickoff
        ? `Home pitch and ${kickoff} kick-off saved.`
        : "Home pitch saved."
      : "Home pitch cleared.",
  };
}

/**
 * Every future home fixture onto the team's own saved pitch and kick-off.
 *
 * No pitch or time is passed: from a list, the only sane meaning of "allocate
 * all home games" is "use what this team's settings say", and
 * `allocate_team_fixtures()` falls back to exactly those columns when given
 * neither. Somebody who wants to allocate onto a different pitch for one season
 * still does it on the team's own screen, where the choice is in front of them.
 */
export async function allocateTeamHomeGames(
  _prev: BulkAllocationState,
  formData: FormData,
): Promise<BulkAllocationState> {
  const teamId = String(formData.get("team_id") ?? "").trim();
  if (!teamId) return { error: "Missing team." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("allocate_team_fixtures", { p_team_id: teamId });
  if (error) {
    if (error.code === "42501") return { error: "Only a club administrator can allocate fixtures." };
    return { error: error.message };
  }

  revalidatePath("/teams");
  revalidatePath(`/teams/${teamId}`);
  revalidatePath("/pitches");
  revalidatePath("/pitches/calendar");
  return { allocated: data as { total: number; allocated: number; conflicts: BulkConflict[] } };
}
