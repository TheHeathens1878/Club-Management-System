import {
  describeMembership,
  toTeamMemberships,
  type MembershipRow,
  type TeamMembership,
} from "./club";
import type { HouseholdMember } from "./household";
import type { PlayerMembership } from "./fixtures";

/**
 * The "My teams" tab shows the whole household, not just the signed-in person:
 * a parent opens the app to find out where their children are playing. Pure
 * shaping over the rows lib/use-household.ts reads; tested in lib/teams.test.ts.
 */

/** A `team_memberships` row selected for the whole household. */
export type HouseholdMembershipRow = MembershipRow & { person_id: string };

export interface HouseholdTeams {
  personId: string;
  name: string;
  isSelf: boolean;
  teams: TeamMembership[];
}

/**
 * One section per household member, in household order (self first), with
 * their live memberships. Members with no team still get a section so the
 * screen can say so rather than silently omit a child.
 */
export function groupTeamsByPerson(
  household: HouseholdMember[],
  rows: HouseholdMembershipRow[],
): HouseholdTeams[] {
  return household.map((member) => ({
    personId: member.personId,
    name: member.isSelf ? "You" : member.name,
    isSelf: member.isSelf,
    teams: toTeamMemberships(
      rows.filter((row) => row.person_id === member.personId),
    ),
  }));
}

export { describeMembership };

/**
 * Team/season pairs to ask for fixtures on. Deduplicated, because a parent
 * with two children in the same team must not fetch that team twice.
 */
export function teamSeasonKeys(
  rows: HouseholdMembershipRow[],
): { teamId: string; seasonId: string }[] {
  const seen = new Set<string>();
  const keys: { teamId: string; seasonId: string }[] = [];
  for (const row of rows) {
    if (row.left_at !== null) continue;
    const teamId = row.teams?.id;
    const seasonId = row.seasons?.id;
    if (!teamId || !seasonId) continue;
    const key = `${teamId}:${seasonId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push({ teamId, seasonId });
  }
  return keys;
}

/**
 * Who may set availability for which team. `availability_guard()` only accepts
 * a row whose person is a live member of the fixture's team *and* season, so
 * this is the list the fixtures screen checks before offering a toggle.
 */
export function playerMemberships(
  rows: HouseholdMembershipRow[],
): PlayerMembership[] {
  return rows.flatMap<PlayerMembership>((row) => {
    if (row.left_at !== null) return [];
    const teamId = row.teams?.id;
    const seasonId = row.seasons?.id;
    if (!teamId || !seasonId) return [];
    return [{ personId: row.person_id, teamId, seasonId }];
  });
}
