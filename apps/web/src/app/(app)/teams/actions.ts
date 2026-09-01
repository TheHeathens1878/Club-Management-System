"use server";

/**
 * Teams and seasons administration (PLAN.md P2.3).
 *
 * `profiles.role` is still the app's gating model, so everything here is
 * committee-and-above; the database's own `club_admin` RLS is the second line
 * of defence for anything that ever reaches it through a user-scoped client.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { isValidDateString } from "@/lib/booking-time";

const TEAMS_PATH = "/teams";

async function requireCommittee() {
  const session = await getSessionProfile();
  if (!session || !isCommittee(session.profile?.role)) redirect("/lobby");
  return session;
}

function backToTeams(params: { error?: string; saved?: string }): never {
  const query = new URLSearchParams();
  if (params.error) query.set("error", params.error);
  if (params.saved) query.set("saved", params.saved);
  const qs = query.toString();
  redirect(qs ? `${TEAMS_PATH}?${qs}` : TEAMS_PATH);
}

export async function createTeam(formData: FormData): Promise<void> {
  const session = await requireCommittee();
  const admin = createAdminClient();

  const name = String(formData.get("name") ?? "").trim();
  const ageGroup = String(formData.get("age_group") ?? "").trim() || null;
  if (!name) backToTeams({ error: "Team name is required." });

  const { data: last } = await admin
    .from("teams")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextSort = (last?.[0]?.sort_order ?? 0) + 10;

  const { data: created, error } = await admin
    .from("teams")
    .insert({ name, age_group: ageGroup, active: true, sort_order: nextSort })
    .select("id")
    .maybeSingle();
  if (error) backToTeams({ error: `Could not create the team: ${error.message}` });

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "create",
    entity: "team",
    entityId: created?.id ?? null,
    detail: { name, age_group: ageGroup },
  });

  revalidatePath(TEAMS_PATH);
  backToTeams({ saved: "team" });
}

export async function setTeamActive(formData: FormData): Promise<void> {
  const session = await requireCommittee();
  const admin = createAdminClient();

  const teamId = String(formData.get("team_id") ?? "");
  const active = String(formData.get("active") ?? "") === "true";
  if (!teamId) backToTeams({ error: "No team given." });

  const { error } = await admin.from("teams").update({ active }).eq("id", teamId);
  if (error) backToTeams({ error: `Could not update the team: ${error.message}` });

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: active ? "activate" : "deactivate",
    entity: "team",
    entityId: teamId,
    detail: { active },
  });

  revalidatePath(TEAMS_PATH);
  revalidatePath(`${TEAMS_PATH}/${teamId}`);
  backToTeams({ saved: "team" });
}

export async function createSeason(formData: FormData): Promise<void> {
  const session = await requireCommittee();
  const admin = createAdminClient();

  const name = String(formData.get("name") ?? "").trim();
  const startsOn = String(formData.get("starts_on") ?? "").trim();
  const endsOn = String(formData.get("ends_on") ?? "").trim();

  if (!name) backToTeams({ error: "Season name is required." });
  if (!isValidDateString(startsOn) || !isValidDateString(endsOn)) {
    backToTeams({ error: "Season start and end must both be real dates." });
  }
  if (endsOn <= startsOn) {
    backToTeams({ error: "The season must end after it starts." });
  }

  const { data: created, error } = await admin
    .from("seasons")
    .insert({ name, starts_on: startsOn, ends_on: endsOn })
    .select("id")
    .maybeSingle();
  if (error) backToTeams({ error: `Could not create the season: ${error.message}` });

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "create",
    entity: "season",
    entityId: created?.id ?? null,
    detail: { name, starts_on: startsOn, ends_on: endsOn },
  });

  revalidatePath(TEAMS_PATH);
  backToTeams({ saved: "season" });
}

export async function setCurrentSeason(formData: FormData): Promise<void> {
  const session = await requireCommittee();
  const admin = createAdminClient();

  const seasonId = String(formData.get("season_id") ?? "");
  if (!seasonId) backToTeams({ error: "No season given." });

  // `seasons_one_current_idx` allows a single current season, so the old one
  // has to be cleared before the new one is set.
  const { error: clearError } = await admin
    .from("seasons")
    .update({ is_current: false })
    .eq("is_current", true)
    .neq("id", seasonId);
  if (clearError) backToTeams({ error: `Could not change the current season: ${clearError.message}` });

  const { error } = await admin.from("seasons").update({ is_current: true }).eq("id", seasonId);
  if (error) backToTeams({ error: `Could not change the current season: ${error.message}` });

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "set_current",
    entity: "season",
    entityId: seasonId,
    detail: {},
  });

  revalidatePath(TEAMS_PATH);
  backToTeams({ saved: "season" });
}
