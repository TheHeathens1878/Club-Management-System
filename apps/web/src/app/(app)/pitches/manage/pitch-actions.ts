"use server";

/**
 * The venue admin's writes — pitches as rows in `resources` (gap 7).
 *
 * Every one of them goes through the USER-SCOPED client. `resources_admin_insert`,
 * `_update` and `_delete` all ask `is_club_admin()`, so the database is what
 * decides whether the caller may change the club's pitches; the guard on the
 * page mirrors that answer, it does not replace it. A 42501 is turned into a
 * sentence that says which role is missing; a P0001 from a trigger is passed
 * through verbatim.
 *
 * A pitch is NEVER deleted. `bookings.resource_id` references `resources` with
 * ON DELETE RESTRICT, so removing one would either fail against the club's
 * history or, worse, take it with it. Deactivating is the whole retirement
 * story: `resources_public_read` stops returning it, the booking form stops
 * offering it, and every booking already made against it still reads correctly.
 */

import { revalidatePath } from "next/cache";

import type { Database } from "@club/db";

import { friendlyDbError } from "@/lib/people-display";
import { createClient } from "@/lib/supabase/server";

type ResourceInsert = Database["public"]["Tables"]["resources"]["Insert"];
type ResourceUpdate = Database["public"]["Tables"]["resources"]["Update"];

export type PitchAdminActionState = {
  error?: string;
  notice?: string;
  /** Set on a successful create so the new-pitch form can link onward. */
  createdId?: string;
};

const NOT_ALLOWED =
  "The database refused that. Only a club administrator can add or change the club's pitches.";

/** A buffer longer than this is a closure, not a changeover. */
const MAX_BUFFER_MINUTES = 240;

function text(formData: FormData, key: string, max = 500): string {
  return String(formData.get(key) ?? "")
    .trim()
    .slice(0, max);
}

/** An optional positive integer field: "" means NULL, nonsense means an error. */
function optionalNumber(
  formData: FormData,
  key: string,
  label: string,
  max: number,
): { value: number | null } | { error: string } {
  const raw = text(formData, key, 10);
  if (raw === "") return { value: null };
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    return { error: `${label} must be a whole number between 1 and ${max}.` };
  }
  return { value: parsed };
}

/** A buffer is required by the column (NOT NULL), so "" means zero. */
function bufferMinutes(
  formData: FormData,
  key: string,
  label: string,
): { value: number } | { error: string } {
  const raw = text(formData, key, 10);
  if (raw === "") return { value: 0 };
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_BUFFER_MINUTES) {
    return { error: `${label} must be a whole number of minutes between 0 and ${MAX_BUFFER_MINUTES}.` };
  }
  return { value: parsed };
}

function revalidatePitchPaths(): void {
  revalidatePath("/pitches/manage");
  revalidatePath("/pitches");
  revalidatePath("/pitches/book");
  revalidatePath("/pitches/mine");
  revalidatePath("/pitches/calendar");
}

