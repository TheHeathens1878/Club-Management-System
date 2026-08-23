"use server";

/**
 * Pitch bookings by team — every write (gap 3).
 *
 * All of it goes through the USER-SCOPED client. The database, not this file,
 * decides what may happen:
 *
 *   - `bookings_team_staff_insert` allows a coach exactly one shape of row —
 *     a pending `block`/`training` booking on a pitch, for a team they staff,
 *     booked as themselves. Anything else is a 42501.
 *   - `bookings_team_guard()` is a BEFORE trigger, so it runs ahead of the
 *     WITH CHECK and raises P0001 with the sentence the coach needs
 *     ("only a club administrator can confirm a pitch booking"). Those
 *     messages are passed through verbatim — rewriting them would throw away
 *     the only explanation the user gets.
 *   - `bookings_no_overlap`, the GiST exclusion constraint, is the single
 *     arbiter of whether a pitch is free. `booking_has_conflict()` is asked
 *     first so a clash can be named before anything is written, but the
 *     constraint is what makes it safe when two coaches submit at once — so
 *     23P01 is handled on every path that can create an overlap.
 *
 * A weekly repeat is written as one multi-row INSERT: Postgres makes that
 * atomic, so a series either lands whole or not at all. When the constraint
 * rejects it, each occurrence is re-checked so the message can say which week
 * clashed rather than "something clashed".
 */

import { revalidatePath } from "next/cache";

import {
  addDays,
  isValidDateString,
  isValidTimeString,
  localToInstant,
  normaliseTime,
} from "@/lib/booking-time";
import { isSlotConflict, slotHasConflict, SLOT_TAKEN_MESSAGE } from "@/lib/booking-conflict";
import { bookingPeriod, type BookingInsert } from "@/lib/booking-types";
import { friendlyDbError } from "@/lib/people-display";
import {
  formatInstantSlot,
  MAX_REPEAT_WEEKS,
  PITCH_BOOKING_KINDS,
  type PitchBookingKind,
} from "@/lib/pitch-booking";
import { getSessionProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type PitchBookingActionState = {
  error?: string;
  notice?: string;
  /** Occurrences that already clash, in Europe/London wall clock. */
  clashes?: string[];
  /** Set on a successful create, so the form can link to the team page. */
  teamId?: string;
};

const NOT_ALLOWED =
  "The database refused that. Pitch bookings can only be requested by a team's coach, assistant coach or manager, and only a club administrator can confirm one.";

const NO_PERSON =
  "Your sign-in is not linked to a member record yet, so the club cannot record who is booking. Ask a club administrator to link it.";

type Occurrence = { startsAt: string; endsAt: string; label: string };

function revalidatePitchPaths(teamId?: string | null): void {
  revalidatePath("/pitches");
  revalidatePath("/pitches/mine");
  revalidatePath("/pitches/requests");
  if (teamId) revalidatePath(`/teams/${teamId}`);
  revalidatePath("/teams/[id]", "page");
}

function text(formData: FormData, key: string, max = 500): string {
  return String(formData.get(key) ?? "").trim().slice(0, max);
}

/**
 * The Europe/London window a form describes, as a pair of instants — repeated
 * weekly when asked for. A pitch session never runs past midnight, so an end
 * time at or before the start is a mistake, not an overnight booking.
 */
function readOccurrences(
  formData: FormData,
  allowRepeat: boolean,
): { occurrences: Occurrence[] } | { error: string } {
  const date = text(formData, "date", 10);
  const startRaw = text(formData, "start_time", 8);
  const endRaw = text(formData, "end_time", 8);

  if (!isValidDateString(date)) return { error: "Choose a date." };
  if (!isValidTimeString(startRaw) || !isValidTimeString(endRaw)) {
    return { error: "Choose a start and an end time." };
  }
  const startTime = normaliseTime(startRaw);
  const endTime = normaliseTime(endRaw);
  if (endTime <= startTime) {
    return { error: "The end time must be after the start time." };
  }

  let weeks = 1;
  if (allowRepeat) {
    const raw = text(formData, "repeat_weeks", 4);
    if (raw) {
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_REPEAT_WEEKS) {
        return { error: `A weekly repeat must be between 1 and ${MAX_REPEAT_WEEKS} weeks.` };
      }
      weeks = parsed;
    }
  }

  const occurrences: Occurrence[] = [];
  for (let week = 0; week < weeks; week += 1) {
    const day = addDays(date, week * 7);
    const startsAt = localToInstant(day, startTime);
    const endsAt = localToInstant(day, endTime);
    occurrences.push({ startsAt, endsAt, label: formatInstantSlot(startsAt, endsAt) });
  }
  return { occurrences };
}

