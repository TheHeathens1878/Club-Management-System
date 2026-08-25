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
 *   · Registering a child is a plain INSERT on `registrations` (through
 *     `submitTeamRegistration`, the write /join makes too). The guardian
 *     policy admits it and `registrations_guard()` re-checks the guardianship,
 *     so a parent who is no longer an active guardian is refused by the
 *     database rather than by a check here.
 *   · Emergency contacts are the child's own record (`set_emergency_contacts`,
 *     Adam 2026-08-25) — up to two, replaced as a set, guardian or admin only.
 *   · Withdrawing is the single UPDATE the guardian and the subject may make
 *     (`registrations_guardian_withdraw` / `registrations_self_withdraw`, both
 *     WITH CHECK `status = 'withdrawn'`) — and, since 20260825260000, only
 *     while the registration is still PENDING. An approved one is withdrawn by
 *     a club administrator; `registrations_guard()` refuses anyone else with a
 *     P0001 that says so, and the sentence below prints it unchanged.
 *
 *   · `update_child_details()` is the one narrow door onto a child's record
 *     (Adam, 2026-08-25). `people` still has no guardian INSERT or UPDATE
 *     policy — the RPC is SECURITY DEFINER and checks the live guardianship
 *     itself — and it accepts CONTACT details only. Name and date of birth are
 *     not parameters, so there is nothing here to send them with.
 */

import { revalidatePath } from "next/cache";

import type { Json } from "@club/db";

import { countyForTown } from "@/lib/address";
import { createClient } from "@/lib/supabase/server";
import { emergencyContactsFromFormData, noEmergencyContacts } from "@/lib/emergency-contacts";
import { saveEmergencyContacts } from "@/lib/emergency-contacts-server";
import { registrationFormFromFormData } from "@/lib/registration-form";
import { customQuestionsFrom, submitTeamRegistration } from "@/lib/registration-server";

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
  const isMinor = String(formData.get("is_minor") ?? "") === "yes";

  if (!personId) return { error: "Missing the person being registered." };
  if (!seasonId) {
    return { error: "The club has not opened a season yet, so registrations cannot be taken." };
  }
  if (!teamId) return { error: "Choose a team." };

  const built = registrationFormFromFormData(formData, {
    includePhotoPreferences: isSelf,
    customQuestions: customQuestionsFrom(formData),
    requireGdpr: formData.get("gdpr_asked") === "yes",
  });
  if ("error" in built) return { error: built.error };

  const supabase = await createClient();
  const { data: season } = await supabase
    .from("seasons")
    .select("id,ends_on")
    .eq("id", seasonId)
    .maybeSingle();
  if (!season) return { error: "That season is not one the club recognises." };

  // The same write /join makes: the ID rule, the emergency-contact rule, the
  // pending row, the uploads and the SG-5 consents, in that order.
  const result = await submitTeamRegistration({
    personId,
    isSelf,
    isMinor,
    seasonId: season.id,
    seasonEndsOn: season.ends_on,
    teamId,
    form: built.form,
    formData,
  });
  if ("error" in result) return { error: result.error };

  revalidatePath(PATH);
  return { notice: "Registration sent. A club administrator will review it." };
}

/**
 * A guardian sets their child's emergency contacts (Adam, 2026-08-25). The
 * RPC is the authority — `can_act_for()` for a minor child, or club_admin —
 * and "I am the first emergency contact" is resolved from the caller's own
 * record in `saveEmergencyContacts`, never from the browser.
 */
export async function updateChildEmergencyContacts(
  _prev: FamilyActionState,
  formData: FormData,
): Promise<FamilyActionState> {
  const childId = String(formData.get("child_person_id") ?? "").trim();
  if (!childId) return { error: "Missing the child these contacts belong to." };

  const posted = emergencyContactsFromFormData(formData);
  if ("error" in posted) return { error: posted.error };
  if (noEmergencyContacts(posted)) {
    return { error: "Name at least one emergency contact, or tick that you are the first one." };
  }

  const saved = await saveEmergencyContacts(childId, posted);
  if (saved.error) return { error: saved.error };

  revalidatePath(PATH);
  return { notice: "Emergency contacts saved." };
}

/**
 * A guardian corrects their child's contact details (Adam, 2026-08-25).
 *
 * "Same address as lead contact" is resolved HERE, from the caller's own
 * `people` row, not from whatever the browser posted: the tick-box is a
 * statement about a household, and the address it stands for is the one the
 * club currently holds for the signed-in guardian. Unticked, the four fields
 * are written as the same object shape the join wizard writes — which is what
 * lets two separated parents keep two different addresses for the same child.
 */
export async function updateChildDetails(
  _prev: FamilyActionState,
  formData: FormData,
): Promise<FamilyActionState> {
  const childId = String(formData.get("child_person_id") ?? "").trim();
  if (!childId) return { error: "Missing the child these details belong to." };

  const preferred = String(formData.get("preferred_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const line1 = String(formData.get("address_line1") ?? "").trim();
  const line2 = String(formData.get("address_line2") ?? "").trim();
  const town = String(formData.get("address_town") ?? "").trim();
  // The town settles the county where the club knows the place (Adam,
  // 2026-08-25), re-derived here so the stored address cannot disagree with
  // the rule the form showed.
  const county = countyForTown(town) ?? String(formData.get("address_county") ?? "").trim();
  const postcode = String(formData.get("address_postcode") ?? "").trim();
  const anyAddress = !!(line1 || line2 || town || postcode);
  // The four fields are only rendered while the box is UNTICKED, so an
  // address arriving alongside a "yes" can only mean the browser reset the
  // checkbox behind React's back (React 19 resets a form once its action
  // completes). The typed address is the parent's clearer statement, so it
  // wins and the tick is ignored — the lead's address never overwrites what
  // was just typed.
  const sameAsLead = String(formData.get("same_as_lead") ?? "") === "yes" && !anyAddress;

  const supabase = await createClient();

  let address: Json | undefined;
  if (sameAsLead) {
    const { data: personId } = await supabase.rpc("current_person_id");
    const { data: lead } = personId
      ? await supabase.from("people").select("address").eq("id", personId).maybeSingle()
      : { data: null };
    const leadAddress = lead?.address ?? null;
    if (!leadAddress) {
      return {
        error:
          "There is no address on your own record to copy. Add yours on My profile, or untick the box and type your child's address.",
      };
    }
    address = leadAddress;
  } else {
    if (anyAddress && (!line1 || !town || !postcode)) {
      return { error: "An address needs at least the first line, the town and the postcode." };
    }
    if (anyAddress) address = { line1, line2: line2 || null, town, county: county || null, postcode };
  }

  const { error } = await supabase.rpc("update_child_details", {
    p_child_person_id: childId,
    p_email: email || undefined,
    p_phone: phone || undefined,
    p_address: address,
    p_preferred_name: preferred || undefined,
  });

  if (error) {
    // P0001 is the SG-4 guard, or the email check, speaking for the parent.
    if (error.code === "P0001") return { error: error.message };
    if (error.code === "42501") {
      return {
        error:
          "Your sign-in is not linked to a member record yet, so the club cannot record a change from you. Ask the club to link your account.",
      };
    }
    return { error: error.message };
  }

  revalidatePath(PATH);
  return { notice: "Saved." };
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
