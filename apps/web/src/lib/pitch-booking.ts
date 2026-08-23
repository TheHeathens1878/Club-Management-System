/**
 * Pitch bookings by team — the shared vocabulary (gap 3).
 *
 * The cutover left the club with a pitch calendar nobody could add to: the
 * only write path was `allocate_fixture()`, so a coach who wanted a training
 * slot had to ask a committee member to make one. Migration
 * 20260824120000_pitch_bookings gave the database what those screens need —
 * `bookings.team_id`, `booking_teams`, coach RLS, `bookings_team_guard()` and
 * `pitch_calendar()`.
 *
 * This module holds the half both sides of the wire need: the row shape, the
 * labels and the Europe/London formatting. It deliberately imports nothing
 * that reaches `next/headers`, so a client panel can render a booking without
 * dragging the server Supabase client into the bundle. The reads themselves
 * live in `lib/pitch-booking-data.ts`.
 */

import type { Database } from "@club/db";

import {
  formatBookingDateShort,
  instantsToLocalWindow,
  instantToLocal,
} from "@/lib/booking-time";

export type BookingKind = Database["public"]["Enums"]["booking_kind"];
export type BookingStatus = Database["public"]["Enums"]["booking_status"];
export type TeamRole = Database["public"]["Enums"]["team_role"];

/**
 * The `team_memberships` roles that make someone a team's staff for booking
 * purposes. `is_team_staff()` asks `child_facing_roles` instead, which is the
 * safeguarding question; these three are the club's answer to "who runs this
 * team", and the database still has the final word on every write.
 */
export const STAFF_TEAM_ROLES: TeamRole[] = ["coach", "assistant_coach", "manager"];

/** What a coach may create: `bookings_team_staff_insert` allows these two. */
export type PitchBookingKind = Extract<BookingKind, "training" | "block">;

export const PITCH_BOOKING_KINDS: PitchBookingKind[] = ["training", "block"];

export const PITCH_BOOKING_KIND_LABELS: Record<PitchBookingKind, string> = {
  training: "Training",
  block: "Other use",
};

/** A weekly repeat longer than this is a season plan, not a booking form. */
export const MAX_REPEAT_WEEKS = 20;

/** How far ahead the `pitch_calendar()` fallback looks, in days. */
export const CALENDAR_FALLBACK_DAYS = 60;

export type TeamOption = { id: string; name: string; ageGroup: string | null };

export type PitchOption = { id: string; name: string };

export type PitchBookingItem = {
  id: string;
  resourceId: string;
  resourceName: string;
  kind: BookingKind;
  status: BookingStatus;
  startsAt: string;
  endsAt: string;
  /** Europe/London wall clock, which is what every screen shows. */
  date: string;
  startTime: string;
  endTime: string;
  label: string | null;
  notes: string | null;
  internalNotes: string | null;
  teamId: string | null;
  teamName: string | null;
  bookerName: string | null;
  bookerEmail: string | null;
  recurrenceGroupId: string | null;
  /** True when this row came from `pitch_calendar()` — no PII, no editing. */
  calendarOnly: boolean;
};

/** "Sat, 1 Mar 2026 · 18:00–19:30" — one slot, the way every list shows it. */
export function formatSlot(item: {
  date: string;
  startTime: string;
  endTime: string;
}): string {
  return `${formatBookingDateShort(item.date)} · ${item.startTime}–${item.endTime}`;
}

/** The same, from a pair of instants — for error messages about occurrences. */
export function formatInstantSlot(startsAt: string, endsAt: string): string {
  return formatSlot(instantsToLocalWindow(startsAt, endsAt));
}

export function statusVariant(
  status: BookingStatus,
): "success" | "warning" | "muted" | "destructive" | "default" {
  if (status === "confirmed") return "success";
  if (status === "pending") return "warning";
  if (status === "cancelled") return "muted";
  return "default";
}

export function statusLabel(status: BookingStatus): string {
  if (status === "pending") return "Awaiting confirmation";
  if (status === "confirmed") return "Confirmed";
  if (status === "cancelled") return "Cancelled";
  return status;
}

export function kindLabel(kind: BookingKind): string {
  if (kind === "training") return "Training";
  if (kind === "block") return "Other use";
  if (kind === "fixture") return "Fixture";
  if (kind === "maintenance") return "Maintenance";
  return "Hire";
}

/** Today's date in Europe/London — the earliest a booking form should allow. */
export function todayLondon(): string {
  return instantToLocal(new Date()).date;
}
