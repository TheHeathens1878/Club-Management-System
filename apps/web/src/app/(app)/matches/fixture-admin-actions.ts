"use server";

/**
 * Managing matches: the kick-off, the cancellation, and the delete — one at a
 * time on the match itself, and many at once from a list.
 *
 * Adam, 2026-09-02, twice:
 *   "I need the ability to bulk delete and cancel matches (as admin) for an
 *    individual team and the matches tab."
 *   "I (admin) need the ability to change KO times, by clicking into the event
 *    and also bulk on the matches screen. Coaches to have the ability on the
 *    event."
 *
 * NOTHING HERE IS A NEW PERMISSION. `fixtures_staff_update` has always been
 * `is_club_admin() OR is_team_staff(team_id)`, and `fixtures_admin_delete` /
 * `fixtures_staff_delete` cover the delete. Every write below goes through the
 * caller's own client, so those policies are what actually decide; the checks
 * in this file exist so a refusal is a sentence instead of an update that
 * quietly changes no rows.
 *
 * WHO GETS WHAT, and why they differ:
 *   · the KICK-OFF of one match — a coach or an administrator. It is the thing
 *     a coach is told on a Thursday night and the reason Adam asked for it on
 *     the event.
 *   · anything in BULK — a club administrator. Adam asked for bulk "as admin",
 *     and a mis-aimed tick on a list of forty games is a different kind of
 *     mistake from a mis-typed time on one.
 *
 * WHAT THE DATABASE DOES ON ITS OWN, so none of it is re-implemented here:
 *   · moving a kick-off moves the pitch booking with it, and where the new slot
 *     clashes it leaves the booking alone, sets `allocation_conflict` and
 *     writes an audit row (`fixtures_sync_booking`). That is why a kick-off
 *     change reports how many landed on a clash rather than claiming success.
 *   · cancelling FREES the pitch — the booking is cancelled and the link kept,
 *     so putting the fixture back to scheduled re-books it.
 *   · the diary entry follows: the event is moved or cancelled, with a change
 *     note, and everybody involved is notified (`fixtures_events_sync_update`,
 *     `fixtures_changed_notify`).
 *   · the other side of an internal match follows a cancellation
 *     (`fixtures_cancel_mirror`).
 *
 * The one thing the database does NOT do is protect a deleted fixture's pitch:
 * `bookings.fixture_id` is ON DELETE SET NULL, so a delete would leave a
 * confirmed booking holding a slot for a game that no longer exists. Every
 * delete here unallocates first, exactly as the single-fixture delete does.
 */

import { revalidatePath } from "next/cache";

import { writeAudit } from "@/lib/audit";
import { getSessionProfile } from "@/lib/auth";
import {
  atLocalTime,
  instantToLocal,
  isValidTimeString,
  localToInstant,
  normaliseTime,
} from "@/lib/booking-time";
import {
  emailCoachesAboutReallocation,
  type ReallocationMove,
} from "@/lib/fixture-reallocation-email";
import { friendlyDbError } from "@/lib/people-display";
import { isClubAdmin } from "@/lib/person";
import { createClient } from "@/lib/supabase/server";

export type MatchAdminState = {
  error?: string;
  notice?: string;
  /** Per-fixture trouble that did not stop the rest — shown as a list. */
  warnings?: string[];
};

/** How many fixtures one post may name. A season is ~24; a whole club is not. */
const MAX_BULK = 200;

function text(formData: FormData, key: string, max = 200): string {
  return String(formData.get(key) ?? "")
    .trim()
    .slice(0, max);
}

function fixtureIds(formData: FormData): string[] {
  const seen = new Set<string>();
  for (const value of formData.getAll("fixture_id")) {
    const id = String(value).trim();
    if (id !== "") seen.add(id);
  }
  return [...seen].slice(0, MAX_BULK);
}

/** Revalidate everywhere a fixture is shown. Cheap, and there are five places. */
function revalidateMatches(teamIds: Iterable<string | null>): void {
  revalidatePath("/matches");
  revalidatePath("/pitches");
  revalidatePath("/pitches/calendar");
  revalidatePath("/events");
  for (const teamId of teamIds) {
    if (!teamId) continue;
    revalidatePath(`/teams/${teamId}`);
    revalidatePath(`/teams/${teamId}/fixtures`);
  }
}

