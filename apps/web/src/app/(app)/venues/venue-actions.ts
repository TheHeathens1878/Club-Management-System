"use server";

/**
 * The venue admin's writes.
 *
 * Every one goes through the USER-SCOPED client. `venues_admin_insert` and
 * `venues_admin_update` (20260901180000) ask `is_club_admin()`, and so do
 * `resources_admin_update` for the pitch that is being placed on a venue. The
 * guard on the page mirrors those answers; it does not replace them.
 *
 * A VENUE IS NEVER DELETED. There is no delete policy and no delete grant —
 * 20260901190000 hangs a conversation off a venue and a conversation is never
 * destroyed (SG-2), so a venue that could be deleted is a venue that could
 * orphan a room full of messages. Retiring it with `active = false` keeps the
 * room, the history and the address, and is the whole retirement story.
 *
 * Renaming one renames its coaches' group, and moving a pitch on or off one
 * moves the coaches who work there in or out of that group — both are
 * triggers, not code here (`venues_rename_coaches_group`,
 * `resources_sync_venue_groups`). This file only writes the fact.
 */

import { revalidatePath } from "next/cache";
import type { PostgrestError } from "@supabase/supabase-js";

import { friendlyDbError } from "@/lib/people-display";
import { createClient } from "@/lib/supabase/server";

export type VenueActionState = {
  error?: string;
  notice?: string;
  /** Set on a successful create, so the new-venue form can go on to it. */
  createdId?: string;
};

const NOT_ALLOWED =
  "The database refused that. Only a club administrator can add or change the club's venues.";

function text(formData: FormData, key: string, max = 500): string {
  return String(formData.get(key) ?? "")
    .trim()
    .slice(0, max);
}

function refuse(error: PostgrestError, duplicate?: string): VenueActionState {
  return { error: friendlyDbError(error, NOT_ALLOWED, duplicate) };
}

/** Name, address, notes and order — the fields both forms share. */
function fieldsFrom(formData: FormData): { name: string; address: string | null; notes: string | null; sortOrder: number } | { error: string } {
  const name = text(formData, "name", 120);
  if (!name) return { error: "A venue needs a name — the ground as people call it." };
  const rawOrder = text(formData, "sort_order", 6);
  const sortOrder = rawOrder === "" ? 0 : Number(rawOrder);
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) {
    return { error: "The order must be a whole number between 0 and 9999." };
  }
  return {
    name,
    address: text(formData, "address", 300) || null,
    notes: text(formData, "notes", 4000) || null,
    sortOrder,
  };
}

export async function createVenue(
  _prev: VenueActionState,
  formData: FormData,
): Promise<VenueActionState> {
  const fields = fieldsFrom(formData);
  if ("error" in fields) return { error: fields.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("venues")
    .insert({
      name: fields.name,
      address: fields.address,
      notes: fields.notes,
      sort_order: fields.sortOrder,
    })
    .select("id")
    .single();
  // The unique index on lower(name) is the club's "one Ashton Park, however it
  // is typed" rule, and it deserves its own sentence.
  if (error) return refuse(error, `The club already has a venue called ${fields.name}.`);
  if (!data) return { error: "The venue was not created." };

  revalidatePath("/venues");
  return { notice: `${fields.name} added.`, createdId: data.id };
}

export async function updateVenue(
  _prev: VenueActionState,
  formData: FormData,
): Promise<VenueActionState> {
  const id = text(formData, "venue_id", 40);
  if (!id) return { error: "No venue was named." };
  const fields = fieldsFrom(formData);
  if ("error" in fields) return { error: fields.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("venues")
    .update({
      name: fields.name,
      address: fields.address,
      notes: fields.notes,
      sort_order: fields.sortOrder,
    })
    .eq("id", id);
  if (error) return refuse(error, `The club already has a venue called ${fields.name}.`);

  revalidatePath("/venues");
  revalidatePath(`/venues/${id}`);
  return { notice: "Saved. The venue's coaches group takes its name from here, so it is renamed too." };
}

export async function setVenueActive(
  _prev: VenueActionState,
  formData: FormData,
): Promise<VenueActionState> {
  const id = text(formData, "venue_id", 40);
  const active = formData.get("active") === "yes";
  if (!id) return { error: "No venue was named." };

  const supabase = await createClient();
  const { error } = await supabase.from("venues").update({ active }).eq("id", id);
  if (error) return refuse(error);

  revalidatePath("/venues");
  revalidatePath(`/venues/${id}`);
  return {
    notice: active
      ? "Back in use."
      : "Retired. Nothing is deleted: the pitches, their bookings and the coaches group all stay exactly as they are.",
  };
}

/**
 * Put a pitch on this venue, or take it off.
 *
 * `resources.venue_id` is the link (20260901180000 §2). Moving it fires
 * `resources_sync_venue_groups`, which walks the coaches of every team that
 * plays here into or out of the venue's group — so this is a bigger act than
 * it looks, and the screen says so.
 */
export async function setPitchVenue(
  _prev: VenueActionState,
  formData: FormData,
): Promise<VenueActionState> {
  const resourceId = text(formData, "resource_id", 40);
  const venueId = text(formData, "venue_id", 40);
  const attach = formData.get("attach") === "yes";
  if (!resourceId || !venueId) return { error: "No pitch was named." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("resources")
    .update({ venue_id: attach ? venueId : null })
    .eq("id", resourceId);
  if (error) return refuse(error);

  revalidatePath("/venues");
  revalidatePath(`/venues/${venueId}`);
  revalidatePath("/pitches/manage");
  return {
    notice: attach
      ? "Pitch added to this venue. Any coach whose team plays here joins the venue's coaches group."
      : "Pitch taken off this venue. A coach who works nowhere else here leaves its group — the history stays.",
  };
}
