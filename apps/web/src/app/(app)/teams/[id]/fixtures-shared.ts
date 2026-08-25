/**
 * Fixture vocabulary shared by client components (the fixtures table) and
 * server pages (the fixture attendance page). Plain module on purpose — a
 * function exported from a "use client" file is a client reference a server
 * component cannot call (the /events/[id] lesson, 2026-08-24).
 */

/**
 * Where a game on the team page opens (Adam, 2026-08-25): the Event & RSVP
 * page when the events module mirrors the fixture, otherwise the fixture's
 * own availability marker. The events bridge keeps `event_responses` and
 * `availability` in step both ways, so an answer given on either page is
 * the same answer.
 */
export function fixtureHref(teamId: string, fixture: { id: string; eventId: string | null }): string {
  return fixture.eventId ? `/events/${fixture.eventId}` : `/teams/${teamId}/fixtures/${fixture.id}`;
}

/**
 * "Pick the team" (Adam, 2026-08-25: it "should be a tab (line-up) in there"):
 * the Line-up tab of the Event & RSVP page, or the fixture's own lineup page
 * when no event mirrors it yet.
 */
export function lineupHref(teamId: string, fixture: { id: string; eventId: string | null }): string {
  return fixture.eventId
    ? `/events/${fixture.eventId}?tab=lineup`
    : `/teams/${teamId}/fixtures/${fixture.id}/lineup`;
}

export function fixtureStatusVariant(
  status: string,
): "success" | "muted" | "destructive" | "warning" | "default" {
  if (status === "played") return "success";
  if (status === "cancelled" || status === "abandoned") return "destructive";
  if (status === "postponed") return "warning";
  return "default";
}
