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

import { mentionExcerpt, mentionedPersonIds } from "@/lib/mentions";
import { nameOf, resolveNames } from "@/lib/person";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type ActionState = { error?: string; notice?: string };

const MESSAGES_PATH = "/messages";

async function currentPersonId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("current_person_id");
  return data ?? null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Post a message. The SG-1.7 re-check happens in the database, on insert.
 *
 * The client may supply the message id (for optimistic rendering: the bubble
 * it painted is confirmed, not duplicated, when the realtime insert arrives)
 * and a `reply_to` message id (WhatsApp-style quoting — the column has been in
 * the schema since P5.2).
 */
export async function sendMessage(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const conversationId = String(formData.get("conversation_id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  const clientId = String(formData.get("client_id") ?? "");
  const replyTo = String(formData.get("reply_to") ?? "");
  if (!conversationId) return { error: "No conversation given." };
  if (!body) return { error: "Type a message first." };

  const personId = await currentPersonId();
  if (!personId) return { error: "Your account is not linked to a member record yet." };

  const supabase = await createClient();
  // The id is settled HERE, not by the column default: the mention rows and
  // the notifications that follow need to name this message, and reading it
  // back with RETURNING would have to satisfy the SELECT policy as well.
  const messageId = UUID_RE.test(clientId) ? clientId : crypto.randomUUID();
  const { error } = await supabase.from("messages").insert({
    id: messageId,
    conversation_id: conversationId,
    sender_person_id: personId,
    body,
    ...(UUID_RE.test(replyTo) ? { reply_to_id: replyTo } : {}),
  });
  if (error) return { error: error.message };

  await recordMentions(conversationId, messageId, personId, body);

  revalidatePath(`${MESSAGES_PATH}/${conversationId}`);
  revalidatePath(MESSAGES_PATH);
  return {};
}

/**
 * `@mentions` — resolve, record, notify.
 *
 * The typed names are matched SERVER-SIDE against the conversation's LIVE
 * participants, read through the caller's own client. The browser sends no
 * list of person ids and could not be believed if it did: a composer is a text
 * box, and the only thing that decides who was mentioned is who is actually in
 * the room. `mention_people()` then checks the same two facts again in the
 * database (you sent this message; they are in this conversation), so a hand-
 * rolled request cannot mint a mention either.
 *
 * The notification goes through `notify()` with the ADMIN client because
 * `notify()` is service-role-only by design (20260824160000) — in-app only,
 * no email, and never to the sender themselves. One person mentioned twice in
 * one message is one row and one notification.
 *
 * Nothing in here can fail the send: the message is already committed and
 * saying "something went wrong" over a message that arrived would be a lie.
 * A mention that could not be recorded is a missing highlight, not a lost
 * message.
 */
async function recordMentions(
  conversationId: string,
  messageId: string,
  senderPersonId: string,
  body: string,
): Promise<void> {
  if (!body.includes("@")) return;
  try {
    const supabase = await createClient();
    const { data: participantRows } = await supabase
      .from("conversation_participants")
      .select("person_id")
      .eq("conversation_id", conversationId)
      .is("left_at", null);

    const liveIds = (participantRows ?? [])
      .map((p) => p.person_id)
      .filter((id) => id !== senderPersonId);
    if (liveIds.length === 0) return;

    const names = await resolveNames([...liveIds, senderPersonId]);
    const candidates = liveIds.map((id) => ({ person_id: id, name: nameOf(names, id) }));
    const personIds = mentionedPersonIds(body, candidates);
    if (personIds.length === 0) return;

    const { error: mentionError } = await supabase.rpc("mention_people", {
      p_message_id: messageId,
      p_person_ids: personIds,
    });
    if (mentionError) return;

    const { data: conversation } = await supabase
      .from("conversations")
      .select("type,title")
      .eq("id", conversationId)
      .maybeSingle();
    const where =
      conversation?.title?.trim() ||
      (conversation?.type === "dm" ? "your conversation" : "a conversation");
    const senderName = nameOf(names, senderPersonId);

    const admin = createAdminClient();
    await Promise.all(
      personIds.map((id) =>
        admin.rpc("notify", {
          p_person_id: id,
          p_subject: `You were mentioned in ${where}`,
          p_body: `${senderName} mentioned you: “${mentionExcerpt(body)}”`,
          p_link: `${MESSAGES_PATH}/${conversationId}`,
          p_entity: "messages",
          p_entity_id: messageId,
        }),
      ),
    );
  } catch {
    // See the doc comment: the message is sent either way.
  }
}

/**
 * React / un-react with one emoji. Reactions are participant-scoped by RLS
 * (no announcements, no closed conversations, no removed messages) and
 * un-reacting is a hard delete of one's own row — the one messaging table
 * SG-2 does not freeze, because a reaction is expression, not evidence.
 */
export async function toggleReaction(
  conversationId: string,
  messageId: string,
  emoji: string,
): Promise<ActionState> {
  const trimmed = emoji.trim();
  if (!messageId || !trimmed || trimmed.length > 16) return { error: "Not a reaction." };
  const personId = await currentPersonId();
  if (!personId) return { error: "Your account is not linked to a member record yet." };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("message_reactions")
    .select("id")
    .eq("message_id", messageId)
    .eq("person_id", personId)
    .eq("emoji", trimmed)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase.from("message_reactions").delete().eq("id", existing.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase
      .from("message_reactions")
      .insert({ message_id: messageId, person_id: personId, emoji: trimmed });
    if (error) return { error: error.message };
  }
  revalidatePath(`${MESSAGES_PATH}/${conversationId}`);
  return {};
}

/**
 * Open a photo message: the row goes in first (body is NOT NULL, so a caption
 * or the 📎 placeholder), the browser then uploads the file to
 * `attachments/<conversation>/<message>/…` with the USER'S OWN storage client
 * — the storage policies only accept paths inside conversations the uploader
 * is an active participant of — and records it in `message_attachments`.
 * Mirrors the mobile app's flow.
 */
export async function openAttachmentMessage(
  conversationId: string,
  caption: string,
): Promise<ActionState & { messageId?: string }> {
  if (!conversationId) return { error: "No conversation given." };
  const personId = await currentPersonId();
  if (!personId) return { error: "Your account is not linked to a member record yet." };

  const supabase = await createClient();
  const messageId = crypto.randomUUID();
  const { error } = await supabase.from("messages").insert({
    id: messageId,
    conversation_id: conversationId,
    sender_person_id: personId,
    body: caption.trim() || "📎 Photo",
  });
  if (error) return { error: error.message };
  revalidatePath(`${MESSAGES_PATH}/${conversationId}`);
  return { messageId };
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
  // No RETURNING here: with RLS, INSERT … RETURNING must also satisfy the
  // SELECT policy, and conversations are readable by participants only — a
  // row nobody has joined yet is invisible, so the insert would be refused
  // ("new row violates row-level security policy"). Generate the id instead.
  const conversationId = crypto.randomUUID();
  const { error: convError } = await supabase
    .from("conversations")
    .insert({ id: conversationId, type, title, created_by_person_id: personId });
  if (convError) return { error: convError.message };
  const conversation = { id: conversationId };

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

// ---------------------------------------------------------------------------
// Permanent deletion of one message — super user only (Adam, 2026-08-25)
// ---------------------------------------------------------------------------
/**
 * The soft delete above is unchanged and is still what everyone else gets: a
 * tombstone, per SG-2. This is the one exception the club owner asked for, and
 * every decision about whether it is allowed is made by `purge_message()` in
 * the database — super user only, and refused outright for a message cited by
 * a safeguarding concern or one of its notes, or under a legal hold. The RPC
 * goes through the user-scoped client so that check sees the real caller.
 *
 * Attachments: the storage objects are removed with the SERVICE-ROLE client,
 * and only AFTER the RPC has returned. Two things make that safe. First, the
 * ordering: the database has already decided the purge is permitted and has
 * already written the `messages.purged` audit row, so by the time this runs
 * the `message_attachments` rows do not exist and the objects are orphans —
 * unreachable through the storage policies, which key off the message row, and
 * pointing at nothing. Second, the paths are read with the admin client
 * BEFOREHAND rather than the caller's, because a super user need not be a
 * participant of the conversation and their own client would (correctly) be
 * shown nothing. The admin key is never used to decide anything here; it is
 * used to finish what the database has already authorised.
 */
export async function purgeMessage(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const messageId = String(formData.get("message_id") ?? "");
  const conversationId = String(formData.get("conversation_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!messageId) return { error: "No message given." };
  if (!reason) {
    return { error: "Say why. The reason is the only thing the audit row will be able to say." };
  }

  const admin = createAdminClient();
  const { data: files } = await admin
    .from("message_attachments")
    .select("storage_bucket,storage_path")
    .eq("message_id", messageId);

  const supabase = await createClient();
  const { error } = await supabase.rpc("purge_message", {
    p_message_id: messageId,
    p_reason: reason,
  });
  if (error) return { error: error.message };

  for (const file of files ?? []) {
    await admin.storage.from(file.storage_bucket).remove([file.storage_path]);
  }

  revalidatePath(`${MESSAGES_PATH}/${conversationId}`);
  return { notice: "Message permanently deleted." };
}
