/**
 * The database's answer to "what may this person actually do?" (gap 4).
 *
 * Split out from `@/lib/role-view` because that module is shared with a client
 * component (the role tiles need the cookie name and the labels). Everything
 * here is server-only and goes through the USER-SCOPED client, so each answer
 * is the one RLS gives this caller — never the service key's.
 */

import { cookies } from "next/headers";

import { getSessionProfile, isBarManager, isCommittee, isStaff, isSuperUser } from "@/lib/auth";
import { hasWaitingListAccess, isClubAdmin, isSafeguardingLead } from "@/lib/person";
import { ROLE_VIEW_COOKIE, isRoleView, type Capabilities, type RoleView } from "@/lib/role-view";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/types";

/** The stored view preference, or null when the person has not chosen one. */
export async function getStoredRoleView(): Promise<RoleView | null> {
  const store = await cookies();
  const value = store.get(ROLE_VIEW_COOKIE)?.value;
  return isRoleView(value) ? value : null;
}

const TEAM_STAFF_ROLES = new Set(["coach", "assistant_coach", "manager"]);

/**
 * Everything the nav needs to know, in one pass.
 *
 * The `person_roles`, `team_memberships` and `guardianships` reads are all
 * filtered to this person explicitly. They have to be: a club administrator's
 * own policies would otherwise return the whole club, and every capability
 * would come back true for the wrong reason.
 */
export async function getCapabilities(): Promise<Capabilities> {
  const session = await getSessionProfile();
  const appRole = (session?.profile?.role ?? "member") as UserRole;

  const supabase = await createClient();
  const { data: personId } = await supabase.rpc("current_person_id");

  const [clubAdmin, safeguardingLead, waitingList] = await Promise.all([
    isClubAdmin(),
    isSafeguardingLead(),
    hasWaitingListAccess(),
  ]);

  let hasCoachRole = false;
  let hasParentRole = false;
  let isTeamStaff = false;
  let hasPlayerMembership = false;
  let isGuardian = false;

  if (personId) {
    const [roles, memberships, guardianships] = await Promise.all([
      supabase.from("person_roles").select("role").eq("person_id", personId).is("revoked_at", null),
      supabase.from("team_memberships").select("role").eq("person_id", personId).is("left_at", null),
      supabase
        .from("guardianships")
        .select("id")
        .eq("guardian_person_id", personId)
        .is("ended_at", null)
        .limit(1),
    ]);

    for (const row of roles.data ?? []) {
      if (row.role === "coach") hasCoachRole = true;
      if (row.role === "parent") hasParentRole = true;
    }
    for (const row of memberships.data ?? []) {
      if (TEAM_STAFF_ROLES.has(row.role)) isTeamStaff = true;
      if (row.role === "player") hasPlayerMembership = true;
    }
    isGuardian = (guardianships.data ?? []).length > 0;
  }

  return {
    personId: personId ?? null,
    appRole,
    isSuperUser: isSuperUser(appRole),
    isCommittee: isCommittee(appRole),
    isStaff: isStaff(appRole),
    isBarManager: isBarManager(appRole),
    isClubAdmin: clubAdmin,
    isSafeguardingLead: safeguardingLead,
    hasCoachRole,
    hasParentRole,
    isTeamStaff,
    hasPlayerMembership,
    isGuardian,
    hasWaitingListAccess: waitingList,
  };
}
