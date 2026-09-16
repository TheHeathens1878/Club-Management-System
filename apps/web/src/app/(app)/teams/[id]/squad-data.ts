import { signPeoplePhotos } from "@/lib/avatars";
import { emergencyContactLine, type EmergencyContact } from "@/lib/emergency-contacts";
import { loadEmergencyContacts } from "@/lib/emergency-contacts-server";
import { personLabel } from "@/lib/people-display";
import { nameOf, resolveNames } from "@/lib/person";
import { fixtureDayLabel, fixtureWhenLabel, type AvailabilityStatus } from "@/lib/squad-cards";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { createClient } from "@/lib/supabase/server";

import type {
  MemberRow,
  PendingRow,
  SquadAvailability,
  SquadLeave,
  SquadSubs,
} from "./members-panel";

/**
 * What the Squad tab reads (P8.7a).
 *
 * Its own module, away from the drawing, for two reasons. The first is the
 * ordinary one: a page reads like "here is what this tab is" when the two
 * hundred lines of Supabase live next door. The second is concrete —
 * `signPeoplePhotos` and `loadEmergencyContacts` are server-only, and the
 * render harness bundles the VIEW for a browser, so anything that reaches for
 * the service key has to be on this side of the line.
 *
 * Every query below came out of `page.tsx` whole. Not one was changed.
 */

type UserClient = Awaited<ReturnType<typeof createClient>>;
type AdminClient = ReturnType<typeof createAdminClient>;

export type SquadTabData = {
  members: MemberRow[];
  pending: PendingRow[];
  squadLeave: SquadLeave;
  availability: SquadAvailability | null;
  subs: SquadSubs | null;
  season: { id: string; name: string } | null;
};

export const EMPTY_SQUAD: SquadTabData = {
  members: [],
  pending: [],
  squadLeave: { canRequest: false, pendingMembershipIds: [] },
  availability: null,
  subs: null,
  season: null,
};

/** The payload `migrate_neon()` queues for a held-back membership. */
function pendingMembershipPayload(payload: unknown): {
  teamId: string | null;
  role: string | null;
  displayName: string | null;
} {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { teamId: null, role: null, displayName: null };
  }
  const record = payload as Record<string, unknown>;
  const read = (key: string): string | null =>
    typeof record[key] === "string" ? (record[key] as string) : null;
  return { teamId: read("team_id"), role: read("role"), displayName: read("display_name") };
}

/**
 * The season's roster and the held-back imports. Moved out of `page.tsx`
 * whole (P8.7a) — not one query changed.
 *
 * The roster is read through the caller's own client, so `team_memberships`
 * RLS decides: `_admin_read` for a club_admin or the safeguarding lead,
 * `_staff_read` for this team's own child-facing staff. Editing is offered
 * only to a club_admin, which is who `_admin_insert` / `_admin_update`
 * accept — and if the app ever got that wrong, the policy would still refuse
 * and the refusal is what the sheet shows.
 *
 * NO DATE OF BIRTH IS READ HERE. `is_minor()` is SECURITY DEFINER and returns
 * a boolean, which is all a roster needs; the date itself lives on the
 * person's record behind /people.
 */
