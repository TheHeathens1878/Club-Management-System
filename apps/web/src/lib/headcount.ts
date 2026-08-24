/**
 * "How many children will be there?" — the one aggregation both event kinds
 * share (fixtures read `availability`, team bookings read
 * `booking_availability`; the rows carry the same shape).
 *
 * The denominator is the squad: live PLAYER memberships only. Coaches and
 * managers answer for themselves too, but the question the club asked is a
 * headcount of children, so staff answers never inflate the numbers.
 */

export type AvailabilityStatusLike = "available" | "unavailable" | "maybe";

export type Headcount = {
  going: number;
  notGoing: number;
  maybe: number;
  unanswered: number;
  /** Squad size — live players. */
  squad: number;
};

export function summariseAvailability(
  rows: readonly { person_id: string; status: AvailabilityStatusLike }[],
  playerIds: readonly string[],
): Headcount {
  const players = new Set(playerIds);
  let going = 0;
  let notGoing = 0;
  let maybe = 0;
  const answered = new Set<string>();
  for (const row of rows) {
    if (!players.has(row.person_id) || answered.has(row.person_id)) continue;
    answered.add(row.person_id);
    if (row.status === "available") going += 1;
    else if (row.status === "unavailable") notGoing += 1;
    else maybe += 1;
  }
  return {
    going,
    notGoing,
    maybe,
    unanswered: players.size - answered.size,
    squad: players.size,
  };
}

/** `5 going · 2 out · 1 maybe · 4 unanswered`, omitting empty parts. */
export function headcountLabel(h: Headcount): string {
  const parts: string[] = [`${h.going} going`];
  if (h.notGoing > 0) parts.push(`${h.notGoing} out`);
  if (h.maybe > 0) parts.push(`${h.maybe} maybe`);
  if (h.unanswered > 0) parts.push(`${h.unanswered} unanswered`);
  return parts.join(" · ");
}
