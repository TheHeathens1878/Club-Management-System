"use server";

/**
 * Events — accept/decline, reminders, and coach-created one-off/recurring
 * events (Adam, 2026-08-24).
 *
 * Everything goes through the user-scoped client and the database decides:
 *
 *   - `respond_to_event` accepts only `can_act_for` (yourself, or a child in
 *     your care) and only for a live member of the event's team.
 *   - one-off events are a plain INSERT under `events_staff_insert`
 *     (team staff or club admin); `events_guard` refuses a hand-made
 *     fixture-linked row.
 *   - `create_event_series` materialises the weekly occurrences server-side
 *     (staff or admin, at most 60).
 *   - `remind_event_nonresponders` is staff/admin only and refuses a second
 *     send within the hour.
 *
 * P0001 messages are shown verbatim (they are written for humans); anything
 * else falls back to a friendly line.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getSessionProfile } from "@/lib/auth";
import { localToInstant } from "@/lib/booking-time";
import { friendlyDbError } from "@/lib/people-display";
import { createClient } from "@/lib/supabase/server";

import { EVENT_TYPES, type EventType } from "./shared";

export type EventActionState = {
  error?: string;
  notice?: string;
  /** Occurrences of a series whose pitch was already taken, London wall clock. */
  clashes?: string[];
};

const RESPOND_REFUSED =
  "The database refused that. You can only accept or decline for yourself, or for a child in your care who is in the event's team.";
const CREATE_REFUSED =
  "The database refused that. Only the team's coach, assistant coach or manager — or a club administrator — can create events.";

function text(formData: FormData, key: string, max = 500): string {
  return String(formData.get(key) ?? "")
    .trim()
    .slice(0, max);
}

// ---------------------------------------------------------------------------
// Accept / decline
// ---------------------------------------------------------------------------

