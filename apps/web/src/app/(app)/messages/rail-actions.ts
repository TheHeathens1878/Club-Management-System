"use server";

/**
 * The conversation rail's own writes (Adam, 2026-08-25: "we should be able to
 * delete them and archive them") — all against the caller's OWN participation
 * rows, through their own client, so RLS is the whole authorisation story.
 *
 *   · archive / unarchive — shelve the conversation for me alone. History and
 *     everyone else's list are untouched; a newer message un-shelves it.
 *   · remove ("delete") — leave the conversation AND shelve it. Messages are
 *     never deleted (SG-2); the thread stays readable from the archive. The
 *     SG-1 trigger still referees the leave and its refusal is surfaced.
 */

import { revalidatePath } from "next/cache";

import { getCurrentPersonId } from "@/lib/person";
import { createClient } from "@/lib/supabase/server";

export type RailActionState = { error?: string };

export async function archiveConversation(conversationId: string): Promise<RailActionState> {
  const personId = await getCurrentPersonId();
  if (!personId) return { error: "Not linked to a member record." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("conversation_participants")
    .update({ archived_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .eq("person_id", personId);
  if (error) return { error: error.message };
  revalidatePath("/messages");
  return {};
}

export async function unarchiveConversation(conversationId: string): Promise<RailActionState> {
  const personId = await getCurrentPersonId();
  if (!personId) return { error: "Not linked to a member record." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("conversation_participants")
    .update({ archived_at: null })
    .eq("conversation_id", conversationId)
    .eq("person_id", personId);
  if (error) return { error: error.message };
  revalidatePath("/messages");
  return {};
}

export async function removeConversation(conversationId: string): Promise<RailActionState> {
  const personId = await getCurrentPersonId();
  if (!personId) return { error: "Not linked to a member record." };
  const supabase = await createClient();
  // Leave the live participation (the SG-1 trigger referees this — leaving a
  // group must not strand an adult alone with a minor), then shelve every row.
  const { error: leaveError } = await supabase
    .from("conversation_participants")
    .update({ left_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .eq("person_id", personId)
    .is("left_at", null);
  if (leaveError) return { error: leaveError.message };
  const { error } = await supabase
    .from("conversation_participants")
    .update({ archived_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .eq("person_id", personId);
  if (error) return { error: error.message };
  revalidatePath("/messages");
  return {};
}
