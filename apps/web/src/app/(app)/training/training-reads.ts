/**
 * The two reads `/training` needs beside `training_sessions()`, kept out of
 * the page the way `lib/booking-detail.ts` keeps the booking's own reads out
 * of `/pitches/[bookingId]`.
 *
 *   1. {@link loadMarkedSessions} — has a register been STARTED for each of
 *      this week's sessions? `training_sessions()` carries no such flag, and
 *      "11 of 14 coming, register not taken" is the one fact the week is for.
 *      One query for the whole week, not one per card.
 *   2. {@link loadSessionRegister} — the roster for ONE session, read when its
 *      sheet opens. Seven days of teams is 7 × N rosters nobody asked for, so
 *      the grid ships with none of them and the sheet fetches the one it is
 *      showing.
 *
 * Everything goes through the caller's own client, so RLS decides:
 * `booking_attendance_read` answers (1) and `team_memberships_staff_read` /
 * `_admin_read` answers (2). Nothing here is a permission of its own.
 */

import type { RosterRow } from "@/app/(app)/pitches/[bookingId]/attendance-panel";
import { getCapabilities, getStoredRoleView } from "@/lib/capabilities";
import { loadBookingTeams } from "@/lib/booking-detail";
import { nameOf, resolveNames } from "@/lib/person";
import { isMemberView, resolveRoleView } from "@/lib/role-view";
import { createClient } from "@/lib/supabase/server";

/** The facts about a session the grid carries but `SessionCard` does not. */
export type SessionMeta = {
  /** `bookings.booker_name` — who put it in the diary. */
  bookedBy: string;
  /** The booking's status, for the words under "pitch awaiting confirmation". */
  status: string;
};

/** What the sheet gets when it opens on a session. */
export type SessionRegister = {
  bookingId: string;
  /**
   * The same question `/pitches/[bookingId]` asks before it draws the sheet:
   * staff of THIS booking (or a club administrator) wearing a staff hat.
   */
  canMark: boolean;
  rows: RosterRow[];
};

/**
 * Which of these bookings has anybody marked on its register?
 *
 * One row is enough: the week only asks "taken or not taken", and the counts
 * that would need the whole sheet live on the sheet. A caller whose policies
 * return nothing gets an empty set, which reads as "not taken" — the safe way
 * round, because the worst it costs is a register offered twice.
 */
export async function loadMarkedSessions(
  bookingIds: readonly string[],
): Promise<Set<string>> {
  const ids = Array.from(new Set(bookingIds));
  if (ids.length === 0) return new Set();

  const supabase = await createClient();
  const { data } = await supabase
    .from("booking_attendance")
    .select("booking_id")
    .in("booking_id", ids);

  return new Set((data ?? []).map((row) => row.booking_id));
}

/**
 * One session's roster, availability and attendance — the rows
 * `AttendancePanel` marks.
 *
 * The gate is computed here rather than trusted from the client: a booking id
 * is not a capability, so the sheet may ask about any session and this answers
 * with `canMark: false` and an empty roster unless the database and the chosen
 * hat both say otherwise. That is the pair from
 * `pitches/[bookingId]/page.tsx` — `(is_staff_of_booking || is_club_admin) &&
 * !isMemberView(view)` — and the roster read hangs off it, so a parent's view
 * does not fetch the squad at all.
 *
 * Availability is read from `booking_availability`: a training session's
 * answers belong to its booking. (A FIXTURE's live in `availability`, keyed on
 * the fixture — and a fixture is not a training session.)
 */
export async function loadSessionRegister(bookingId: string): Promise<SessionRegister> {
  const id = bookingId.trim().slice(0, 40);
  const empty: SessionRegister = { bookingId: id, canMark: false, rows: [] };
  if (!id) return empty;

  const supabase = await createClient();
  const [capabilities, storedView, staffResult, adminResult] = await Promise.all([
    getCapabilities(),
    getStoredRoleView(),
    supabase.rpc("is_staff_of_booking", { p_booking_id: id }),
    supabase.rpc("is_club_admin"),
  ]);
  const view = resolveRoleView(storedView, capabilities);
  const canMark =
    (staffResult.data === true || adminResult.data === true) && !isMemberView(view);
  if (!canMark) return empty;

  const teams = await loadBookingTeams(id);
  const teamIds = teams.map((team) => team.id);
  const teamNameById = new Map(teams.map((team) => [team.id, team.name]));
  if (teamIds.length === 0) return { bookingId: id, canMark, rows: [] };

  const { data: membershipRows } = await supabase
    .from("team_memberships")
    .select("person_id,team_id,role,shirt_number")
    .in("team_id", teamIds)
    .is("left_at", null);

  // Somebody in two of the sharing teams is one person on one sheet.
  const seen = new Set<string>();
  const memberships = (membershipRows ?? []).filter((row) => {
    if (seen.has(row.person_id)) return false;
    seen.add(row.person_id);
    return true;
  });

  const peopleIds = memberships.map((row) => row.person_id);
  if (peopleIds.length === 0) return { bookingId: id, canMark, rows: [] };

  const [availabilityResult, attendanceResult, names] = await Promise.all([
    supabase
      .from("booking_availability")
      .select("person_id,status,note")
      .eq("booking_id", id)
      .in("person_id", peopleIds),
    supabase
      .from("booking_attendance")
      .select("person_id,status,note")
      .eq("booking_id", id)
      .in("person_id", peopleIds),
    resolveNames(peopleIds),
  ]);

  const availabilityByPerson = new Map(
    (availabilityResult.data ?? []).map((row) => [row.person_id, row]),
  );
  const attendanceByPerson = new Map(
    (attendanceResult.data ?? []).map((row) => [row.person_id, row]),
  );

  // A boolean, never the date behind it — the register shows no dates of birth.
  const minorFlags = new Map(
    await Promise.all(
      peopleIds.map(async (personId) => {
        const { data } = await supabase.rpc("is_minor", { person_id: personId });
        return [personId, data === true] as const;
      }),
    ),
  );

  const rows: RosterRow[] = memberships
    .map((row) => {
      const availability = availabilityByPerson.get(row.person_id);
      const attendance = attendanceByPerson.get(row.person_id);
      return {
        personId: row.person_id,
        name: nameOf(names, row.person_id),
        isMinor: minorFlags.get(row.person_id) === true,
        teamName: teamNameById.get(row.team_id) ?? "Team",
        role: row.role,
        shirtNumber: row.shirt_number,
        availability: availability?.status ?? null,
        availabilityNote: availability?.note ?? null,
        attendance: attendance?.status ?? null,
        attendanceNote: attendance?.note ?? null,
      } satisfies RosterRow;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return { bookingId: id, canMark, rows };
}
