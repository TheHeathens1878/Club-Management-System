import { groupByVenue, splitVenue } from "@/lib/pitch-venue";
import { createClient } from "@/lib/supabase/server";

/**
 * The things a group can be attached to, as the picker needs them.
 *
 * Server-only (it reads through the caller's own client). `resources_public
 * _read` returns the active rows to anybody, so nothing here depends on being
 * an administrator — the page guard does that.
 *
 * Venues are not a table: a pitch is named "Venue – Pitch N" and the prefix is
 * the venue, which is why `groupByVenue` from `@/lib/pitch-venue` is the one
 * place that knows the convention. Function rooms carry no such prefix, so they
 * are gathered under one heading of their own.
 */

export type ResourceOption = { id: string; name: string; label: string };
export type VenueGroupOption = { venue: string; options: ResourceOption[] };
export type TeamOption = { id: string; name: string };

/** The heading the function room resources sit under. */
export const FUNCTION_ROOM_HEADING = "Function room";

export async function loadAttachmentOptions(): Promise<{
  venues: VenueGroupOption[];
  teams: TeamOption[];
}> {
  const supabase = await createClient();

  const [{ data: resourceRows }, { data: teamRows }] = await Promise.all([
    supabase
      .from("resources")
      .select("id,name,type,active,sort_order")
      .eq("active", true)
      .order("sort_order")
      .order("name"),
    supabase.from("teams").select("id,name,age_group,active").eq("active", true).order("name"),
  ]);

  const resources = resourceRows ?? [];
  const rooms = resources.filter((r) => r.type === "function_room");
  const pitches = resources.filter((r) => r.type === "pitch");

  const venues: VenueGroupOption[] = [];
  if (rooms.length > 0) {
    venues.push({
      venue: FUNCTION_ROOM_HEADING,
      options: rooms.map((r) => ({ id: r.id, name: r.name, label: r.name })),
    });
  }
  for (const group of groupByVenue(pitches)) {
    venues.push({
      venue: group.venue,
      // Inside a venue the pitch's own part of the name is enough; the heading
      // already carries the ground.
      options: group.pitches.map((p) => ({
        id: p.id,
        name: p.name,
        label: splitVenue(p.name).pitch,
      })),
    });
  }

  const teams: TeamOption[] = (teamRows ?? []).map((t) => ({
    id: t.id,
    name: t.age_group ? `${t.name} (${t.age_group})` : t.name,
  }));

  return { venues, teams };
}
