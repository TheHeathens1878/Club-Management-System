"use server";

/**
 * Group administration (the club owner's ask: "WhatsApp-style groups …
 * attached to venues initially, but the ability to set up against anything").
 *
 * Every action here uses the USER-SCOPED client, exactly as
 * `messages/actions.ts` does, and for the same reason: SG-1 is enforced by
 * triggers and participant-scoped RLS that key off `auth.uid()`. A service-role
 * client would bypass the policies AND rob the database of the ability to say
 * who did the thing. There is no admin back door in this file.
 *
 * Two rules are load-bearing and are asserted in code, not just in review:
 *
 *   1. NOTHING here writes to a conversation whose type is not `group`. Team
 *      rooms are matched by TITLE inside `ensure_team_conversation()`, so
 *      renaming one from a UI would silently mint a duplicate room at the next
 *      membership change. Every write reads the type first and refuses.
 *   2. Membership changes are never optimistic and are never reworded. When
 *      the SG-1 guard refuses an add or a removal it names the rule and the
 *      people involved; that sentence is the only explanation the administrator
 *      is going to get, so it is returned verbatim.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getCurrentPersonId, isClubAdmin } from "@/lib/person";
import { createClient } from "@/lib/supabase/server";
import { isAttachmentChoice, ONE_ATTACHMENT_REFUSAL } from "@/lib/group-scope";

export type GroupActionState = { error?: string; notice?: string };

const GROUPS_PATH = "/groups";
const MESSAGES_PATH = "/messages";

/** What the attachment fields resolve to on `conversations`. */
type Attachment = {
  team_id: string | null;
  resource_id: string | null;
  scope_label: string | null;
};

/**
 * Read the attachment picker into the three columns.
 *
 * The one-attachment rule is honoured by construction here — a choice sets one
 * column and clears the others — so the 23514 handler below is a backstop for
 * a hand-rolled request, not the normal path.
 */
function readAttachment(formData: FormData): { attachment: Attachment } | { error: string } {
  const raw = String(formData.get("attachment_kind") ?? "none");
  const choice = isAttachmentChoice(raw) ? raw : "none";
  const resourceId = String(formData.get("resource_id") ?? "").trim();
  const teamId = String(formData.get("team_id") ?? "").trim();
  const scopeLabel = String(formData.get("scope_label") ?? "").trim();

  if (choice === "resource") {
    if (!resourceId) return { error: "Pick the venue, pitch or room this group is about." };
    return { attachment: { team_id: null, resource_id: resourceId, scope_label: null } };
  }
  if (choice === "team") {
    if (!teamId) return { error: "Pick the team this group is about." };
    return { attachment: { team_id: teamId, resource_id: null, scope_label: null } };
  }
  if (choice === "label") {
    if (!scopeLabel) {
      return { error: "Say what this group is about — the label is what everyone else will see." };
    }
    return { attachment: { team_id: null, resource_id: null, scope_label: scopeLabel } };
  }
  return { attachment: { team_id: null, resource_id: null, scope_label: null } };
}

/**
 * The group, if this caller may act on it.
 *
 * `conversations_participant_read` is participants-only, so a group nobody has
 * put this administrator in simply is not there — which is the honest answer
 * and the one the screen shows.
 */
async function loadGroup(
  conversationId: string,
): Promise<{ id: string; type: string; closed_at: string | null } | { error: string }> {
  if (!conversationId) return { error: "No group given." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conversations")
    .select("id,type,closed_at")
    .eq("id", conversationId)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) {
    return {
      error:
        "That group could not be found. Conversations are readable by the people in them, so a group you are not a member of will not open here.",
    };
  }
  if (data.type !== "group") {
    return {
      error:
        "This is a team room, not a group. Team rooms take their name and their membership from the team and the season, and are not edited here.",
    };
  }
  return data;
}

/**
 * Create a group.
 *
 * The conversation row goes in WITHOUT `RETURNING`: under RLS an
 * `INSERT … RETURNING` must also satisfy the SELECT policy, and a conversation
 * nobody has joined yet is invisible to everyone — the insert would be refused.
 * The id is generated here instead, exactly as `startConversation` does.
 *
 * The creator's own row is next (`basis 'creator'`, which the insert policy
 * allows on its own), then the members one at a time: SG-1 is evaluated per
 * row, so a refusal names the person who caused it. A refused member abandons
 * the whole group — SG-2 forbids deleting participant rows, so the half-built
 * conversation is closed rather than left as litter.
 */
export async function createGroup(
  _prev: GroupActionState,
  formData: FormData,
): Promise<GroupActionState> {
  if (!(await isClubAdmin())) {
    return { error: "Only a club administrator can set up groups here." };
  }

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "Give the group a name — it is what everyone in it will see." };

  const read = readAttachment(formData);
  if ("error" in read) return read;

  const personId = await getCurrentPersonId();
  if (!personId) return { error: "Your account is not linked to a member record yet." };

  const members = Array.from(
    new Set(
      formData
        .getAll("person_id")
        .map((value) => String(value).trim())
        .filter((value) => value !== "" && value !== personId),
    ),
  );

  const supabase = await createClient();
  const conversationId = crypto.randomUUID();
  const { error: convError } = await supabase.from("conversations").insert({
    id: conversationId,
    type: "group",
    title,
    created_by_person_id: personId,
    ...read.attachment,
  });
  if (convError) {
    if (convError.code === "23514") return { error: ONE_ATTACHMENT_REFUSAL };
    return { error: convError.message };
  }

  const abandon = async (message: string): Promise<GroupActionState> => {
    await supabase
      .from("conversations")
      .update({ closed_at: new Date().toISOString() })
      .eq("id", conversationId);
    return { error: message };
  };

  const { error: creatorError } = await supabase
    .from("conversation_participants")
    .insert({ conversation_id: conversationId, person_id: personId, basis: "creator" });
  if (creatorError) return abandon(creatorError.message);

  for (const member of members) {
    const { error } = await supabase
      .from("conversation_participants")
      .insert({ conversation_id: conversationId, person_id: member, basis: "member" });
    // Verbatim: the SG-1 message names the rule and the person it is about.
    if (error) return abandon(error.message);
  }

  revalidatePath(GROUPS_PATH);
  revalidatePath(MESSAGES_PATH);
  redirect(`${MESSAGES_PATH}/${conversationId}`);
}