type FixtureRow = {
  id: string;
  team_id: string | null;
  opponent: string;
  is_home: boolean;
  kickoff_at: string;
  status: string;
  booking_id: string | null;
  venue_resource_id: string | null;
  mirror_fixture_id: string | null;
  source: string | null;
  external_ref: string | null;
  season_id: string | null;
  competition: string | null;
  venue_text: string | null;
};

const FIXTURE_COLUMNS =
  "id,team_id,opponent,is_home,kickoff_at,status,booking_id,venue_resource_id,mirror_fixture_id,source,external_ref,season_id,competition,venue_text";

/** "Sat 5 Sep, 14:00 v Boothstown" — what a warning has to name to be useful. */
function describe(fixture: FixtureRow): string {
  const local = instantToLocal(fixture.kickoff_at);
  return `${local.date} ${local.time} ${fixture.is_home ? "v" : "away to"} ${fixture.opponent}`;
}


// ---------------------------------------------------------------------------
// One match: the kick-off
// ---------------------------------------------------------------------------

/**
 * Move one match's kick-off. A coach of that team, or an administrator.
 *
 * The date is taken as well as the time, because "the kick-off moved" and "the
 * game moved to Sunday" are the same act to whoever is doing it, and asking
 * them to edit two things in two places would be the worse screen.
 */
export async function setFixtureKickoff(
  _prev: MatchAdminState,
  formData: FormData,
): Promise<MatchAdminState> {
  const session = await getSessionProfile();
  if (!session) return { error: "Sign in again first." };

  const id = text(formData, "fixture_id", 40);
  const date = text(formData, "kickoff_date", 10);
  const time = normaliseTime(text(formData, "kickoff_time", 5));
  if (!id) return { error: "No match given." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Give the date as a real date." };
  if (!isValidTimeString(time)) return { error: "Give the kick-off as a time like 10:30." };

  const supabase = await createClient();
  const { data: fixture } = await supabase
    .from("fixtures")
    .select(FIXTURE_COLUMNS)
    .eq("id", id)
    .maybeSingle<FixtureRow>();
  if (!fixture) return { error: "That match no longer exists." };

  const admin = await isClubAdmin();
  const { data: isStaff } = fixture.team_id
    ? await supabase.rpc("is_team_staff", { p_team_id: fixture.team_id })
    : { data: false };
  if (!admin && isStaff !== true) {
    return { error: "Only this team's staff or a club administrator can move a kick-off." };
  }

  const kickoffAt = localToInstant(date, time);
  const { data, error } = await supabase
    .from("fixtures")
    .update({ kickoff_at: kickoffAt })
    .eq("id", id)
    .select("id,allocation_conflict");
  if (error) return { error: friendlyDbError(error, "The database refused that kick-off.") };
  if ((data ?? []).length === 0) {
    return { error: "Only this team's staff or a club administrator can move a kick-off." };
  }

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "fixture.kickoff_changed",
    entity: "fixtures",
    entityId: id,
    detail: { from: fixture.kickoff_at, to: kickoffAt, team_id: fixture.team_id },
  });

  revalidateMatches([fixture.team_id]);
  revalidatePath(`/teams/${fixture.team_id}/fixtures/${id}`);

  // `fixtures_sync_booking` sets this when the pitch could not follow. Saying
  // so here is the whole difference between a move that happened and a move
  // that half happened.
  const clashed = data?.[0]?.allocation_conflict === true;
  return {
    notice: clashed
      ? "Kick-off moved — but the pitch booking could not follow it, because something else is on that slot. Sort the clash on Pitches."
      : "Kick-off moved. The pitch booking, the diary entry and everybody's notifications follow it.",
  };
}


// ---------------------------------------------------------------------------
// Many matches
// ---------------------------------------------------------------------------

async function adminAnd(ids: string[]): Promise<
  { error: string } | { fixtures: FixtureRow[]; session: NonNullable<Awaited<ReturnType<typeof getSessionProfile>>> }
