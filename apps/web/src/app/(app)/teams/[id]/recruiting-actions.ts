"use server";

/**
 * The team's recruiting block (gap 10).
 *
 * One UPDATE on `teams` through the USER-SCOPED client. Two policies can admit
 * it — `teams_admin_write` for a club administrator and `teams_staff_update`
 * for the team's own staff — and `teams_staff_update_guard()` refuses, with
 * P0001, any attempt by a non-administrator to change the team's name, age
 * group, status, sort order or notes. This action sends only the recruiting
 * columns, so the guard should never fire; if it does, its message is shown
 * word for word rather than replaced with a guess about why.
 *
 * `show_coach_contact` is the switch `recruiting_teams()` reads: with it off,
 * the public page gets NULLs for the contact columns rather than a page that
 * politely declines to render them. Turning it on is publishing a phone number
 * to the internet, and the form says so.
 */

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export type RecruitingState = { error?: string; notice?: string };

const GENDERS = new Set(["mixed", "boys", "girls"]);
const JOIN_TYPES = new Set(["open", "waiting_list", "trial", "closed"]);

function optional(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value === "" ? null : value;
}

export async function updateTeamRecruiting(
  _prev: RecruitingState,
  formData: FormData,
): Promise<RecruitingState> {
  const teamId = String(formData.get("team_id") ?? "").trim();
  if (!teamId) return { error: "Missing team." };

  const gender = optional(formData, "gender");
  const joinType = optional(formData, "join_type");
  if (gender !== null && !GENDERS.has(gender)) return { error: "Choose a valid team make-up." };
  if (joinType !== null && !JOIN_TYPES.has(joinType)) return { error: "Choose a valid way to join." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("teams")
    .update({
      recruiting: formData.get("recruiting") === "yes",
      gender,
      join_type: joinType,
      join_instructions: optional(formData, "join_instructions"),
      session_details: optional(formData, "session_details"),
      contact_name: optional(formData, "contact_name"),
      contact_email: optional(formData, "contact_email"),
      contact_phone: optional(formData, "contact_phone"),
      show_coach_contact: formData.get("show_coach_contact") === "yes",
    })
    .eq("id", teamId)
    .select("id");

  if (error) {
    // The staff guard speaks P0001 and names exactly what it refused.
    if (error.code === "P0001") return { error: error.message };
    if (error.code === "42501") {
      return { error: "Only this team's staff or a club administrator can change these details." };
    }
    if (error.code === "23514") {
      return { error: "That combination is not one the club allows. Check the make-up and the way to join." };
    }
    return { error: error.message };
  }
  if ((data ?? []).length === 0) {
    return { error: "Only this team's staff or a club administrator can change these details." };
  }

  revalidatePath(`/teams/${teamId}`);
  revalidatePath("/recruitment");
  return { notice: "Recruiting details saved." };
}
