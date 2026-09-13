"use server";

/**
 * A training venue's bookings, season by season (Adam, 2026-09-13: "note
 * booking dates for each season against each training venue"), each with
 * its weekly slots (Adam, later the same day: "slots by days and hours
 * instead of When").
 *
 * The record of the hire — "Loreto, 2026/27, 6 Oct to 23 Mar, Tuesdays
 * 19:00–20:00 and Thursdays 18:00–19:30, ref LHS-0412" — kept beside the
 * venue so whoever plans the next block can see what the club has actually
 * booked. It is a note, not the plan: the block's slots say what happens in
 * the booking. Written through the user-scoped client;
 * `venue_bookings_admin_write` and `venue_booking_slots_admin_write` ask
 * `can_plan_training()`.
 */

import { revalidatePath } from "next/cache";

import { isValidDateString, isValidTimeString, normaliseTime } from "@/lib/booking-time";
import { parseShareKey } from "@/lib/training-plan";
import { friendlyDbError } from "@/lib/people-display";
import { createClient } from "@/lib/supabase/server";

import type { VenueActionState } from "./venue-actions";

const NOT_ALLOWED = "The database refused that. Only a club administrator or committee member can note a venue booking.";

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

type SlotInput = {
  weekday: number;
  start_time: string;
  end_time: string;
  pitch_id: string | null;
  parts: number;
  shares: number;
  price_pence: number | null;
};

/**
 * The slot rows the form sends as parallel fields — `slot_weekday`,
 * `slot_start`, `slot_end`, one of each per row. A row with nothing in it is
 * skipped; a half-filled one is an error, because a slot with no end is not
 * a slot.
 */
function readSlots(formData: FormData): { error: string } | { slots: SlotInput[] } {
  const days = formData.getAll("slot_weekday").map((v) => String(v).trim());
  const starts = formData.getAll("slot_start").map((v) => String(v).trim());
  const ends = formData.getAll("slot_end").map((v) => String(v).trim());
  const pitches = formData.getAll("slot_pitch").map((v) => String(v).trim());
  const sharesKeys = formData.getAll("slot_share").map((v) => String(v).trim());
  const prices = formData.getAll("slot_price").map((v) => String(v).trim());
  const slots: SlotInput[] = [];
  for (let i = 0; i < Math.max(days.length, starts.length, ends.length); i += 1) {
    const day = days[i] ?? "";
    const start = starts[i] ?? "";
    const end = ends[i] ?? "";
    if (day === "" && start === "" && end === "") continue;
    const weekday = Number.parseInt(day, 10);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return { error: "Choose the day for each slot." };
    if (!isValidTimeString(start) || !isValidTimeString(end)) return { error: "Give each slot a start and an end time." };
    const startTime = normaliseTime(start);
    const endTime = normaliseTime(end);
    if (endTime <= startTime) return { error: "A slot must end after it starts." };
    const share = parseShareKey(sharesKeys[i] ?? "1:1");
    const pitchRaw = pitches[i] ?? "";
    // The price per session, typed in pounds; blank = not priced yet.
    const priceRaw = prices[i] ?? "";
    const pricePounds = priceRaw === "" ? null : Number(priceRaw);
    if (pricePounds !== null && (!Number.isFinite(pricePounds) || pricePounds < 0 || pricePounds > 100000)) {
      return { error: "The price per session must be a figure in pounds." };
    }
    slots.push({
      weekday,
      start_time: startTime,
      end_time: endTime,
      pitch_id: UUID_RE.test(pitchRaw) ? pitchRaw : null,
      parts: share.parts,
      shares: share.shares,
      price_pence: pricePounds === null ? null : Math.round(pricePounds * 100),
    });
  }
  if (slots.length > 20) return { error: "That is more than twenty slots — split the booking." };
  return { slots };
}

