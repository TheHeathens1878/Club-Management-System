"use server";

/**
 * Winter training allocation — the planner's writes (Adam, 2026-09-06).
 *
 * Every write to the plan goes through the USER-SCOPED client: the four
 * `training_*` tables each carry a `can_plan_training()` policy, so the
 * database is what decides whether the caller may plan, and a 42501 here is
 * turned into the sentence saying so. The guards — a slot cannot be
 * over-allocated, a block runs for at most a year — raise P0001 with words
 * written for the screen, and those are shown verbatim.
 *
 * The plan is EDITED here and APPLIED by `syncBlock`: nothing on the
 * calendar moves until the administrator presses "Update the calendar",
 * which is `sync_training_block()` for real after the page has shown them
 * the dry run. That is the whole re-run design: change the plan as much as
 * you like, then bring the calendar into step, as many times as you need.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isValidDateString, isValidTimeString, normaliseTime } from "@/lib/booking-time";
import { friendlyDbError } from "@/lib/people-display";
import { createClient } from "@/lib/supabase/server";
import type { SyncCounts } from "@/lib/training-plan";

export type PlanActionState = {
  error?: string;
  notice?: string;
  /** Set after a real sync, so the card can say what happened. */
  synced?: SyncCounts;
};

const NOT_ALLOWED = "The database refused that. Only a club administrator can plan training.";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(formData: FormData, key: string, max = 300): string {
  return String(formData.get(key) ?? "")
    .trim()
    .slice(0, max);
}

function uuid(formData: FormData, key: string): string | null {
  const value = text(formData, key, 40);
  return UUID_RE.test(value) ? value : null;
}

