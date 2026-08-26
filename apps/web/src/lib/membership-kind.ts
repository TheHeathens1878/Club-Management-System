import type { Enums } from "@club/db";

/**
 * The membership tag (Adam, 2026-08-26).
 *
 * "The system should work out whether it is an individual or family membership
 *  based on the number of players (2+ is family). Each person in that family
 *  membership (and individual) should be tagged."
 *
 * The DECISION is the database's: `membership_kind_for()` counts the players in
 * the membership's season — a live `team_memberships` player row, or a
 * pending/approved registration — and a statement trigger keeps
 * `memberships.kind` true when a second child is registered later. Nothing here
 * re-derives it; these are the words a screen puts around the answer it read.
 */

export type MembershipKind = Enums<"membership_kind">;

/** One row of `public.person_memberships`, narrowed to what the screens read. */
export type PersonMembershipRow = {
  membership_id: string | null;
  kind: MembershipKind | null;
  season_id: string | null;
  season_name: string | null;
  season_is_current: boolean | null;
  primary_person_id: string | null;
  is_primary: boolean | null;
  created_at: string | null;
};

export function membershipKindLabel(kind: MembershipKind): string {
  return kind === "family" ? "Family" : "Individual";
}

/** `Badge` variants, so the tag is one colour everywhere it appears. */
export function membershipKindVariant(kind: MembershipKind): "default" | "muted" {
  return kind === "family" ? "default" : "muted";
}

/**
 * The sentence under the badge on a member's record — the RULE, not a count.
 *
 * The player count itself is deliberately not shown: `registrations` is
 * readable by club_admin, safeguarding_lead, the subject and their guardians
 * and by nobody else, so a committee reader who is not an administrator would
 * be shown a number smaller than the truth. The badge is the database's answer
 * and the sentence says how the database reached it.
 */
export function membershipKindHint(kind: MembershipKind): string {
  return kind === "family"
    ? "Two or more players on one membership, so the club charges it as a family."
    : "One player on this membership, or none yet, so it is charged as an individual.";
}

/** "Jo and 2 others" — how many people the membership covers, not how many play. */
export function membershipPeopleSummary(count: number): string {
  if (count <= 0) return "Nobody else is on this membership.";
  return count === 1
    ? "One other person is on this membership."
    : `${count} other people are on this membership.`;
}

/**
 * Which membership a person's row should be tagged with.
 *
 * A person may sit on one membership per season and the view returns every one
 * of them, so a screen showing a single badge has to choose. The current season
 * wins; failing that the newest membership does; a row with no `created_at` is
 * treated as the oldest rather than being allowed to sort unpredictably.
 */
export function currentMembership<T extends PersonMembershipRow>(rows: T[]): T | null {
  if (rows.length === 0) return null;
  const current = rows.filter((row) => row.season_is_current === true);
  const pool = current.length > 0 ? current : rows;
  return pool.reduce((best, row) =>
    (row.created_at ?? "") > (best.created_at ?? "") ? row : best,
  );
}

/** The CSV cell and the `title=` text: "Family" alone is ambiguous out of context. */
export function membershipKindWord(kind: MembershipKind | null | undefined): string {
  if (!kind) return "";
  return kind === "family" ? "Family membership" : "Individual membership";
}