/**
 * Rename a group and/or change what it is attached to.
 *
 * Guarded on `type = 'group'` above — see rule 1 at the top of this file.
 */
export async function updateGroup(
  _prev: GroupActionState,
  formData: FormData,
): Promise<GroupActionState> {
  const conversationId = String(formData.get("conversation_id") ?? "").trim();
  const group = await loadGroup(conversationId);
  if ("error" in group) return group;

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "A group needs a name." };

  const read = readAttachment(formData);
  if ("error" in read) return read;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conversations")
    .update({ title, ...read.attachment })
    .eq("id", conversationId)
    .eq("type", "group")
    .select("id");
  if (error) {
    if (error.code === "23514") return { error: ONE_ATTACHMENT_REFUSAL };
    if (error.code === "42501") {
      return { error: "Only the person who set this group up, or a club administrator, can change it." };
    }
    return { error: error.message };
  }
  if ((data ?? []).length === 0) {
    return { error: "Nothing was changed — the database did not accept the edit for this group." };
  }

  revalidatePath(`${GROUPS_PATH}/${conversationId}`);
  revalidatePath(GROUPS_PATH);
  revalidatePath(`${MESSAGES_PATH}/${conversationId}`);
  revalidatePath(MESSAGES_PATH);
  return { notice: "Group updated." };
}

/**
 * Add somebody to a group.
 *
 * No optimistic UI anywhere near this: the row either lands or the database
 * explains why not, and the explanation is passed through untouched.
 */
export async function addGroupMember(
  _prev: GroupActionState,
  formData: FormData,
): Promise<GroupActionState> {
  const conversationId = String(formData.get("conversation_id") ?? "").trim();
  const personId = String(formData.get("person_id") ?? "").trim();
  const group = await loadGroup(conversationId);
  if ("error" in group) return group;
  if (!personId) return { error: "Pick somebody to add." };
  if (group.closed_at) return { error: "This group is closed. Nobody new can be added to it." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("conversation_participants")
    .insert({ conversation_id: conversationId, person_id: personId, basis: "member" });
  if (error) return { error: error.message };

  revalidatePath(`${GROUPS_PATH}/${conversationId}`);
  revalidatePath(`${MESSAGES_PATH}/${conversationId}`);
  return { notice: "Added to the group." };
}

/**
 * Take somebody out of a group.
 *
 * SG-2: the participant row is kept and stamped `left_at`; it is never
 * deleted. SG-1.1 can refuse this outright — removing the wrong person can be
 * what leaves one adult alone with one child — and that refusal is shown as it
 * arrived.
 */
export async function removeGroupMember(
  _prev: GroupActionState,
  formData: FormData,
): Promise<GroupActionState> {
  const conversationId = String(formData.get("conversation_id") ?? "").trim();
  const personId = String(formData.get("person_id") ?? "").trim();
  const group = await loadGroup(conversationId);
  if ("error" in group) return group;
  if (!personId) return { error: "No member given." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conversation_participants")
    .update({ left_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .eq("person_id", personId)
    .is("left_at", null)
    .select("id");
  if (error) return { error: error.message };
  if ((data ?? []).length === 0) {
    return { error: "Nothing changed — that person is not currently in this group." };
  }

  revalidatePath(`${GROUPS_PATH}/${conversationId}`);
  revalidatePath(`${MESSAGES_PATH}/${conversationId}`);
  return { notice: "Removed from the group. Their part of the history is kept." };
}

/**
 * Close a group. The history stays and stays readable; nothing new can be
 * posted. This is the nearest thing to deleting a group that safeguarding
 * allows (SG-2).
 */
export async function closeGroup(
  _prev: GroupActionState,
  formData: FormData,
): Promise<GroupActionState> {
  const conversationId = String(formData.get("conversation_id") ?? "").trim();
  const group = await loadGroup(conversationId);
  if ("error" in group) return group;
  if (group.closed_at) return { notice: "This group is already closed." };

  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("conversations")
    .update({ closed_at: new Date().toISOString(), closed_by: user.user?.id ?? null })
    .eq("id", conversationId)
    .eq("type", "group")
    .select("id");
  if (error) return { error: error.message };
  if ((data ?? []).length === 0) {
    return { error: "Nothing changed — the database did not accept closing this group." };
  }

  revalidatePath(`${GROUPS_PATH}/${conversationId}`);
  revalidatePath(GROUPS_PATH);
  revalidatePath(MESSAGES_PATH);
  return { notice: "Group closed. What was said in it is kept and can still be read." };
}
