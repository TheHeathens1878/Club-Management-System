import { NextRequest, NextResponse } from "next/server";

import { getSessionProfile } from "@/lib/auth";
import { getCapabilities } from "@/lib/capabilities";
import { createClient } from "@/lib/supabase/server";
import { formatEventDate, formatEventTime } from "@/app/(app)/events/shared";

export const dynamic = "force-dynamic";

export type SearchHit = {
  type: "person" | "team" | "event" | "booking";
  label: string;
  detail: string | null;
  href: string;
};

/**
 * The command palette's remote half. Everything reads through the CALLER'S
 * OWN client, so RLS decides what a search can see — an administrator finds
 * anyone, a member finds their own household and nothing else. Results only
 * link where the caller's own guards will let them land.
 *
 * P7.2 adds the two things people actually type into a search box: an
 * opponent or a date ("Sale", "Saturday") to find the event, and a hirer's
 * name or occasion to find the booking. Events come from `my_events()` —
 * already scoped to the caller's teams — and bookings from the function-room
 * diary under `bookings_staff_read`, so a member simply gets none.
 */
export async function GET(request: NextRequest) {
  const session = await getSessionProfile();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ hits: [] });

  const capabilities = await getCapabilities();
  const supabase = await createClient();
  const like = `%${q.replace(/[%_]/g, "")}%`;
  const needle = q.toLowerCase();
  const hits: SearchHit[] = [];

  const canSeePeople = capabilities.isClubAdmin || capabilities.isCommittee || capabilities.hasFinanceRole;
  const canSeeTeams = capabilities.isClubAdmin || capabilities.isCommittee || capabilities.isTeamStaff;
  const canSeeBookings = capabilities.isStaff;

  const [people, teams, events, bookings] = await Promise.all([
    canSeePeople
      ? supabase
          .from("people")
          .select("id,first_name,last_name,email")
          .is("deleted_at", null)
          .or(`first_name.ilike.${like},last_name.ilike.${like}`)
          .order("last_name")
          .limit(8)
      : Promise.resolve({ data: null, error: null }),
    canSeeTeams
      ? supabase.from("teams").select("id,name,age_group").eq("active", true).ilike("name", like).order("name").limit(5)
      : Promise.resolve({ data: null, error: null }),
    supabase.rpc("my_events", { p_horizon_days: 120 }),
    canSeeBookings
      ? supabase
          .from("bookings")
          .select("id,booker_name,occasion,starts_at,status,resources!inner(name,type)")
          .eq("resources.type", "function_room")
          .or(`booker_name.ilike.${like},occasion.ilike.${like}`)
          .gte("starts_at", new Date(Date.now() - 30 * 86_400_000).toISOString())
          .order("starts_at")
          .limit(5)
      : Promise.resolve({ data: null, error: null }),
  ]);

  for (const person of people.data ?? []) {
    hits.push({
      type: "person",
      label: `${person.first_name} ${person.last_name}`,
      detail: person.email,
      href: `/people/${person.id}`,
    });
  }

  // Teams: staff and admins land on the team page; everyone else reaches
  // their own teams through the Club hub's rows.
  for (const team of teams.data ?? []) {
    hits.push({ type: "team", label: team.name, detail: team.age_group, href: `/teams/${team.id}` });
  }

  // Events: title, team, venue or the printed date — "sale", "cobras",
  // "sat 12 sep" all find the fixture. Filtered here because my_events() is
  // the caller's whole diary and already small.
  const matchedEvents = (events.data ?? [])
    .filter((event) => {
      const when = `${formatEventDate(event.starts_at)} ${formatEventTime(event.starts_at)}`.toLowerCase();
      return [event.title, event.team_name, event.venue ?? "", when].some((field) =>
        field.toLowerCase().includes(needle),
      );
    })
    .slice(0, 6);
  for (const event of matchedEvents) {
    hits.push({
      type: "event",
      label: event.title,
      detail: `${event.team_name} · ${formatEventDate(event.starts_at)}`,
      href: `/events/${event.event_id}`,
    });
  }

  for (const booking of bookings.data ?? []) {
    hits.push({
      type: "booking",
      label: booking.booker_name ?? "Booking",
      detail: [booking.occasion, formatEventDate(booking.starts_at), booking.status].filter(Boolean).join(" · "),
      href: `/room-bookings/${booking.id}`,
    });
  }

  return NextResponse.json({ hits });
}
