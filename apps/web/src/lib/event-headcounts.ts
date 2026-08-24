import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@club/db";

import { summariseAvailability, type Headcount } from "./headcount";

/**
 * Headcounts per event, read AS THE CALLER — so these are only meaningful for
 * team staff and administrators, whose `availability_read` /
 * `booking_availability_read` policies return the whole squad's answers. A
 * parent's client would only get their own household back, and a count built
 * from that would be quietly wrong; callers gate on staff before asking.
 */

type Client = SupabaseClient<Database>;

/** Live players of a team — the denominator for every headcount. */
export async function teamPlayerIds(client: Client, teamId: string): Promise<string[]> {
  const { data } = await client
    .from("team_memberships")
    .select("person_id,role")
    .eq("team_id", teamId)
    .is("left_at", null);
  return (data ?? []).filter((row) => row.role === "player").map((row) => row.person_id);
}

export async function fixtureHeadcounts(
  client: Client,
  fixtureIds: string[],
  playerIds: string[],
): Promise<Map<string, Headcount>> {
  const map = new Map<string, Headcount>();
  if (fixtureIds.length === 0) return map;
  const { data } = await client
    .from("availability")
    .select("fixture_id,person_id,status")
    .in("fixture_id", fixtureIds);
  for (const id of fixtureIds) {
    map.set(
      id,
      summariseAvailability(
        (data ?? []).filter((row) => row.fixture_id === id),
        playerIds,
      ),
    );
  }
  return map;
}

export async function bookingHeadcounts(
  client: Client,
  bookingIds: string[],
  playerIds: string[],
): Promise<Map<string, Headcount>> {
  const map = new Map<string, Headcount>();
  if (bookingIds.length === 0) return map;
  const { data } = await client
    .from("booking_availability")
    .select("booking_id,person_id,status")
    .in("booking_id", bookingIds);
  for (const id of bookingIds) {
    map.set(
      id,
      summariseAvailability(
        (data ?? []).filter((row) => row.booking_id === id),
        playerIds,
      ),
    );
  }
  return map;
}
