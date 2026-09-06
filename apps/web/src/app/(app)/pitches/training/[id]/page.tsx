import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { isClubAdmin } from "@/lib/person";
import { createClient } from "@/lib/supabase/server";
import { dateSpanLabel, slotOrder, type SyncCounts } from "@/lib/training-plan";

import { BlackoutsCard } from "./blackouts-card";
import { DetailsCard } from "./details-card";
import { SlotsSection, type SlotRow, type TeamOption } from "./slots-section";
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
 *   3. VENUES AND SLOTS — grouped by venue; each slot shows its day, its
 *      time, how it is divided and the teams in it, with "Add team" on the
 *      row. This is where the allocating happens.
 *   4. THE BLOCK — name, dates, title; delete at the bottom, armed.
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

  const [{ data: block }, { data: blackouts }, { data: slotRows }, { data: teamRows }, dryRun] =
    await Promise.all([
      supabase
        .from("training_blocks")
        .select("id,name,starts_on,ends_on,session_title,notes,last_synced_at")
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("training_blackouts")
        .select("id,label,starts_on,ends_on")
        .eq("block_id", id)
        .order("starts_on"),
      supabase
        .from("training_slots")
        .select(
          "id,venue_name,venue_address,weekday,start_time,end_time,parts,notes,training_allocations(id,team_id,shares,teams(name,age_group))",
        )
        .eq("block_id", id),
      supabase.from("teams").select("id,name,age_group").eq("active", true).order("name"),
      supabase.rpc("sync_training_block", { p_block_id: id, p_dry_run: true }),
    ]);
  if (!block) notFound();

  const counts: SyncCounts | null = dryRun.data?.[0] ?? null;

  const slots: SlotRow[] = slotOrder(
    (slotRows ?? []).map((row) => ({
      id: row.id,
      venueName: row.venue_name,
      venueAddress: row.venue_address,
      weekday: row.weekday,
      startTime: row.start_time,
      endTime: row.end_time,
      parts: row.parts,
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
  const teams: TeamOption[] = (teamRows ?? []).map((t) => ({ id: t.id, name: t.name, ageGroup: t.age_group }));
  const venues = Array.from(new Set(slots.map((s) => s.venueName)));

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
          }))}
        />

        <SlotsSection blockId={block.id} slots={slots} teams={teams} />

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
