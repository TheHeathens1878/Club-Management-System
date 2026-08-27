"use server";

/**
 * Connected Adults' one write: `add_household_adult()` (join flow,
 * 20260824280000; matching and linking added 20260825490000). The RPC holds
 * every rule — the caller must be a known adult, the new person must be an
 * adult (children go through `add_child()` so a guardianship is recorded), an
 * EMAIL match links the club's existing record instead of creating a second
 * one, and a NAME-only match refuses to link at all. Its SG-4 refusals arrive
 * as P0001 and are shown VERBATIM: they are written for the person reading
 * them.
 *
 * The one refusal that is not a dead end carries `hint = 'confirm_new'`: the
 * club already has somebody of that name, and the member must either give the
 * email address (which is proof, and links) or say plainly that this is a
 * different person. That second answer comes back here as `confirm_new`.
 */

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export type HouseholdAdultInput = {
  first_name: string;
  last_name: string;
  dob: string;
  email: string;
  phone: string;
};

export type HouseholdActionState = {
  error?: string;
  notice?: string;
  /** A possible duplicate: the database's sentence, and what to re-post. */
  confirm?: { message: string; values: HouseholdAdultInput };
};

function isPlausibleDob(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** "add_household_adult: only a known adult…" reads better without the prefix. */
function tidy(message: string): string {
  return message.replace(/^[a-z_]+: /, "");
}

export async function addHouseholdAdult(
  _prev: HouseholdActionState,
  formData: FormData,
): Promise<HouseholdActionState> {
  const values: HouseholdAdultInput = {
    first_name: String(formData.get("first_name") ?? "").trim(),
    last_name: String(formData.get("last_name") ?? "").trim(),
    dob: String(formData.get("dob") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim(),
    phone: String(formData.get("phone") ?? "").trim(),
  };
  const confirmNew = formData.get("confirm_new") === "yes";

  if (!values.first_name) return { error: "Their first name is required." };
  if (!values.last_name) return { error: "Their last name is required." };
  if (!isPlausibleDob(values.dob)) return { error: "Enter their date of birth." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_household_adult", {
    p_first_name: values.first_name,
    p_last_name: values.last_name,
    p_dob: values.dob,
    p_email: values.email || undefined,
    p_phone: values.phone || undefined,
    p_confirm_new: confirmNew,
  });

  if (error) {
    if (error.hint === "confirm_new") {
      return { confirm: { message: tidy(error.message), values } };
    }
    if (error.code === "P0001") return { error: tidy(error.message) };
    if (error.code === "42501") {
      return {
        error:
          "Your sign-in is not linked to a member record yet, so an adult cannot be connected to it. Ask the club to link your account.",
      };
    }
    return { error: tidy(error.message) };
  }

  revalidatePath("/connected-adults");
  return {
    notice: `${values.first_name} is now connected to your account. If the club already held a record for them, that record has been connected rather than a second one created.`,
  };
}


/**
 * Correct a connected adult's record (Adam, 2026-08-26: "We should be able to
 * edit details also").
 *
 * The authority is the database's: `update_household_adult_details()` refuses
 * anyone who is not connected to this login, anyone who holds their own login
 * — their email is where a password reset goes — and anyone under 18. Its
 * refusals are shown word for word, minus the function-name prefix, because
 * they say which door to use instead.
 */
export async function editHouseholdAdult(
  _prev: HouseholdActionState,
  formData: FormData,
): Promise<HouseholdActionState> {
  const personId = String(formData.get("person_id") ?? "").trim();
  const firstName = String(formData.get("first_name") ?? "").trim();
  const lastName = String(formData.get("last_name") ?? "").trim();
  const preferredName = String(formData.get("preferred_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();

  if (!personId) return { error: "No person given." };
  if (!firstName) return { error: "Their first name is required." };
  if (!lastName) return { error: "Their last name is required." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_household_adult_details", {
    p_person_id: personId,
    p_first_name: firstName,
    p_last_name: lastName,
    p_preferred_name: preferredName || undefined,
    p_email: email || undefined,
    p_phone: phone || undefined,
  });

  if (error) return { error: tidy(error.message) };

  revalidatePath("/connected-adults");
  return { notice: `${firstName}'s details have been updated.` };
}
