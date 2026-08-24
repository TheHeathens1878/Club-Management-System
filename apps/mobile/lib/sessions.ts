import type { Enums } from "@club/db";

import { availabilityLabel, type FixtureRespondent, type PlayerMembership } from "./fixtures";
import { clubDateTime } from "./format";
import type { HouseholdMember } from "./household";

/**
 * Training sessions for the household — the other half of "how many children
 * will be there?" (fixtures are lib/fixtures.ts).
 *
 * Rows come from `pitch_calendar()` (SECURITY DEFINER, no booker PII —
 * members and guardians are exactly who it exists for) and availability from
 * `booking_availability`, the training counterpart of `availability`.
 */

export const SESSION_AVAILABILITY_OPTIONS: readonly Enums<"availability_status">[] = [
  "available",
  "maybe",
  "unavailable",
];

export interface SessionRow {
  booking_id: string;
  resource_name: string;
  kind: Enums<"booking_kind">;
  status: Enums<"booking_status">;
  starts_at: string;
  ends_at: string;
  label: string | null;
  team_id: string | null;
  team_name: string | null;
  shared_team_ids: string[] | null;
}

export interface SessionAvailabilityRow {
  booking_id: string;
  person_id: string;
  status: Enums<"availability_status">;
}

export interface Session {
  id: string;
  title: string;
  teamIds: string[];
  startsAt: string;
  /** "Sat 6 Sep, 09:30" — London wall clock. */
  when: string;
  resourceName: string;
  status: Enums<"booking_status">;
  respondents: FixtureRespondent[];
}

/** Every team this session is for: its own team plus any sharing teams. */
export function sessionTeamIds(row: SessionRow): string[] {
  const ids = new Set<string>();
  if (row.team_id) ids.add(row.team_id);
  for (const id of row.shared_team_ids ?? []) ids.add(id);
  return [...ids];
}

/**
 * Household players who belong to any of the session's teams — no season key
 * here (a booking has none); a live player membership on the team is the same
 * fact `is_member_of_booking()` checks before a write is allowed.
 */
export function sessionRespondentsFor(
  row: SessionRow,
  household: HouseholdMember[],
  memberships: PlayerMembership[],
  availability: Map<string, Enums<"availability_status">>,
): FixtureRespondent[] {
  const teams = new Set(sessionTeamIds(row));
  return household.flatMap<FixtureRespondent>((member) => {
    const plays = memberships.some(
      (m) => m.personId === member.personId && teams.has(m.teamId),
    );
    if (!plays) return [];
    return [
      {
        personId: member.personId,
        label: member.isSelf ? "You" : member.name,
        status: availability.get(`${row.booking_id}:${member.personId}`) ?? null,
      },
    ];
  });
}

export function indexSessionAvailability(
  rows: SessionAvailabilityRow[],
): Map<string, Enums<"availability_status">> {
  return new Map(rows.map((row) => [`${row.booking_id}:${row.person_id}`, row.status]));
}

/**
 * Upcoming training sessions the household is part of, soonest first. Only
 * `training` bookings become sessions — matches live on the fixtures list,
 * maintenance closures and hires are nobody's attendance question.
 */
export function toSessions(
  rows: SessionRow[],
  household: HouseholdMember[],
  memberships: PlayerMembership[],
  availabilityRows: SessionAvailabilityRow[],
): Session[] {
  const availability = indexSessionAvailability(availabilityRows);
  return rows
    .filter((row) => row.kind === "training")
    .map<Session>((row) => ({
      id: row.booking_id,
      title: row.label ?? row.team_name ?? "Training",
      teamIds: sessionTeamIds(row),
      startsAt: row.starts_at,
      when: clubDateTime(row.starts_at),
      resourceName: row.resource_name,
      status: row.status,
      respondents: sessionRespondentsFor(row, household, memberships, availability),
    }))
    .filter((session) => session.respondents.length > 0)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export { availabilityLabel };