/** Every occurrence `booking_has_conflict()` says is already taken. */
async function findClashes(
  supabase: Awaited<ReturnType<typeof createClient>>,
  resourceId: string,
  occurrences: Occurrence[],
  excludeBookingId?: string | null,
): Promise<string[]> {
  const results = await Promise.all(
    occurrences.map(async (occurrence) => ({
      label: occurrence.label,
      taken: await slotHasConflict(supabase, {
        resourceId,
        startsAt: occurrence.startsAt,
        endsAt: occurrence.endsAt,
        excludeBookingId: excludeBookingId ?? null,
      }),
    })),
  );
  return results.filter((r) => r.taken).map((r) => r.label);
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createPitchBooking(
  _prev: PitchBookingActionState,
  formData: FormData,
): Promise<PitchBookingActionState> {
  const session = await getSessionProfile();
  if (!session) return { error: "Sign in again to request a pitch." };

  const teamId = text(formData, "team_id", 40);
  const resourceId = text(formData, "resource_id", 40);
  const kindRaw = text(formData, "kind", 20);

  if (!teamId) return { error: "Choose a team." };
  if (!resourceId) return { error: "Choose a pitch." };
  if (!PITCH_BOOKING_KINDS.includes(kindRaw as PitchBookingKind)) {
    return { error: "Choose what the pitch is for." };
  }
  const kind = kindRaw as PitchBookingKind;

  const window = readOccurrences(formData, kind === "training");
  if ("error" in window) return { error: window.error };
  const { occurrences } = window;

  const supabase = await createClient();
  const [personResult, adminResult] = await Promise.all([
    supabase.rpc("current_person_id"),
    supabase.rpc("is_club_admin"),
  ]);
  const personId = personResult.data ?? null;
  if (!personId) return { error: NO_PERSON };
  const isAdmin = adminResult.data === true;

  // A courtesy check only — `bookings_team_staff_insert` is the real gate, and
  // it is the one that runs whatever this says.
  if (!isAdmin) {
    const { data: staff } = await supabase.rpc("is_team_staff", { p_team_id: teamId });
    if (staff !== true) {
      return { error: "You are not listed as coach, assistant coach or manager of that team." };
    }
  }

  // Only a club administrator may ask for a confirmed booking; for anyone else
  // the policy pins status to 'pending' regardless of what was posted.
  const wantsConfirmed = isAdmin && text(formData, "status", 20) === "confirmed";
  const status = wantsConfirmed ? "confirmed" : "pending";

  const clashes = await findClashes(supabase, resourceId, occurrences);
  if (clashes.length > 0) {
    return {
      error:
        occurrences.length === 1
          ? "That slot is already booked on that pitch. Choose a different time, date or pitch."
          : `${clashes.length} of the ${occurrences.length} sessions clash with a booking that is already on that pitch. Nothing has been saved.`,
      clashes,
    };
  }

  const bookerName = session.profile?.full_name?.trim() || session.email || "Club member";
  const bookerEmail = session.email?.trim();
  if (!bookerEmail) {
    return { error: "Your sign-in has no email address, and a booking must record a contact." };
  }

  const recurrenceGroupId = occurrences.length > 1 ? crypto.randomUUID() : null;
  const rows: BookingInsert[] = occurrences.map((occurrence) => ({
    resource_id: resourceId,
    team_id: teamId,
    kind,
    status,
    ...bookingPeriod(occurrence.startsAt, occurrence.endsAt),
    booker_person_id: personId,
    booker_profile_id: session.userId,
    booker_name: bookerName,
    booker_email: bookerEmail,
    occasion: text(formData, "occasion", 120) || null,
    notes: text(formData, "notes") || null,
    recurrence_group_id: recurrenceGroupId,
  }));

  // One multi-row INSERT: atomic, so a clashing week cannot leave half a
  // series behind.
  const { data: created, error } = await supabase.from("bookings").insert(rows).select("id");

  if (error) {
    if (isSlotConflict(error)) {
      const late = await findClashes(supabase, resourceId, occurrences);
      return {
        error:
          late.length > 0
            ? "Someone booked that pitch while this form was open. Nothing has been saved."
            : "That pitch was taken while this form was open. Nothing has been saved.",
        clashes: late.length > 0 ? late : occurrences.map((o) => o.label),
      };
    }
    return { error: friendlyDbError(error, NOT_ALLOWED) };
  }

  const bookingIds = (created ?? []).map((row) => row.id);

  // Extra teams sharing the session. The owning team is on the booking, so it
  // is never repeated here.
  const extraTeamIds = Array.from(
    new Set(
      formData
        .getAll("extra_team_ids")
        .map((value) => String(value).trim())
        .filter((value) => value !== "" && value !== teamId),
    ),
  );
  let sharingWarning = "";
  if (extraTeamIds.length > 0 && bookingIds.length > 0) {
    const links = bookingIds.flatMap((bookingId) =>
      extraTeamIds.map((extraTeamId) => ({ booking_id: bookingId, team_id: extraTeamId })),
    );
    const { error: shareError } = await supabase.from("booking_teams").insert(links);
    if (shareError) {
      sharingWarning = ` The sharing teams could not be added: ${friendlyDbError(shareError, NOT_ALLOWED)}`;
    }
  }

  revalidatePitchPaths(teamId);
  for (const extraTeamId of extraTeamIds) revalidatePath(`/teams/${extraTeamId}`);

  const what =
    occurrences.length === 1 ? "Pitch booking" : `${occurrences.length} weekly pitch sessions`;
  const outcome =
    status === "confirmed"
      ? `${what} confirmed.`
      : `${what} requested. A club administrator will confirm it.`;

  return { notice: `${outcome}${sharingWarning}`, teamId };
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

/**
 * Cancelling is a status change, never a delete: the row is the history the
 * calendar and the audit trail read. `bookings_team_guard()` lets a coach make
 * exactly this change on their own team's booking.
 */
export async function cancelPitchBooking(
  _prev: PitchBookingActionState,
  formData: FormData,
): Promise<PitchBookingActionState> {
  const bookingId = text(formData, "booking_id", 40);
  if (!bookingId) return { error: "No booking given." };
  const teamId = text(formData, "team_id", 40) || null;

  const supabase = await createClient();
  const { error } = await supabase
    .from("bookings")
    .update({ status: "cancelled" })
    .eq("id", bookingId);
  if (error) return { error: friendlyDbError(error, NOT_ALLOWED) };

  revalidatePitchPaths(teamId);
  return { notice: "Booking cancelled. The pitch is free again." };
}

/** The whole weekly series, for a repeat that should not have been made. */
export async function cancelPitchBookingSeries(
  _prev: PitchBookingActionState,
  formData: FormData,
): Promise<PitchBookingActionState> {
  const groupId = text(formData, "recurrence_group_id", 40);
  if (!groupId) return { error: "That booking is not part of a weekly series." };
  const teamId = text(formData, "team_id", 40) || null;

  const supabase = await createClient();
  const { error } = await supabase
    .from("bookings")
    .update({ status: "cancelled" })
    .eq("recurrence_group_id", groupId)
    .gte("ends_at", new Date().toISOString())
    .neq("status", "cancelled");
  if (error) return { error: friendlyDbError(error, NOT_ALLOWED) };

  revalidatePitchPaths(teamId);
  return { notice: "The remaining sessions in that series are cancelled." };
}

// ---------------------------------------------------------------------------
// Edit — pending bookings only, which the trigger also enforces
// ---------------------------------------------------------------------------

export async function updatePitchBooking(
  _prev: PitchBookingActionState,
  formData: FormData,
): Promise<PitchBookingActionState> {
  const bookingId = text(formData, "booking_id", 40);
  if (!bookingId) return { error: "No booking given." };
  const resourceId = text(formData, "resource_id", 40);
  if (!resourceId) return { error: "Choose a pitch." };
  const teamId = text(formData, "team_id", 40) || null;

  const window = readOccurrences(formData, false);
  if ("error" in window) return { error: window.error };
  const occurrence = window.occurrences[0];
  if (!occurrence) return { error: "Choose a date and a time." };

  const supabase = await createClient();
  const clashes = await findClashes(supabase, resourceId, [occurrence], bookingId);
  if (clashes.length > 0) {
    return {
      error: "That slot is already booked on that pitch. Choose a different time, date or pitch.",
      clashes,
    };
  }

  const { error } = await supabase
    .from("bookings")
    .update({
      resource_id: resourceId,
      ...bookingPeriod(occurrence.startsAt, occurrence.endsAt),
      occasion: text(formData, "occasion", 120) || null,
      notes: text(formData, "notes") || null,
    })
    .eq("id", bookingId);

  if (error) {
    if (isSlotConflict(error)) {
      return { error: SLOT_TAKEN_MESSAGE, clashes: [occurrence.label] };
    }
    return { error: friendlyDbError(error, NOT_ALLOWED) };
  }

  revalidatePitchPaths(teamId);
  return { notice: "Booking updated." };
}

// ---------------------------------------------------------------------------
// The administrator's desk
// ---------------------------------------------------------------------------

/**
 * Confirming brings a pending row under `bookings_no_overlap` against every
 * other live booking, so this update can collide even though the request was
 * accepted — hence `conflictOrMessage`.
 */
export async function confirmPitchBooking(
  _prev: PitchBookingActionState,
  formData: FormData,
): Promise<PitchBookingActionState> {
  const bookingId = text(formData, "booking_id", 40);
  if (!bookingId) return { error: "No booking given." };
  const teamId = text(formData, "team_id", 40) || null;

  const supabase = await createClient();
  const { error } = await supabase
    .from("bookings")
    .update({ status: "confirmed" })
    .eq("id", bookingId);
  if (error) {
    if (isSlotConflict(error)) return { error: SLOT_TAKEN_MESSAGE };
    return { error: friendlyDbError(error, NOT_ALLOWED) };
  }

  revalidatePitchPaths(teamId);
  return { notice: "Booking confirmed." };
}

/** Declining is a cancellation with the reason kept where staff can read it. */
export async function declinePitchBooking(
  _prev: PitchBookingActionState,
  formData: FormData,
): Promise<PitchBookingActionState> {
  const bookingId = text(formData, "booking_id", 40);
  if (!bookingId) return { error: "No booking given." };
  const teamId = text(formData, "team_id", 40) || null;
  const reason = text(formData, "reason");
  if (!reason) return { error: "Say why it is being declined — the coach is told this." };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("bookings")
    .select("internal_notes")
    .eq("id", bookingId)
    .maybeSingle();

  const stamped = `Declined ${new Date().toISOString().slice(0, 10)}: ${reason}`;
  const internalNotes = existing?.internal_notes
    ? `${existing.internal_notes}\n${stamped}`
    : stamped;

  const { error } = await supabase
    .from("bookings")
    .update({ status: "cancelled", internal_notes: internalNotes })
    .eq("id", bookingId);
  if (error) return { error: friendlyDbError(error, NOT_ALLOWED) };

  revalidatePitchPaths(teamId);
  return { notice: "Request declined." };
}
