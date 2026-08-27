"use server";

/**
 * Availability for one fixture — the marker that answers "how many children
 * will be there?" for match days, including AWAY fixtures and home fixtures
 * that have no pitch booking yet (the booking sheet at /pitches/[bookingId]
 * only exists once a pitch is allocated; a fixture's availability exists from
 * the moment the importer creates the fixture).
 *
 * USER-SCOPED client throughout. The `availability` policies decide: the
 * player, their guardian (`can_act_for`), the team's staff or a club
 * administrator may write; `availability_guard()` refuses anyone not holding a
 * live membership on the fixture's team, and its message is shown verbatim.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { Database } from "@club/db";

import { writeAudit } from "@/lib/audit";
import { getSessionProfile } from "@/lib/auth";
import { friendlyDbError } from "@/lib/people-display";
import { isClubAdmin } from "@/lib/person";
import { createClient } from "@/lib/supabase/server";

type AvailabilityStatus = Database["public"]["Enums"]["availability_status"];

const AVAILABILITY_STATUSES: AvailabilityStatus[] = ["available", "maybe", "unavailable"];

export type FixtureAvailabilityState = { error?: string; notice?: string };

const REFUSED =
  "The database refused that. Availability can only be set by the player, their parent or guardian, the team's staff or a club administrator — and only for someone in the fixture's team.";

function text(formData: FormData, key: string, max = 500): string {
  return String(formData.get(key) ?? "")
    .trim()
    .slice(0, max);
}

export async function setFixtureAvailability(
  _prev: FixtureAvailabilityState,
  formData: FormData,
): Promise<FixtureAvailabilityState> {
  const session = await getSessionProfile();
  if (!session) return { error: "Sign in again to set availability." };

  const fixtureId = text(formData, "fixture_id", 40);
  const teamId = text(formData, "team_id", 40);
  const personId = text(formData, "person_id", 40);
  const statusRaw = text(formData, "status", 20);
  const note = text(formData, "note", 500) || null;

  if (!fixtureId) return { error: "No fixture given." };
  if (!personId) return { error: "No player given." };
  if (!AVAILABILITY_STATUSES.includes(statusRaw as AvailabilityStatus)) {
    return { error: "Choose available, maybe or unavailable." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("availability").upsert(
    {
      fixture_id: fixtureId,
      person_id: personId,
      status: statusRaw as AvailabilityStatus,
      note,
      set_by: session.userId,
    },
    { onConflict: "fixture_id,person_id" },
  );
  if (error) return { error: friendlyDbError(error, REFUSED) };

  if (teamId) {
    revalidatePath(`/teams/${teamId}/fixtures/${fixtureId}`);
    revalidatePath(`/teams/${teamId}`);
  }
  return { notice: "Availability saved." };
}


// ---------------------------------------------------------------------------
// Deleting a fixture (Adam, 2026-08-26: "Admin can't delete fixtures, they
// need to be able to")
// ---------------------------------------------------------------------------
//
// The database has allowed this since fixtures existed — `fixtures_admin_delete`
// is `for delete using (is_club_admin())` — and nothing in the app ever used
// it. So this is a screen for a permission the club already had, not a new one.
//
// A fixture is not a leaf. These rows go with it, by ON DELETE CASCADE:
//   availability        every player's yes/no/maybe for the game
//   fixture_lineups     the team sheet, and its slots
//   fixture_player_stats goals, assists, captain, player of the match
//   selections          who was picked
//   events              the diary entry, if one was made from the fixture
// and `bookings.fixture_id` is ON DELETE SET NULL, which is the trap: delete a
// fixture that holds a pitch and the BOOKING SURVIVES, still confirmed, still
// holding the slot, now attached to nothing. That is worse than the fixture it
// replaced, so the screen offers to give the pitch back at the same time and
// says plainly what happens either way.
//
// An internal match is one game written on two teams' pages
// (`mirror_fixture_id`, 20260825410000). Deleting one side and leaving the
// other is never what anybody means, so both go.

export type DeleteFixtureState = { error?: string; notice?: string };

export async function deleteFixture(
  _prev: DeleteFixtureState,
  formData: FormData,
): Promise<DeleteFixtureState> {
  const session = await getSessionProfile();
  if (!session) return { error: "Sign in first." };

  const fixtureId = text(formData, "fixture_id", 40);
  const teamId = text(formData, "team_id", 40);
  const releasePitch = formData.get("release_pitch") === "yes";
  if (!fixtureId) return { error: "No fixture given." };

  const supabase = await createClient();

  // Adam, 2026-08-27: "As an admin and coach, I should be able to delete
  // previously created fixtures." `fixtures_staff_delete` (20260827100000) is
  // what actually decides it; this is the same question asked early so the
  // refusal is a sentence rather than a delete that quietly removes no rows.
  const admin = await isClubAdmin();
  const { data: isStaff } = teamId
    ? await supabase.rpc("is_team_staff", { p_team_id: teamId })
    : { data: false };
  if (!admin && isStaff !== true) {
    return { error: "Only this team's staff or a club administrator can delete a fixture." };
  }

  // Read it BEFORE deleting: the audit row is the only record left afterwards,
  // so it carries enough to recognise — and to re-enter — the game by hand.
  const { data: fixture, error: readError } = await supabase
    .from("fixtures")
    .select(
      "id,team_id,season_id,opponent,is_home,kickoff_at,competition,status,source,external_ref,booking_id,mirror_fixture_id,venue_text",
    )
    .eq("id", fixtureId)
    .maybeSingle();
  if (readError) return { error: friendlyDbError(readError, "Could not read that fixture.") };
  if (!fixture) return { error: "That fixture no longer exists." };

  // What is about to go with it, counted while it is still there.
  const [availability, lineups, stats, selections, events] = await Promise.all([
    supabase.from("availability").select("id", { count: "exact", head: true }).eq("fixture_id", fixtureId),
    supabase.from("fixture_lineups").select("id", { count: "exact", head: true }).eq("fixture_id", fixtureId),
    supabase.from("fixture_player_stats").select("id", { count: "exact", head: true }).eq("fixture_id", fixtureId),
    supabase.from("selections").select("id", { count: "exact", head: true }).eq("fixture_id", fixtureId),
    supabase.from("events").select("id", { count: "exact", head: true }).eq("fixture_id", fixtureId),
  ]);

  // The pitch first, while the fixture still exists to be unallocated: once the
  // row is gone the booking has no fixture_id left to find it by.
  if (releasePitch && fixture.booking_id) {
    const { error } = await supabase.rpc("unallocate_fixture", { p_fixture_id: fixtureId });
    if (error) {
      return {
        error: friendlyDbError(
          error,
          "The pitch could not be given back, so the fixture has been left alone. Unallocate it on Pitches, then delete it.",
        ),
      };
    }
  }

  // Both sides of an internal match, or neither — and a coach staffs only one
  // of the two teams, so their delete would take their own row and leave the
  // other team's page pointing at nothing. Refused in words rather than half
  // done.
  if (fixture.mirror_fixture_id && !admin) {
    return {
      error:
        "This is an internal match, so it sits on both teams' pages. A club administrator deletes it, because removing only this side would leave the other team with a fixture against nobody.",
    };
  }

  const ids = [fixtureId];
  if (fixture.mirror_fixture_id) {
    ids.push(fixture.mirror_fixture_id);
    if (releasePitch) {
      // Best effort: the mirror is the away side and rarely holds the pitch.
      await supabase.rpc("unallocate_fixture", { p_fixture_id: fixture.mirror_fixture_id });
    }
  }

  const { error: deleteError, count } = await supabase
    .from("fixtures")
    .delete({ count: "exact" })
    .in("id", ids);
  if (deleteError) {
    return { error: friendlyDbError(deleteError, "The database refused to delete that fixture.") };
  }
  if (!count) {
    // RLS returning zero rows rather than an error is what a refusal looks
    // like from here.
    return {
      error:
        "The database did not delete it. Only this team's staff or a club administrator may.",
    };
  }

  await writeAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "fixture.deleted",
    entity: "fixtures",
    entityId: fixtureId,
    detail: {
      fixture: {
        team_id: fixture.team_id,
        season_id: fixture.season_id,
        opponent: fixture.opponent,
        is_home: fixture.is_home,
        kickoff_at: fixture.kickoff_at,
        competition: fixture.competition,
        status: fixture.status,
        source: fixture.source,
        external_ref: fixture.external_ref,
        venue_text: fixture.venue_text,
      },
      also_deleted: {
        mirror_fixture_id: fixture.mirror_fixture_id,
        availability: availability.count ?? 0,
        lineups: lineups.count ?? 0,
        player_stats: stats.count ?? 0,
        selections: selections.count ?? 0,
        events: events.count ?? 0,
      },
      pitch: fixture.booking_id
        ? { booking_id: fixture.booking_id, released: releasePitch }
        : null,
      rows_deleted: count,
    },
  });

  if (teamId) {
    revalidatePath(`/teams/${teamId}`);
    revalidatePath(`/teams/${teamId}/fixtures`);
  }
  revalidatePath("/matches");
  redirect(teamId ? `/teams/${teamId}?deleted=fixture` : "/matches");
}
