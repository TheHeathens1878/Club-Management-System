"use server";

/**
 * The team membership editor (gap 1).
 *
 * Every write goes to `team_memberships` through the USER-SCOPED client, never
 * the service key. That is the whole point: `team_memberships_admin_insert` /
 * `_update` restrict the write to a club_admin, and
 * `trg_team_memberships_sg6_guard` is a BEFORE trigger that raises P0001 with a
 * sentence naming the person and the paperwork they are missing (SG-6 tier 1,
 * both directions — a child-facing role joining a team with minors, and a minor
 * joining a team whose staff are not compliant). Going through the service key
 * would keep the trigger but lose the policy, and the app's own role check
 * would become the only access control — the arrangement SAFEGUARDING.md §1.2
 * rules out.
 *
 * A membership is never deleted. Leaving a team sets `left_at`; the row is the
 * history P5.3 reads.
 */

import { revalidatePath } from "next/cache";

import type { Database } from "@club/db";

import { friendlyDbError } from "@/lib/people-display";
import { createClient } from "@/lib/supabase/server";

export type MembershipActionState = { error?: string; notice?: string };

type TeamRole = Database["public"]["Enums"]["team_role"];

const TEAM_ROLES: TeamRole[] = ["player", "coach", "assistant_coach", "manager"];

const NOT_ADMIN =
  "Only a club administrator can change who is in a team. Ask one to make the change, or to grant you the club_admin role.";

function teamPath(teamId: string): string {
  return `/teams/${teamId}`;
}

function readShirtNumber(raw: string): { value: number | null } | { error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { value: null };
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 99) {
    return { error: "A shirt number must be a whole number between 0 and 99." };
  }
  return { value: parsed };
}

/** Add someone to this team for the current season. */
export async function addTeamMember(
  _prev: MembershipActionState,
  formData: FormData,
): Promise<MembershipActionState> {
  const teamId = String(formData.get("team_id") ?? "").trim();
  const seasonId = String(formData.get("season_id") ?? "").trim();
  const personId = String(formData.get("person_id") ?? "").trim();
  const role = String(formData.get("role") ?? "").trim();
  const joinedAt = String(formData.get("joined_at") ?? "").trim();

  if (!teamId || !seasonId) {
    return { error: "This team has no current season. Make a season current on the Teams screen first." };
  }
  if (!personId) return { error: "Search for and choose a person first." };
  if (!TEAM_ROLES.includes(role as TeamRole)) return { error: "Choose a role." };

  const shirt = readShirtNumber(String(formData.get("shirt_number") ?? ""));
  if ("error" in shirt) return { error: shirt.error };

  const supabase = await createClient();
  const { error } = await supabase.from("team_memberships").insert({
    person_id: personId,
    team_id: teamId,
    season_id: seasonId,
    role: role as TeamRole,
    shirt_number: shirt.value,
    ...(joinedAt ? { joined_at: joinedAt } : {}),
  });
  if (error) {
    return {
      error: friendlyDbError(
        error,
        NOT_ADMIN,
        "That person already holds that role in this team for this season.",
      ),
    };
  }

  revalidatePath(teamPath(teamId));
  return { notice: "Added to the team." };
}

/**
 * Change a member's role.
 *
 * The SG-6 guard fires on this update, so promoting a player to coach on a team
 * with minors is refused unless the paperwork (or a lead's exemption) is in
 * place — and the refusal names what is missing.
 */
export async function changeMemberRole(
  _prev: MembershipActionState,
  formData: FormData,
): Promise<MembershipActionState> {
  const teamId = String(formData.get("team_id") ?? "").trim();
  const membershipId = String(formData.get("membership_id") ?? "").trim();
  const role = String(formData.get("role") ?? "").trim();

  if (!membershipId) return { error: "No membership given." };
  if (!TEAM_ROLES.includes(role as TeamRole)) return { error: "Choose a role." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("team_memberships")
    .update({ role: role as TeamRole })
    .eq("id", membershipId);
  if (error) {
    return {
      error: friendlyDbError(
        error,
        NOT_ADMIN,
        "That person already holds that role in this team for this season.",
      ),
    };
  }

  revalidatePath(teamPath(teamId));
  return { notice: "Role updated." };
}

/** Shirt numbers do not touch the SG-6 guard — it watches person, team, role and left_at. */
export async function setShirtNumber(
  _prev: MembershipActionState,
  formData: FormData,
): Promise<MembershipActionState> {
  const teamId = String(formData.get("team_id") ?? "").trim();
  const membershipId = String(formData.get("membership_id") ?? "").trim();
  if (!membershipId) return { error: "No membership given." };

  const shirt = readShirtNumber(String(formData.get("shirt_number") ?? ""));
  if ("error" in shirt) return { error: shirt.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("team_memberships")
    .update({ shirt_number: shirt.value })
    .eq("id", membershipId);
  if (error) return { error: friendlyDbError(error, NOT_ADMIN, "That shirt number is taken.") };

  revalidatePath(teamPath(teamId));
  return { notice: "Shirt number saved." };
}

/** Leaving a team is a soft end: `left_at`, never a delete. */
export async function endMembership(
  _prev: MembershipActionState,
  formData: FormData,
): Promise<MembershipActionState> {
  const teamId = String(formData.get("team_id") ?? "").trim();
  const membershipId = String(formData.get("membership_id") ?? "").trim();
  if (!membershipId) return { error: "No membership given." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("team_memberships")
    .update({ left_at: new Date().toISOString() })
    .eq("id", membershipId)
    .is("left_at", null);
  if (error) return { error: friendlyDbError(error, NOT_ADMIN) };

  revalidatePath(teamPath(teamId));
  return { notice: "Membership ended. The row is kept as history." };
}
