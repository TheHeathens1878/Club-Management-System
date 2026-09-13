import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { isClubAdmin } from "@/lib/person";
import { createClient } from "@/lib/supabase/server";
import { dateSpanLabel, slotOrder, type SyncCounts } from "@/lib/training-plan";

import { BlackoutsCard } from "./blackouts-card";
import { BlockVenuesCard } from "./block-venues-card";
import { DayPlanner } from "./day-planner";
import { DetailsCard } from "./details-card";
import { SlotsSection, type SlotRow, type TeamOption, type VenueOption } from "./slots-section";
import { SyncCard } from "./sync-card";

export const metadata = { title: "Training block" };

export const dynamic = "force-dynamic";

/**
 * `/pitches/training/[id]` — one block, top to bottom the way it is planned
 * (Adam, 2026-09-06):
 *
 *   1. THE CALENDAR — what the plan would do if applied now ("8 to add, 2 to
 *      change, 3 to remove"), and the one button that does it. A dry run of
 *      `sync_training_block()` on every load, so the administrator always
 *      sees the plan and the calendar side by side.
 *   2. DATES OFF — Christmas, half-term.
 *   3. THE DAY PLANNER — a column per venue in the block, drag the teams on.
 *   4. THE BLOCK'S VENUES — which grounds it trains at (2026-09-13).
 *   5. VENUES AND SLOTS — grouped by venue; each slot shows its day, its
 *      time, how it is divided, how much is ours and the teams in it, with
 *      "Add team" on the row. This is where the allocating happens.
 *   6. THE BLOCK — name, dates, title; delete at the bottom, armed.
 *
 * Everything is read through the caller's own client. The four tables are
 * readable by anyone signed in; the guard here matches the write policies
 * (`can_plan_training()`) so a coach who types the URL gets the lobby, not a
 * page of buttons the database would refuse.
 */
