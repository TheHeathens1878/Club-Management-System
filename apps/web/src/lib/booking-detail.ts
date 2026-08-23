/**
 * One pitch booking, read as whoever is asking (gap 8).
 *
 * `/pitches/[bookingId]` is the first pitch screen a parent or a player is
 * meant to reach, and they hold no `bookings` grant at all. So the read is two
 * attempts, in this order:
 *
 *   1. `bookings` directly — what `bookings_team_staff_read` gives a coach and
 *      `bookings_staff_read` gives an administrator. It carries the notes and
 *      the booker, which is why it is tried first.
 *   2. `pitch_calendar()` — SECURITY DEFINER, gated on
 *      `can_view_pitch_calendar()`, carrying no booker PII. This is how a
 *      parent sees "training, Tuesday 18:00" for their child's team.
 *
 * Nothing here decides who may look. Both paths are the database's answer, and
 * a booking neither returns simply does not exist as far as this caller is
 * concerned — the page 404s, which is the same answer it gives for an id that
 * was never real.
 */

import type { Database } from "@club/db";

import { instantsToLocalWindow } from "@/lib/booking-time";
import type { BookingKind, BookingStatus } from "@/lib/pitch-booking";
import { createClient } from "@/lib/supabase/server";

/** How far either side of today the `pitch_calendar()` fallback looks. */
const CALENDAR_WINDOW_DAYS = 200;

export type BookingDetail = {
  id: string;
  resourceId: string;
  resourceName: string;
  kind: BookingKind;
  status: BookingStatus;
  startsAt: string;
  endsAt: string;
  /** Europe/London wall clock — what every screen shows. */
  date: string;
  startTime: string;
  endTime: string;
  label: string | null;
  notes: string | null;
  /** The owning team. Shared teams come from {@link loadBookingTeams}. */
  teamId: string | null;
  teamName: string | null;
  fixtureId: string | null;
  /** True when the row came from `pitch_calendar()` — no notes, no PII. */
  calendarOnly: boolean;
};

export type BookingFixture = {
  id: string;
  opponent: string;
  isHome: boolean;
  competition: string | null;
  status: Database["public"]["Enums"]["fixture_status"];
};

/**
 * One string literal, not a concatenation: supabase-js infers the row type
 * from the select text, and only a literal carries that type.
 */
const DETAIL_SELECT =
  "id,resource_id,kind,status,starts_at,ends_at,occasion,notes,team_id,fixture_id,resources!inner(name,type),teams(name)";

export async function loadBookingDetail(bookingId: string): Promise<BookingDetail | null> {
  const supabase = await createClient();

  const { data: direct } = await supabase
    .from("bookings")
    .select(DETAIL_SELECT)
    .eq("id", bookingId)
    .maybeSingle();

  if (direct && direct.resources?.type === "pitch") {
    const window = instantsToLocalWindow(direct.starts_at, direct.ends_at);
    return {
      id: direct.id,
      resourceId: direct.resource_id,
      resourceName: direct.resources.name,
      kind: direct.kind,
      status: direct.status,
      startsAt: direct.starts_at,
      endsAt: direct.ends_at,
      date: window.date,
      startTime: window.startTime,
      endTime: window.endTime,
      label: direct.occasion,
      notes: direct.notes,
      teamId: direct.team_id,
      teamName: direct.teams?.name ?? null,
      fixtureId: direct.fixture_id,
      calendarOnly: false,
    };
  }

  // No `bookings` grant (or a function-room booking, which is not this
  // screen's business). `pitch_calendar()` is the other way in.
  const now = Date.now();
  const { data: calendarRows } = await supabase.rpc("pitch_calendar", {
    p_from: new Date(now - CALENDAR_WINDOW_DAYS * 86_400_000).toISOString(),
    p_to: new Date(now + CALENDAR_WINDOW_DAYS * 86_400_000).toISOString(),
  });

  const row = (calendarRows ?? []).find((entry) => entry.booking_id === bookingId);
  if (!row) return null;

  const window = instantsToLocalWindow(row.starts_at, row.ends_at);
  return {
    id: row.booking_id,
    resourceId: row.resource_id,
    resourceName: row.resource_name,
    kind: row.kind,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    date: window.date,
    startTime: window.startTime,
    endTime: window.endTime,
    label: row.label,
    notes: null,
    teamId: row.team_id,
    teamName: row.team_name,
    fixtureId: row.fixture_id,
    calendarOnly: true,
  };
}

/**
 * Every team on the booking — the owning one and everyone sharing it.
 *
 * `booking_team_ids()` is SECURITY DEFINER and granted to `authenticated`, so
 * it answers for a parent too; reading `booking_teams` directly would need
 * `can_view_pitch_calendar()` and would quietly return a short list to
 * somebody who is allowed to see the session but not the join table.
 */
export async function loadBookingTeams(
  bookingId: string,
): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient();
  const { data: ids } = await supabase.rpc("booking_team_ids", { p_booking_id: bookingId });
  const teamIds = ids ?? [];
  if (teamIds.length === 0) return [];

  const { data } = await supabase.from("teams").select("id,name").in("id", teamIds).order("name");
  return (data ?? []).map((row) => ({ id: row.id, name: row.name }));
}

/** The opponent behind a `kind = 'fixture'` booking. `fixtures_read` is open. */
export async function loadBookingFixture(fixtureId: string): Promise<BookingFixture | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("fixtures")
    .select("id,opponent,is_home,competition,status")
    .eq("id", fixtureId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    opponent: data.opponent,
    isHome: data.is_home,
    competition: data.competition,
    status: data.status,
  };
}
