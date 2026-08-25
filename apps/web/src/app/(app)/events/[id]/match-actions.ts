"use server";

/**
 * Recording what happened in a match: the per-player stats and the coach's
 * scoreline (Adam, 2026-08-25).
 *
 * USER-SCOPED client throughout. `set_fixture_stats()` refuses anyone who is
 * not the team's staff or a club administrator with 42501, and
 * `fixtures_staff_update` decides who may type a score; the checks below are
 * only so the screen fails politely before the round trip, never instead of the
 * database.
 *
 * The stats form is saved whole, exactly like the lineup board: the client
 * sends a line per squad player and the RPC replaces the fixture's stats with
 * that set, dropping the blank lines. That is what makes "move the armband from
 * A to B" a single save rather than a delete and an insert that briefly leave
 * two captains on the pitch.
 */

import { revalidatePath } from "next/cache";

import type { Json } from "@club/db";

import { getSessionProfile } from "@/lib/auth";
import { friendlyDbError } from "@/lib/people-display";
import { createClient } from "@/lib/supabase/server";

export type MatchActionState = { error?: string; notice?: string };

const STATS_REFUSED =
  "The database refused that. Match stats can only be recorded by the team's staff or a club administrator, and only players with a live membership of this team can be given a line.";
const SCORE_REFUSED =
  "The database refused that. The scoreline can only be entered by the team's staff or a club administrator.";

function text(formData: FormData, key: string, max = 200): string {
  return String(formData.get(key) ?? "")
    .trim()
    .slice(0, max);
}

/** An empty box is a zero, not an error; anything unreadable is refused. */
function count(raw: string): number | null {
  if (raw === "") return 0;
  if (!/^\d{1,2}$/.test(raw)) return null;
  return Number(raw);
}

type StatLine = {
  person_id: string;
  goals: number;
  assists: number;
  captain: boolean;
  player_of_match: boolean;
};

export async function saveFixtureStats(
  _prev: MatchActionState,
  formData: FormData,
): Promise<MatchActionState> {
  const session = await getSessionProfile();
  if (!session) return { error: "Sign in again to record the match stats." };

  const eventId = text(formData, "event_id", 40);
  const fixtureId = text(formData, "fixture_id", 40);
  const teamId = text(formData, "team_id", 40);
  const personIds = formData.getAll("person_id").map((value) => String(value));
  if (!fixtureId || !teamId) return { error: "No match given." };

  const captain = text(formData, "captain", 40);
  const award = text(formData, "player_of_match", 40);

  const lines: StatLine[] = [];
  for (const personId of personIds) {
    const goals = count(text(formData, `goals_${personId}`, 4));
    const assists = count(text(formData, `assists_${personId}`, 4));
    if (goals === null || assists === null) {
      return { error: "Goals and assists are whole numbers from 0 to 99." };
    }
    lines.push({
      person_id: personId,
      goals,
      assists,
      captain: captain === personId,
      player_of_match: award === personId,
    });
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_fixture_stats", {
    p_fixture_id: fixtureId,
    p_stats: lines as unknown as Json,
  });
  if (error) return { error: friendlyDbError(error, STATS_REFUSED) };

  if (eventId) revalidatePath(`/events/${eventId}`);
  revalidatePath(`/teams/${teamId}/fixtures/${fixtureId}`);
  const scorers = lines.filter((line) => line.goals > 0).length;
  return {
    notice:
      scorers > 0
        ? `Match stats saved — ${scorers} ${scorers === 1 ? "scorer" : "scorers"} recorded.`
        : "Match stats saved.",
  };
}

/**
 * The coach's scoreline — the pair that overrides Full-Time's (Adam: "Full-Time
 * will only import scorelines for U12 and above so where it comes through as
 * X-X, the coach's score will over-ride it").
 *
 * Written straight to `fixtures` under the caller's own policies. Clearing both
 * boxes hands the fixture back to Full-Time; the database's both-or-neither
 * check is why one box empty is refused here rather than half-written.
 */
export async function saveCoachScore(
  _prev: MatchActionState,
  formData: FormData,
): Promise<MatchActionState> {
  const session = await getSessionProfile();
  if (!session) return { error: "Sign in again to enter the score." };

  const eventId = text(formData, "event_id", 40);
  const fixtureId = text(formData, "fixture_id", 40);
  const teamId = text(formData, "team_id", 40);
  if (!fixtureId || !teamId) return { error: "No match given." };

  const homeRaw = text(formData, "home", 4);
  const awayRaw = text(formData, "away", 4);
  const clearing = homeRaw === "" && awayRaw === "";

  let home: number | null = null;
  let away: number | null = null;
  if (!clearing) {
    if (!/^\d{1,2}$/.test(homeRaw) || !/^\d{1,2}$/.test(awayRaw)) {
      return { error: "Enter both scores as whole numbers from 0 to 99, or clear them both." };
    }
    home = Number(homeRaw);
    away = Number(awayRaw);
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fixtures")
    .update({ coach_home_score: home, coach_away_score: away })
    .eq("id", fixtureId)
    .eq("team_id", teamId)
    .select("id");
  if (error) return { error: friendlyDbError(error, SCORE_REFUSED) };
  // A policy the caller fails is silence on UPDATE, not an error: no row came
  // back, so nothing was written and the screen has to say so.
  if (!data || data.length === 0) return { error: SCORE_REFUSED };

  if (eventId) revalidatePath(`/events/${eventId}`);
  revalidatePath(`/teams/${teamId}/fixtures/${fixtureId}`);
  return {
    notice: clearing
      ? "Score cleared — the match shows Full-Time's result again, if it has one."
      : `Score saved — ${home}–${away}.`,
  };
}
