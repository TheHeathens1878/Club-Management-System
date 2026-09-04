"use server";

/**
 * Add a fixture from the matches desk (Adam, 2026-09-04: "Add a fixture on
 * Matches takes me (admin) to the team page. I need to be able to add it
 * directly from there").
 *
 * One INSERT through the caller's own client: `fixtures_staff_insert` (club
 * admin, or staff of the team) is the whole permission, exactly as it is
 * everywhere else a fixture is born. The database does the rest on its own —
 * the diary event, the notifications, the mirror rules — and a home fixture
 * lands straight on the desk's Unallocated amber and the /pitches work list,
 * where today's Allocate tools put it on a pitch.
 *
 * `source` is 'manual', so the Full-Time reconciler never mistakes this for a
 * row it owns and retires it as "no longer published".
 */

import { revalidatePath } from "next/cache";

import { normaliseTime, isValidTimeString, localToInstant } from "@/lib/booking-time";
import { friendlyDbError } from "@/lib/people-display";
import { createClient } from "@/lib/supabase/server";

export type AddFixtureState = { error?: string; notice?: string };

function text(formData: FormData, key: string, max = 200): string {
  return String(formData.get(key) ?? "")
    .trim()
    .slice(0, max);
}

export async function addFixture(
  _prev: AddFixtureState,
  formData: FormData,
): Promise<AddFixtureState> {
  const teamId = text(formData, "team_id", 40);
  const opponent = text(formData, "opponent", 120);
  const isHome = text(formData, "side", 8) !== "away";
  const date = text(formData, "kickoff_date", 10);
  const time = normaliseTime(text(formData, "kickoff_time", 5));
  const competition = text(formData, "competition", 120);
  const venueText = text(formData, "venue_text", 200);

  if (!teamId) return { error: "Pick the team first." };
  if (!opponent) return { error: "Name the opponent." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Give the date as a real date." };
  if (!isValidTimeString(time)) return { error: "Give the kick-off as a time like 10:30." };

  const supabase = await createClient();
  const { data: season } = await supabase
    .from("seasons")
    .select("id")
    .eq("is_current", true)
    .limit(1)
    .maybeSingle();
  if (!season) return { error: "No current season is set — fixtures need one (Teams → Season)." };

  const { data, error } = await supabase
    .from("fixtures")
    .insert({
      team_id: teamId,
      season_id: season.id,
      opponent,
      is_home: isHome,
      kickoff_at: localToInstant(date, time),
      source: "manual",
      ...(competition ? { competition } : {}),
      ...(venueText ? { venue_text: venueText } : {}),
    })
    .select("id")
    .maybeSingle();
  if (error) return { error: friendlyDbError(error, "The database refused that fixture.") };
  if (!data) {
    return { error: "Only a club administrator or this team's staff can add its fixtures." };
  }

  revalidatePath("/matches");
  revalidatePath("/pitches");
  revalidatePath("/events");
  revalidatePath(`/teams/${teamId}`);
  return {
    notice: isHome
      ? "Fixture added — the diary event and notifications follow. It is waiting for a pitch: tick it here or allocate on Pitches."
      : "Fixture added — the diary event and notifications follow.",
  };
}
