"use server";

/**
 * The team's match-day defaults (migration 20260824200000).
 *
 * One UPDATE on `teams` through the USER-SCOPED client, exactly as the
 * recruiting card does. Two policies can admit it — `teams_admin_write` for a
 * club administrator and `teams_staff_update` for the team's own staff — and
 * `teams_staff_update_guard()` refuses, with P0001, any attempt by a
 * non-administrator to change the team's name, age group, status, sort order
 * or notes. None of those columns are sent from here.
 *
 * The database owns every rule these fields have:
 *
 *   - `trg_teams_home_resource_guard` raises P0001 if the chosen home resource
 *     is not a pitch. Its message is shown WORD FOR WORD rather than replaced
 *     with a guess, because it names precisely what it refused.
 *   - the CHECK constraints own the ranges (halves 1–4, half length 5–60,
 *     half time 0–30, buffers 0–120). The form mirrors them so a typo is
 *     caught before the round trip, but the constraint is the arbiter.
 *
 * Nothing here computes a duration: `team_match_duration()` does, and
 * `trg_fixtures_default_duration` is what applies it to new fixtures.
 */

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export type MatchDayState = { error?: string; notice?: string };

/** Mirrors the CHECK constraints in 20260824200000_team_matchday_defaults. */
const LIMITS = {
  match_halves: { min: 1, max: 4 },
  half_length_minutes: { min: 5, max: 60 },
  half_time_minutes: { min: 0, max: 30 },
  buffer: { min: 0, max: 120 },
} as const;

function optionalInt(
  formData: FormData,
  key: string,
  min: number,
  max: number,
): number | null | "invalid" {
  const raw = String(formData.get(key) ?? "").trim();
  if (raw === "") return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) return "invalid";
  return value;
}

function requiredInt(
  formData: FormData,
  key: string,
  min: number,
  max: number,
): number | "invalid" {
  const value = optionalInt(formData, key, min, max);
  return value === null ? "invalid" : value;
}