/** The editable half of a pitch row, or the first thing wrong with the form. */
function readFields(
  formData: FormData,
): { fields: Omit<ResourceUpdate, "id" | "type"> } | { error: string } {
  const name = text(formData, "name", 120);
  if (name === "") return { error: "Give the pitch a name." };

  const capacity = optionalNumber(formData, "capacity", "Capacity", 10_000);
  if ("error" in capacity) return { error: capacity.error };

  const preBuffer = bufferMinutes(formData, "default_pre_buffer_minutes", "The set-up buffer");
  if ("error" in preBuffer) return { error: preBuffer.error };

  const postBuffer = bufferMinutes(formData, "default_post_buffer_minutes", "The clear-down buffer");
  if ("error" in postBuffer) return { error: postBuffer.error };

  return {
    fields: {
      name,
      description: text(formData, "description", 2_000) || null,
      address: text(formData, "address", 300) || null,
      information: text(formData, "information", 4_000) || null,
      capacity: capacity.value,
      default_pre_buffer_minutes: preBuffer.value,
      default_post_buffer_minutes: postBuffer.value,
    },
  };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * A new pitch, added at the end of the running order.
 *
 * `type` is pinned to `pitch` here rather than read from the form: this screen
 * is the pitch admin and a function room is `/room-bookings/rooms`' business.
 */
export async function createPitch(
  _prev: PitchAdminActionState,
  formData: FormData,
): Promise<PitchAdminActionState> {
  const read = readFields(formData);
  if ("error" in read) return { error: read.error };

  const supabase = await createClient();

  // Last in the list, so a new pitch never silently jumps the running order.
  const { data: lastRow } = await supabase
    .from("resources")
    .select("sort_order")
    .eq("type", "pitch")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const row: ResourceInsert = {
    ...read.fields,
    name: read.fields.name ?? "",
    type: "pitch",
    active: text(formData, "active", 8) !== "false",
    sort_order: (lastRow?.sort_order ?? -1) + 1,
  };

  const { data, error } = await supabase.from("resources").insert(row).select("id").maybeSingle();
  if (error) return { error: friendlyDbError(error, NOT_ALLOWED) };

  revalidatePitchPaths();
  return {
    notice: `${row.name} added. It is on the booking form straight away if it is active.`,
    createdId: data?.id,
  };
}

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

export async function updatePitch(
  _prev: PitchAdminActionState,
  formData: FormData,
): Promise<PitchAdminActionState> {
  const id = text(formData, "id", 40);
  if (!id) return { error: "No pitch given." };

  const read = readFields(formData);
  if ("error" in read) return { error: read.error };

  const supabase = await createClient();
  const { error } = await supabase.from("resources").update(read.fields).eq("id", id);
  if (error) return { error: friendlyDbError(error, NOT_ALLOWED) };

  revalidatePitchPaths();
  return { notice: `${read.fields.name} saved.` };
}

// ---------------------------------------------------------------------------
// Retire / bring back
// ---------------------------------------------------------------------------

/**
 * Deactivating is how a pitch is retired: the row stays, so every booking that
 * references it still reads correctly, and `resources_public_read` stops
 * returning it to anyone who is not an administrator.
 */
export async function setPitchActive(
  _prev: PitchAdminActionState,
  formData: FormData,
): Promise<PitchAdminActionState> {
  const id = text(formData, "id", 40);
  if (!id) return { error: "No pitch given." };
  const active = text(formData, "active", 8) === "true";

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("resources")
    .update({ active })
    .eq("id", id)
    .select("name")
    .maybeSingle();
  if (error) return { error: friendlyDbError(error, NOT_ALLOWED) };

  revalidatePitchPaths();
  const name = data?.name ?? "That pitch";
  return {
    notice: active
      ? `${name} is bookable again.`
      : `${name} is out of use. Bookings already on it are untouched — it is simply no longer offered.`,
  };
}

// ---------------------------------------------------------------------------
// Running order
// ---------------------------------------------------------------------------

/**
 * Move a pitch one place up or down.
 *
 * The whole list is renumbered from zero rather than the pair being swapped.
 * `sort_order` has no unique constraint and the imported rows share values, so
 * swapping two equal numbers would look like a working button that does
 * nothing. Renumbering makes the order the list actually shows the order the
 * column holds.
 */
export async function movePitch(
  _prev: PitchAdminActionState,
  formData: FormData,
): Promise<PitchAdminActionState> {
  const id = text(formData, "id", 40);
  const direction = text(formData, "direction", 4);
  if (!id) return { error: "No pitch given." };
  if (direction !== "up" && direction !== "down") return { error: "Say which way to move it." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("resources")
    .select("id,name,sort_order")
    .eq("type", "pitch")
    .order("sort_order")
    .order("name");
  if (error) return { error: friendlyDbError(error, NOT_ALLOWED) };

  const ordered = data ?? [];
  const index = ordered.findIndex((row) => row.id === id);
  if (index === -1) return { error: "That pitch is no longer in the list." };

  const target = direction === "up" ? index - 1 : index + 1;
  const moved = ordered[index];
  const neighbour = ordered[target];
  if (!moved || !neighbour) {
    return { notice: `That pitch is already ${direction === "up" ? "first" : "last"}.` };
  }

  const reordered = [...ordered];
  reordered[index] = neighbour;
  reordered[target] = moved;

  for (const [position, row] of reordered.entries()) {
    if (row.sort_order === position) continue;
    const { error: updateError } = await supabase
      .from("resources")
      .update({ sort_order: position })
      .eq("id", row.id);
    if (updateError) return { error: friendlyDbError(updateError, NOT_ALLOWED) };
  }

  revalidatePitchPaths();
  return { notice: `${moved.name} moved ${direction}.` };
}
