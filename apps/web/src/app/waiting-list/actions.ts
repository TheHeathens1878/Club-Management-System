"use server";

/**
 * Public waiting list submission (PLAN.md P3.4).
 *
 * The caller here is usually anonymous, and `anon` holds no privilege at all
 * on `waiting_list_entries` — the row can only be written through
 * `submit_waiting_list_entry()`, a SECURITY DEFINER function that re-checks
 * consent and that the age group is open before it inserts. So the validation
 * below is there to give a parent a useful message, not to authorise anything:
 * the database refuses on its own terms whatever this file does.
 */

import { createClient } from "@/lib/supabase/server";
import { tidyRpcMessage } from "@/lib/waiting-list";

export type SubmitState = { ok?: boolean; error?: string };

function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

export async function submitWaitingListEntry(
  _prev: SubmitState,
  formData: FormData,
): Promise<SubmitState> {
  const playerFirstName = text(formData, "player_first_name");
  const playerLastName = text(formData, "player_last_name");
  const dob = text(formData, "dob");
  const ageGroup = text(formData, "age_group");
  const schoolYear = text(formData, "school_year");
  const biologicalSex = text(formData, "biological_sex");
  const teamPreference = text(formData, "team_preference");
  const schoolChoice = text(formData, "school");
  const schoolOther = text(formData, "school_other");
  const healthConditions = text(formData, "health_conditions");
  const parentFirstName = text(formData, "parent_first_name");
  const parentLastName = text(formData, "parent_last_name");
  const parentEmail = text(formData, "parent_email");
  const parentPhone = text(formData, "parent_phone");
  const coachingInterest = formData.get("coaching_interest") === "yes";
  const coachingNote = text(formData, "coaching_note");
  const dataConsent = formData.get("data_consent") === "yes";

  if (!playerFirstName) return { error: "Please enter the player's first name." };
  if (!playerLastName) return { error: "Please enter the player's last name." };
  if (!dob) return { error: "Please enter the player's date of birth." };
  if (Number.isNaN(new Date(dob).getTime())) return { error: "Please enter a valid date of birth." };
  if (!ageGroup) return { error: "Please choose an age group." };
  if (!schoolYear) return { error: "Please choose a school year." };
  if (biologicalSex !== "MALE" && biologicalSex !== "FEMALE") {
    return { error: "Please tell us the player's biological sex." };
  }
  if (biologicalSex === "FEMALE" && !teamPreference) {
    return { error: "Please choose a team preference." };
  }
  if (!parentFirstName) return { error: "Please enter the parent or guardian's first name." };
  if (!parentLastName) return { error: "Please enter the parent or guardian's last name." };
  if (!parentEmail) return { error: "Please enter an email address." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail)) {
    return { error: "Please enter a valid email address." };
  }
  if (!parentPhone) return { error: "Please enter a phone number." };
  if (!dataConsent) return { error: "We cannot accept the form without your consent." };

  const school = schoolChoice === "Other" ? schoolOther : schoolChoice;

  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_waiting_list_entry", {
    p_player_first_name: playerFirstName,
    p_player_last_name: playerLastName,
    p_dob: dob,
    p_age_group: ageGroup,
    p_school_year: schoolYear,
    p_biological_sex: biologicalSex,
    p_team_preference: biologicalSex === "FEMALE" ? teamPreference : "",
    p_school: school,
    p_health_conditions: healthConditions,
    p_parent_first_name: parentFirstName,
    p_parent_last_name: parentLastName,
    p_parent_email: parentEmail,
    p_parent_phone: parentPhone,
    p_coaching_interest: coachingInterest,
    p_coaching_note: coachingInterest ? coachingNote : "",
    p_data_consent: dataConsent,
  });

  if (error) return { error: tidyRpcMessage(error.message) };

  return { ok: true };
}
