/**
 * Pitch bookings by team — the reads (gap 3).
 *
 * EVERY query here goes through the USER-SCOPED client, never the service key.
 * That is deliberate and load-bearing:
 *
 *   - `bookings_team_staff_read` is what shows a coach their own team's rows,
 *     and it is also what hides every other team's booker contact details.
 *   - `bookings_staff_read` is what shows a club administrator everything.
 *   - anyone else — a parent, a player — has no `bookings` grant at all and
 *     reads the club's pitch calendar through `pitch_calendar()`, which is
 *     SECURITY DEFINER and returns no booker PII. {@link loadTeamPitchBookings}
 *     falls back to it precisely so a team page still shows "training, Tuesday
 *     18:00" to someone who may not see who booked it.
 *
 * Wall clock is Europe/London throughout; the columns are timestamptz and the
 * conversion is `lib/booking-time`'s job, not this module's.
 */

import type { Database } from "@club/db";

import { instantsToLocalWindow } from "@/lib/booking-time";
import {
  CALENDAR_FALLBACK_DAYS,
  STAFF_TEAM_ROLES,
  type BookingKind,
  type BookingStatus,
  type PitchBookingItem,
  type PitchOption,
  type TeamOption,
} from "@/lib/pitch-booking";
import { createClient } from "@/lib/supabase/server";

/**
 * The columns the management screens read. One string literal, not a
 * concatenation: supabase-js infers the row type from the select text, and
 * only a literal carries that type.
 */
const BOOKING_SELECT =
  "id,resource_id,kind,status,starts_at,ends_at,occasion,notes,internal_notes,team_id,fixture_id,opponent_team_id,booker_name,booker_email,recurrence_group_id,resources!inner(name,type),teams!bookings_team_id_fkey(name)";

type BookingSelectRow = {
  id: string;
  resource_id: string;
  kind: BookingKind;
  status: BookingStatus;
  starts_at: string;
  ends_at: string;
  occasion: string | null;
  notes: string | null;
  internal_notes: string | null;
  team_id: string | null;
  fixture_id: string | null;
  opponent_team_id: string | null;
  booker_name: string;
  booker_email: string;
  recurrence_group_id: string | null;
  resources: { name: string; type: Database["public"]["Enums"]["resource_type"] } | null;
  teams: { name: string } | null;
};

function toItem(row: BookingSelectRow): PitchBookingItem {
  const window = instantsToLocalWindow(row.starts_at, row.ends_at);
  return {
    id: row.id,
    resourceId: row.resource_id,
    resourceName: row.resources?.name ?? "Pitch",
    kind: row.kind,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    date: window.date,
    startTime: window.startTime,
    endTime: window.endTime,
    label: row.occasion,
    notes: row.notes,
    internalNotes: row.internal_notes,
    teamId: row.team_id,
    teamName: row.teams?.name ?? null,
    fixtureId: row.fixture_id,
    opponentTeamId: row.opponent_team_id,
    bookerName: row.booker_name,
    bookerEmail: row.booker_email,
    recurrenceGroupId: row.recurrence_group_id,
    calendarOnly: false,
  };
}

/** The team columns the booking form needs, including its home pitch. */
function toTeamOption(row: {
  id: string;
  name: string;
  age_group: string | null;
  home_resource_id: string | null;
}): TeamOption {
  return {
    id: row.id,
    name: row.name,
    ageGroup: row.age_group,
    homeResourceId: row.home_resource_id,
  };
}

export type PitchBookingAccess = {
  /** `current_person_id()` — null when the sign-in is not linked to a member. */
  personId: string | null;
  /** `is_club_admin()` — the `person_roles` answer, not `profiles.role`. */
  isAdmin: boolean;
  /** Teams this caller is coach / assistant coach / manager of. */
  staffTeamIds: string[];
  /** The teams the booking form may offer: an admin's is every active team. */
  teams: TeamOption[];
};

/**
 * Who the caller is, as the database sees them, plus the teams they may book
 * for. Asked through the user-scoped client so `team_memberships_self_read`
 * and `is_club_admin()` give the answer — the app never decides this itself.
 */