export async function respondToEvent(
  _prev: EventActionState,
  formData: FormData,
): Promise<EventActionState> {
  const session = await getSessionProfile();
  if (!session) return { error: "Sign in again to respond." };

  const eventId = text(formData, "event_id", 40);
  const personId = text(formData, "person_id", 40);
  const status = text(formData, "status", 20);
  const note = text(formData, "note", 500);

  if (!eventId || !personId) return { error: "No event or person given." };
  if (status !== "accepted" && status !== "declined") {
    return { error: "Choose accept or decline." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("respond_to_event", {
    p_event_id: eventId,
    p_person_id: personId,
    p_status: status,
    p_note: note,
  });
  if (error) return { error: friendlyDbError(error, RESPOND_REFUSED) };

  revalidatePath(`/events/${eventId}`);
  revalidatePath("/events");
  return { notice: status === "accepted" ? "Accepted." : "Declined." };
}

// ---------------------------------------------------------------------------
// Remind the non-responders (staff)
// ---------------------------------------------------------------------------

export async function remindEventNonResponders(
  _prev: EventActionState,
  formData: FormData,
): Promise<EventActionState> {
  const session = await getSessionProfile();
  if (!session) return { error: "Sign in again to send reminders." };

  const eventId = text(formData, "event_id", 40);
  if (!eventId) return { error: "No event given." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("remind_event_nonresponders", {
    p_event_id: eventId,
  });
  if (error) {
    return {
      error: friendlyDbError(
        error,
        "The database refused that. Only the team's staff or a club administrator can send reminders.",
      ),
    };
  }

  revalidatePath(`/events/${eventId}`);
  return {
    notice:
      data === 0
        ? "Everyone has already responded — nothing to send."
        : `Reminder sent to ${data} ${data === 1 ? "person" : "people"}.`,
  };
}

// ---------------------------------------------------------------------------
// Create — one-off, or a weekly series
// ---------------------------------------------------------------------------

export async function createEvent(
  _prev: EventActionState,
  formData: FormData,
): Promise<EventActionState> {
  const session = await getSessionProfile();
  if (!session) return { error: "Sign in again to create an event." };

  const teamId = text(formData, "team_id", 40);
  const type = text(formData, "type", 20);
  const title = text(formData, "title", 120);
  const date = text(formData, "date", 10);
  const time = text(formData, "time", 5);
  const durationRaw = text(formData, "duration_minutes", 4);
  const venueResourceId = text(formData, "venue_resource_id", 40);
  const venueText = text(formData, "venue_text", 200);
  const notes = text(formData, "notes", 1000);
  const repeats = text(formData, "repeats", 5) === "true";
  const repeatUntil = text(formData, "repeat_until", 10);
  // Reserving the pitch only means anything when the venue IS a club pitch.
  const bookPitch = text(formData, "book_pitch", 5) === "true" && !!venueResourceId;

  if (!teamId) return { error: "Choose a team." };
  if (!EVENT_TYPES.includes(type as EventType)) return { error: "Choose an event type." };
  if (!title) return { error: "Give the event a name." };
  if (!date || !time) return { error: "Give the event a date and a time." };
  const duration = Number.parseInt(durationRaw, 10);
  if (!Number.isFinite(duration) || duration < 15 || duration > 480) {
    return { error: "The length must be between 15 minutes and 8 hours." };
  }
  if (repeats && !repeatUntil) {
    return { error: "A repeating event needs a date to repeat until." };
  }

  let startsAt: string;
  try {
    startsAt = localToInstant(date, time);
  } catch {
    return { error: "That date and time could not be read." };
  }

  // "Meet at" (Adam, 2026-08-25): a time on the form, stored as minutes
  // before the start so a reschedule carries it. Blank = no meet time.
  const meetTime = text(formData, "meet_time", 5);
  let meetMinutesBefore: number | null = null;
  if (meetTime) {
    let meetAt: string;
    try {
      meetAt = localToInstant(date, meetTime);
    } catch {
      return { error: "That meet time could not be read." };
    }
    const minutes = Math.round((Date.parse(startsAt) - Date.parse(meetAt)) / 60_000);
    if (minutes < 0) return { error: "The meet time must not be after the start." };
    if (minutes > 240) return { error: "The meet time is more than four hours before the start." };
    meetMinutesBefore = minutes;
  }

  const supabase = await createClient();

  if (repeats) {
    const { data, error } = await supabase.rpc("create_event_series", {
      p_team_id: teamId,
      p_type: type,
      p_title: title,
      p_starts_at: startsAt,
      p_duration_minutes: duration,
      p_repeat_until: repeatUntil,
      p_venue_resource_id: venueResourceId || undefined,
      p_venue_text: venueText || undefined,
      p_notes: notes || undefined,
      p_book: bookPitch,
    });
    if (error) return { error: friendlyDbError(error, CREATE_REFUSED) };
    const result = data?.[0];
    if (!result) return { error: "The series was not created." };

    // Every occurrence meets at the same relative time. The insert default
    // (30 minutes for matches) stands when the form left it blank.
    if (meetMinutesBefore !== null) {
      await supabase
        .from("events")
        .update({ meet_minutes_before: meetMinutesBefore })
        .eq("series_id", result.series_id);
    }

    // A clashing week keeps its event and loses only the pitch, so the series
    // is not lost — but the coach has to be told which weeks to sort out.
    if (bookPitch && result.clashes && result.clashes.length > 0) {
      revalidatePath("/events");
      return {
        notice: `Series created: ${result.booked} of ${result.occurrences} weeks have the pitch reserved.`,
        error: `The pitch was already taken for ${result.clashes.length} of the ${result.occurrences} weeks. Those events were still created — move them, or book another pitch.`,
        clashes: result.clashes,
      };
    }
  } else {
    const { data, error } = await supabase.rpc("create_team_event", {
      p_team_id: teamId,
      p_type: type,
      p_title: title,
      p_starts_at: startsAt,
      p_duration_minutes: duration,
      p_venue_resource_id: venueResourceId || undefined,
      p_venue_text: venueText || undefined,
      p_notes: notes || undefined,
      p_book: bookPitch,
    });
    if (error) return { error: friendlyDbError(error, CREATE_REFUSED) };
    if (meetMinutesBefore !== null && data) {
      await supabase
        .from("events")
        .update({ meet_minutes_before: meetMinutesBefore })
        .eq("id", data);
    }
  }

  revalidatePath("/events");
  revalidatePath("/pitches/mine");
  redirect("/events");
}

// ---------------------------------------------------------------------------
// Cancel a one-off / series occurrence (staff). Fixture events are cancelled
// by cancelling the fixture — the sync would only reinstate them.
// ---------------------------------------------------------------------------

export async function cancelEvent(
  _prev: EventActionState,
  formData: FormData,
): Promise<EventActionState> {
  const session = await getSessionProfile();
  if (!session) return { error: "Sign in again to cancel the event." };

  const eventId = text(formData, "event_id", 40);
  if (!eventId) return { error: "No event given." };

  // `cancel_team_event` refuses fixture events (the fixture is the master) and
  // hands back the pitch when the event was holding one.
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_team_event", { p_event_id: eventId });
  if (error) return { error: friendlyDbError(error, CREATE_REFUSED) };

  revalidatePath(`/events/${eventId}`);
  revalidatePath("/events");
  revalidatePath("/pitches/mine");
  return { notice: "Event cancelled. Any pitch it was holding has been released." };
}
