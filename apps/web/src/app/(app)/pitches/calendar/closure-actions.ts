"use server";

/**
 * Closing a pitch (gap 6).
 *
 * A closure is an ordinary booking — `kind = 'maintenance'`, `status =
 * 'confirmed'`, no team, the administrator as booker — written through the
 * USER-SCOPED client under the existing `bookings_staff_insert` policy. There
 * is no new write path and no new privilege: if the caller is not staff or a
 * club administrator the policy refuses, and the message says so.
 *
 * Whether a pitch is free is decided in exactly one place, the GiST exclusion
 * constraint `bookings_no_overlap`. `booking_has_conflict()` is asked first so
 * a clash can be named per pitch before anything is written; the constraint is
 * what makes it safe when a coach books the same slot at the same moment, so
 * 23P01 is handled too — and re-checked, so the error can say *which* pitch
 * was taken rather than "something clashed".
 *
 * "All pitches" is one multi-row INSERT. Postgres makes that atomic, so a
 * closure either lands on every pitch asked for or on none: half a closure is
 * worse than none, because the half that is missing is the one someone plays
 * on.
 */

import { revalidatePath } from "next/cache";

import { getSessionProfile } from "@/lib/auth";
import {
  isValidDateString,
  isValidTimeString,
  localToInstant,
  normaliseTime,
} from "@/lib/booking-time";
import { isSlotConflict, slotHasConflict } from "@/lib/booking-conflict";
import { bookingPeriod, type BookingInsert } from "@/lib/booking-types";
import { friendlyDbError } from "@/lib/people-display";
import { createClient } from "@/lib/supabase/server";

export type ClosureActionState = {
  error?: string;
  notice?: string;
  /** "Pitch 1 — Sat, 1 Mar 2026 · 18:00–19:30" for each pitch already taken. */
  clashes?: string[];
};

const NOT_ALLOWED =
  "The database refused that. Only a club administrator can close a pitch.";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(formData: FormData, key: string, max = 200): string {
  return String(formData.get(key) ?? "").trim().slice(0, max);
}

function revalidateCalendar(): void {
  revalidatePath("/pitches/calendar");
  revalidatePath("/pitches");
  revalidatePath("/pitches/requests");
  revalidatePath("/pitches/mine");
}

/**
 * Close one pitch, or every pitch, for a window.
 *
 * `p_pitch = "all"` means every active pitch; anything else must be the id of
 * one. The pitch list is read as the caller, so "all" is exactly the pitches
 * they can see.
 */
export async function createPitchClosure(
  _prev: ClosureActionState,
  formData: FormData,
): Promise<ClosureActionState> {
  const session = await getSessionProfile();
  if (!session) return { error: "Sign in again to close a pitch." };

  const date = text(formData, "date", 10);
  const startRaw = text(formData, "start_time", 8);
  const endRaw = text(formData, "end_time", 8);
  const label = text(formData, "label", 120);
  const target = text(formData, "resource_id", 40);

  if (!isValidDateString(date)) return { error: "Choose a date." };
  if (!isValidTimeString(startRaw) || !isValidTimeString(endRaw)) {
    return { error: "Choose a start and an end time." };
  }
  const startTime = normaliseTime(startRaw);
  const endTime = normaliseTime(endRaw);
  if (endTime <= startTime) return { error: "The end time must be after the start time." };
  if (!label) return { error: "Say why — “Waterlogged”, “Frozen”, “Re-seeding”." };
  if (target !== "all" && !UUID_RE.test(target)) return { error: "Choose a pitch." };

  const startsAt = localToInstant(date, startTime);
  const endsAt = localToInstant(date, endTime);

  const supabase = await createClient();
  const { data: personId } = await supabase.rpc("current_person_id");
  if (!personId) {
    return {
      error:
        "Your sign-in is not linked to a member record yet, so the club cannot record who closed the pitch.",
    };
  }

  const { data: pitchRows, error: pitchError } = await supabase
    .from("resources")
    .select("id,name")
    .eq("type", "pitch")
    .eq("active", true)
    .order("sort_order")
    .order("name");
  if (pitchError) return { error: `Could not read the pitches: ${pitchError.message}` };

  const pitches = (pitchRows ?? []).filter((row) => target === "all" || row.id === target);
  if (pitches.length === 0) return { error: "That pitch is not one of the club's active pitches." };

  const window = `${startTime}–${endTime}`;
  const clashLabel = (name: string): string => `${name} — ${date}, ${window}`;

  const preChecked = await Promise.all(
    pitches.map(async (pitch) => ({
      name: pitch.name,
      taken: await slotHasConflict(supabase, { resourceId: pitch.id, startsAt, endsAt }),
    })),
  );
  const clashes = preChecked.filter((row) => row.taken).map((row) => clashLabel(row.name));
  if (clashes.length > 0) {
    return {
      error:
        clashes.length === pitches.length
          ? "Something is already booked in that window. Cancel or move it first — a closure never overwrites a booking."
          : `${clashes.length} of the ${pitches.length} pitches already have a booking in that window. Nothing has been closed.`,
      clashes,
    };
  }

  const bookerName = session.profile?.full_name?.trim() || session.email || "Club administrator";
  const bookerEmail = session.email?.trim();
  if (!bookerEmail) {
    return { error: "Your sign-in has no email address, and a booking must record a contact." };
  }

  const rows: BookingInsert[] = pitches.map((pitch) => ({
    resource_id: pitch.id,
    team_id: null,
    kind: "maintenance",
    status: "confirmed",
    ...bookingPeriod(startsAt, endsAt),
    booker_person_id: personId,
    booker_profile_id: session.userId,
    booker_name: bookerName,
    booker_email: bookerEmail,
    occasion: label,
  }));

  const { error } = await supabase.from("bookings").insert(rows);
  if (error) {
    if (isSlotConflict(error)) {
      const late = await Promise.all(
        pitches.map(async (pitch) => ({
          name: pitch.name,
          taken: await slotHasConflict(supabase, { resourceId: pitch.id, startsAt, endsAt }),
        })),
      );
      const lateClashes = late.filter((row) => row.taken).map((row) => clashLabel(row.name));
      return {
        error:
          "Something was booked on that pitch while this form was open. Nothing has been closed.",
        clashes: lateClashes.length > 0 ? lateClashes : pitches.map((p) => clashLabel(p.name)),
      };
    }
    return { error: friendlyDbError(error, NOT_ALLOWED) };
  }

  revalidateCalendar();
  return {
    notice:
      pitches.length === 1
        ? `${pitches[0]?.name ?? "The pitch"} is closed on ${date}, ${window} — ${label}.`
        : `All ${pitches.length} pitches are closed on ${date}, ${window} — ${label}.`,
  };
}

/**
 * Re-open a pitch: the closure is cancelled, never deleted, so the record of
 * why it was shut survives. `kind = 'maintenance'` is checked here so this
 * action can never be pointed at a fixture or a coach's training slot.
 */
export async function cancelPitchClosure(
  _prev: ClosureActionState,
  formData: FormData,
): Promise<ClosureActionState> {
  const bookingId = text(formData, "booking_id", 40);
  if (!UUID_RE.test(bookingId)) return { error: "No closure given." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bookings")
    .update({ status: "cancelled" })
    .eq("id", bookingId)
    .eq("kind", "maintenance")
    .select("id");
  if (error) return { error: friendlyDbError(error, NOT_ALLOWED) };
  if ((data ?? []).length === 0) {
    return { error: "That closure could not be re-opened — it may already have been lifted." };
  }

  revalidateCalendar();
  return { notice: "The pitch is open again." };
}