export async function loadPitchBookingAccess(): Promise<PitchBookingAccess> {
  const supabase = await createClient();
  const [personResult, adminResult] = await Promise.all([
    supabase.rpc("current_person_id"),
    supabase.rpc("is_club_admin"),
  ]);
  const personId = personResult.data ?? null;
  const isAdmin = adminResult.data === true;

  let staffTeamIds: string[] = [];
  if (personId) {
    const { data } = await supabase
      .from("team_memberships")
      .select("team_id")
      .eq("person_id", personId)
      .is("left_at", null)
      .in("role", STAFF_TEAM_ROLES);
    staffTeamIds = Array.from(new Set((data ?? []).map((row) => row.team_id)));
  }

  let teams: TeamOption[] = [];
  if (isAdmin) {
    const { data } = await supabase
      .from("teams")
      .select("id,name,age_group,home_resource_id")
      .eq("active", true)
      .order("name");
    teams = (data ?? []).map(toTeamOption);
  } else if (staffTeamIds.length > 0) {
    const { data } = await supabase
      .from("teams")
      .select("id,name,age_group,home_resource_id")
      .in("id", staffTeamIds)
      .order("name");
    teams = (data ?? []).map(toTeamOption);
  }

  return { personId, isAdmin, staffTeamIds, teams };
}

/**
 * Does the caller run any team? The nav question, kept to a single count so
 * the layout does not pay for the full {@link loadPitchBookingAccess} read.
 * `team_memberships_self_read` is what returns the rows, so this is safe to
 * ask for any signed-in user.
 */
export async function isAnyTeamStaff(): Promise<boolean> {
  const supabase = await createClient();
  const { data: personId } = await supabase.rpc("current_person_id");
  if (!personId) return false;
  const { count } = await supabase
    .from("team_memberships")
    .select("team_id", { count: "exact", head: true })
    .eq("person_id", personId)
    .is("left_at", null)
    .in("role", STAFF_TEAM_ROLES);
  return (count ?? 0) > 0;
}

/**
 * Every active team, for the "internal opposition" picker on the booking form.
 *
 * Deliberately not `loadPitchBookingAccess().teams`: that answers "which teams
 * may this person BOOK for", and the club a coach is playing against is a
 * different question — an U14 coach arranging a friendly against the U18s does
 * not staff the U18s. `teams_read` is `using (true)` for any signed-in member,
 * and a team's name and age group are not private, so this is the caller's own
 * read like everything else in this module.
 */
export async function loadActiveTeams(): Promise<TeamOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("teams")
    .select("id,name,age_group,home_resource_id")
    .eq("active", true)
    .order("name");
  return (data ?? []).map(toTeamOption);
}

/** Every bookable pitch. `resources_public_read` covers the active ones. */
export async function loadPitches(): Promise<PitchOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("resources")
    .select("id,name")
    .eq("type", "pitch")
    .eq("active", true)
    .order("sort_order")
    .order("name");
  return (data ?? []).map((row) => ({ id: row.id, name: row.name }));
}

/** One booking, read as the caller. Null when RLS says they may not see it. */
export async function loadPitchBooking(bookingId: string): Promise<PitchBookingItem | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("bookings")
    .select(BOOKING_SELECT)
    .eq("id", bookingId)
    .maybeSingle();
  if (!data || data.resources?.type !== "pitch") return null;
  return toItem(data as BookingSelectRow);
}

export type PitchBookingQuery = {
  /** Restrict to these teams. Omitted means "whatever RLS returns". */
  teamIds?: string[];
  statuses?: BookingStatus[];
  kinds?: BookingKind[];
  /**
   * Leave out the allocator's own fixture slots (`fixture_id is not null`).
   * A coach's requested match is a `fixture`-kind booking with no link, so the
   * lists that mean "what this team has asked for" need to tell the two apart.
   */
  excludeAllocated?: boolean;
  /** Only bookings that have not finished yet. Defaults to true. */
  upcomingOnly?: boolean;
  limit?: number;
};