export async function loadSquadTab({
  userClient,
  admin,
  teamId,
  nowIso,
  staffTools,
  committee,
  clubAdmin,
  teamStaff,
}: {
  userClient: UserClient;
  admin: AdminClient;
  teamId: string;
  nowIso: string;
  staffTools: boolean;
  committee: boolean;
  clubAdmin: boolean;
  teamStaff: boolean | null;
}): Promise<SquadTabData> {
  const out: SquadTabData = { ...EMPTY_SQUAD, members: [], pending: [] };

  const [seasonsResult, pendingResult] = await Promise.all([
    userClient.from("seasons").select("id,name,is_current").order("starts_on", {
      ascending: false,
    }),
    // Imported memberships the SG-0 gate is holding back.
    // `neon_import_pending` RLS is club_admin (or the subject), so a
    // non-admin simply gets no rows — which is the right answer, not a
    // failure to handle. The team lives inside the payload
    // `migrate_neon()` wrote, so the filter is applied here.
    userClient
      .from("neon_import_pending")
      .select(
        "id,person_id,payload,created_at,attempts,last_error,people(first_name,last_name,preferred_name)",
      )
      .eq("kind", "membership")
      .is("applied_at", null)
      .order("created_at"),
  ]);

  const currentSeason = (seasonsResult.data ?? []).find((season) => season.is_current) ?? null;
  out.season = currentSeason ? { id: currentSeason.id, name: currentSeason.name } : null;

  if (currentSeason) {
    const { data: membershipRows } = await userClient
      .from("team_memberships")
      .select("id,person_id,role,shirt_number,joined_at")
      .eq("team_id", teamId)
      .eq("season_id", currentSeason.id)
      .is("left_at", null)
      .order("role")
      .order("joined_at");

    // `resolveNames` reads `people` first and falls back to `display_name()`,
    // the SECURITY DEFINER helper that names a member to their team's staff.
    // A coach reading this roster holds no `people` grant, so without the
    // fallback every row would read "Club member".
    const memberNames = await resolveNames((membershipRows ?? []).map((row) => row.person_id));

    // The face by the name (Adam, 2026-08-25). Read through the CALLER'S own
    // client, which is the whole safety of `signPeoplePhotos`: it only ever
    // signs `photo_path` values that reader's own `people` row returned.
    // `people_staff_read` (20260825280000, Adam: "I want coaches to … see
    // photos") lets a team's staff read their live members' rows, so a
    // coach sees faces too; anyone the policies refuse gets initials.
    const memberPersonIds = Array.from(new Set((membershipRows ?? []).map((row) => row.person_id)));
    const { data: memberPhotoRows } = memberPersonIds.length
      ? await userClient.from("people").select("id,photo_path").in("id", memberPersonIds)
      : { data: [] as { id: string; photo_path: string | null }[] };
    const memberPhotos = await signPeoplePhotos(memberPhotoRows ?? []);
    // Emergency contacts beside the player (Adam, 2026-08-25: "I want
    // coaches to read emergency contacts"): `emergency_contacts_staff_read`
    // admits the team's staff for its live members; a reader the policies
    // refuse simply gets none. Read through the caller's client.
    // Only the people who ring them: the emergency contacts are drawn on
    // the roster for staff wearing the coach or admin hat and nobody else.
    const memberContacts = staffTools
      ? await loadEmergencyContacts(memberPersonIds)
      : new Map<string, EmergencyContact[]>();

    // What is already on the administrator's desk, so a row that has been
    // reported says so instead of offering the button again.
    // `_staff_read` / `_admin_read` decide; a reader entitled to neither
    // simply gets nothing back, which reads as "no requests".
    const { data: leaveRows } = await userClient
      .from("team_membership_leave_requests")
      .select("team_membership_id")
      .eq("team_id", teamId)
      .eq("status", "pending");
    out.squadLeave = {
      // A club administrator has End, which does it immediately; offering
      // them the queue as well would only be a slower End.
      canRequest: teamStaff === true && !clubAdmin,
      pendingMembershipIds: (leaveRows ?? []).map((row) => row.team_membership_id),
    };

    out.members = await Promise.all(
      (membershipRows ?? []).map(async (row) => {
        const minor = await userClient.rpc("is_minor", { person_id: row.person_id });
        return {
          id: row.id,
          personId: row.person_id,
          name: nameOf(memberNames, row.person_id),
          role: row.role,
          shirtNumber: row.shirt_number,
          joinedAt: row.joined_at,
          isMinor: minor.data === true,
          photoUrl: memberPhotos.get(row.person_id) ?? null,
          emergencyContacts: (memberContacts.get(row.person_id) ?? []).map(emergencyContactLine),
        } satisfies MemberRow;
      }),
    );

    const squadPlayerIds = out.members
      .filter((member) => member.role === "player")
      .map((member) => member.personId);

    // ----------------------------------------------------------------
    // The "Saturday" column, and the line above the list.
    //
    // Exactly what the Overview tab does: the next fixture, then the
    // `availability` rows against it. STAFF AND ADMINISTRATORS ONLY —
    // which the Squad tab already is (`staffTools` gates the tab and
    // its render) — because a parent's client returns only their own
    // household's availability rows, and a partial read shown as a squad
    // status would lie.
    // ----------------------------------------------------------------
    if (staffTools && squadPlayerIds.length > 0) {
      const { data: nextFixture } = await userClient
        .from("fixtures")
        .select("id,kickoff_at")
        .eq("team_id", teamId)
        .gte("kickoff_at", nowIso)
        .order("kickoff_at")
        .limit(1)
        .maybeSingle();
      if (nextFixture) {
        const { data: availRows } = await userClient
          .from("availability")
          .select("person_id,status")
          .eq("fixture_id", nextFixture.id);
        // Everyone starts silent; an answer overwrites it. A player with no
        // row has not replied, which is the thing worth chasing.
        const statusByPerson: Record<string, AvailabilityStatus> = {};
        for (const personId of squadPlayerIds) statusByPerson[personId] = null;
        for (const row of availRows ?? []) {
          if (row.person_id in statusByPerson) {
            statusByPerson[row.person_id] = row.status as AvailabilityStatus;
          }
        }
        out.availability = {
          fixtureLabel: fixtureWhenLabel(nextFixture.kickoff_at),
          dayLabel: fixtureDayLabel(nextFixture.kickoff_at),
          statusByPerson,
        };
      }
    }

    // ----------------------------------------------------------------
    // The "Subs" column — COMMITTEE ONLY, and it is not rendered at all
    // for anyone else (`subs` stays null). Same read as the Subs tab: the
    // newest `subscriptions` row per player through the admin client,
    // which is where money already lives on this page. No policy is
    // widened; a reader who is not committee simply never asks.
    // ----------------------------------------------------------------
    if (committee && squadPlayerIds.length > 0) {
      const { data: subRows } = await admin
        .from("subscriptions")
        .select("person_id,status,amount_due_pence,created_at")
        .in("person_id", squadPlayerIds)
        .order("created_at", { ascending: false });
      const byPerson: Record<string, { status: string | null; amountDuePence: number | null }> = {};
      for (const row of subRows ?? []) {
        // Newest first, so the first row seen per player is the current one.
        if (!(row.person_id in byPerson)) {
          byPerson[row.person_id] = { status: row.status, amountDuePence: row.amount_due_pence };
        }
      }
      out.subs = { byPerson };
    }
  }

  out.pending = (pendingResult.data ?? [])
    .map((row) => ({ row, parsed: pendingMembershipPayload(row.payload) }))
    .filter((entry) => entry.parsed.teamId === teamId)
    .map(({ row, parsed }) => ({
      id: row.id,
      personId: row.person_id,
      personName: row.people ? personLabel(row.people) : "Club member",
      role: parsed.role,
      displayName: parsed.displayName,
      createdAt: row.created_at,
      attempts: row.attempts,
      lastError: row.last_error,
    }));

  return out;
}