> {
  const session = await getSessionProfile();
  if (!session) return { error: "Sign in again first." };
  if (ids.length === 0) return { error: "Tick the matches first." };
  if (!(await isClubAdmin())) {
    return { error: "Only a club administrator can change matches in bulk." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.from("fixtures").select(FIXTURE_COLUMNS).in("id", ids);
  if (error) return { error: friendlyDbError(error, "Those matches could not be read.") };
  const fixtures = (data ?? []) as FixtureRow[];
  if (fixtures.length === 0) return { error: "None of those matches exist any more." };
  return { fixtures, session };
}

/**
 * Cancel every ticked match.
 *
 * Cancelling is the kind thing to do to a game that is not being played: the
 * record survives, the pitch is freed, the diary entry is marked cancelled and
 * everybody who was going is told. Deleting does none of that. A match already
 * cancelled is skipped rather than counted, so the number reported is the
 * number that changed.
 */
export async function bulkCancelFixtures(
  _prev: MatchAdminState,
  formData: FormData,
): Promise<MatchAdminState> {
  const ids = fixtureIds(formData);
  const loaded = await adminAnd(ids);
  if ("error" in loaded) return { error: loaded.error };
  const { fixtures, session } = loaded;

  const already = fixtures.filter((f) => f.status === "cancelled").length;
  const targets = fixtures.filter((f) => f.status !== "cancelled");
  if (targets.length === 0) {
    return { notice: `Nothing to do — ${already === 1 ? "that match is" : "those matches are"} already cancelled.` };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fixtures")
    .update({ status: "cancelled" })
    .in("id", targets.map((f) => f.id))
    .select("id");
  if (error) return { error: friendlyDbError(error, "The database refused to cancel those matches.") };
  const changed = (data ?? []).length;
  if (changed === 0) {
    return { error: "The database did not cancel any of them. Only a club administrator may." };
  }

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "fixtures.bulk_cancelled",
    entity: "fixtures",
    entityId: null,
    detail: {
      cancelled: changed,
      already_cancelled: already,
      fixtures: targets.map((f) => ({ id: f.id, team_id: f.team_id, when: f.kickoff_at, opponent: f.opponent })),
    },
  });

  revalidateMatches(new Set(fixtures.map((f) => f.team_id)));
  return {
    notice: `${changed} ${changed === 1 ? "match" : "matches"} cancelled — pitches freed, diary entries marked, everybody told.${
      already > 0 ? ` ${already} ${already === 1 ? "was" : "were"} already cancelled.` : ""
    }`,
  };
}

/**
 * Delete every ticked match, giving back any pitch first.
 *
 * The pitch has to go back BEFORE the row does: `bookings.fixture_id` is
 * ON DELETE SET NULL, so deleting a fixture that holds a slot leaves a
 * confirmed booking attached to nothing — worse than the fixture it replaced.
 * A fixture whose pitch cannot be released is LEFT ALONE and named, rather
 * than deleted anyway.
 *
 * Both sides of an internal match go together, because one side alone leaves
 * the other team with a game against nobody.
 */
export async function bulkDeleteFixtures(
  _prev: MatchAdminState,
  formData: FormData,
): Promise<MatchAdminState> {
  const ids = fixtureIds(formData);
  const loaded = await adminAnd(ids);
  if ("error" in loaded) return { error: loaded.error };
  const { fixtures, session } = loaded;

  const supabase = await createClient();
  const warnings: string[] = [];
  const deletable: FixtureRow[] = [];

  for (const fixture of fixtures) {
    if (!fixture.booking_id) {
      deletable.push(fixture);
      continue;
    }
    const { error } = await supabase.rpc("unallocate_fixture", { p_fixture_id: fixture.id });
    if (error) {
      warnings.push(`${describe(fixture)} — kept, because its pitch could not be given back: ${error.message}`);
      continue;
    }
    deletable.push(fixture);
  }

  // The other half of an internal match, and its pitch too.
  const mirrors = fixtures
    .map((f) => f.mirror_fixture_id)
    .filter((id): id is string => !!id && !ids.includes(id));
  for (const mirrorId of mirrors) {
    await supabase.rpc("unallocate_fixture", { p_fixture_id: mirrorId });
  }

  if (deletable.length === 0) {
    return { error: "Nothing was deleted.", warnings };
  }

  const toDelete = [...deletable.map((f) => f.id), ...mirrors];
  const { data, error } = await supabase.from("fixtures").delete().in("id", toDelete).select("id");
  if (error) return { error: friendlyDbError(error, "The database refused to delete those matches."), warnings };
  const deleted = (data ?? []).length;
  if (deleted === 0) {
    return { error: "The database did not delete any of them. Only a club administrator may.", warnings };
  }

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "fixtures.bulk_deleted",
    entity: "fixtures",
    entityId: null,
    detail: {
      deleted,
      kept: warnings.length,
      // Enough to re-enter each game by hand, which is the only way back.
      fixtures: deletable.map((f) => ({
        id: f.id,
        team_id: f.team_id,
        season_id: f.season_id,
        opponent: f.opponent,
        is_home: f.is_home,
        kickoff_at: f.kickoff_at,
        competition: f.competition,
        status: f.status,
        source: f.source,
        external_ref: f.external_ref,
        venue_text: f.venue_text,
      })),
      mirror_fixture_ids: mirrors,
    },
  });

  revalidateMatches(new Set(fixtures.map((f) => f.team_id)));
  return {
    notice: `${deleted} ${deleted === 1 ? "match" : "matches"} deleted, with their team sheets, availability and stats. Any pitch they held has been given back.`,
    warnings,
  };
}

