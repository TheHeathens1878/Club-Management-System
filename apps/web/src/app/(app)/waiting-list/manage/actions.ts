"use server";

/**
 * The waiting list desk's writes (PLAN.md P3.4).
 *
 * User-scoped throughout — RLS is the authorisation, not the checks here:
 *   · a note may be added by a club administrator, or by a coach who holds a
 *     `waiting_list_access` row for that entry's age group, and only ever with
 *     `author_person_id = current_person_id()`;
 *   · the status is a club administrator's alone;
 *   · the age group settings (open for new entries, advertised publicly) are a
 *     club administrator's alone and go through `set_waiting_list_age_group()`
 *     — the table takes no write from `authenticated` at all since
 *     20260825290000, and the function answers anyone else with a readable
 *     42501 rather than the silent no-op a policy gives.
 *
 * A coach has no UPDATE policy on `waiting_list_entries`, so an attempt to
 * change a status does not raise — the row simply is not visible to the
 * statement and nothing is written. That is why the update asks for the
 * changed row back and treats an empty result as a refusal.
 */

import { revalidatePath } from "next/cache";

import { getCurrentPersonId } from "@/lib/person";
import { createClient } from "@/lib/supabase/server";
import { isWaitingListStatus } from "@/lib/waiting-list";

const PATH = "/waiting-list/manage";

export type WaitingListActionState = { error?: string; notice?: string };

export async function addWaitingListNote(
  _prev: WaitingListActionState,
  formData: FormData,
): Promise<WaitingListActionState> {
  const entryId = String(formData.get("entry_id") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!entryId) return { error: "Missing entry." };
  if (!body) return { error: "Write something first." };

  const personId = await getCurrentPersonId();
  if (!personId) {
    return { error: "Your account is not linked to a member record, so notes cannot be attributed." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("waiting_list_notes")
    .insert({ entry_id: entryId, author_person_id: personId, body });

  if (error) {
    return {
      error:
        error.code === "42501"
          ? "You do not have access to this age group."
          : error.message,
    };
  }

  revalidatePath(PATH);
  return { notice: "Note added." };
}

export async function setWaitingListStatus(
  _prev: WaitingListActionState,
  formData: FormData,
): Promise<WaitingListActionState> {
  const entryId = String(formData.get("entry_id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  if (!entryId) return { error: "Missing entry." };
  if (!isWaitingListStatus(status)) return { error: "Choose a status." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("waiting_list_entries")
    .update({ status })
    .eq("id", entryId)
    .select("id");

  if (error) {
    return {
      error:
        error.code === "42501"
          ? "Only a club administrator can change a waiting list status."
          : error.message,
    };
  }
  if ((data ?? []).length === 0) {
    return { error: "Only a club administrator can change a waiting list status." };
  }

  revalidatePath(PATH);
  return { notice: "Status updated." };
}

/**
 * Write the running order of one age group (gap 10).
 *
 * `priority` is a plain integer on the entry and the desk already sorts by it,
 * so ordering is "renumber these ids 1..n in the order they were posted".
 * There is no coach UPDATE policy on `waiting_list_entries`, so a coach's post
 * matches no row and writes nothing — which is why the count of changed rows
 * is checked rather than trusted.
 */
export async function setWaitingListPriorities(
  _prev: WaitingListActionState,
  formData: FormData,
): Promise<WaitingListActionState> {
  const ageGroup = String(formData.get("age_group") ?? "").trim();
  const ids = formData
    .getAll("entry_id")
    .map((value) => String(value).trim())
    .filter(Boolean);
  if (ids.length === 0) return { error: "Nothing to order." };

  const supabase = await createClient();
  let changed = 0;
  for (const [index, id] of ids.entries()) {
    const { data, error } = await supabase
      .from("waiting_list_entries")
      .update({ priority: index + 1 })
      .eq("id", id)
      .select("id");
    if (error) {
      return {
        error:
          error.code === "42501"
            ? "Only a club administrator can set waiting list priorities."
            : error.message,
      };
    }
    changed += (data ?? []).length;
  }

  if (changed === 0) {
    return { error: "Only a club administrator can set waiting list priorities." };
  }

  revalidatePath(PATH);
  return { notice: `${ageGroup || "Order"} saved — ${changed} numbered.` };
}

export async function setAgeGroupAvailability(
  _prev: WaitingListActionState,
  formData: FormData,
): Promise<WaitingListActionState> {
  const ageGroup = String(formData.get("age_group") ?? "").trim();
  if (!ageGroup) return { error: "Choose an age group." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_waiting_list_age_group", {
    p_age_group: ageGroup,
    p_is_open: formData.get("is_open") === "yes",
    p_is_publicly_advertised: formData.get("is_publicly_advertised") === "yes",
  });

  if (error) return { error: error.message };

  revalidatePath(PATH);
  revalidatePath("/waiting-list");
  revalidatePath("/recruitment");
  return { notice: `${ageGroup} saved.` };
}
