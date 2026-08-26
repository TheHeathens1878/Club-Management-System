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
 * purposes. These three are the club's answer to "who runs this team", and the
 * database still has the final word on every write.
 */
export const STAFF_TEAM_ROLES: TeamRole[] = ["coach", "assistant_coach", "manager"];

/**
 * What a coach may ask for: `bookings_team_staff_insert` allows these three.
 * `fixture` is the club's word for a match (Adam, 2026-08-25: "in what is the
 * pitch for, match should be an option") — the same enum value
 * `allocate_fixture()` writes, so a requested match sits on the pitch diary
 * beside an allocated one instead of pretending to be a training session.
 */
export type PitchBookingKind = Extract<BookingKind, "training" | "block" | "fixture">;

export const PITCH_BOOKING_KINDS: PitchBookingKind[] = ["training", "block", "fixture"];

export const PITCH_BOOKING_KIND_LABELS: Record<PitchBookingKind, string> = {
  training: "Training",
  fixture: "Match",
  block: "Other use",
};

/** A weekly repeat longer than this is a season plan, not a booking form. */
export const MAX_REPEAT_WEEKS = 20;

/** How far ahead the `pitch_calendar()` fallback looks, in days. */
export const CALENDAR_FALLBACK_DAYS = 60;

export type TeamOption = {
  id: string;
  name: string;
  ageGroup: string | null;
  /** `teams.home_resource_id` — where the booking form's pitch select opens. */
  homeResourceId: string | null;
};

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
  /**
   * Set on the allocator's own slots (`allocate_fixture()`) and, since
   * 20260825410000, on a confirmed internal match's home fixture. A coach may
   * not touch either — `bookings_team_guard()` refuses — so the lists use it
   * together with {@link PitchBookingItem.opponentTeamId} to decide whether to
   * offer Cancel at all.
   */
  fixtureId: string | null;
  /**
   * `bookings.opponent_team_id` — the club team this match is against when the
   * opposition is internal; null for a club from outside and for everything
   * that is not a match. It is what tells an internal match apart from a
   * league fixture's allocated slot: the league fixture exists whether or not
   * the pitch does and is unallocated on /pitches, whereas an internal match's
   * booking IS the match, so cancelling it calls the game off on both teams'
   * pages.
   */
  opponentTeamId: string | null;
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

// ---------------------------------------------------------------------------
// The match label (Adam, 2026-08-25: "the label should be pre-populated")
// ---------------------------------------------------------------------------

/** How a match's opposition was named on the form. */
export type OppositionSide = "internal" | "external";

export function isOppositionSide(value: string | null | undefined): value is OppositionSide {
  return value === "internal" || value === "external";
}

/**
 * "U14 Mavericks v Sale Sharks" — what the pitch diary shows for a match.
 *
 * Pure on purpose: it is the one part of the booking form worth a unit test,
 * and both halves of the wire use it — the form pre-fills the Label box with
 * it, and the server action falls back to it when the box arrives empty.
 * Either name missing means there is nothing to suggest yet: an empty string,
 * never "U14 Mavericks v " or " v Sale Sharks".
 */
export function matchLabel(
  teamName: string | null | undefined,
  opponentName: string | null | undefined,
): string {
  const home = (teamName ?? "").trim();
  const away = (opponentName ?? "").trim();
  if (!home || !away) return "";
  return `${home} v ${away}`;
}

/**
 * The Label box's value after something it is built from has changed.
 *
 * Adam asked for a label "pre-populated from this information", and that only
 * works if a suggestion never eats a sentence somebody typed. So a suggestion
 * takes the box only when the box is empty, or still holds the PREVIOUS
 * suggestion untouched. The moment it holds anything else it is theirs, and
 * this leaves it exactly as it is — including when there is no suggestion to
 * make, which must not blank a label by hand either.
 */
export function nextSuggestedLabel(
  current: string,
  previousSuggestion: string,
  suggestion: string,
): string {
  if (current.trim() === "") return suggestion;
  if (current === previousSuggestion) return suggestion;
  return current;
}
