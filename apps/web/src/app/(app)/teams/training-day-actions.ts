"use server";

/**
 * A team's default training day (Adam, 2026-09-13: "In Teams settings, they
 * should have a default training day field which can be set in bulk on Teams
 * table"). Which evening the team usually trains — what the training planner
 * offers first when a day is chosen.
 *
 * Both writes go through the USER-SCOPED client: `teams_admin_write` is what
 * admits the caller, and the column's own check is what refuses an eighth
 * day. The bulk act walks the ticked teams in one statement — the same day
 * for all of them, or none.
 */

import { revalidatePath } from "next/cache";

import { getSessionProfile } from "@/lib/auth";
import { friendlyDbError } from "@/lib/people-display";
import { createClient } from "@/lib/supabase/server";

const NOT_ALLOWED =
  "The database refused that. Only a club administrator can set a team's training day.";

/** How many teams one post may name. The whole club is ~30. */
const MAX_TEAMS = 100;

/** "" → null (not set); "0".."6" → the day; anything else → undefined (refused). */
function readDay(raw: string): number | null | undefined {
  if (raw === "") return null;
  const day = Number.parseInt(raw, 10);
  return Number.isInteger(day) && day >= 0 && day <= 6 ? day : undefined;
}

export type TrainingDayState = { error?: string; notice?: string };

/** The Settings tab's form: one team, one day (or none). */
export async function setTeamTrainingDay(
  _prev: TrainingDayState,
  formData: FormData,
): Promise<TrainingDayState> {
  const session = await getSessionProfile();
  if (!session) return { error: "Sign in again first." };
  const teamId = String(formData.get("team_id") ?? "").trim();
  if (!teamId) return { error: "No team was named." };
  const day = readDay(String(formData.get("default_training_day") ?? "").trim());
  if (day === undefined) return { error: "Choose a day of the week, or none." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("teams")
    .update({ default_training_day: day })
    .eq("id", teamId)
    .select("id");
  if (error) return { error: friendlyDbError(error, NOT_ALLOWED) };
  if ((data ?? []).length === 0) return { error: NOT_ALLOWED };

  revalidatePath(`/teams/${teamId}`);
  revalidatePath("/teams");
  revalidatePath("/pitches/training");
  return { notice: day === null ? "Training day cleared." : "Training day saved." };
}

/** The ticks bar: every ticked team, one day. */
export async function bulkSetTrainingDay(
  _prev: TrainingDayState,
  formData: FormData,
): Promise<TrainingDayState> {
  const session = await getSessionProfile();
  if (!session) return { error: "Sign in again first." };
  const day = readDay(String(formData.get("default_training_day") ?? "").trim());
  if (day === undefined) return { error: "Choose a day of the week, or none." };

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
  const { data, error } = await supabase
    .from("teams")
    .update({ default_training_day: day })
    .in("id", teamIds)
    .select("id");
  if (error) return { error: friendlyDbError(error, NOT_ALLOWED) };
  const saved = (data ?? []).length;
  if (saved === 0) return { error: NOT_ALLOWED };

  revalidatePath("/teams");
  revalidatePath("/pitches/training");
  for (const id of teamIds) revalidatePath(`/teams/${id}`);
  return {
    notice:
      day === null
        ? `Training day cleared for ${saved} ${saved === 1 ? "team" : "teams"}.`
        : `Training day set for ${saved} ${saved === 1 ? "team" : "teams"}.`,
  };
}
