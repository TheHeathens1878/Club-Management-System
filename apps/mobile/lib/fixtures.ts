import type { Enums } from "@club/db";

import { clubDateTime, humaniseEnum } from "./format";
import type { HouseholdMember } from "./household";

/**
 * Shaping for the fixtures tab. Pure — tested in lib/fixtures.test.ts.
 *
 * The pitch is the point of this screen: fixtures arrive from Full-Time with
 * no venue, and P2.5 allocates one later. Until `venue_resource_id` is set the
 * card must say so rather than leave a blank line, so a parent can tell
 * "no pitch yet" from "we forgot to show it".
 */

export const PITCH_TBC = "Pitch TBC";

/** A `fixtures` row with its team and (once allocated) its pitch resource. */
export interface FixtureRow {
  id: string;
  team_id: string;
  season_id: string;
  opponent: string;
  is_home: boolean;
  kickoff_at: string;
  competition: string | null;
  status: Enums<"fixture_status">;
  venue_resource_id: string | null;
  venue_text: string | null;
  teams: { id: string; name: string } | null;
  resources: { id: string; name: string } | null;
}

/** An `availability` row for someone in the household. */
export interface AvailabilityRow {
  fixture_id: string;
  person_id: string;
  status: Enums<"availability_status">;
}

/** Who in the household may answer for this fixture, and what they said. */
export interface FixtureRespondent {
  personId: string;
  label: string;
  status: Enums<"availability_status"> | null;
}

export interface Fixture {
  id: string;
  teamId: string;
  seasonId: string;
  teamName: string;
  opponent: string;
  isHome: boolean;
  kickoffAt: string;
  /** "Sat 6 Sep · 10:30", always Europe/London. */
  kickoff: string;
  competition: string | null;
  status: Enums<"fixture_status">;
  /** The allocated pitch, or `PITCH_TBC` for a home fixture with none yet. */
  venue: string;
  /** False while a home fixture is waiting on P2.5's allocation. */
  venueAllocated: boolean;
  respondents: FixtureRespondent[];
}

export const AVAILABILITY_OPTIONS: readonly Enums<"availability_status">[] = [
  "available",
  "maybe",
  "unavailable",
] as const;

const AVAILABILITY_LABELS: Record<Enums<"availability_status">, string> = {
  available: "Available",
  maybe: "Maybe",
  unavailable: "Unavailable",
};

export function availabilityLabel(
  status: Enums<"availability_status"> | null,
): string {
  return status ? AVAILABILITY_LABELS[status] : "No answer";
}

/** "Home" / "Away", the thing a parent reads first. */
export function venueSide(isHome: boolean): string {
  return isHome ? "Home" : "Away";
}

/**
 * Where the fixture is played. A home fixture shows the allocated pitch, or
 * `PITCH_TBC` until P2.5 has allocated one; an away fixture shows whatever
 * Full-Time gave us, and otherwise just says it is away.
 */
export function fixtureVenue(row: FixtureRow): {
  venue: string;
  allocated: boolean;
} {
  const pitch = row.resources?.name?.trim();
  if (pitch) return { venue: pitch, allocated: true };

  const text = row.venue_text?.trim();
  if (text) return { venue: text, allocated: !row.is_home };

  return row.is_home
    ? { venue: PITCH_TBC, allocated: false }
    : { venue: "Away — venue to be confirmed", allocated: false };
}

/** "Home · Pitch 1 · League" — the secondary line on a fixture card. */
export function describeFixture(fixture: Fixture): string {
  const parts = [venueSide(fixture.isHome), fixture.venue];
  if (fixture.competition) parts.push(fixture.competition);
  if (fixture.status !== "scheduled") parts.push(humaniseEnum(fixture.status));
  return parts.join(" · ");
}

/** `${fixtureId}:${personId}` — the key availability is indexed by. */
export function availabilityKey(fixtureId: string, personId: string): string {
  return `${fixtureId}:${personId}`;
}

export function indexAvailability(
  rows: AvailabilityRow[],
): Map<string, Enums<"availability_status">> {
  const index = new Map<string, Enums<"availability_status">>();
  for (const row of rows) {
    index.set(availabilityKey(row.fixture_id, row.person_id), row.status);
  }
  return index;
}

/**
 * Only a registered player of the fixture's team and season may have an
 * availability row — the `availability_guard()` trigger enforces exactly this,
 * so the UI must not offer a toggle the database will reject.
 */
export interface PlayerMembership {
  personId: string;
  teamId: string;
  seasonId: string;
}

export function respondentsFor(
  row: FixtureRow,
  household: HouseholdMember[],
  memberships: PlayerMembership[],
  availability: Map<string, Enums<"availability_status">>,
): FixtureRespondent[] {
  return household.flatMap<FixtureRespondent>((member) => {
    const plays = memberships.some(
      (m) =>
        m.personId === member.personId &&
        m.teamId === row.team_id &&
        m.seasonId === row.season_id,
    );
    if (!plays) return [];
    return [
      {
        personId: member.personId,
        label: member.isSelf ? "You" : member.name,
        status:
          availability.get(availabilityKey(row.id, member.personId)) ?? null,
      },
    ];
  });
}

/**
 * Upcoming fixtures, soonest first. Cancelled fixtures stay in the list — a
 * parent needs to see that the game they were driving to is off — but a
 * fixture already played drops out.
 */
export function toFixtures(
  rows: FixtureRow[],
  household: HouseholdMember[],
  memberships: PlayerMembership[],
  availabilityRows: AvailabilityRow[],
): Fixture[] {
  const availability = indexAvailability(availabilityRows);

  return rows
    .filter((row) => row.status !== "played" && row.status !== "abandoned")
    .map<Fixture>((row) => {
      const { venue, allocated } = fixtureVenue(row);
      return {
        id: row.id,
        teamId: row.team_id,
        seasonId: row.season_id,
        teamName: row.teams?.name ?? "Your team",
        opponent: row.opponent,
        isHome: row.is_home,
        kickoffAt: row.kickoff_at,
        kickoff: clubDateTime(row.kickoff_at),
        competition: row.competition,
        status: row.status,
        venue,
        venueAllocated: allocated,
        respondents: respondentsFor(row, household, memberships, availability),
      };
    })
    .sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt));
}

/** "Sale AoM U12 v Wilmslow" / "Wilmslow v Sale AoM U12". */
export function fixtureTitle(fixture: Fixture): string {
  return fixture.isHome
    ? `${fixture.teamName} v ${fixture.opponent}`
    : `${fixture.opponent} v ${fixture.teamName}`;
}