/**
 * Put every ticked match on one pitch, straight from the desk (Adam,
 * 2026-09-04: "give me the ability on the matches screen to allocate to a
 * different pitch" and "allocate the pitch directly from the matches tab as
 * well as change the KO time").
 *
 * The allocation itself is `allocate_fixture()` — the same SECURITY DEFINER
 * function the /pitches screen calls, run here through the CALLER'S client so
 * the database's own club-admin gate decides, with the `bookings_no_overlap`
 * constraint still the single arbiter of whether a pitch is free. A clash is
 * reported per fixture with the database's message verbatim (it names the
 * bookings in the way); the rest of the ticked matches still land.
 *
 * Left alone, and named: away matches (nothing to allocate), and matches of a
 * team that plays at a central venue — the club books no pitch for those, the
 * same rule that keeps them off the /pitches work list.
 */
export async function bulkAllocatePitch(
  _prev: MatchAdminState,
  formData: FormData,
): Promise<MatchAdminState> {
  const resourceId = text(formData, "resource_id", 40);
  if (!resourceId) return { error: "Choose a pitch first." };
  const rawTime = text(formData, "kickoff_time", 5);
  const time = rawTime === "" ? null : normaliseTime(rawTime);
  if (time !== null && !isValidTimeString(time)) {
    return { error: "Give the kick-off as a time like 10:30, or leave it blank to keep each match's own." };
  }

  const ids = fixtureIds(formData);
  const loaded = await adminAnd(ids);
  if ("error" in loaded) return { error: loaded.error };
  const { fixtures, session } = loaded;

  const supabase = await createClient();
  const { data: pitch } = await supabase
    .from("resources")
    .select("id,name")
    .eq("id", resourceId)
    .maybeSingle();
  if (!pitch) return { error: "That pitch no longer exists." };

  const teamIds = [...new Set(fixtures.map((f) => f.team_id).filter((id): id is string => !!id))];
  const { data: teamRows } = await supabase
    .from("teams")
    .select("id,central_venue_name")
    .in("id", teamIds);
  const centralVenue = new Map(
    (teamRows ?? []).map((t) => [t.id, (t.central_venue_name ?? "").trim()]),
  );

  const warnings: string[] = [];
  let allocated = 0;
  // Games that already held a slot and have just been moved — their coaches
  // are emailed, one message per team (Adam, 2026-09-04). A first allocation
  // is not a move.
  const movesByTeam = new Map<string, ReallocationMove[]>();

  for (const fixture of fixtures) {
    if (!fixture.is_home) {
      warnings.push(`${describe(fixture)} — an away match; there is no pitch to allocate.`);
      continue;
    }
    const central = fixture.team_id ? centralVenue.get(fixture.team_id) ?? "" : "";
    if (central !== "") {
      warnings.push(
        `${describe(fixture)} — left alone: the team plays at ${central}, a central venue, so the club books no pitch.`,
      );
      continue;
    }
    const { error } = await supabase.rpc("allocate_fixture", {
      p_fixture_id: fixture.id,
      p_resource_id: resourceId,
      ...(time ? { p_kickoff_time: time } : {}),
    });
    if (error) {
      // Verbatim — a 23P01 names the clashing bookings, which is exactly what
      // the admin needs to pick another pitch or another time.
      warnings.push(`${describe(fixture)} — not allocated: ${error.message}`);
      continue;
    }
    allocated += 1;

    const kickoffChanged =
      time !== null && instantToLocal(fixture.kickoff_at).time !== time;
    const pitchChanged = fixture.venue_resource_id !== resourceId;
    if (fixture.booking_id !== null && fixture.team_id && (pitchChanged || kickoffChanged)) {
      const moves = movesByTeam.get(fixture.team_id) ?? [];
      moves.push({
        fixtureId: fixture.id,
        opponent: fixture.opponent,
        kickoffAt: time ? atLocalTime(fixture.kickoff_at, time) : fixture.kickoff_at,
        // Resolved to a name below, once, after the loop.
        fromPitch: fixture.venue_resource_id,
        toPitch: pitch.name,
        kickoffChanged,
      });
      movesByTeam.set(fixture.team_id, moves);
    }
  }

  if (movesByTeam.size > 0) {
    const previousIds = new Set<string>();
    for (const moves of movesByTeam.values()) {
      for (const move of moves) if (move.fromPitch) previousIds.add(move.fromPitch);
    }
    const { data: previousPitches } = previousIds.size
      ? await supabase.from("resources").select("id,name").in("id", [...previousIds])
      : { data: [] as { id: string; name: string }[] };
    const previousNames = new Map((previousPitches ?? []).map((row) => [row.id, row.name]));
    for (const [teamId, moves] of movesByTeam) {
      await emailCoachesAboutReallocation(
        teamId,
        moves.map((move) => ({
          ...move,
          fromPitch: move.fromPitch ? previousNames.get(move.fromPitch) ?? null : null,
        })),
      );
    }
  }

  if (allocated === 0) {
    return { error: "No pitches were allocated.", warnings };
  }

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "fixtures.bulk_allocated",
    entity: "fixtures",
    entityId: null,
    detail: {
      resource_id: resourceId,
      pitch: pitch.name,
      kickoff_time: time,
      allocated,
      skipped: warnings.length,
      fixture_ids: fixtures.map((f) => f.id),
    },
  });

  revalidateMatches(new Set(fixtures.map((f) => f.team_id)));
  return {
    notice: `${allocated} ${allocated === 1 ? "match" : "matches"} now on ${pitch.name}${
      time ? `, kicking off at ${time}` : ""
    }. The bookings, the diary and the notifications follow.`,
    warnings,
  };
}