export async function addVenueBooking(_prev: VenueActionState, formData: FormData): Promise<VenueActionState> {
  const venueId = uuid(formData, "venue_id");
  if (!venueId) return { error: "No venue was named." };
  const seasonId = uuid(formData, "season_id");
  const startsOn = text(formData, "starts_on", 10);
  const endsOn = text(formData, "ends_on", 10) || startsOn;
  const reference = text(formData, "reference", 80);
  const notes = text(formData, "notes", 1000);

  if (!isValidDateString(startsOn) || !isValidDateString(endsOn)) return { error: "Choose the first and last dates booked." };
  if (endsOn < startsOn) return { error: "The booking cannot end before it starts." };
  const read = readSlots(formData);
  if ("error" in read) return { error: read.error };
  if (read.slots.length === 0) return { error: "Add at least one slot — the day and the hours booked." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("venue_bookings")
    .insert({
      venue_id: venueId,
      season_id: seasonId,
      starts_on: startsOn,
      ends_on: endsOn,
      reference: reference || null,
      notes: notes || null,
    })
    .select("id")
    .single();
  if (error) return { error: friendlyDbError(error, NOT_ALLOWED) };

  const { error: slotsError } = await supabase
    .from("venue_booking_slots")
    .insert(read.slots.map((slot) => ({ booking_id: data.id, ...slot })));
  if (slotsError) {
    // The booking without its slots would say nothing useful; take it back.
    await supabase.from("venue_bookings").delete().eq("id", data.id);
    return { error: friendlyDbError(slotsError, NOT_ALLOWED) };
  }

  revalidatePath("/venues");
  revalidatePath(`/venues/${venueId}`);
  return { notice: `Booking noted with ${read.slots.length} ${read.slots.length === 1 ? "slot" : "slots"}.` };
}

export async function removeVenueBooking(_prev: VenueActionState, formData: FormData): Promise<VenueActionState> {
  const venueId = uuid(formData, "venue_id");
  const bookingId = uuid(formData, "booking_id");
  if (!venueId || !bookingId) return { error: "No booking was named." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("venue_bookings")
    .delete()
    .eq("id", bookingId)
    .eq("venue_id", venueId)
    .select("id");
  if (error) return { error: friendlyDbError(error, NOT_ALLOWED) };
  if ((data ?? []).length === 0) return { error: NOT_ALLOWED };

  revalidatePath("/venues");
  revalidatePath(`/venues/${venueId}`);
  return { notice: "Booking removed." };
}

/** One more slot on a booking already noted. */
export async function addVenueBookingSlot(_prev: VenueActionState, formData: FormData): Promise<VenueActionState> {
  const venueId = uuid(formData, "venue_id");
  const bookingId = uuid(formData, "booking_id");
  if (!venueId || !bookingId) return { error: "No booking was named." };
  const read = readSlots(formData);
  if ("error" in read) return { error: read.error };
  if (read.slots.length === 0) return { error: "Choose the day and the hours." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("venue_booking_slots")
    .insert(read.slots.map((slot) => ({ booking_id: bookingId, ...slot })));
  if (error) return { error: friendlyDbError(error, NOT_ALLOWED) };

  revalidatePath("/venues");
  revalidatePath(`/venues/${venueId}`);
  return { notice: "Slot added." };
}

export async function removeVenueBookingSlot(_prev: VenueActionState, formData: FormData): Promise<VenueActionState> {
  const venueId = uuid(formData, "venue_id");
  const slotId = uuid(formData, "slot_id");
  if (!venueId || !slotId) return { error: "No slot was named." };

  const supabase = await createClient();
  const { data, error } = await supabase.from("venue_booking_slots").delete().eq("id", slotId).select("id");
  if (error) return { error: friendlyDbError(error, NOT_ALLOWED) };
  if ((data ?? []).length === 0) return { error: NOT_ALLOWED };

  revalidatePath("/venues");
  revalidatePath(`/venues/${venueId}`);
  return { notice: "Slot removed." };
}
