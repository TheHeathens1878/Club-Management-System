"use server";

/**
 * The group's Important information board (Adam, 2026-09-04): create, pin,
 * delete. Every write is a SECURITY DEFINER function through the caller's own
 * client — participant checks, the announcing chat message and the in-app
 * bells all live in `create_conversation_post()` (20260904120000), so a post
 * can never arrive silently and this file cannot forget to ring the room.
 */

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export type BoardActionState = { error?: string; notice?: string };

function text(formData: FormData, key: string, max: number): string {
  return String(formData.get(key) ?? "")
    .trim()
    .slice(0, max);
}

export async function createConversationPost(
  _prev: BoardActionState,
  formData: FormData,
): Promise<BoardActionState> {
  const conversationId = text(formData, "conversation_id", 40);
  const title = text(formData, "title", 200);
  const body = String(formData.get("body") ?? "").trim().slice(0, 8000);
  if (!conversationId) return { error: "No group given." };
  if (!title) return { error: "Give the post a title." };
  if (!body) return { error: "Write the information itself too." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_conversation_post", {
    p_conversation_id: conversationId,
    p_title: title,
    p_body: body,
  });
  if (error) return { error: error.message };

  revalidatePath(`/messages/${conversationId}`);
  return { notice: "Posted — the group has been told in the chat and by notification." };
}

export async function setConversationPostPinned(
  _prev: BoardActionState,
  formData: FormData,
): Promise<BoardActionState> {
  const postId = text(formData, "post_id", 40);
  const conversationId = text(formData, "conversation_id", 40);
  const pinned = formData.get("pinned") === "true";
  if (!postId) return { error: "No post given." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_conversation_post_pinned", {
    p_post_id: postId,
    p_pinned: pinned,
  });
  if (error) return { error: error.message };

  revalidatePath(`/messages/${conversationId}`);
  return { notice: pinned ? "Pinned to the top." : "Unpinned." };
}

export async function deleteConversationPost(
  _prev: BoardActionState,
  formData: FormData,
): Promise<BoardActionState> {
  const postId = text(formData, "post_id", 40);
  const conversationId = text(formData, "conversation_id", 40);
  if (!postId) return { error: "No post given." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_conversation_post", { p_post_id: postId });
  if (error) return { error: error.message };

  revalidatePath(`/messages/${conversationId}`);
  return { notice: "Post removed." };
}
