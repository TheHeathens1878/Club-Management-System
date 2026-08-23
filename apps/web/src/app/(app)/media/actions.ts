"use server";

/**
 * Albums, uploads and photo-consent tagging (PLAN.md P4.5 — SAFEGUARDING.md SG-5).
 *
 * User-scoped client. `media_items` has no SELECT grant for `authenticated` at
 * all: galleries come back from `media_gallery()`, which filters by
 * `media_item_showable()` — untagged fails closed, and any minor subject
 * without an active consent for the album's purpose removes the item. The one
 * service-key step in this feature is minting a signed URL, and it happens
 * only for ids the user's own `media_gallery()` call has already returned.
 */

import { revalidatePath } from "next/cache";

import type { Database } from "@club/db";

import { createClient } from "@/lib/supabase/server";

export type ActionState = { error?: string; notice?: string };

type Visibility = Database["public"]["Enums"]["album_visibility"];

const VISIBILITIES: Visibility[] = ["team", "club", "public", "social", "press"];

export async function createAlbum(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const visibility = String(formData.get("visibility") ?? "team");
  const teamId = String(formData.get("team_id") ?? "").trim() || null;
  const seasonId = String(formData.get("season_id") ?? "").trim() || null;

  if (!title) return { error: "The album needs a title." };
  if (!VISIBILITIES.includes(visibility as Visibility)) return { error: "Pick a visibility." };
  if (visibility === "team" && !teamId) return { error: "A team album needs a team." };

  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const { error } = await supabase.from("media_albums").insert({
    title,
    description,
    visibility: visibility as Visibility,
    team_id: teamId,
    season_id: seasonId,
    created_by: user.user?.id ?? null,
  });
  if (error) return { error: error.message };

  revalidatePath("/media");
  return { notice: "Album created." };
}

/**
 * Register a file the browser has already put in the `media` bucket. The
 * upload itself goes straight from the browser through the user's own client,
 * so the storage policy (admins and child-facing staff) is what admits it.
 */
export async function registerMediaItem(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const albumId = String(formData.get("album_id") ?? "");
  const storagePath = String(formData.get("storage_path") ?? "");
  const contentType = String(formData.get("content_type") ?? "").trim() || null;
  const byteSize = Number(formData.get("byte_size") ?? 0);
  const caption = String(formData.get("caption") ?? "").trim() || null;

  if (!albumId || !storagePath) return { error: "The upload did not complete." };

  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const { error } = await supabase.from("media_items").insert({
    album_id: albumId,
    storage_bucket: "media",
    storage_path: storagePath,
    content_type: contentType,
    byte_size: Number.isFinite(byteSize) && byteSize > 0 ? Math.round(byteSize) : null,
    caption,
    uploaded_by: user.user?.id ?? null,
  });
  if (error) return { error: error.message };

  revalidatePath(`/media/${albumId}`);
  return { notice: "Uploaded. It stays hidden until you confirm who is in it." };
}

/**
 * Confirm the subject list. Nothing appears in a gallery until a human has
 * done this: an untagged item fails the consent test closed, deliberately, so
 * that forgetting to tag hides a photo rather than publishing it.
 */
export async function confirmSubjects(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const albumId = String(formData.get("album_id") ?? "");
  const itemId = String(formData.get("item_id") ?? "");
  const personIds = formData.getAll("person_id").map((v) => String(v)).filter(Boolean);
  if (!itemId) return { error: "No photo given." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_media_subjects", {
    p_item_id: itemId,
    p_person_ids: personIds,
  });
  if (error) return { error: error.message };

  revalidatePath(`/media/${albumId}`);
  return {
    notice:
      personIds.length === 0
        ? "Confirmed as nobody identifiable. It will show if the album's consent rules allow."
        : "Subjects confirmed. Anyone without consent for this album keeps the photo hidden.",
  };
}
