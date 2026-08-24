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

import type { Database } from "@club/db";

import { getSessionProfile } from "@/lib/auth";
import { friendlyDbError } from "@/lib/people-display";
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
