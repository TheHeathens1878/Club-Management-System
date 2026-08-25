"use server";

/**
 * Saving one fixture's lineup — the formation and who stands on which slot.
 *
 * USER-SCOPED client throughout. `fixture_lineups_staff_write` and
 * `fixture_lineup_slots_staff_write` decide who may write, and
 * `fixture_lineup_slots_guard()` refuses anyone who is not a live player on
 * the fixture's team; the checks below are only so the screen fails politely
 * before the round trip, never instead of the database.
 *
 * The board is saved whole: the client sends the placements it has, and the
 * action replaces the lineup's slots with exactly that set. That is what makes
 * "change formation, keep who fits" a single save rather than a diff.
 */

import { revalidatePath } from "next/cache";

import { getSessionProfile } from "@/lib/auth";
import { formationsFor, playingFormatFor } from "@/lib/formations";
import { friendlyDbError } from "@/lib/people-display";
import { createClient } from "@/lib/supabase/server";

export type FixtureLineupState = { error?: string; notice?: string };

const REFUSED =
  "The database refused that. A lineup can only be set by the team's staff or a club administrator, and only players with a live membership of this team can be placed on the pitch.";

function text(formData: FormData, key: string, max = 200): string {
  return String(formData.get(key) ?? "")
    .trim()
    .slice(0, max);
}

/** `{"GK":"<person>","CB1":"<person>"}` from the client, sanity-checked. */
function parsePlacements(raw: string): Record<string, string> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const out: Record<string, string> = {};
  for (const [slot, personId] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof personId !== "string" || personId.length === 0) return null;
    out[slot] = personId;
  }
  return out;
}

export async function saveFixtureLineup(
  _prev: FixtureLineupState,
  formData: FormData,
): Promise<FixtureLineupState> {
  const session = await getSessionProfile();
  if (!session) return { error: "Sign in again to save the lineup." };

  const fixtureId = text(formData, "fixture_id", 40);
  const teamId = text(formData, "team_id", 40);
  const formationName = text(formData, "formation", 20);
  const placements = parsePlacements(String(formData.get("placements") ?? ""));

  if (!fixtureId || !teamId) return { error: "No fixture given." };
  if (!placements) return { error: "The lineup could not be read. Reload the page and try again." };

  const supabase = await createClient();

  // The fixture must be this team's, and the team's age group is what decides
  // which formations exist at all (the FA table, via `playingFormatFor`).
  const { data: fixture } = await supabase
    .from("fixtures")
    .select("id,team_id,teams:team_id(age_group)")
    .eq("id", fixtureId)
    .eq("team_id", teamId)
    .maybeSingle();
  if (!fixture) return { error: "That fixture is not on this team." };

  const format = playingFormatFor((fixture.teams as { age_group: string | null } | null)?.age_group);
  const chosen = formationsFor(format).find((f) => f.name === formationName);
  if (!chosen) return { error: `A ${format} team cannot line up in ${formationName || "that shape"}.` };

  const allowedSlots = new Set(chosen.slots.map((slot) => slot.key));
  const seen = new Set<string>();
  for (const [slot, personId] of Object.entries(placements)) {
    if (!allowedSlots.has(slot)) return { error: `${slot} is not a position in ${chosen.name}.` };
    if (seen.has(personId)) return { error: "A player can only stand in one position." };
    seen.add(personId);
  }

  const { data: lineup, error: lineupError } = await supabase
    .from("fixture_lineups")
    .upsert(
      { fixture_id: fixtureId, formation: chosen.name, created_by: session.userId },
      { onConflict: "fixture_id" },
    )
    .select("id")
    .single();
  if (lineupError) return { error: friendlyDbError(lineupError, REFUSED) };
  if (!lineup) return { error: REFUSED };

  // Replace the board rather than diff it: the delete is scoped to this
  // lineup, and the same policy that let the upsert through governs it.
  const { error: clearError } = await supabase
    .from("fixture_lineup_slots")
    .delete()
    .eq("lineup_id", lineup.id);
  if (clearError) return { error: friendlyDbError(clearError, REFUSED) };

  const rows = Object.entries(placements).map(([slot, personId]) => ({
    lineup_id: lineup.id,
    slot,
    person_id: personId,
    placed_by: session.userId,
  }));
  if (rows.length > 0) {
    const { error: insertError } = await supabase.from("fixture_lineup_slots").insert(rows);
    if (insertError) return { error: friendlyDbError(insertError, REFUSED) };
  }

  revalidatePath(`/teams/${teamId}/fixtures/${fixtureId}/lineup`);
  revalidatePath(`/teams/${teamId}/fixtures/${fixtureId}`);
  return {
    notice:
      rows.length > 0
        ? `Lineup saved — ${chosen.name}, ${rows.length} of ${chosen.slots.length} placed.`
        : "Lineup saved — the pitch is empty.",
  };
}
