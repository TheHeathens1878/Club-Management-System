"use server";

/**
 * Family self-service writes (gap 9).
 *
 * Everything goes through the USER-SCOPED client, so the safeguarding rules
 * are the database's and the messages are the database's words:
 *
 *   · `add_child()` is one SECURITY DEFINER entry point that creates the
 *     person and the guardianship together. Its SG-4 refusals ("adults create
 *     their own account", "the guardian's date of birth is unknown") arrive as
 *     P0001 and are shown VERBATIM — they are written for the parent reading
 *     them, and rewriting them would lose the reason.
 *   · Registering a child is a plain INSERT on `registrations`. The guardian
 *     policy admits it and `registrations_guard()` re-checks the guardianship,
 *     so a parent who is no longer an active guardian is refused by the
 *     database rather than by a check here.
 *   · Withdrawing is the single UPDATE the guardian and the subject may make
 *     (`registrations_guardian_withdraw` / `registrations_self_withdraw`, both
 *     WITH CHECK `status = 'withdrawn'`).
 *
 * There is deliberately no "edit my child" action: `people` has a guardian
 * READ policy and no guardian INSERT or UPDATE, by design (P1.2 / SG-4). A
 * correction goes through the club, and the page says so.
 */

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import {
  REGISTRATION_FORM_VERSION,
  registrationFormFromFormData,
} from "@/lib/registration-form";

const PATH = "/family";

export type FamilyActionState = { error?: string; notice?: string };

/** Ten years is well past any plausible mistyped year; a future date is refused by the RPC. */
function isPlausibleDob(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export async function addChild(
  _prev: FamilyActionState,
  formData: FormData,
): Promise<FamilyActionState> {
  const firstName = String(formData.get("first_name") ?? "").trim();
  const lastName = String(formData.get("last_name") ?? "").trim();
  const preferred = String(formData.get("preferred_name") ?? "").trim();
  const dob = String(formData.get("dob") ?? "").trim();

  if (!firstName) return { error: "Your child's first name is required." };
  if (!lastName) return { error: "Your child's last name is required." };
  if (!isPlausibleDob(dob)) return { error: "Enter your child's date of birth." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_child", {
    p_first_name: firstName,
    p_last_name: lastName,
    p_dob: dob,
    p_preferred_name: preferred || undefined,
  });

  if (error) {
    // P0001 is a safeguarding guard speaking — show it word for word.
    if (error.code === "P0001") return { error: error.message };
    if (error.code === "42501") {
      return {
        error:
          "Your sign-in is not linked to a member record yet, so a child cannot be added to it. Ask the club to link your account.",
      };
    }
    return { error: error.message };
  }

  revalidatePath(PATH);
  return { notice: `${firstName} has been added to your family.` };
}

export async function registerForTeam(
  _prev: FamilyActionState,
  formData: FormData,
): Promise<FamilyActionState> {
  const personId = String(formData.get("person_id") ?? "").trim();
  const seasonId = String(formData.get("season_id") ?? "").trim();
  const teamId = String(formData.get("team_id") ?? "").trim();
  const isSelf = String(formData.get("is_self") ?? "") === "yes";

  if (!personId) return { error: "Missing the person being registered." };
  if (!seasonId) {
    return { error: "The club has not opened a season yet, so registrations cannot be taken." };
  }
  if (!teamId) return { error: "Choose a team." };

  const built = registrationFormFromFormData(formData, { includePhotoPreferences: isSelf });
  if ("error" in built) return { error: built.error };

  const supabase = await createClient();
  const { error } = await supabase.from("registrations").insert({
    person_id: personId,
    season_id: seasonId,
    team_id: teamId,
    form: built.form,
    form_version: REGISTRATION_FORM_VERSION,
  });

  if (error) {
    if (error.code === "P0001") return { error: error.message };
    if (error.code === "23505") {
      return {
        error:
          "There is already a registration waiting or approved for this season. Withdraw it first if you need to change it.",
      };
    }
    if (error.code === "42501") {
      return {
        error:
          "The club's records do not show you as an active guardian of this player, so this registration was refused.",
      };
    }
    return { error: error.message };
  }

  revalidatePath(PATH);
  return { notice: "Registration sent. A club administrator will review it." };
}

export async function withdrawRegistration(
  _prev: FamilyActionState,
  formData: FormData,
): Promise<FamilyActionState> {
  const registrationId = String(formData.get("registration_id") ?? "").trim();
  if (!registrationId) return { error: "Missing registration." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("registrations")
    .update({ status: "withdrawn" })
    .eq("id", registrationId)
    .select("id");

  if (error) {
    if (error.code === "P0001") return { error: error.message };
    if (error.code === "42501") {
      return { error: "Only the player, an active guardian or a club administrator may withdraw this." };
    }
    return { error: error.message };
  }
  if ((data ?? []).length === 0) {
    return {
      error:
        "Nothing was withdrawn — this registration is no longer yours to change, or it has already been decided.",
    };
  }

  revalidatePath(PATH);
  return { notice: "Registration withdrawn." };
}
