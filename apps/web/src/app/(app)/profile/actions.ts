"use server";

/**
 * My Profile's one write: `update_own_contact()` (join flow, 20260824280000).
 *
 * The RPC is the whole rulebook — it finds the caller's own person row and
 * touches nothing else, so this action does no authorisation of its own. Name,
 * email and date of birth are deliberately not here: the name and date of
 * birth are the club's record to correct (P1.2), and the email is the login.
 *
 * The RPC coalesces, so a blank field keeps what is already stored rather than
 * clearing it. The form pre-fills every field, which makes that invisible in
 * practice; the address is sent as the complete object the form shows.
 */

import { revalidatePath } from "next/cache";

import { countyForTown } from "@/lib/address";
import { createClient } from "@/lib/supabase/server";
import { emergencyContactsFromFormData } from "@/lib/emergency-contacts";
import { saveEmergencyContacts } from "@/lib/emergency-contacts-server";

export type ProfileActionState = { error?: string; notice?: string };

export async function updateContactDetails(
  _prev: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const preferred = String(formData.get("preferred_name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const line1 = String(formData.get("address_line1") ?? "").trim();
  const line2 = String(formData.get("address_line2") ?? "").trim();
  const town = String(formData.get("address_town") ?? "").trim();
  // The town settles the county where the club knows the place (Adam,
  // 2026-08-25); the browser posts what the field was holding, and this
  // re-derives it so a hand-edited form cannot store "Sale, Cheshire".
  const postedCounty = String(formData.get("address_county") ?? "").trim();
  const county = countyForTown(town) ?? postedCounty;
  const postcode = String(formData.get("address_postcode") ?? "").trim();

  const anyAddress = !!(line1 || line2 || town || postcode);
  if (anyAddress && (!line1 || !town || !postcode)) {
    return { error: "An address needs at least the first line, the town and the postcode." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_own_contact", {
    p_preferred_name: preferred || undefined,
    p_phone: phone || undefined,
    p_address: anyAddress
      ? { line1, line2: line2 || null, town, county: county || null, postcode }
      : undefined,
  });

  if (error) {
    // P0001 and 42501 are the database speaking — its words are for the reader.
    if (error.code === "P0001") return { error: error.message };
    if (error.code === "42501") {
      return {
        error:
          "Your sign-in is not linked to a member record yet, so there is nothing to update. Ask the club to link your account.",
      };
    }
    return { error: error.message };
  }

  revalidatePath("/profile");
  return { notice: "Saved." };
}

/**
 * The caller's own emergency contacts (Adam, 2026-08-25) — up to two, through
 * `set_emergency_contacts()`, which checks `can_act_for(self)` itself. An
 * empty list is allowed here: clearing your own contacts is your call, and
 * the registration is what insists on one.
 */
export async function updateEmergencyContacts(
  _prev: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const supabase = await createClient();
  const { data: personId } = await supabase.rpc("current_person_id");
  if (!personId) {
    return {
      error:
        "Your sign-in is not linked to a member record yet, so there is nothing to update. Ask the club to link your account.",
    };
  }

  const posted = emergencyContactsFromFormData(formData);
  if ("error" in posted) return { error: posted.error };

  const saved = await saveEmergencyContacts(personId, posted);
  if (saved.error) return { error: saved.error };

  revalidatePath("/profile");
  return { notice: "Emergency contacts saved." };
}
