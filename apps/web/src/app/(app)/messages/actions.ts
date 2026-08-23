"use server";

/**
 * Messaging actions (PLAN.md P5.4, P5.6).
 *
 * Every one of these uses the USER-SCOPED client. That is a safeguarding
 * requirement, not a style choice: SG-1, SG-2 and SG-9 are enforced by
 * triggers, participant-scoped RLS and SECURITY DEFINER accessors that all key
 * off `auth.uid()`. A service-role client here would bypass the policies, and
 * — worse — would make the database unable to tell who is doing the thing.
 *
 * Where the database refuses, its message is returned to the screen VERBATIM:
 * the SG-1 errors name the rule and the conversations involved, and rewording
 * them into "something went wrong" would throw away the only explanation the
 * user is going to get.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type ActionState = { error?: string; notice?: string };

const MESSAGES_PATH = "/messages";

async function currentPersonId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("current_person_id");
  return data ?? null;
}

/** Post a message. The SG-1.7 re-check happens in the database, on insert. */
export async function sendMessage(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const conversationId = String(formData.get("conversation_id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!conversationId) return { error: "No conversation given." };
  if (!body) return { error: "Type a message first." };

  const personId = await currentPersonId();
  if (!personId) return { error: "Your account is not linked to a member record yet." };

  const supabase = await createClient();
  const { error } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    sender_person_id: personId,
    body,
  });
  if (error) return { error: error.message };

  revalidatePath(`${MESSAGES_PATH}/${conversationId}`);
  revalidatePath(MESSAGES_PATH);
  return {};
}

/**
 * Read receipt: `last_read_message_id` on the caller's own participant row.
 * Called by the thread client once the messages are on screen and again as
 * live ones arrive.
 */
export async function markRead(conversationId: string, messageId: string): Promise<void> {
  const personId = await currentPersonId();
  if (!personId || !conversationId || !messageId) return;

  const supabase = await createClient();
  await supabase
    .from("conversation_participants")
    .update({ last_read_message_id: messageId })
    .eq("conversation_id", conversationId)
    .eq("person_id", personId);
}

/** Soft delete (SG-2): the row stays, the body is marked deleted. */
export async function deleteMessage(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const messageId = String(formData.get("message_id") ?? "");
  const conversationId = String(formData.get("conversation_id") ?? "");
  if (!messageId) return { error: "No message given." };

  const personId = await currentPersonId();
  if (!personId) return { error: "Your account is not linked to a member record yet." };

  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("messages")
    .update({ deleted_at: new Date().toISOString(), deleted_by: user.user?.id ?? null })
    .eq("id", messageId)
    .eq("sender_person_id", personId);
  if (error) return { error: error.message };

  revalidatePath(`${MESSAGES_PATH}/${conversationId}`);
  return { notice: "Message deleted." };
}

/**
 * P5.6: report a message. `report_message()` opens a safeguarding concern
 * through SG-3's `report_concern()`, so the lead works one case list.
 */
export async function reportMessage(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const messageId = String(formData.get("message_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!messageId) return { error: "No message given." };
  if (!reason) return { error: "Say what the concern is — the reason is what the lead reads first." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_message", {
    p_message_id: messageId,
    p_reason: reason,
  });
  if (error) return { error: error.message };

  return { notice: `Reported. Your reference is ${data}. The safeguarding lead has been notified.` };
}

/**
 * Leave a conversation. SG-1.1: the database refuses when leaving would leave
 * one adult alone with one child, and says so — that text is shown as-is.
 */
export async function leaveConversation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const conversationId = String(formData.get("conversation_id") ?? "");
  if (!conversationId) return { error: "No conversation given." };

  const personId = await currentPersonId();
  if (!personId) return { error: "Your account is not linked to a member record yet." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("conversation_participants")
    .update({ left_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .eq("person_id", personId)
    .is("left_at", null);
  if (error) return { error: error.message };

  revalidatePath(MESSAGES_PATH);
  redirect(MESSAGES_PATH);
}

/**
 * Start a DM or a group.
 *
 * The creator's own row goes in first (`basis 'creator'`, which is what the
 * insert policy allows without any other privilege), then the others one at a
 * time — SG-1 is evaluated per row, so a refusal names the person who caused
 * it. If a participant is refused, the conversation is closed rather than left
 * half-built: SG-2 forbids deleting participant rows, and an empty open
 * conversation is litter.
 */
export async function startConversation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const type = String(formData.get("type") ?? "dm");
  const title = String(formData.get("title") ?? "").trim() || null;
  const others = formData.getAll("person_id").map((v) => String(v)).filter(Boolean);

  if (type !== "dm" && type !== "group") return { error: "Only direct messages and groups can be started here." };
  if (others.length === 0) return { error: "Pick at least one person." };
  if (type === "dm" && others.length !== 1) return { error: "A direct message has exactly one other person." };

  const personId = await currentPersonId();
  if (!personId) return { error: "Your account is not linked to a member record yet." };
  if (others.includes(personId)) return { error: "You are already in this conversation." };

  const supabase = await createClient();
  const { data: conversation, error: convError } = await supabase
    .from("conversations")
    .insert({ type, title, created_by_person_id: personId })
    .select("id")
    .maybeSingle();
  if (convError || !conversation) return { error: convError?.message ?? "Could not start the conversation." };

  const abandon = async (message: string): Promise<ActionState> => {
    await supabase.from("conversations").update({ closed_at: new Date().toISOString() }).eq("id", conversation.id);
    return { error: message };
  };

  const { error: creatorError } = await supabase
    .from("conversation_participants")
    .insert({ conversation_id: conversation.id, person_id: personId, basis: "creator" });
  if (creatorError) return abandon(creatorError.message);

  for (const other of others) {
    const { error } = await supabase
      .from("conversation_participants")
      .insert({ conversation_id: conversation.id, person_id: other, basis: "member" });
    if (error) return abandon(error.message);
  }

  revalidatePath(MESSAGES_PATH);
  redirect(`${MESSAGES_PATH}/${conversation.id}`);
}