/**
 * Put every ticked match at the same time of day, each on its own date.
 *
 * The date is deliberately not touched: "all the Under-12s kick off at 10:00"
 * is the thing clubs actually do, and moving forty games to one date is not.
 * Whoever needs to move one game to another day does it on the game.
 */
export async function bulkSetKickoffTime(
  _prev: MatchAdminState,
  formData: FormData,
): Promise<MatchAdminState> {
  const time = normaliseTime(text(formData, "kickoff_time", 5));
  if (!isValidTimeString(time)) return { error: "Give the kick-off as a time like 10:30." };

  const ids = fixtureIds(formData);
  const loaded = await adminAnd(ids);
  if ("error" in loaded) return { error: loaded.error };
  const { fixtures, session } = loaded;

  const supabase = await createClient();
  const warnings: string[] = [];
  let moved = 0;
  let clashed = 0;

  for (const fixture of fixtures) {
    if (instantToLocal(fixture.kickoff_at).time === time) continue;
    const kickoffAt = atLocalTime(fixture.kickoff_at, time);
    const { data, error } = await supabase
      .from("fixtures")
      .update({ kickoff_at: kickoffAt })
      .eq("id", fixture.id)
      .select("id,allocation_conflict");
    if (error) {
      warnings.push(`${describe(fixture)} — not moved: ${error.message}`);
      continue;
    }
    if ((data ?? []).length === 0) {
      warnings.push(`${describe(fixture)} — not moved: the database refused it.`);
      continue;
    }
    moved += 1;
    if (data?.[0]?.allocation_conflict === true) {
      clashed += 1;
      warnings.push(`${describe(fixture)} — moved, but its pitch booking could not follow: something else is on that slot.`);
    }
  }

  if (moved === 0) {
    return warnings.length > 0
      ? { error: "Nothing moved.", warnings }
      : { notice: `Nothing to do — they all kick off at ${time} already.` };
  }

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "fixtures.bulk_kickoff_changed",
    entity: "fixtures",
    entityId: null,
    detail: { time, moved, pitch_clashes: clashed, fixture_ids: fixtures.map((f) => f.id) },
  });

  revalidateMatches(new Set(fixtures.map((f) => f.team_id)));
  return {
    notice: `${moved} ${moved === 1 ? "match" : "matches"} now kick off at ${time}. The pitch bookings, the diary and the notifications follow.`,
    warnings,
  };
}
