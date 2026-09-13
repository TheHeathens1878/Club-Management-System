"use server";

/**
 * A training venue's bookings, season by season (Adam, 2026-09-13: "note
 * booking dates for each season against each training venue").
 *
 * The record of the hire — "Loreto, 2026/27, 6 Oct to 23 Mar, Tuesdays 7–8,
 * ref LHS-0412" — kept beside the venue so whoever plans the next block can
 * see what the club has actually booked. It is a note, not the plan: the
 * block's slots say what happens in the booking. Written through the
 * user-scoped client; `venue_bookings_admin_write` asks `can_plan_training()`.
 */

import { revalidatePath } from "next/cache";

import { isValidDateString } from "@/lib/booking-time";
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

export async function addVenueBooking(_prev: VenueActionState, formData: FormData): Promise<VenueActionState> {
  const venueId = uuid(formData, "venue_id");
  if (!venueId) return { error: "No venue was named." };
  const seasonId = uuid(formData, "season_id");
  const startsOn = text(formData, "starts_on", 10);
  const endsOn = text(formData, "ends_on", 10) || startsOn;
  const whenText = text(formData, "when_text", 120);
  const reference = text(formData, "reference", 80);
  const notes = text(formData, "notes", 1000);

  if (!isValidDateString(startsOn) || !isValidDateString(endsOn)) return { error: "Choose the first and last dates booked." };
  if (endsOn < startsOn) return { error: "The booking cannot end before it starts." };

  const supabase = await createClient();
  const { error } = await supabase.from("venue_bookings").insert({
    venue_id: venueId,
    season_id: seasonId,
    starts_on: startsOn,
    ends_on: endsOn,
    when_text: whenText || null,
    reference: reference || null,
    notes: notes || null,
  });
  if (error) return { error: friendlyDbError(error, NOT_ALLOWED) };

  revalidatePath("/venues");
  revalidatePath(`/venues/${venueId}`);
  return { notice: "Booking noted." };
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