export default async function TrainingBlockPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!isCommittee(session.profile?.role) && !(await isClubAdmin())) redirect("/lobby");

  const { id } = await params;
  const supabase = await createClient();

  const [
    { data: block },
    { data: blackouts },
    { data: slotRows },
    { data: teamRows },
    { data: venueRows },
    { data: blockVenueRows },
    dryRun,
    { data: bookedSlotRows },
    { data: pitchRows },
  ] = await Promise.all([
      supabase
        .from("training_blocks")
        .select("id,name,starts_on,ends_on,session_title,notes,last_synced_at")
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("training_blackouts")
        .select("id,label,starts_on,ends_on,charged")
        .eq("block_id", id)
        .order("starts_on"),
      supabase
        .from("training_slots")
        .select(
          "id,venue_id,venue_name,venue_address,pitch_id,weekday,start_time,end_time,parts,club_parts,notes,resources(name),training_allocations(id,team_id,shares,teams(name,age_group))",
        )
        .eq("block_id", id),
      supabase.from("teams").select("id,name,age_group,default_training_day").eq("active", true).order("name"),
      // The venues a slot may be at: training venues first, then every
      // match ground (picking one makes it a training venue too).
      supabase
        .from("venues")
        .select("id,name,for_training,training_parts,training_shares,training_notes")
        .eq("active", true)
        .order("for_training", { ascending: false })
        .order("sort_order")
        .order("name"),
      supabase.from("training_block_venues").select("venue_id").eq("block_id", id),
      supabase.rpc("sync_training_block", { p_block_id: id, p_dry_run: true }),
      // What the club has booked at its training venues — every slot, with
      // its pitch and its booking's dates; narrowed to this block below.
      supabase
        .from("venue_booking_slots")
        .select("pitch_id,weekday,start_time,end_time,parts,shares,resources(name),venue_bookings!inner(venue_id,starts_on,ends_on)")
        .order("weekday")
        .order("start_time"),
      // The pitches on each venue, for "which pitch" on a slot.
      supabase
        .from("resources")
        .select("id,name,venue_id")
        .eq("type", "pitch")
        .eq("active", true)
        .not("venue_id", "is", null)
        .order("sort_order")
        .order("name"),
    ]);
  if (!block) notFound();

  const counts: SyncCounts | null = dryRun.data?.[0] ?? null;

  const slots: SlotRow[] = slotOrder(
    (slotRows ?? []).map((row) => ({
      id: row.id,
      venueId: row.venue_id,
      venueName: row.venue_name,
      venueAddress: row.venue_address,
      pitchId: row.pitch_id,
      pitchName: row.resources?.name ?? null,
      weekday: row.weekday,
      startTime: row.start_time,
      endTime: row.end_time,
      parts: row.parts,
      clubParts: row.club_parts,
      notes: row.notes,
      allocations: (row.training_allocations ?? [])
        .map((a) => ({
          id: a.id,
          teamId: a.team_id,
          shares: a.shares,
          teamName: a.teams?.name ?? "Team",
          ageGroup: a.teams?.age_group ?? null,
        }))
        .sort((a, b) => a.teamName.localeCompare(b.teamName)),
    })),
  );
  const teams: TeamOption[] = (teamRows ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    ageGroup: t.age_group,
    trainingDay: t.default_training_day,
  }));
  // A booked slot counts for this block when its booking overlaps the
  // block's dates.
  const bookedFor = (venueId: string) =>
    (bookedSlotRows ?? [])
      .filter(
        (row) =>
          row.venue_bookings?.venue_id === venueId &&
          row.venue_bookings.starts_on <= block.ends_on &&
          row.venue_bookings.ends_on >= block.starts_on,
      )
      .map((row) => ({
        pitchId: row.pitch_id,
        pitchName: row.resources?.name ?? null,
        weekday: row.weekday,
        startTime: row.start_time,
        endTime: row.end_time,
        parts: row.parts,
        shares: row.shares,
      }));
  const venueOptions: VenueOption[] = (venueRows ?? []).map((v) => ({
    id: v.id,
    name: v.name,
    forTraining: v.for_training,
    trainingParts: v.training_parts,
    trainingShares: v.training_shares,
    trainingNotes: v.training_notes,
    pitches: (pitchRows ?? []).filter((p) => p.venue_id === v.id).map((p) => ({ id: p.id, name: p.name })),
    bookedSlots: bookedFor(v.id),
  }));
  const blockVenueIds = (blockVenueRows ?? []).map((row) => row.venue_id);
  // The block's venues in the club's order — the planner's columns.
  const blockVenues = venueOptions.filter((venue) => blockVenueIds.includes(venue.id));
  const slotsByVenue = new Map<string, number>();
  for (const slot of slots) {
    if (slot.venueId) slotsByVenue.set(slot.venueId, (slotsByVenue.get(slot.venueId) ?? 0) + 1);
  }
  const venues = Array.from(new Set([...blockVenues.map((v) => v.name), ...slots.map((s) => s.venueName)]));

  return (
    <>
      <PageHeader
        title={block.name}
        subtitle={`${dateSpanLabel(block.starts_on, block.ends_on)} · ${venues.length} venue${venues.length === 1 ? "" : "s"} · ${slots.length} slot${slots.length === 1 ? "" : "s"}`}
        back={{ href: "/pitches/training", label: "Training blocks" }}
      />

      <div className="space-y-6 p-4 lg:p-6">
        <SyncCard
          blockId={block.id}
          counts={counts}
          dryRunError={dryRun.error?.message ?? null}
          lastSyncedAt={block.last_synced_at}
          hasPlan={slots.some((s) => s.allocations.length > 0)}
        />

        <BlackoutsCard
          blockId={block.id}
          startsOn={block.starts_on}
          endsOn={block.ends_on}
          blackouts={(blackouts ?? []).map((b) => ({
            id: b.id,
            label: b.label,
            startsOn: b.starts_on,
            endsOn: b.ends_on,
            charged: b.charged,
          }))}
        />

        <DayPlanner blockId={block.id} slots={slots} teams={teams} venues={blockVenues} />

        <BlockVenuesCard
          blockId={block.id}
          venues={venueOptions}
          blockVenueIds={blockVenueIds}
          slotsByVenue={slotsByVenue}
        />

        <SlotsSection
          blockId={block.id}
          slots={slots}
          teams={teams}
          venues={venueOptions}
          blockVenueIds={blockVenueIds}
        />

        <DetailsCard
          block={{
            id: block.id,
            name: block.name,
            startsOn: block.starts_on,
            endsOn: block.ends_on,
            sessionTitle: block.session_title,
            notes: block.notes,
          }}
          sessionsOnCalendar={counts ? counts.unchanged + counts.updated : 0}
        />
      </div>
    </>
  );
}
