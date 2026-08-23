import type { Enums } from "@club/db";

/**
 * The "household": the signed-in person plus every child they currently guard.
 * Everything on the fixtures, subs and teams tabs is scoped to it, because a
 * parent needs to answer for their children as well as themselves.
 *
 * Pure shaping only — the reads live in lib/use-household.ts, and RLS decides
 * what comes back. Names come from the `display_name()` RPC rather than a
 * `people` select, so the database stays the authority on who may see a name.
 */

export interface HouseholdMember {
  personId: string;
  /** From `display_name(person_id)`; falls back to a neutral label. */
  name: string;
  /** True for the signed-in person, false for a guarded child. */
  isSelf: boolean;
  relationship: Enums<"guardian_relationship"> | null;
}

/** A live `guardianships` row as selected by lib/use-household.ts. */
export interface GuardianshipRow {
  child_person_id: string;
  relationship: Enums<"guardian_relationship">;
  ended_at: string | null;
}

/** A guardianship counts only while it has not been ended (SG-1.8). */
export function isLiveGuardianship(row: GuardianshipRow): boolean {
  return row.ended_at === null;
}

/**
 * Builds the household list: self first, then children by name. Duplicate
 * children (two live guardianship rows for the same child) collapse to one.
 */
export function buildHousehold(
  selfPersonId: string,
  selfName: string,
  guardianships: GuardianshipRow[],
  childNames: Readonly<Record<string, string>>,
): HouseholdMember[] {
  const children = new Map<string, HouseholdMember>();

  for (const row of guardianships) {
    if (!isLiveGuardianship(row)) continue;
    if (row.child_person_id === selfPersonId) continue;
    if (children.has(row.child_person_id)) continue;
    children.set(row.child_person_id, {
      personId: row.child_person_id,
      name: childNames[row.child_person_id] ?? "A child in your care",
      isSelf: false,
      relationship: row.relationship,
    });
  }

  const sorted = [...children.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "en-GB"),
  );

  return [
    {
      personId: selfPersonId,
      name: selfName || "You",
      isSelf: true,
      relationship: null,
    },
    ...sorted,
  ];
}

/** Every person id in the household, for `.in("person_id", …)` filters. */
export function householdPersonIds(members: HouseholdMember[]): string[] {
  return members.map((member) => member.personId);
}

/** How to label a household member in a per-person control. */
export function memberLabel(member: HouseholdMember): string {
  return member.isSelf ? "You" : member.name;
}
