"use server";

/**
 * Connected Adults' one write: `add_household_adult()` (join flow,
 * 20260824280000). The RPC holds every rule — the caller must be a known
 * adult, the new person must be an adult (children go through `add_child()`
 * so a guardianship is recorded), and the addition is audited. Its SG-4
 * refusals arrive as P0001 and are shown VERBATIM — they are written for the
 * person reading them.
 */

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export type HouseholdActionState = { error?: string; notice?: string };

function isPlausibleDob(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export async function addHouseholdAdult(
  _prev: HouseholdActionState,
  formData: FormData,
): Promise<HouseholdActionState> {
  const firstName = String(formData.get("first_name") ?? "").trim();
  const lastName = String(formData.get("last_name") ?? "").trim();
  const dob = String(formData.get("dob") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();

  if (!firstName) return { error: "Their first name is required." };
  if (!lastName) return { error: "Their last name is required." };
  if (!isPlausibleDob(dob)) return { error: "Enter their date of birth." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_household_adult", {
    p_first_name: firstName,
    p_last_name: lastName,
    p_dob: dob,
    p_email: email || undefined,
    p_phone: phone || undefined,
  });

  if (error) {
    if (error.code === "P0001") return { error: error.message };
    if (error.code === "42501") {
      return {
        error:
          "Your sign-in is not linked to a member record yet, so an adult cannot be connected to it. Ask the club to link your account.",
      };
    }
    return { error: error.message };
  }

  revalidatePath("/connected-adults");
  return { notice: `${firstName} has been connected to your account.` };
}
