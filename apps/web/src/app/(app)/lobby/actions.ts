"use server";

/**
 * The Club Lobby (Adam, 2026-08-25) — writes for the board.
 *
 * All the rules live in the SECURITY DEFINER functions from `20260824400000`:
 * who may post (admins and team staff), which teams a coach may target,
 * age-group expansion, the one-thread reply rule, receipts. These actions
 * shape forms and pass P0001 messages through verbatim.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getSessionProfile } from "@/lib/auth";
import { friendlyDbError } from "@/lib/people-display";
import { createClient } from "@/lib/supabase/server";

export type LobbyActionState = {
  error?: string;
  notice?: string;
};

function text(formData: FormData, key: string, max = 4000): string {
  return String(formData.get(key) ?? "")
    .trim()
    .slice(0, max);
}

export async function createLobbyPost(
  _prev: LobbyActionState,
  formData: FormData,
): Promise<LobbyActionState> {
  const session = await getSessionProfile();
  if (!session) return { error: "Sign in again to post." };

  const title = text(formData, "title", 160);
  const body = text(formData, "body", 4000);
  if (!title) return { error: "Give the post a title." };
  if (!body) return { error: "Write the post." };

  const teamIds = formData
    .getAll("team_ids")
    .map((value) => String(value).trim())
    .filter(Boolean)
    .slice(0, 100);
  const ageGroups = formData
    .getAll("age_groups")
    .map((value) => String(value).trim())
    .filter(Boolean)
    .slice(0, 50);
  const push = text(formData, "push_to_boards", 5) === "true";
  const pinned = text(formData, "pinned", 5) === "true";

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_board_post", {
    p_title: title,
    p_body: body,
    p_team_ids: teamIds.length > 0 ? teamIds : undefined,
    p_age_groups: ageGroups.length > 0 ? ageGroups : undefined,
    p_push_to_boards: push,
    p_pinned: pinned,
  });
  if (error) {
    return {
      error: friendlyDbError(
        error,
        "The database refused that. Only the club's administrators and team staff can post to the board.",
      ),
    };
  }

  revalidatePath("/lobby");
  redirect(`/lobby/${data}`);
}

export async function replyToPost(
  _prev: LobbyActionState,
  formData: FormData,
): Promise<LobbyActionState> {
  const session = await getSessionProfile();
  if (!session) return { error: "Sign in again to reply." };

  const postId = text(formData, "post_id", 40);
  const body = text(formData, "body", 2000);
  if (!postId) return { error: "No post given." };
  if (!body) return { error: "Write a reply." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("reply_board_post", { p_post_id: postId, p_body: body });
  if (error) {
    return {
      error: friendlyDbError(error, "The database refused that reply."),
    };
  }

  revalidatePath(`/lobby/${postId}`);
  revalidatePath("/lobby");
  return { notice: "Reply posted." };
}

export async function setPostPinned(
  _prev: LobbyActionState,
  formData: FormData,
): Promise<LobbyActionState> {
  const session = await getSessionProfile();
  if (!session) return { error: "Sign in again." };

  const postId = text(formData, "post_id", 40);
  const pinned = text(formData, "pinned", 5) === "true";
  if (!postId) return { error: "No post given." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_board_post_pinned", {
    p_post_id: postId,
    p_pinned: pinned,
  });
  if (error) return { error: friendlyDbError(error, "The database refused that.") };

  revalidatePath(`/lobby/${postId}`);
  revalidatePath("/lobby");
  return { notice: pinned ? "Pinned." : "Unpinned." };
}

export async function deletePost(
  _prev: LobbyActionState,
  formData: FormData,
): Promise<LobbyActionState> {
  const session = await getSessionProfile();
  if (!session) return { error: "Sign in again." };

  const postId = text(formData, "post_id", 40);
  if (!postId) return { error: "No post given." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_board_post", { p_post_id: postId });
  if (error) return { error: friendlyDbError(error, "The database refused that.") };

  revalidatePath("/lobby");
  redirect("/lobby");
}
