"use server";

/**
 * The team bulletin board (spec §3.2; migration 20260824400000).
 *
 * Every write is a board RPC through the USER-SCOPED client, so the database
 * decides who may post (admins, and staff for their own team), who may reply
 * (anyone who may read), and what a pushed club post is (replies land on the
 * club post — the RPCs enforce the one-thread rule, not this file). Refusals
 * come back as the functions' own messages and are shown verbatim.
 */

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export type BoardActionState = { error?: string; notice?: string };

export async function postToTeamBoard(
  _prev: BoardActionState,
  formData: FormData,
): Promise<BoardActionState> {
  const teamId = String(formData.get("team_id") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!teamId) return { error: "Missing team." };
  if (!title || !body) return { error: "A post needs a headline and a body." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_board_post", {
    p_title: title,
    p_body: body,
    p_team_ids: [teamId],
  });
  if (error) return { error: error.message };

  revalidatePath(`/teams/${teamId}`);
  return { notice: "Posted to the board." };
}

export async function replyToBoardPost(
  _prev: BoardActionState,
  formData: FormData,
): Promise<BoardActionState> {
  const teamId = String(formData.get("team_id") ?? "").trim();
  const postId = String(formData.get("post_id") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!postId || !body) return { error: "Write the reply first." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("reply_board_post", { p_post_id: postId, p_body: body });
  if (error) return { error: error.message };

  if (teamId) revalidatePath(`/teams/${teamId}`);
  revalidatePath("/lobby");
  return { notice: "Reply added." };
}

export async function setBoardPostPinned(
  _prev: BoardActionState,
  formData: FormData,
): Promise<BoardActionState> {
  const teamId = String(formData.get("team_id") ?? "").trim();
  const postId = String(formData.get("post_id") ?? "").trim();
  const pinned = String(formData.get("pinned") ?? "") === "true";
  if (!postId) return { error: "Missing post." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_board_post_pinned", {
    p_post_id: postId,
    p_pinned: pinned,
  });
  if (error) return { error: error.message };

  if (teamId) revalidatePath(`/teams/${teamId}`);
  revalidatePath("/lobby");
  return { notice: pinned ? "Pinned." : "Unpinned." };
}
