import type { PostgrestError } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@club/db";

/**
 * Double-booking protection for `public.bookings` (P1.5).
 *
 * The invariant is the GiST exclusion constraint `bookings_no_overlap`, which
 * rejects any overlap of the buffered `[blocked_from, blocked_until)` windows
 * of two `pending`/`confirmed` bookings on the same resource with SQLSTATE
 * 23P01. `booking_has_conflict()` is the courtesy check that lets us say "that
 * slot is taken" before attempting the write; the constraint is what makes it
 * safe when two requests race.
 *
 * Every insert or update that can create an overlap must therefore do both:
 * ask first, and translate 23P01 if the answer changed underneath us.
 */

export const SLOT_TAKEN_MESSAGE =
  "That slot is already booked. Please choose a different time or date.";

/** SQLSTATE 23P01 — exclusion_violation, raised by `bookings_no_overlap`. */
export function isSlotConflict(error: PostgrestError | null | undefined): boolean {
  return error?.code === "23P01";
}

/**
 * `SLOT_TAKEN_MESSAGE` for an overlap, otherwise the caller's own message.
 * Keeps a raw Postgres string from ever reaching a booker or a staff member.
 */
export function conflictOrMessage(
  error: PostgrestError | null | undefined,
  fallback: string,
): string {
  return isSlotConflict(error) ? SLOT_TAKEN_MESSAGE : fallback;
}

/**
 * Would a booking of this window on this resource collide with a live one?
 * `excludeBookingId` lets an edit ignore the row it is editing.
 *
 * A failed check returns `false`: the constraint still stands behind the
 * write, so a transient RPC error must not block a legitimate booking.
 */
export async function slotHasConflict(
  client: SupabaseClient<Database>,
  args: {
    resourceId: string;
    startsAt: string;
    endsAt: string;
    preBufferMinutes?: number;
    postBufferMinutes?: number;
    excludeBookingId?: string | null;
  },
): Promise<boolean> {
  const { data, error } = await client.rpc("booking_has_conflict", {
    p_resource_id: args.resourceId,
    p_starts_at: args.startsAt,
    p_ends_at: args.endsAt,
    p_pre_buffer_minutes: args.preBufferMinutes ?? 0,
    p_post_buffer_minutes: args.postBufferMinutes ?? 0,
    p_exclude_booking_id: args.excludeBookingId ?? undefined,
  });
  if (error) {
    console.error("[bookings] conflict check failed:", error);
    return false;
  }
  return data === true;
}