function integer(formData: FormData, key: string, min: number, max: number): number | null {
  const value = Number.parseInt(text(formData, key, 4), 10);
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function revalidateBlock(blockId: string): void {
  revalidatePath("/pitches/training");
  revalidatePath(`/pitches/training/${blockId}`);
}

function revalidateCalendars(): void {
  revalidatePath("/events");
  revalidatePath("/training");
  revalidatePath("/lobby");
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

export async function createBlock(_prev: PlanActionState, formData: FormData): Promise<PlanActionState> {
  const name = text(formData, "name", 80);
  const startsOn = text(formData, "starts_on", 10);
  const endsOn = text(formData, "ends_on", 10);
  const sessionTitle = text(formData, "session_title", 80) || "Winter training";
  const seasonId = uuid(formData, "season_id");
  const notes = text(formData, "notes", 1000);

  if (!name) return { error: "Give the block a name — “Winter 2026/27”." };
  if (!isValidDateString(startsOn) || !isValidDateString(endsOn)) {
    return { error: "Choose the first and last days of training." };
  }
  if (endsOn < startsOn) return { error: "The last day cannot be before the first." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("training_blocks")
    .insert({
      name,
      starts_on: startsOn,
      ends_on: endsOn,
      session_title: sessionTitle,
      season_id: seasonId,
      notes: notes || null,
    })
    .select("id")
    .single();
  if (error) return { error: friendlyDbError(error, NOT_ALLOWED) };

  revalidatePath("/pitches/training");
  redirect(`/pitches/training/${data.id}`);
}

export async function updateBlock(_prev: PlanActionState, formData: FormData): Promise<PlanActionState> {
  const blockId = uuid(formData, "block_id");
  if (!blockId) return { error: "No block given." };
  const name = text(formData, "name", 80);
  const startsOn = text(formData, "starts_on", 10);
  const endsOn = text(formData, "ends_on", 10);
  const sessionTitle = text(formData, "session_title", 80);
  const notes = text(formData, "notes", 1000);

  if (!name) return { error: "The block needs a name." };
  if (!sessionTitle) return { error: "Say what the sessions are called on the calendar." };
  if (!isValidDateString(startsOn) || !isValidDateString(endsOn)) {
    return { error: "Choose the first and last days of training." };
  }
  if (endsOn < startsOn) return { error: "The last day cannot be before the first." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("training_blocks")
    .update({ name, starts_on: startsOn, ends_on: endsOn, session_title: sessionTitle, notes: notes || null })
    .eq("id", blockId)
    .select("id");
  if (error) return { error: friendlyDbError(error, NOT_ALLOWED) };
  if ((data ?? []).length === 0) return { error: NOT_ALLOWED };

  revalidateBlock(blockId);
  return { notice: "Saved. Update the calendar to apply the new dates." };
}

export async function deleteBlock(_prev: PlanActionState, formData: FormData): Promise<PlanActionState> {
  const blockId = uuid(formData, "block_id");
  if (!blockId) return { error: "No block given." };

  const supabase = await createClient();
  const { data, error } = await supabase.from("training_blocks").delete().eq("id", blockId).select("id");
  if (error) return { error: friendlyDbError(error, NOT_ALLOWED) };
  if ((data ?? []).length === 0) return { error: NOT_ALLOWED };

  revalidatePath("/pitches/training");
  revalidateCalendars();
  redirect("/pitches/training");
}

// ---------------------------------------------------------------------------
// Dates off
// ---------------------------------------------------------------------------

export async function addBlackout(_prev: PlanActionState, formData: FormData): Promise<PlanActionState> {
  const blockId = uuid(formData, "block_id");
  if (!blockId) return { error: "No block given." };
  const label = text(formData, "label", 80);
  const startsOn = text(formData, "starts_on", 10);
  const endsOn = text(formData, "ends_on", 10) || startsOn;

  if (!label) return { error: "Say what the dates off are — “Christmas”, “Half-term”." };
  if (!isValidDateString(startsOn) || !isValidDateString(endsOn)) return { error: "Choose the dates." };
  if (endsOn < startsOn) return { error: "The last day off cannot be before the first." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("training_blackouts")
    .insert({ block_id: blockId, label, starts_on: startsOn, ends_on: endsOn });
  if (error) return { error: friendlyDbError(error, NOT_ALLOWED) };

  revalidateBlock(blockId);
  return { notice: `${label} added. Update the calendar to take those sessions off.` };
}

export async function removeBlackout(_prev: PlanActionState, formData: FormData): Promise<PlanActionState> {
  const blockId = uuid(formData, "block_id");
  const blackoutId = uuid(formData, "blackout_id");
  if (!blockId || !blackoutId) return { error: "No dates given." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("training_blackouts")
    .delete()
    .eq("id", blackoutId)
    .eq("block_id", blockId)
    .select("id");
  if (error) return { error: friendlyDbError(error, NOT_ALLOWED) };
  if ((data ?? []).length === 0) return { error: NOT_ALLOWED };

  revalidateBlock(blockId);
  return { notice: "Removed. Update the calendar to put those sessions back." };
}

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

function readSlot(formData: FormData): { error: string } | {
  venueId: string;
  venueAddress: string | null;
  weekday: number;
  startTime: string;
  endTime: string;
  parts: number;
  clubParts: number | null;
  notes: string | null;
} {
  const venueId = uuid(formData, "venue_id");
  const venueAddress = text(formData, "venue_address", 300);
  const weekday = integer(formData, "weekday", 0, 6);
  const startRaw = text(formData, "start_time", 8);
  const endRaw = text(formData, "end_time", 8);
  const parts = integer(formData, "parts", 1, 6);
  // "" = all of the parts are ours; otherwise how many of them (20260913130000).
  const clubRaw = text(formData, "club_parts", 2);
  const clubParts = clubRaw === "" ? null : integer(formData, "club_parts", 1, 6);
  const notes = text(formData, "notes", 500);

  if (!venueId) return { error: "Choose the venue — add it under Venues first if it is not listed." };
  if (weekday === null) return { error: "Choose the day of the week." };
  if (!isValidTimeString(startRaw) || !isValidTimeString(endRaw)) return { error: "Choose a start and an end time." };
  const startTime = normaliseTime(startRaw);
  const endTime = normaliseTime(endRaw);
  if (endTime <= startTime) return { error: "The slot must end after it starts." };
  if (parts === null) return { error: "Say how the pitch is divided." };
  if (clubRaw !== "" && clubParts === null) return { error: "Say how many of the parts are ours." };
  if (clubParts !== null && clubParts > parts) return { error: "The club cannot have more of the pitch than there are parts." };

  return {
    venueId,
    venueAddress: venueAddress || null,
    weekday,
    startTime,
    endTime,
    parts,
    clubParts: clubParts !== null && clubParts >= parts ? null : clubParts,
    notes: notes || null,
  };
}

export async function addSlot(_prev: PlanActionState, formData: FormData): Promise<PlanActionState> {
  const blockId = uuid(formData, "block_id");
  if (!blockId) return { error: "No block given." };
  const slot = readSlot(formData);
  if ("error" in slot) return slot;

  const supabase = await createClient();
  // venue_name is filled from the venue by trigger (20260913110000).
  const { error } = await supabase.from("training_slots").insert({
    block_id: blockId,
    venue_id: slot.venueId,
    venue_address: slot.venueAddress,
    weekday: slot.weekday,
    start_time: slot.startTime,
    end_time: slot.endTime,
    parts: slot.parts,
    club_parts: slot.clubParts,
    notes: slot.notes,
  });
  if (error) return { error: friendlyDbError(error, NOT_ALLOWED) };

  revalidateBlock(blockId);
  return { notice: "Slot added — now put teams in it." };
}

export async function updateSlot(_prev: PlanActionState, formData: FormData): Promise<PlanActionState> {
  const blockId = uuid(formData, "block_id");
  const slotId = uuid(formData, "slot_id");
  if (!blockId || !slotId) return { error: "No slot given." };
  const slot = readSlot(formData);
  if ("error" in slot) return slot;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("training_slots")
    .update({
      venue_id: slot.venueId,
      venue_address: slot.venueAddress,
      weekday: slot.weekday,
      start_time: slot.startTime,
      end_time: slot.endTime,
      parts: slot.parts,
      club_parts: slot.clubParts,
      notes: slot.notes,
    })
    .eq("id", slotId)
    .eq("block_id", blockId)
    .select("id");
  if (error) return { error: friendlyDbError(error, NOT_ALLOWED) };
  if ((data ?? []).length === 0) return { error: NOT_ALLOWED };

  revalidateBlock(blockId);
  return { notice: "Slot saved. Update the calendar to move its sessions." };
}

export async function removeSlot(_prev: PlanActionState, formData: FormData): Promise<PlanActionState> {
  const blockId = uuid(formData, "block_id");
  const slotId = uuid(formData, "slot_id");
  if (!blockId || !slotId) return { error: "No slot given." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("training_slots")
    .delete()
    .eq("id", slotId)
    .eq("block_id", blockId)
    .select("id");
  if (error) return { error: friendlyDbError(error, NOT_ALLOWED) };
  if ((data ?? []).length === 0) return { error: NOT_ALLOWED };

  revalidateBlock(blockId);
  return { notice: "Slot removed. Update the calendar to take its sessions off." };
}

/**
 * Clone a slot — venue, division, notes and (by default) its teams — to
 * another day or hour (Adam, 2026-09-13). One call to
 * `clone_training_slot()`: SECURITY INVOKER, so the planning policies decide.
 */
export async function cloneSlot(_prev: PlanActionState, formData: FormData): Promise<PlanActionState> {
  const blockId = uuid(formData, "block_id");
  const slotId = uuid(formData, "slot_id");
  if (!blockId || !slotId) return { error: "No slot given." };
  const weekday = integer(formData, "weekday", 0, 6);
  const startRaw = text(formData, "start_time", 8);
  const endRaw = text(formData, "end_time", 8);
  if (weekday === null) return { error: "Choose the day of the week." };
  if (!isValidTimeString(startRaw) || !isValidTimeString(endRaw)) return { error: "Choose a start and an end time." };
  const startTime = normaliseTime(startRaw);
  const endTime = normaliseTime(endRaw);
  if (endTime <= startTime) return { error: "The slot must end after it starts." };
  const copyTeams = formData.get("copy_teams") === "on";

  const supabase = await createClient();
  const { error } = await supabase.rpc("clone_training_slot", {
    p_slot_id: slotId,
    p_weekday: weekday,
    p_start_time: startTime,
    p_end_time: endTime,
    p_copy_teams: copyTeams,
  });
  if (error) return { error: friendlyDbError(error, NOT_ALLOWED) };

  revalidateBlock(blockId);
  return { notice: copyTeams ? "Slot cloned, teams and all. Update the calendar to add its sessions." : "Slot cloned — now put teams in it." };
}

// ---------------------------------------------------------------------------
// Teams in slots
// ---------------------------------------------------------------------------

/**
 * The day planner's drop: a team onto a slot, one part of it. Plain arguments
 * rather than a form — the planner calls it from a drag, not a submit — and
 * the same guard answers as for "Add team".
 */
export async function allocateTeamToSlot(input: {
  blockId: string;
  slotId: string;
  teamId: string;
  shares: number;
}): Promise<PlanActionState> {
  if (!UUID_RE.test(input.blockId) || !UUID_RE.test(input.slotId) || !UUID_RE.test(input.teamId)) {
    return { error: "No slot or team given." };
  }
  const shares = Number.isInteger(input.shares) && input.shares >= 1 && input.shares <= 6 ? input.shares : 1;
  const supabase = await createClient();
  const { error } = await supabase
    .from("training_allocations")
    .insert({ slot_id: input.slotId, team_id: input.teamId, shares });
  if (error) {
    if (error.code === "23505") return { error: "That team is already in this slot." };
    return { error: friendlyDbError(error, NOT_ALLOWED) };
  }
  revalidateBlock(input.blockId);
  return { notice: "Team placed." };
}

/** The day planner's other drop: a team already in a slot, dragged to another. */
export async function moveAllocation(input: {
  blockId: string;
  allocationId: string;
  slotId: string;
  /** How much of the new slot the team takes; omitted = keep its shares. */
  shares?: number;
}): Promise<PlanActionState> {
  if (!UUID_RE.test(input.blockId) || !UUID_RE.test(input.allocationId) || !UUID_RE.test(input.slotId)) {
    return { error: "No slot or team given." };
  }
  const supabase = await createClient();
  const shares =
    input.shares !== undefined && Number.isInteger(input.shares) && input.shares >= 1 && input.shares <= 6
      ? input.shares
      : undefined;
  const { data, error } = await supabase
    .from("training_allocations")
    .update(shares === undefined ? { slot_id: input.slotId } : { slot_id: input.slotId, shares })
    .eq("id", input.allocationId)
    .select("id");
  if (error) {
    if (error.code === "23505") return { error: "That team is already in that slot." };
    return { error: friendlyDbError(error, NOT_ALLOWED) };
  }
  if ((data ?? []).length === 0) return { error: NOT_ALLOWED };
  revalidateBlock(input.blockId);
  return { notice: "Team moved." };
}

export async function addAllocation(_prev: PlanActionState, formData: FormData): Promise<PlanActionState> {
  const blockId = uuid(formData, "block_id");
  const slotId = uuid(formData, "slot_id");
  const teamId = uuid(formData, "team_id");
  const shares = integer(formData, "shares", 1, 6) ?? 1;
  if (!blockId || !slotId) return { error: "No slot given." };
  if (!teamId) return { error: "Choose a team." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("training_allocations")
    .insert({ slot_id: slotId, team_id: teamId, shares });
  if (error) {
    return {
      error: friendlyDbError(error, NOT_ALLOWED, "That team is already in this slot."),
    };
  }

  revalidateBlock(blockId);
  return { notice: "Team added. Update the calendar to create its sessions." };
}

export async function updateAllocation(_prev: PlanActionState, formData: FormData): Promise<PlanActionState> {
  const blockId = uuid(formData, "block_id");
  const allocationId = uuid(formData, "allocation_id");
  const shares = integer(formData, "shares", 1, 6);
  if (!blockId || !allocationId) return { error: "No team given." };
  if (shares === null) return { error: "Choose how much of the pitch." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("training_allocations")
    .update({ shares })
    .eq("id", allocationId)
    .select("id");
  if (error) return { error: friendlyDbError(error, NOT_ALLOWED) };
  if ((data ?? []).length === 0) return { error: NOT_ALLOWED };

  revalidateBlock(blockId);
  return { notice: "Share changed. Update the calendar to reword its sessions." };
}

export async function removeAllocation(_prev: PlanActionState, formData: FormData): Promise<PlanActionState> {
  const blockId = uuid(formData, "block_id");
  const allocationId = uuid(formData, "allocation_id");
  if (!blockId || !allocationId) return { error: "No team given." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("training_allocations")
    .delete()
    .eq("id", allocationId)
    .select("id");
  if (error) return { error: friendlyDbError(error, NOT_ALLOWED) };
  if ((data ?? []).length === 0) return { error: NOT_ALLOWED };

  revalidateBlock(blockId);
  return { notice: "Team taken out. Update the calendar to remove its sessions." };
}

// ---------------------------------------------------------------------------
// The button — bring the calendar into step with the plan
// ---------------------------------------------------------------------------

export async function syncBlock(_prev: PlanActionState, formData: FormData): Promise<PlanActionState> {
  const blockId = uuid(formData, "block_id");
  if (!blockId) return { error: "No block given." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sync_training_block", { p_block_id: blockId, p_dry_run: false });
  if (error) return { error: friendlyDbError(error, NOT_ALLOWED) };
  const row = data?.[0];
  if (!row) return { error: "The calendar was not updated." };

  revalidateBlock(blockId);
  revalidateCalendars();
  return { synced: row };
}

// ---------------------------------------------------------------------------
// The block's venues (Adam, 2026-09-13: "for each training block, I need to
// be able to select which venues apply to that training block")
// ---------------------------------------------------------------------------

export async function addBlockVenue(_prev: PlanActionState, formData: FormData): Promise<PlanActionState> {
  const blockId = uuid(formData, "block_id");
  const venueId = uuid(formData, "venue_id");
  if (!blockId) return { error: "No block given." };
  if (!venueId) return { error: "Choose a venue." };

  const supabase = await createClient();
  const { error } = await supabase.from("training_block_venues").insert({ block_id: blockId, venue_id: venueId });
  if (error) {
    if (error.code === "23505") return { error: "That venue is already on this block." };
    return { error: friendlyDbError(error, NOT_ALLOWED) };
  }
  revalidateBlock(blockId);
  revalidatePath("/venues");
  return { notice: "Venue added to the block — it has a column in the day planner now." };
}

export async function removeBlockVenue(_prev: PlanActionState, formData: FormData): Promise<PlanActionState> {
  const blockId = uuid(formData, "block_id");
  const venueId = uuid(formData, "venue_id");
  if (!blockId || !venueId) return { error: "No venue given." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("training_block_venues")
    .delete()
    .eq("block_id", blockId)
    .eq("venue_id", venueId)
    .select("venue_id");
  if (error) return { error: friendlyDbError(error, NOT_ALLOWED) };
  if ((data ?? []).length === 0) return { error: NOT_ALLOWED };
  revalidateBlock(blockId);
  return { notice: "Venue taken off the block." };
}
