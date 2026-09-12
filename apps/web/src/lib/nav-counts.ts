/**
 * How many things are waiting behind a menu entry.
 *
 * Adam, 2026-09-02: "in approvals and registrations, there should be a number
 * icon showing how many are waiting (club admin)." A queue nobody can see the
 * depth of is a queue nobody opens — the whole reason his two role requests
 * went unnoticed this morning was that /approvals looked the same empty as
 * full.
 *
 * WHAT EACH NUMBER COUNTS. The badge has to agree with the page it sits on, or
 * it is worse than nothing:
 *
 *   · APPROVALS is the two queues /approvals actually decides — pending
 *     `account_requests` (somebody asking for a hat) and pending
 *     `team_membership_leave_requests` ("this player has left"). It does NOT
 *     include registrations, even though that page shows a banner pointing at
 *     them, because they are counted separately on their own entry and one
 *     thing should not be counted twice in one menu.
 *   · REGISTRATIONS is pending `registrations` — the team applications the
 *     registrations desk approves.
 *
 * COUNTED THROUGH THE CALLER'S OWN CLIENT, with `head: true` so no rows come
 * back — only the number. `account_requests_admin_read` and the registrations
 * admin policy are what make the total the club's rather than the reader's,
 * which matters: a member has a self-read policy on `account_requests` and
 * would otherwise count their own. The nav only draws these on an entry whose
 * `allowed` is `isClubAdmin`, so the two agree, and RLS is the one that
 * decides.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type NavCounts = { approvals: number; registrations: number; roomBookings: number };

export const NO_NAV_COUNTS: NavCounts = { approvals: 0, registrations: 0, roomBookings: 0 };

/**
 * `roomBookings` (Adam, 2026-09-12: "a number bubble alongside pending
 * requests to show me there are some") is every function-room request still
 * waiting for the desk's answer — a `pending` booking request or an `enquiry`
 * — for a date that has not passed. It is what the "Waiting" tab of the list
 * shows, so the badge and the page agree. A quote is waiting on the hirer,
 * not the desk, and is not counted. Drawn for the room desk (bar, committee,
 * super user), which is a wider circle than the admin queues; the count is
 * the club's, so it is taken through the admin client behind that gate.
 */
export async function loadNavCounts(isClubAdmin: boolean, isStaff = false): Promise<NavCounts> {
  if (!isClubAdmin && !isStaff) return NO_NAV_COUNTS;

  const supabase = await createClient();
  const [requests, leavers, registrations, roomBookings] = await Promise.all([
    isClubAdmin
      ? supabase.from("account_requests").select("id", { count: "exact", head: true }).eq("status", "pending")
      : Promise.resolve({ count: 0 }),
    isClubAdmin
      ? supabase.from("team_membership_leave_requests").select("id", { count: "exact", head: true }).eq("status", "pending")
      : Promise.resolve({ count: 0 }),
    isClubAdmin
      ? supabase.from("registrations").select("id", { count: "exact", head: true }).eq("status", "pending")
      : Promise.resolve({ count: 0 }),
    isStaff ? countWaitingRoomRequests() : Promise.resolve(0),
  ]);

  // A failed count is a zero, not a crash and not a guess. This runs in the
  // layout of every signed-in page; a badge is not worth taking the app down
  // for, and a wrong number would be worse than none.
  return {
    approvals: (requests.count ?? 0) + (leavers.count ?? 0),
    registrations: registrations.count ?? 0,
    roomBookings,
  };
}

/** Requests and enquiries on the function room that the desk has not yet answered. */
export async function countWaitingRoomRequests(): Promise<number> {
  try {
    const admin = createAdminClient();
    const { data: rooms } = await admin.from("resources").select("id").eq("type", "function_room");
    const roomIds = (rooms ?? []).map((room) => room.id);
    if (roomIds.length === 0) return 0;
    const { count } = await admin
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .in("resource_id", roomIds)
      .in("status", ["pending", "enquiry"])
      .gte("starts_at", new Date().toISOString());
    return count ?? 0;
  } catch {
    return 0;
  }
}
