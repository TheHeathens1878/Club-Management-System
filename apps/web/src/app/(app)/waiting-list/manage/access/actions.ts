"use server";

/**
 * Who may see the waiting list (gap 10).
 *
 * `waiting_list_access` is the grant table `wl_entries_coach_read` reads: one
 * row per (person, age group), and a coach sees exactly the age groups they
 * hold a row for. Both writes go through the USER-SCOPED client, so
 * `wl_access_admin` — club administrators only — is the gate; nothing here
 * re-implements it.
 *
 * The insert fires `trg_waiting_list_access_notify`, which writes the in-app
 * notification telling the coach they now have an age group. No email is sent
 * and none should be: the notification is the notification.
 */

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

const PATH = "/waiting-list/manage/access";

export type AccessActionState = { error?: string; notice?: string };

export async function grantWaitingListAccess(
  _prev: AccessActionState,
  formData: FormData,
): Promise<AccessActionState> {
  const personId = String(formData.get("person_id") ?? "").trim();
  const ageGroup = String(formData.get("age_group") ?? "").trim();
  if (!personId) return { error: "Choose a person." };
  if (!ageGroup) return { error: "Choose an age group." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase
    .from("waiting_list_access")
    .insert({ person_id: personId, age_group: ageGroup, granted_by: user?.id ?? null });

  if (error) {
    if (error.code === "23505") return { error: "They already have that age group." };
    if (error.code === "42501") {
      return { error: "Only a club administrator can grant waiting list access." };
    }
    if (error.code === "P0001") return { error: error.message };
    return { error: error.message };
  }

  revalidatePath(PATH);
  revalidatePath("/waiting-list/manage");
  return { notice: `Access to ${ageGroup} granted. They have been notified in the app.` };
}

export async function revokeWaitingListAccess(
  _prev: AccessActionState,
  formData: FormData,
): Promise<AccessActionState> {
  const personId = String(formData.get("person_id") ?? "").trim();
  const ageGroup = String(formData.get("age_group") ?? "").trim();
  if (!personId || !ageGroup) return { error: "Missing grant." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("waiting_list_access")
    .delete()
    .eq("person_id", personId)
    .eq("age_group", ageGroup)
    .select("person_id");

  if (error) {
    if (error.code === "42501") {
      return { error: "Only a club administrator can revoke waiting list access." };
    }
    return { error: error.message };
  }
  if ((data ?? []).length === 0) {
    return { error: "Nothing was revoked — only a club administrator can change these grants." };
  }

  revalidatePath(PATH);
  revalidatePath("/waiting-list/manage");
  return { notice: `Access to ${ageGroup} revoked.` };
}
