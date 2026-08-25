/**
 * The database's answer to "what may this person actually do?" (gap 4).
 *
 * Split out from `@/lib/role-view` because that module is shared with a client
 * component (the role tiles need the cookie name and the labels). Everything
 * here is server-only and goes through the USER-SCOPED client, so each answer
 * is the one RLS gives this caller — never the service key's.
 */

import { cache } from "react";
import { cookies } from "next/headers";

import { getSessionProfile, isBarManager, isCommittee, isStaff, isSuperUser } from "@/lib/auth";
import {
  ROLE_VIEW_COOKIE,
  TEAM_SCOPE_COOKIE,
  isRoleView,
  teamsForView,
  type Capabilities,
  type RoleView,
  type TeamRef,
} from "@/lib/role-view";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/types";

/** The stored view preference, or null when the person has not chosen one. */
export async function getStoredRoleView(): Promise<RoleView | null> {
  const store = await cookies();
  const value = store.get(ROLE_VIEW_COOKIE)?.value;
  return isRoleView(value) ? value : null;
}

/**
 * The team the current view is narrowed to — VALIDATED, not just read: the
 * cookie only counts when it names a team the resolved view actually holds
 * (a coach's staffed team, a parent's child's team, a player's own). A stale
 * value — child moved on, role ended — silently widens back to the whole view
 * rather than filtering everything down to nothing.
 */
export async function getTeamScope(view: RoleView | null, c: Capabilities): Promise<TeamRef | null> {
  if (!view) return null;
  const store = await cookies();
  const value = store.get(TEAM_SCOPE_COOKIE)?.value;
  if (!value) return null;
  return teamsForView(view, c).find((team) => team.id === value) ?? null;
}

/** `my_capabilities()` returns exactly these keys; read it defensively anyway. */
function flag(row: Record<string, unknown> | null, key: string): boolean {
  return row?.[key] === true;
}

function teams(row: Record<string, unknown> | null, key: string): TeamRef[] {
  const value = row?.[key];
  if (!Array.isArray(value)) return [];
  const out: TeamRef[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (typeof record["id"] !== "string" || typeof record["name"] !== "string") continue;
    const children = Array.isArray(record["children"])
      ? (record["children"] as unknown[]).filter((name): name is string => typeof name === "string")
      : undefined;
    out.push({ id: record["id"], name: record["name"], ...(children ? { children } : {}) });
  }
  return out;
}

/**
 * Everything the nav needs to know, in ONE round trip.
 *
 * This is asked on every navigation — the layout builds the menu from it — so
 * its cost is the app's baseline responsiveness. It used to be seven separate
 * questions (`current_person_id`, `is_club_admin`, `is_safeguarding_lead`, a
 * waiting-list count, then `person_roles`, `team_memberships` and
 * `guardianships`); `my_capabilities()` is the same predicates evaluated
 * together, and `cache()` means a render asks even that once however many
 * components need it.
 *
 * Every clause is still pinned to the caller's own person id inside the
 * function. It has to be: a club administrator's own policies would otherwise
 * answer for the whole club and every capability would come back true for the
 * wrong reason.
 */
export const getCapabilities = cache(async function getCapabilities(): Promise<Capabilities> {
  const session = await getSessionProfile();
  const appRole = (session?.profile?.role ?? "member") as UserRole;

  const supabase = await createClient();
  const { data } = await supabase.rpc("my_capabilities");
  const row = (data ?? null) as Record<string, unknown> | null;
  const personId = typeof row?.["person_id"] === "string" ? (row["person_id"] as string) : null;

  return {
    personId,
    appRole,
    isSuperUser: isSuperUser(appRole),
    isCommittee: isCommittee(appRole),
    isStaff: isStaff(appRole),
    isBarManager: isBarManager(appRole),
    isClubAdmin: flag(row, "is_club_admin"),
    isSafeguardingLead: flag(row, "is_safeguarding_lead"),
    hasCoachRole: flag(row, "has_coach_role"),
    hasParentRole: flag(row, "has_parent_role"),
    isTeamStaff: flag(row, "is_team_staff"),
    hasPlayerMembership: flag(row, "has_player_membership"),
    isGuardian: flag(row, "is_guardian"),
    hasWaitingListAccess: flag(row, "has_waiting_list_access"),
    staffTeams: teams(row, "staff_teams"),
    playerTeams: teams(row, "player_teams"),
    parentTeams: teams(row, "parent_teams"),
  };
});
