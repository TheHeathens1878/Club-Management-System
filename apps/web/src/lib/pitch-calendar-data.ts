/**
 * The pitch calendar — the reads (gap 6).
 *
 * EVERY query here goes through the USER-SCOPED client, never the service key.
 * The calendar is deliberately readable by people who have no `bookings` grant
 * at all — a parent, a player — and the thing that lets them see it is
 * `pitch_calendar()`, a SECURITY DEFINER function that returns no booker PII
 * and refuses everyone `can_view_pitch_calendar()` says no to. Reading it as
 * the caller is what makes "you are not linked to a team yet" a real answer
 * rather than a guess.
 *
 * The pitch columns come from `resources` (`resources_public_read` covers the
 * active ones). If that read comes back empty — a caller with no grant at all,
 * or a pitch that has been deactivated but still has bookings on it — the
 * column list is derived from the calendar rows themselves, so the grid never
 * silently drops a booking it was given.
 */

import { instantToLocal } from "@/lib/booking-time";
import {
  toCalendarEntry,
  type CalendarEntry,
  type PitchCalendarRpcRow,
} from "@/lib/pitch-calendar";
import { STAFF_TEAM_ROLES, type PitchOption } from "@/lib/pitch-booking";
import { createClient } from "@/lib/supabase/server";

/**
 * `can_view_pitch_calendar()` — a live team membership, a guarded child with
 * one, or a club role. The same predicate `pitch_calendar()` enforces, asked
 * separately so the nav can offer the link to exactly the right people.
 */
export async function canViewPitchCalendar(): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("can_view_pitch_calendar");
  return data === true;
}

export type PitchCalendarContext = {
  /** `current_person_id()` — null when the sign-in is not linked to a member. */
  personId: string | null;
  /** `is_club_admin()` — the `person_roles` answer, not `profiles.role`. */
  isAdmin: boolean;
  /** Teams the caller is coach / assistant coach / manager of. */
  staffTeamIds: string[];
  /**
   * "My teams": every team the caller plays in or staffs, plus every team a
   * child they are guardian of plays in. Empty means the toggle has nothing to
   * narrow to, and the views fall back to showing everything.
   */
  myTeamIds: string[];
};

/**
 * Who the caller is, for the calendar's purposes.
 *
 * All five reads are the database's own answer under the caller's RLS:
 * `team_memberships_self_read` returns their own rows,
 * `guardianships_guardian_read` their own guardianships, and
 * `team_memberships_guardian_read` their children's memberships. A caller with
 * none of those simply gets empty lists.
 */
export async function loadPitchCalendarContext(): Promise<PitchCalendarContext> {
  const supabase = await createClient();
  const [personResult, adminResult] = await Promise.all([
    supabase.rpc("current_person_id"),
    supabase.rpc("is_club_admin"),
  ]);
  const personId = personResult.data ?? null;
  const isAdmin = adminResult.data === true;

  if (!personId) return { personId: null, isAdmin, staffTeamIds: [], myTeamIds: [] };

  const [ownResult, guardianResult] = await Promise.all([
    supabase
      .from("team_memberships")
      .select("team_id,role")
      .eq("person_id", personId)
      .is("left_at", null),
    supabase
      .from("guardianships")
      .select("child_person_id")
      .eq("guardian_person_id", personId)
      .is("ended_at", null),
  ]);

  const own = ownResult.data ?? [];
  const staffTeamIds = Array.from(
    new Set(own.filter((row) => STAFF_TEAM_ROLES.includes(row.role)).map((row) => row.team_id)),
  );
  const myTeamIds = new Set(own.map((row) => row.team_id));

  const childIds = Array.from(
    new Set((guardianResult.data ?? []).map((row) => row.child_person_id)),
  );
  if (childIds.length > 0) {
    const { data: childRows } = await supabase
      .from("team_memberships")
      .select("team_id")
      .in("person_id", childIds)
      .is("left_at", null);
    for (const row of childRows ?? []) myTeamIds.add(row.team_id);
  }

  return { personId, isAdmin, staffTeamIds, myTeamIds: Array.from(myTeamIds) };
}

export type PitchCalendarData = {
  entries: CalendarEntry[];
  pitches: PitchOption[];
  /** True when `pitch_calendar()` refused the caller outright. */
  denied: boolean;
  error: string | null;
};

/**
 * Every live pitch booking in a window, plus the pitch columns to draw.
 *
 * `pitch_calendar()` returns nothing at all to someone `can_view_pitch_calendar()`
 * rejects, and nothing at all to someone in a quiet week — the two are told
 * apart by asking the predicate, not by counting rows.
 */
export async function loadPitchCalendar(
  from: string,
  to: string,
): Promise<PitchCalendarData> {
  const supabase = await createClient();

  const [calendarResult, pitchResult, allowedResult] = await Promise.all([
    supabase.rpc("pitch_calendar", { p_from: from, p_to: to }),
    supabase
      .from("resources")
      .select("id,name")
      .eq("type", "pitch")
      .eq("active", true)
      .order("sort_order")
      .order("name"),
    supabase.rpc("can_view_pitch_calendar"),
  ]);

  if (calendarResult.error) {
    return { entries: [], pitches: [], denied: false, error: calendarResult.error.message };
  }

  const rows = (calendarResult.data ?? []) as PitchCalendarRpcRow[];

  // Names for the teams a session is shared with. `teams_read` is `using
  // (true)` for authenticated, so this is a safe read for any caller; the
  // shared ids come back from the RPC without names attached.
  const teamNames = new Map<string, string>();
  const wantedTeamIds = Array.from(
    new Set(rows.flatMap((row) => row.shared_team_ids ?? []).filter(Boolean)),
  );
  if (wantedTeamIds.length > 0) {
    const { data: teamRows } = await supabase
      .from("teams")
      .select("id,name")
      .in("id", wantedTeamIds);
    for (const row of teamRows ?? []) teamNames.set(row.id, row.name);
  }

  const entries = rows.map((row) => toCalendarEntry(row, teamNames));

  // The column list. Active pitches first; anything a booking sits on that is
  // not in that list is appended, so a deactivated pitch with live bookings
  // still gets a column rather than losing its rows.
  const pitches: PitchOption[] = (pitchResult.data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
  }));
  const known = new Set(pitches.map((pitch) => pitch.id));
  for (const entry of entries) {
    if (!known.has(entry.resourceId)) {
      known.add(entry.resourceId);
      pitches.push({ id: entry.resourceId, name: entry.resourceName });
    }
  }

  return {
    entries,
    pitches,
    denied: allowedResult.data !== true && entries.length === 0,
    error: null,
  };
}

/** Today in Europe/London, as the date pickers and "Today" buttons want it. */
export function todayForCalendar(): string {
  return instantToLocal(new Date()).date;
}
