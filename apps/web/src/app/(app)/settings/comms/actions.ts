"use server";

/**
 * Communication preferences and the suppression list (PLAN.md P4.4).
 *
 * User-scoped: `comms_preferences` is governed by `can_act_for()` — a person
 * may set their own and their children's, and nobody else's — and
 * `comms_suppressions` by `is_club_admin()`. Both of those questions are the
 * database's to answer.
 */

import { revalidatePath } from "next/cache";

import type { Database } from "@club/db";

import { COMMS_CHANNELS } from "@/lib/comms";
import { createClient } from "@/lib/supabase/server";

export type ActionState = { error?: string; notice?: string };

type Channel = Database["public"]["Enums"]["comms_channel"];

const COMMS_PATH = "/settings/comms";

/**
 * Absence of a row means "enabled" for every channel except SMS, which is
 * opt-in. Writing an explicit row for all four keeps the screen and the
 * database saying the same thing.
 */
export async function savePreferences(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const personId = String(formData.get("person_id") ?? "");
  if (!personId) return { error: "No person given." };

  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();

  const rows = COMMS_CHANNELS.map((channel) => ({
    person_id: personId,
    channel,
    enabled: formData.get(`channel_${channel}`) === "on",
    updated_by: user.user?.id ?? null,
  }));

  const { error } = await supabase
    .from("comms_preferences")
    .upsert(rows, { onConflict: "person_id,channel" });
  if (error) return { error: error.message };

  revalidatePath(COMMS_PATH);
  return { notice: "Preferences saved." };
}

/** Committee only, and the database agrees: a hard block on an address. */
export async function addSuppression(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const channel = String(formData.get("channel") ?? "email");
  const address = String(formData.get("address") ?? "").trim().toLowerCase();
  const reason = String(formData.get("reason") ?? "").trim();

  if (!COMMS_CHANNELS.includes(channel as Channel)) return { error: "Pick a channel." };
  if (!address) return { error: "Enter the address to suppress." };
  if (!reason) return { error: "Say why — a suppression with no reason cannot be reviewed later." };

  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const { error } = await supabase.from("comms_suppressions").insert({
    channel: channel as Channel,
    address,
    reason,
    created_by: user.user?.id ?? null,
  });
  if (error) return { error: error.message };

  revalidatePath(COMMS_PATH);
  return { notice: `${address} will no longer be contacted by ${channel}.` };
}

export async function removeSuppression(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get("suppression_id") ?? "");
  if (!id) return { error: "No suppression given." };

  const supabase = await createClient();
  const { error } = await supabase.from("comms_suppressions").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath(COMMS_PATH);
  return { notice: "Suppression removed." };
}
