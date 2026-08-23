"use server";

/**
 * The registrations desk's two decisions (gap 9).
 *
 * Both are a single UPDATE on `registrations` through the USER-SCOPED client.
 * `registrations_admin_update` is the only policy that admits them, and
 * `registrations_guard()` does the rest as one unit:
 *
 *   · it stamps `decided_at` / `decided_by` itself — this action must not, and
 *     the guard raises P0001 if it tries;
 *   · on approval with a `team_id` it creates the live `team_memberships`
 *     (player) row for that season, which is what makes P2.1's SG-6 team
 *     composition guard run at the moment a human is looking. If SG-6 refuses,
 *     the whole approval fails and the registration stays pending. That
 *     message names the coach and the missing certification, so it is shown
 *     VERBATIM: it is the administrator's to-do list.
 *
 * The team membership is therefore NOT created here. Doing it separately would
 * either duplicate the row or move the SG-6 check away from the decision.
 */

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

const PATH = "/registrations";

export type RegistrationDecisionState = {
  error?: string;
  notice?: string;
  /** A guard refused — the database's own words, shown unedited. */
  blocked?: string;
};

export async function approveRegistration(
  _prev: RegistrationDecisionState,
  formData: FormData,
): Promise<RegistrationDecisionState> {
  const registrationId = String(formData.get("registration_id") ?? "").trim();
  const teamId = String(formData.get("team_id") ?? "").trim();
  if (!registrationId) return { error: "Missing registration." };
  if (!teamId) return { error: "Choose the team they are being approved for." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("registrations")
    .update({ status: "approved", team_id: teamId })
    .eq("id", registrationId)
    .select("id");

  if (error) {
    // SG-6 and the status machine both speak P0001 and both are worth reading.
    if (error.code === "P0001") return { blocked: error.message };
    if (error.code === "42501") {
      return { error: "Only a club administrator can approve a registration." };
    }
    return { error: error.message };
  }
  if ((data ?? []).length === 0) {
    return { error: "Only a club administrator can approve a registration." };
  }

  revalidatePath(PATH);
  return { notice: "Approved — the player has been added to the team for this season." };
}

export async function rejectRegistration(
  _prev: RegistrationDecisionState,
  formData: FormData,
): Promise<RegistrationDecisionState> {
  const registrationId = String(formData.get("registration_id") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  if (!registrationId) return { error: "Missing registration." };
  if (!note) return { error: "Say why — the family sees this note." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("registrations")
    .update({ status: "rejected", decision_note: note })
    .eq("id", registrationId)
    .select("id");

  if (error) {
    if (error.code === "P0001") return { blocked: error.message };
    if (error.code === "42501") {
      return { error: "Only a club administrator can reject a registration." };
    }
    return { error: error.message };
  }
  if ((data ?? []).length === 0) {
    return { error: "Only a club administrator can reject a registration." };
  }

  revalidatePath(PATH);
  return { notice: "Rejected." };
}