/**
 * The management lists (`/pitches/mine`, `/pitches/requests`).
 *
 * There is no "which team am I allowed to see" clause here on purpose: RLS
 * already answers that, and a coach querying without a team filter gets
 * exactly their own teams' rows.
 */
export async function loadPitchBookings(
  options: PitchBookingQuery = {},
): Promise<{ items: PitchBookingItem[]; error: string | null }> {
  const supabase = await createClient();
  let query = supabase.from("bookings").select(BOOKING_SELECT).eq("resources.type", "pitch");

  if (options.teamIds) {
    if (options.teamIds.length === 0) return { items: [], error: null };
    query = query.in("team_id", options.teamIds);
  }
  if (options.statuses && options.statuses.length > 0) query = query.in("status", options.statuses);
  if (options.kinds && options.kinds.length > 0) query = query.in("kind", options.kinds);
  if (options.excludeAllocated) query = query.is("fixture_id", null);
  if (options.upcomingOnly !== false) query = query.gte("ends_at", new Date().toISOString());

  query = query.order("starts_at");
  if (options.limit) query = query.limit(options.limit);

  const { data, error } = await query;
  if (error) return { items: [], error: error.message };
  return { items: (data ?? []).map((row) => toItem(row as BookingSelectRow)), error: null };
}

/**
 * A team's next pitch bookings, its own and the sessions it shares.
 *
 * Two reads and a fallback. The direct `bookings` read is what a coach or an
 * administrator gets; anyone else the team page lets in has no `bookings`
 * grant, so `pitch_calendar()` — SECURITY DEFINER, no booker PII — answers
 * instead. Its rows come back flagged `calendarOnly`, which is what stops the
 * card offering a cancel button for a booking the caller cannot write to.
 */
export async function loadTeamPitchBookings(
  teamId: string,
  limit: number,
): Promise<PitchBookingItem[]> {
  const supabase = await createClient();
  const nowIso = new Date().toISOString();

  const { data: sharedRows } = await supabase
    .from("booking_teams")
    .select("booking_id")
    .eq("team_id", teamId);
  const sharedIds = (sharedRows ?? []).map((row) => row.booking_id);

  const [ownResult, sharedResult] = await Promise.all([
    supabase
      .from("bookings")
      .select(BOOKING_SELECT)
      .eq("resources.type", "pitch")
      .eq("team_id", teamId)
      .in("status", ["pending", "confirmed"])
      .gte("ends_at", nowIso)
      .order("starts_at")
      .limit(limit),
    sharedIds.length > 0
      ? supabase
          .from("bookings")
          .select(BOOKING_SELECT)
          .eq("resources.type", "pitch")
          .in("id", sharedIds)
          .in("status", ["pending", "confirmed"])
          .gte("ends_at", nowIso)
          .order("starts_at")
          .limit(limit)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const direct = [...(ownResult.data ?? []), ...(sharedResult.data ?? [])].map((row) =>
    toItem(row as BookingSelectRow),
  );

  if (direct.length > 0) {
    const byId = new Map(direct.map((item) => [item.id, item]));
    return Array.from(byId.values())
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .slice(0, limit);
  }

  // Nothing came back directly — either there is nothing to show, or the
  // caller has no `bookings` grant. `pitch_calendar()` settles both.
  const until = new Date(Date.now() + CALENDAR_FALLBACK_DAYS * 86_400_000).toISOString();
  const { data: calendarRows } = await supabase.rpc("pitch_calendar", {
    p_from: nowIso,
    p_to: until,
  });

  return (calendarRows ?? [])
    .filter((row) => row.team_id === teamId || (row.shared_team_ids ?? []).includes(teamId))
    .slice(0, limit)
    .map((row) => {
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
        internalNotes: null,
        teamId: row.team_id,
        teamName: row.team_name,
        // `pitch_calendar()` returns neither the fixture link nor the
        // opposition team, and its rows are read-only here anyway —
        // `calendarOnly` is what gates the controls.
        fixtureId: null,
        opponentTeamId: null,
        bookerName: null,
        bookerEmail: null,
        recurrenceGroupId: null,
        calendarOnly: true,
      } satisfies PitchBookingItem;
    });
}
