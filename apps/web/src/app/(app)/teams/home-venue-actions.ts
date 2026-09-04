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

import { writeAudit } from "@/lib/audit";
import { getSessionProfile } from "@/lib/auth";
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

// ---------------------------------------------------------------------------
// Many teams at once
// ---------------------------------------------------------------------------

export type BulkHomeVenueState = {
  error?: string;
  notice?: string;
  /** Per-team trouble that did not stop the rest — shown as a list. */
  warnings?: string[];
};

/** How many teams one post may name. The whole club is ~30. */
const MAX_TEAMS = 100;

/**
 * One home pitch for every ticked team (Adam, 2026-09-04: "allocate home
 * venues from here by ticking a box alongside the team and then allocate to a
 * pitch & venue"), optionally allocating each team's future home games too.
 *
 * The same two doors as the single-team acts, walked one team at a time:
 * the `teams` update goes through the caller's own client so
 * `teams_admin_write` and `trg_teams_home_resource_guard` still answer, and
 * the season is `allocate_team_fixtures()`, club-admin-only in the database
 * with one sub-transaction per fixture. A central-venue team is skipped and
 * named rather than fed to the guard, and a blank kick-off leaves each team's
 * standing kick-off alone — in bulk, silence must not clear thirty columns.
 */
export async function bulkSetHomeVenue(
  _prev: BulkHomeVenueState,
  formData: FormData,
): Promise<BulkHomeVenueState> {
  const session = await getSessionProfile();
  if (!session) return { error: "Sign in again first." };

  const resourceId = String(formData.get("home_resource_id") ?? "").trim();
  if (!resourceId) return { error: "Choose a pitch first." };
  const kickoff = String(formData.get("home_kickoff_time") ?? "").trim();
  if (kickoff !== "" && !TIME_RE.test(kickoff)) {
    return { error: "The kick-off must be a time like 10:30, or blank to leave each team's alone." };
  }
  const allocateGames = formData.get("allocate_games") === "on";

  const teamIds = [
    ...new Set(
      formData
        .getAll("team_id")
        .map((value) => String(value).trim())
        .filter((id) => id !== ""),
    ),
  ].slice(0, MAX_TEAMS);
  if (teamIds.length === 0) return { error: "Tick the teams first." };

  const supabase = await createClient();
  const [{ data: pitch }, { data: teams, error: teamsError }] = await Promise.all([
    supabase.from("resources").select("id,name").eq("id", resourceId).maybeSingle(),
    supabase.from("teams").select("id,name,central_venue_name").in("id", teamIds),
  ]);
  if (!pitch) return { error: "That pitch no longer exists." };
  if (teamsError) return { error: "Those teams could not be read." };
  if ((teams ?? []).length === 0) return { error: "None of those teams exist any more." };

  const warnings: string[] = [];
  let saved = 0;
  let placed = 0;
  let placeable = 0;

  for (const team of teams ?? []) {
    if ((team.central_venue_name ?? "").trim() !== "") {
      warnings.push(
        `${team.name} — left alone: it plays at ${team.central_venue_name}, a central venue, so the club books no pitch.`,
      );
      continue;
    }
    const { data, error } = await supabase
      .from("teams")
      .update({
        home_resource_id: resourceId,
        ...(kickoff !== "" ? { home_kickoff_time: kickoff } : {}),
      })
      .eq("id", team.id)
      .select("id");
    if (error) {
      // The guard speaks P0001 and names what it refused — that is the
      // answer, not an error to translate.
      warnings.push(`${team.name} — not set: ${error.message}`);
      continue;
    }
    if ((data ?? []).length === 0) {
      return { error: "Only a club administrator can set a team's home pitch.", warnings };
    }
    saved += 1;

    if (allocateGames) {
      const { data: result, error: allocError } = await supabase.rpc("allocate_team_fixtures", {
        p_team_id: team.id,
      });
      if (allocError) {
        warnings.push(`${team.name} — home pitch set, but not allocated: ${allocError.message}`);
        continue;
      }
      const summary = result as { total: number; allocated: number; conflicts: BulkConflict[] };
      placed += summary.allocated;
      placeable += summary.total;
      for (const conflict of summary.conflicts) {
        warnings.push(`${team.name}, ${conflict.label} — ${conflict.error}`);
      }
    }
  }

  if (saved === 0) {
    return { error: "No team's home pitch was set.", warnings };
  }

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "teams.bulk_home_venue",
    entity: "teams",
    entityId: null,
    detail: {
      resource_id: resourceId,
      pitch: pitch.name,
      kickoff_time: kickoff || null,
      allocate_games: allocateGames,
      saved,
      fixtures_placed: allocateGames ? placed : null,
      team_ids: teamIds,
    },
  });

  revalidatePath("/teams");
  revalidatePath("/pitches");
  revalidatePath("/pitches/calendar");
  for (const teamId of teamIds) revalidatePath(`/teams/${teamId}`);

  return {
    notice: `${saved} ${saved === 1 ? "team now calls" : "teams now call"} ${pitch.name} home${
      kickoff !== "" ? `, kicking off at ${kickoff}` : ""
    }.${allocateGames ? ` ${placed} of ${placeable} future home fixtures placed.` : ""}`,
    warnings,
  };
}
