import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { renderEmailTemplate } from "@/lib/template-engine";
import { STAFF_TEAM_ROLES } from "@/lib/pitch-booking";
import { formatBookingDateShort, instantToLocal } from "@/lib/booking-time";

/**
 * "When a game is reallocated, send an email to all coaches of that team
 * notifying them of the change" (Adam, 2026-09-04).
 *
 * A REALLOCATION is a game that already held a slot being put somewhere else
 * — a different pitch, a different kick-off, or both. A first allocation is
 * routine season admin and sends nothing; this module only speaks when
 * something a coach had already planned around has moved.
 *
 * One email per team per act, listing every game that moved in it, to
 * everyone on the team's staff (coach, assistant coach, manager — the same
 * `STAFF_TEAM_ROLES` the rest of the app calls the coaches). The wording is
 * the `fixture_reallocated` template, editable like every other club email;
 * the send goes through `sendEmail`, so suppression, channel preference and
 * the dry-run switch all still apply. A failure here never fails the
 * allocation that triggered it — the booking moved; the email is the herald,
 * not the act.
 */

export type ReallocationMove = {
  fixtureId: string;
  opponent: string;
  /** The kick-off AFTER the move, ISO. */
  kickoffAt: string;
  fromPitch: string | null;
  toPitch: string;
  kickoffChanged: boolean;
};

/** "Sat 6 Sep, 09:30 v Timperley FC — Ashton Park – Pitch 1 → Dainewell Park – Pitch 2" */
export function reallocationLines(moves: ReallocationMove[]): string[] {
  return moves.map((move) => {
    const local = instantToLocal(move.kickoffAt);
    const when = `${formatBookingDateShort(local.date)}, ${local.time}`;
    const pitchPart =
      move.fromPitch && move.fromPitch !== move.toPitch
        ? `${move.fromPitch} → ${move.toPitch}`
        : `now on ${move.toPitch}`;
    const koPart = move.kickoffChanged ? ` (kick-off moved to ${local.time})` : "";
    return `${when} v ${move.opponent} — ${pitchPart}${koPart}`;
  });
}

export async function emailCoachesAboutReallocation(
  teamId: string,
  moves: ReallocationMove[],
): Promise<void> {
  try {
    if (moves.length === 0) return;
    const admin = createAdminClient();

    const [teamResult, staffResult] = await Promise.all([
      admin.from("teams").select("id,name").eq("id", teamId).maybeSingle(),
      admin
        .from("team_memberships")
        .select("person_id")
        .eq("team_id", teamId)
        .is("left_at", null)
        .in("role", STAFF_TEAM_ROLES),
    ]);
    const team = teamResult.data;
    if (!team) return;

    const personIds = [...new Set((staffResult.data ?? []).map((row) => row.person_id))];
    if (personIds.length === 0) return;
    const { data: people } = await admin
      .from("people")
      .select("id,email")
      .in("id", personIds);
    const emails = [
      ...new Set(
        (people ?? [])
          .map((person) => (person.email ?? "").trim().toLowerCase())
          .filter((email) => email !== ""),
      ),
    ];
    if (emails.length === 0) return;

    const tpl = await renderEmailTemplate("fixture_reallocated", {
      team_name: team.name,
      changes: reallocationLines(moves).join("<br/>"),
    });
    await sendEmail({
      to: emails,
      ...tpl,
      template: "fixture_reallocated",
      entity: "fixtures",
      entityId: moves[0]!.fixtureId,
    });
  } catch (error) {
    // The booking has already moved; a failed email must not unwind that.
    console.error("[pitches] coach reallocation email failed:", error);
  }
}

// ---------------------------------------------------------------------------
// The season sweep: allocate_team_fixtures() re-books EVERY future home
// fixture, moved and fresh alike, so its callers cannot tell from its result
// which games actually changed pitch. They snapshot first, diff after.
// ---------------------------------------------------------------------------

export type AllocationSnapshot = Map<
  string,
  { booked: boolean; resourceId: string | null; kickoffAt: string; opponent: string }
>;

export async function snapshotTeamAllocations(teamId: string): Promise<AllocationSnapshot> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("fixtures")
    .select("id,opponent,kickoff_at,booking_id,venue_resource_id")
    .eq("team_id", teamId)
    .eq("is_home", true)
    .eq("status", "scheduled")
    .gte("kickoff_at", new Date().toISOString());
  const snapshot: AllocationSnapshot = new Map();
  for (const row of data ?? []) {
    snapshot.set(row.id, {
      booked: row.booking_id !== null,
      resourceId: row.venue_resource_id,
      kickoffAt: row.kickoff_at,
      opponent: row.opponent,
    });
  }
  return snapshot;
}

/**
 * What actually moved since the snapshot — games that were BOOKED then and
 * now sit on a different pitch or kick off at a different moment. Freshly
 * allocated games (unbooked in the snapshot) are not moves.
 */
export async function emailCoachesAboutTeamMoves(
  teamId: string,
  snapshot: AllocationSnapshot,
): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("fixtures")
      .select("id,opponent,kickoff_at,venue_resource_id")
      .in("id", [...snapshot.keys()]);

    const resourceIds = new Set<string>();
    const changed: {
      id: string;
      opponent: string;
      kickoffAt: string;
      fromId: string | null;
      toId: string | null;
      kickoffChanged: boolean;
    }[] = [];
    for (const row of data ?? []) {
      const before = snapshot.get(row.id);
      if (!before || !before.booked) continue;
      const pitchChanged =
        row.venue_resource_id !== null && row.venue_resource_id !== before.resourceId;
      const kickoffChanged =
        new Date(row.kickoff_at).getTime() !== new Date(before.kickoffAt).getTime();
      if (!pitchChanged && !kickoffChanged) continue;
      if (before.resourceId) resourceIds.add(before.resourceId);
      if (row.venue_resource_id) resourceIds.add(row.venue_resource_id);
      changed.push({
        id: row.id,
        opponent: row.opponent,
        kickoffAt: row.kickoff_at,
        fromId: before.resourceId,
        toId: row.venue_resource_id,
        kickoffChanged,
      });
    }
    if (changed.length === 0) return;

    const { data: resources } = await admin
      .from("resources")
      .select("id,name")
      .in("id", [...resourceIds]);
    const names = new Map((resources ?? []).map((row) => [row.id, row.name]));

    await emailCoachesAboutReallocation(
      teamId,
      changed.map((row) => ({
        fixtureId: row.id,
        opponent: row.opponent,
        kickoffAt: row.kickoffAt,
        fromPitch: row.fromId ? names.get(row.fromId) ?? null : null,
        toPitch: row.toId ? names.get(row.toId) ?? "another pitch" : "another pitch",
        kickoffChanged: row.kickoffChanged,
      })),
    );
  } catch (error) {
    console.error("[pitches] coach reallocation diff failed:", error);
  }
}
