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

// ---------------------------------------------------------------------------
// App-account consent (SG-10)
// ---------------------------------------------------------------------------
// A child of 13 or over may hold their own login ONLY while an active
// `app_account` consent from an active guardian stands — the SG-10 trigger on
// `profiles` is what enforces that, and these two actions are the guardian's
// end of it. Neither action decides anything:
//
//   · The grant is a plain INSERT. `guardian_consents_guardian_insert` admits
//     it only when `guardian_person_id` is the caller and the caller holds a
//     live `guardianships` row to that child, and §9a's SECURITY DEFINER guard
//     re-checks the same thing plus "the child is a minor" and "the guardian is
//     an adult with a known date of birth". Every one of those refusals is a
//     P0001 written for the parent reading it, so it is shown VERBATIM.
//   · The withdrawal is the single UPDATE a guardian may make
//     (`guardian_consents_guardian_update`, narrowed to `revoked_at` /
//     `revoked_by` by §9b's change guard). Any live guardian may withdraw, not
//     only the one who granted — the database decides that, not this file.
//
// The partial unique index on (child_person_id, consent_type) WHERE revoked_at
// IS NULL means a second grant while one stands comes back as 23505, which is
// the honest answer: consent is already held.

/**
 * Which version of the monitoring notice the guardian was shown (SG-9).
 *
 * `guardian_consents.notice_version` is NOT NULL because a consent whose terms
 * cannot be reconstructed is not evidence of anything. Nothing in the codebase
 * writes a consent yet, so this is the first version: the wording on
 * `/family`'s consent card. Bump it — and only bump it — when that wording
 * changes, because an old row must keep naming what its guardian actually read.
 */
const APP_ACCOUNT_NOTICE_VERSION = "1";

export async function allowAppAccess(
  _prev: FamilyActionState,
  formData: FormData,
): Promise<FamilyActionState> {
  const childId = String(formData.get("child_person_id") ?? "").trim();
  if (!childId) return { error: "Missing the child this consent is about." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in again — your session has expired." };

  const { data: personId } = await supabase.rpc("current_person_id");
  if (!personId) {
    return {
      error:
        "Your sign-in is not linked to a member record yet, so the club cannot record a consent from you. Ask the club to link your account.",
    };
  }

  const { error } = await supabase.from("guardian_consents").insert({
    child_person_id: childId,
    guardian_person_id: personId,
    consent_type: "app_account",
    notice_version: APP_ACCOUNT_NOTICE_VERSION,
    granted_by: user.id,
  });

  if (error) {
    // P0001 is the SG-10 grant guard speaking — word for word.
    if (error.code === "P0001") return { error: error.message };
    if (error.code === "23505") {
      return { error: "Consent for an app account is already held for this child." };
    }
    if (error.code === "42501") {
      return {
        error:
          "The club's records do not show you as an active guardian of this child, so this consent was refused.",
      };
    }
    return { error: error.message };
  }

  revalidatePath(PATH);
  return { notice: "Consent recorded. Your child can now create their own login." };
}

export async function withdrawAppAccess(
  _prev: FamilyActionState,
  formData: FormData,
): Promise<FamilyActionState> {
  const consentId = String(formData.get("consent_id") ?? "").trim();
  if (!consentId) return { error: "Missing the consent to withdraw." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in again — your session has expired." };

  const { data, error } = await supabase
    .from("guardian_consents")
    .update({ revoked_at: new Date().toISOString(), revoked_by: user.id })
    .eq("id", consentId)
    .is("revoked_at", null)
    .select("id");

  if (error) {
    // P0001 is §9b's change guard speaking — word for word.
    if (error.code === "P0001") return { error: error.message };
    if (error.code === "42501") {
      return {
        error:
          "Only an active guardian of this child, a club administrator or the safeguarding lead can withdraw this consent.",
      };
    }
    return { error: error.message };
  }
  if ((data ?? []).length === 0) {
    return {
      error:
        "Nothing was withdrawn — this consent is no longer yours to change, or it has already been withdrawn.",
    };
  }

  revalidatePath(PATH);
  return { notice: "Consent withdrawn." };
}
