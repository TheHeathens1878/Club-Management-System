"use server";

/**
 * Availability and attendance for a team booking (gap 8).
 *
 * Everything goes through the USER-SCOPED client, and the database decides:
 *
 *   - `booking_availability_insert` demands `is_member_of_booking(person, booking)`
 *     AND that the writer is the person themselves, their guardian
 *     (`can_act_for`), the team's staff or a club administrator. So a parent
 *     setting availability for someone else's child is a 42501, whatever this
 *     file does.
 *   - `booking_attendance_staff_write` is staff-and-admin only, with the same
 *     membership check on the row being written.
 *   - a FIXTURE booking writes availability to `public.availability` instead,
 *     keyed on `fixture_id`. That table already existed and already has the
 *     selection screens hanging off it; a second copy of the same answer in
 *     `booking_availability` would be a second source of truth. `availability_guard()`
 *     is a BEFORE trigger there, so it runs ahead of the WITH CHECK and its
 *     P0001 ("not in the team for that fixture's season") is the message the
 *     coach needs — passed through verbatim.
 *
 * Attendance is always keyed on the booking, fixture or not: the sheet is
 * "who turned up to this session", and a fixture's session is its booking.
 */

import { revalidatePath } from "next/cache";

import type { Database } from "@club/db";

import { getSessionProfile } from "@/lib/auth";
import { friendlyDbError } from "@/lib/people-display";
import { createClient } from "@/lib/supabase/server";

type AvailabilityStatus = Database["public"]["Enums"]["availability_status"];
type AttendanceStatus = Database["public"]["Enums"]["attendance_status"];

const AVAILABILITY_STATUSES: AvailabilityStatus[] = ["available", "maybe", "unavailable"];
const ATTENDANCE_STATUSES: AttendanceStatus[] = ["present", "late", "absent"];

export type AttendanceActionState = {
  error?: string;
  notice?: string;
};

const AVAILABILITY_REFUSED =
  "The database refused that. Availability can only be set by the player, their parent or guardian, the team's staff or a club administrator — and only for someone who is in one of the teams on this booking.";

const ATTENDANCE_REFUSED =
  "The database refused that. Only this team's coach, assistant coach or manager — or a club administrator — can mark attendance.";

function text(formData: FormData, key: string, max = 500): string {
  return String(formData.get(key) ?? "")
    .trim()
    .slice(0, max);
}

// ---------------------------------------------------------------------------
// Availability — the player's own answer, or their guardian's
// ---------------------------------------------------------------------------

export async function setBookingAvailability(
  _prev: AttendanceActionState,
  formData: FormData,
): Promise<AttendanceActionState> {
  const session = await getSessionProfile();
  if (!session) return { error: "Sign in again to set availability." };

  const bookingId = text(formData, "booking_id", 40);
  const personId = text(formData, "person_id", 40);
  const fixtureId = text(formData, "fixture_id", 40);
  const statusRaw = text(formData, "status", 20);
  const note = text(formData, "note", 500) || null;

  if (!bookingId) return { error: "No booking given." };
  if (!personId) return { error: "No player given." };
  if (!AVAILABILITY_STATUSES.includes(statusRaw as AvailabilityStatus)) {
    return { error: "Choose available, maybe or unavailable." };
  }
  const status = statusRaw as AvailabilityStatus;

  const supabase = await createClient();

  // A fixture's availability lives in `availability`, keyed on the fixture —
  // the same rows the selection screens read.
  const { error } = fixtureId
    ? await supabase
        .from("availability")
        .upsert(
          { fixture_id: fixtureId, person_id: personId, status, note, set_by: session.userId },
          { onConflict: "fixture_id,person_id" },
        )
    : await supabase
        .from("booking_availability")
        .upsert(
          { booking_id: bookingId, person_id: personId, status, note, set_by: session.userId },
          { onConflict: "booking_id,person_id" },
        );

  if (error) return { error: friendlyDbError(error, AVAILABILITY_REFUSED) };

  revalidatePath(`/pitches/${bookingId}`);
  return { notice: "Availability saved." };
}

// ---------------------------------------------------------------------------
// Attendance — the sheet, saved in one go
// ---------------------------------------------------------------------------

/**
 * The whole roster in one submit.
 *
 * The form posts `status:<personId>` and `note:<personId>` per row. A row left
 * on "not marked" is a DELETE, not a row with a null status: the column is NOT
 * NULL, and "no answer yet" and "marked absent" are different facts about a
 * child's session.
 *
 * The upserts go one statement per row rather than one multi-row statement.
 * PostgREST reports a policy refusal for a batch as a single failure with no
 * hint of which row caused it, and "somebody on this list is not in the team"
 * is not something a coach can act on.
 */
export async function saveBookingAttendance(
  _prev: AttendanceActionState,
  formData: FormData,
): Promise<AttendanceActionState> {
  const session = await getSessionProfile();
  if (!session) return { error: "Sign in again to mark attendance." };

  const bookingId = text(formData, "booking_id", 40);
  if (!bookingId) return { error: "No booking given." };

  const marked: { personId: string; status: AttendanceStatus; note: string | null }[] = [];
  const cleared: string[] = [];

  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("status:")) continue;
    const personId = key.slice("status:".length).trim().slice(0, 40);
    if (!personId) continue;

    const raw = String(value).trim();
    if (raw === "") {
      cleared.push(personId);
      continue;
    }
    if (!ATTENDANCE_STATUSES.includes(raw as AttendanceStatus)) {
      return { error: "One of the rows has a status that is not present, late or absent." };
    }
    marked.push({
      personId,
      status: raw as AttendanceStatus,
      note: text(formData, `note:${personId}`, 500) || null,
    });
  }

  if (marked.length === 0 && cleared.length === 0) {
    return { error: "There was nobody on the sheet to save." };
  }

  const supabase = await createClient();

  for (const row of marked) {
    const { error } = await supabase.from("booking_attendance").upsert(
      {
        booking_id: bookingId,
        person_id: row.personId,
        status: row.status,
        note: row.note,
        marked_by: session.userId,
      },
      { onConflict: "booking_id,person_id" },
    );
    if (error) return { error: friendlyDbError(error, ATTENDANCE_REFUSED) };
  }

  if (cleared.length > 0) {
    const { error } = await supabase
      .from("booking_attendance")
      .delete()
      .eq("booking_id", bookingId)
      .in("person_id", cleared);
    if (error) return { error: friendlyDbError(error, ATTENDANCE_REFUSED) };
  }

  revalidatePath(`/pitches/${bookingId}`);
  return {
    notice:
      marked.length === 0
        ? "Attendance cleared."
        : `Attendance saved for ${marked.length} ${marked.length === 1 ? "person" : "people"}.`,
  };
}
