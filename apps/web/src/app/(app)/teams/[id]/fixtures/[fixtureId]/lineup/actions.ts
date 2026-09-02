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
 *
 * The bench rides in the same map. A substitute is a slot row keyed "SUB1" to
 * "SUB7" (`BENCH_SIZE`), so the table's unique keys — one row per (lineup,
 * slot) and one per (lineup, person) — are already the bench's rules: one
 * player per place, and nobody on the pitch and the bench at once.
 */

import { revalidatePath } from "next/cache";

import { getSessionProfile } from "@/lib/auth";
import { formationsFor, isBenchKey, playingFormatFor } from "@/lib/formations";
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
    .select("id,team_id,teams:team_id(age_group,playing_format)")
    .eq("id", fixtureId)
    .eq("team_id", teamId)
    .maybeSingle();
  if (!fixture) return { error: "That fixture is not on this team." };

  const teamRow = fixture.teams as { age_group: string | null; playing_format: string | null } | null;
  const format = playingFormatFor(teamRow?.age_group, teamRow?.playing_format);
  const chosen = formationsFor(format).find((f) => f.name === formationName);
  if (!chosen) return { error: `A ${format} team cannot line up in ${formationName || "that shape"}.` };

  // The pitch slots belong to the chosen shape; the bench keys belong to no
  // shape at all, which is exactly why a substitute survives a change of
  // formation. Both are rows in the same table.
  const allowedSlots = new Set(chosen.slots.map((slot) => slot.key));
  const seen = new Set<string>();
  for (const [slot, personId] of Object.entries(placements)) {
    if (!allowedSlots.has(slot) && !isBenchKey(slot)) {
      return { error: `${slot} is not a position in ${chosen.name}.` };
    }
    if (seen.has(personId)) {
      return { error: "A player can only be named once — one position, or one place on the bench." };
    }
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
  const subs = rows.filter((row) => isBenchKey(row.slot)).length;
  const onPitch = rows.length - subs;
  return {
    notice:
      rows.length > 0
        ? `Lineup saved — ${chosen.name}, ${onPitch} of ${chosen.slots.length} placed` +
          (subs > 0 ? `, ${subs} substitute${subs === 1 ? "" : "s"}.` : ".")
        : "Lineup saved — the pitch is empty.",
  };
}