export async function updateTeamMatchDay(
  _prev: MatchDayState,
  formData: FormData,
): Promise<MatchDayState> {
  const teamId = String(formData.get("team_id") ?? "").trim();
  if (!teamId) return { error: "Missing team." };

  // Own pitch and central venue are mutually exclusive — the mode decides
  // which of the two columns survives, and `trg_teams_home_resource_guard`
  // enforces the same rule underneath.
  const central = String(formData.get("venue_mode") ?? "own") === "central";
  const centralVenueName = central
    ? String(formData.get("central_venue_name") ?? "").trim()
    : "";
  if (central && !centralVenueName) {
    return { error: "Name the central venue, or switch back to one of the club's own pitches." };
  }
  const homeResourceId = central
    ? null
    : String(formData.get("home_resource_id") ?? "").trim() || null;

  const kickoffRaw = String(formData.get("home_kickoff_time") ?? "").trim();
  if (kickoffRaw !== "" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(kickoffRaw)) {
    return { error: "The home kick-off must be a time like 10:30, or blank for none." };
  }
  const homeKickoffTime = central ? null : kickoffRaw || null;

  const halves = requiredInt(formData, "match_halves", LIMITS.match_halves.min, LIMITS.match_halves.max);
  if (halves === "invalid") {
    return { error: `A match has between ${LIMITS.match_halves.min} and ${LIMITS.match_halves.max} halves.` };
  }

  const halfLength = optionalInt(
    formData,
    "half_length_minutes",
    LIMITS.half_length_minutes.min,
    LIMITS.half_length_minutes.max,
  );
  if (halfLength === "invalid") {
    return {
      error: `Minutes per half must be between ${LIMITS.half_length_minutes.min} and ${LIMITS.half_length_minutes.max}, or blank for no set length.`,
    };
  }

  const halfTime = requiredInt(
    formData,
    "half_time_minutes",
    LIMITS.half_time_minutes.min,
    LIMITS.half_time_minutes.max,
  );
  if (halfTime === "invalid") {
    return {
      error: `Half time must be between ${LIMITS.half_time_minutes.min} and ${LIMITS.half_time_minutes.max} minutes.`,
    };
  }

  const preBuffer = optionalInt(formData, "default_pre_buffer_minutes", LIMITS.buffer.min, LIMITS.buffer.max);
  const postBuffer = optionalInt(formData, "default_post_buffer_minutes", LIMITS.buffer.min, LIMITS.buffer.max);
  if (preBuffer === "invalid" || postBuffer === "invalid") {
    return {
      error: `Buffers must be between ${LIMITS.buffer.min} and ${LIMITS.buffer.max} minutes, or blank to fall back to the pitch's own default.`,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("teams")
    .update({
      home_resource_id: homeResourceId,
      home_kickoff_time: homeKickoffTime,
      central_venue_name: central ? centralVenueName : null,
      match_halves: halves,
      half_length_minutes: halfLength,
      half_time_minutes: halfTime,
      default_pre_buffer_minutes: preBuffer,
      default_post_buffer_minutes: postBuffer,
    })
    .eq("id", teamId)
    .select("id");

  if (error) {
    // The home-pitch guard and the staff guard both speak P0001 and name
    // exactly what they refused. Verbatim beats a guess.
    if (error.code === "P0001") return { error: error.message };
    if (error.code === "42501") {
      return { error: "Only this team's staff or a club administrator can change these details." };
    }
    if (error.code === "23514") {
      return { error: "Those match-day numbers are outside what the club allows. Check the halves, the half length and the buffers." };
    }
    if (error.code === "23503") {
      return { error: "That pitch no longer exists. Pick another one." };
    }
    return { error: error.message };
  }
  if ((data ?? []).length === 0) {
    return { error: "Only this team's staff or a club administrator can change these details." };
  }

  revalidatePath(`/teams/${teamId}`);
  // New fixtures inherit the duration, and allocation now defaults to the home
  // pitch, kick-off and the team's buffers — those screens read this row.
  revalidatePath("/pitches");
  revalidatePath("/pitches/book");
  return { notice: "Match day defaults saved." };
}

// ---------------------------------------------------------------------------
// Bulk allocation (migration 20260824340000)
// ---------------------------------------------------------------------------

/** One failed Sunday out of allocate_team_fixtures(), named. */
export type BulkConflict = { fixture_id: string; label: string; error: string };

export type BulkAllocationState = {
  error?: string;
  /** allocate_team_fixtures: how the run went, clash by clash. */
  allocated?: { total: number; allocated: number; conflicts: BulkConflict[] };
  /** allocate_team_fixtures_central: what was pointed away and freed. */
  central?: { updated: number; bookingsFreed: number };
};

function revalidateAllocation(teamId: string) {
  revalidatePath(`/teams/${teamId}`);
  revalidatePath("/pitches");
  revalidatePath("/pitches/calendar");
  revalidatePath("/pitches/mine");
}

/**
 * Every future scheduled home fixture onto one pitch at one kick-off, in a
 * single call. The database RPC owns the rules — club_admin only, home
 * fixtures only, one sub-transaction per fixture so a clash on one Sunday
 * leaves the rest standing — and its per-fixture conflict messages are shown
 * verbatim, because they name the bookings in the way.
 */
export async function allocateAllTeamFixtures(
  _prev: BulkAllocationState,
  formData: FormData,
): Promise<BulkAllocationState> {
  const teamId = String(formData.get("team_id") ?? "").trim();
  if (!teamId) return { error: "Missing team." };
  const resourceId = String(formData.get("resource_id") ?? "").trim() || null;
  const kickoff = String(formData.get("kickoff_time") ?? "").trim();
  if (kickoff !== "" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(kickoff)) {
    return { error: "The kick-off must be a time like 10:30, or blank to keep each fixture's own." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("allocate_team_fixtures", {
    p_team_id: teamId,
    ...(resourceId ? { p_resource_id: resourceId } : {}),
    ...(kickoff ? { p_kickoff_time: kickoff } : {}),
  });
  if (error) {
    if (error.code === "42501") return { error: "Only a club administrator can allocate fixtures." };
    return { error: error.message };
  }

  const result = data as { total: number; allocated: number; conflicts: BulkConflict[] };
  revalidateAllocation(teamId);
  return { allocated: result };
}

/** Point every future scheduled fixture at the team's central venue and free any pitch bookings. */
export async function sendFixturesToCentralVenue(
  _prev: BulkAllocationState,
  formData: FormData,
): Promise<BulkAllocationState> {
  const teamId = String(formData.get("team_id") ?? "").trim();
  if (!teamId) return { error: "Missing team." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("allocate_team_fixtures_central", {
    p_team_id: teamId,
  });
  if (error) {
    if (error.code === "42501") return { error: "Only a club administrator can allocate fixtures." };
    return { error: error.message };
  }

  const result = data as { updated: number; bookings_freed: number };
  revalidateAllocation(teamId);
  return { central: { updated: result.updated, bookingsFreed: result.bookings_freed } };
}
