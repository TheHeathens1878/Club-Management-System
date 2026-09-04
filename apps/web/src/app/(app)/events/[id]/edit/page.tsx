import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { getSessionProfile } from "@/lib/auth";
import { instantToLocal } from "@/lib/booking-time";
import { getCapabilities } from "@/lib/capabilities";
import { createClient } from "@/lib/supabase/server";

import { EditEventForm, type EventInitial, type VenueOption } from "./edit-event-form";

/**
 * Edit an event (Adam, 2026-08-25: "I also need the ability to edit events (as
 * a coach and admin)").
 *
 * The event row is read directly — `events_read` admits any signed-in person —
 * because the form needs the raw `venue_resource_id`, `notes` and
 * `meet_minutes_before` that `event_detail()` renders rather than returns.
 *
 * Everything this page decides, `update_team_event()` decides again on the
 * way in: who may edit, and that a fixture-mirrored, cancelled or past event
 * may not be. The checks here exist so that a coach meets a sentence and a
 * back-link instead of a form that was never going to save.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Edit event" };

export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  const { id } = await params;

  const supabase = await createClient();
  const { data: event } = await supabase
    .from("events")
    .select(
      "id,team_id,type,title,status,fixture_id,booking_id,starts_at,ends_at,venue_resource_id,venue_text,notes,meet_minutes_before",
    )
    .eq("id", id)
    .maybeSingle();
  if (!event) notFound();

  const capabilities = await getCapabilities();
  const { data: staffAnswer } = await supabase.rpc("is_team_staff", { p_team_id: event.team_id });
  const allowed = capabilities.isClubAdmin || staffAnswer === true;

  const startsAt = new Date(event.starts_at);
  const editable =
    allowed &&
    !event.fixture_id &&
    event.status === "scheduled" &&
    startsAt.getTime() > Date.now();
  if (!editable) redirect(`/events/${id}`);

  // The pitch, when the event is holding one: a booking this page cannot read
  // is treated as live, because refusing to offer "somewhere else" is the safe
  // half of that guess — `update_team_event` has the final word either way.
  const { data: booking } = event.booking_id
    ? await supabase.from("bookings").select("status").eq("id", event.booking_id).maybeSingle()
    : { data: null };
  const holdsPitch = !!event.booking_id && booking?.status !== "cancelled";

  const { data: venueRows } = await supabase
    .from("resources")
    .select("id,name")
    .eq("active", true)
    .eq("type", "pitch")
    .order("sort_order")
    .order("name");
  const venues: VenueOption[] = venueRows ?? [];

  const local = instantToLocal(event.starts_at);
  const durationMinutes = event.ends_at
    ? Math.max(
        15,
        Math.round((new Date(event.ends_at).getTime() - startsAt.getTime()) / 60_000),
      )
    : 60;
  const meetTime =
    event.meet_minutes_before === null || event.meet_minutes_before === undefined
      ? ""
      : instantToLocal(new Date(startsAt.getTime() - event.meet_minutes_before * 60_000)).time;

  const initial: EventInitial = {
    id: event.id,
    type: event.type,
    title: event.title,
    date: local.date,
    time: local.time,
    meetTime,
    durationMinutes,
    venueResourceId: event.venue_resource_id ?? "",
    venueText: event.venue_text ?? "",
    notes: event.notes ?? "",
    holdsPitch,
  };

  return (
    <>
      <PageHeader
        title="Edit event"
        subtitle={event.title}
        back={{ href: `/events/${id}`, label: "Event" }}
      />
      <div className="p-4 lg:p-6">
        <EditEventForm initial={initial} venues={venues} />
      </div>
    </>
  );
}
