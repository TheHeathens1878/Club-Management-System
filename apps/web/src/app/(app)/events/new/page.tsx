import { redirect } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { getCapabilities } from "@/lib/capabilities";
import { getCurrentPersonId } from "@/lib/person";
import { createClient } from "@/lib/supabase/server";

import { EventForm, type TeamOption, type VenueOption } from "./event-form";

/**
 * New event — coaches create one-off and recurring events (Adam, 2026-08-24).
 *
 * The team list is the caller's own staff teams (a club admin gets them all);
 * `events_staff_insert` / `create_event_series` re-check server-side, so this
 * page only shapes the form, never the permission.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "New event" };

const STAFF_ROLES = ["coach", "assistant_coach", "manager"] as const;

export default async function NewEventPage() {
  const capabilities = await getCapabilities();
  if (!capabilities.isTeamStaff && !capabilities.isClubAdmin) redirect("/events");

  const supabase = await createClient();

  let teams: TeamOption[] = [];
  if (capabilities.isClubAdmin) {
    const { data } = await supabase.from("teams").select("id,name").order("name");
    teams = data ?? [];
  } else {
    const personId = await getCurrentPersonId();
    if (personId) {
      const { data } = await supabase
        .from("team_memberships")
        .select("team_id, teams(name)")
        .eq("person_id", personId)
        .in("role", [...STAFF_ROLES])
        .is("left_at", null);
      const seen = new Map<string, string>();
      for (const row of data ?? []) {
        const name = (row.teams as { name: string } | null)?.name;
        if (name && !seen.has(row.team_id)) seen.set(row.team_id, name);
      }
      teams = Array.from(seen, ([id, name]) => ({ id, name })).sort((a, b) =>
        a.name.localeCompare(b.name),
      );
    }
  }

  // Pitches only: a club venue an event can actually reserve. Anywhere else
  // (an away ground, the clubhouse) is typed in as free text.
  const { data: venueRows } = await supabase
    .from("resources")
    .select("id,name")
    .eq("active", true)
    .eq("type", "pitch")
    .order("sort_order")
    .order("name");
  const venues: VenueOption[] = venueRows ?? [];

  return (
    <>
      <PageHeader
        title="New event"
        subtitle="A one-off, or a weekly series — the team is asked to accept or decline"
        back={{ href: "/events", label: "Events" }}
      />
      <div className="p-4 lg:p-6">
        {teams.length === 0 ? (
          <p className="max-w-xl rounded-lg border px-3 py-2 text-sm text-muted-foreground">
            You are not recorded as staff on any team, so there is no team to create an event
            for. Match events are created automatically from fixtures.
          </p>
        ) : (
          <EventForm teams={teams} venues={venues} canConfirm={capabilities.isClubAdmin} />
        )}
      </div>
    </>
  );
}
