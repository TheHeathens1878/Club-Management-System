"use server";

/**
 * The sheet's way of asking for one session's roster.
 *
 * A server action rather than a prop: the week draws up to seven days of
 * teams, and preloading every roster would read the whole club's squads to
 * show a coach one register. The sheet asks when it opens.
 *
 * It is a READ, and it carries no permission of its own — `loadSessionRegister`
 * re-asks the database (`is_staff_of_booking` / `is_club_admin`) and the chosen
 * hat, and every row still comes back through the caller's own client. Nothing
 * is written here: `saveBookingAttendance` on `/pitches/[bookingId]` is
 * untouched and remains the only way a mark is made.
 */

import { loadSessionRegister, type SessionRegister } from "./training-reads";

export async function fetchSessionRegister(bookingId: string): Promise<SessionRegister> {
  return loadSessionRegister(String(bookingId ?? ""));
}
