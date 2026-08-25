"use server";

/**
 * End of season (migration 20260824390000).
 *
 * Both actions go through the USER-SCOPED client so the database checks the
 * caller: `end_of_season_rollover()` is club_admin only and raises 42501 for
 * anyone else, P0001 for a wrong target season — both shown here, the P0001s
 * verbatim because they name the season and the reason.
 *
 * Nothing here decides what a rollover means: the RPC bumps, carries, retires
 * and flips the current season in one transaction, and this file just carries
 * the form to it and the summary back.
 */

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export type RolloverSummary = {
  from_season: string;
  to_season: string;
  teams_upgraded: number;
  teams_retired: number;
  players_carried: number;
  staff_carried: number;
};

export type RolloverState = {
  error?: string;
  notice?: string;
  summary?: RolloverSummary;
};

export async function runEndOfSeason(
  _prev: RolloverState,
  formData: FormData,
): Promise<RolloverState> {
  const seasonId = String(formData.get("season_id") ?? "").trim();
  if (!seasonId) return { error: "Choose the season to roll into." };
  if (String(formData.get("confirm") ?? "") !== "on") {
    return { error: "Tick the confirmation first — this changes every team in one go." };
  }

  const upgrade = formData.getAll("upgrade").map(String).filter(Boolean);
  const retire = formData.getAll("retire").map(String).filter(Boolean);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("end_of_season_rollover", {
    p_new_season_id: seasonId,
    p_upgrade_team_ids: upgrade,
    p_retire_team_ids: retire,
  });

  if (error) {
    if (error.code === "42501") {
      return { error: "Only a club administrator can run the end-of-season rollover." };
    }
    // P0001 names the season and the reason (already current, starts before…).
    return { error: error.message };
  }

  revalidatePath("/teams");
  revalidatePath("/teams/end-of-season");
  revalidatePath("/pitches");
  return { summary: data as RolloverSummary };
}

/** A season to roll into, created without leaving the page. */
export async function createNextSeason(
  _prev: RolloverState,
  formData: FormData,
): Promise<RolloverState> {
  const name = String(formData.get("name") ?? "").trim();
  const startsOn = String(formData.get("starts_on") ?? "").trim();
  const endsOn = String(formData.get("ends_on") ?? "").trim();
  if (!name || !startsOn || !endsOn) {
    return { error: "A season needs a name and both dates." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("seasons")
    .insert({ name, starts_on: startsOn, ends_on: endsOn });
  if (error) {
    if (error.code === "23505") return { error: `A season called “${name}” already exists.` };
    if (error.code === "23514") return { error: "The season must end after it starts." };
    if (error.code === "42501") return { error: "Only a club administrator can add a season." };
    return { error: error.message };
  }

  revalidatePath("/teams/end-of-season");
  revalidatePath("/teams");
  return { notice: `Season “${name}” created — pick it below.` };
}
