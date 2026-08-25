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

import { createClient } from "@/lib/supabase/server";

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
  const postcode = String(formData.get("address_postcode") ?? "").trim();

  const anyAddress = !!(line1 || line2 || town || postcode);
  if (anyAddress && (!line1 || !town || !postcode)) {
    return { error: "An address needs at least the first line, the town and the postcode." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_own_contact", {
    p_preferred_name: preferred || undefined,
    p_phone: phone || undefined,
    p_address: anyAddress ? { line1, line2: line2 || null, town, postcode } : undefined,
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
