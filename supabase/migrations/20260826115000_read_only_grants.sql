-- =============================================================================
-- The read-only things are granted read-only, on purpose and in writing
-- =============================================================================
-- Found 2026-08-27 while three unrelated PRs went red on the same two
-- assertions:
--
--   legacy_views.test.sql          "delete through the function_rooms view is
--                                   refused (no DELETE grant)"
--   squad_leave_requests.test.sql  "a direct UPDATE is refused outright, even
--                                   to an administrator"
--
-- Both assert `42501`, and neither had anything to do with the branches that
-- failed. CI pins the Supabase CLI to `latest`, and its Postgres image moved
-- from 17.6.1.159 to 17.6.1.165 overnight; the newer image applies Supabase's
-- default privileges (`grant all on tables to anon, authenticated`) where the
-- older one did not, so the local database stopped matching what those two
-- tests assumed.
--
-- THE PART THAT MATTERS: production already looked like the NEW image, and has
-- since each object was created. `anon` and `authenticated` hold INSERT,
-- UPDATE, DELETE and TRUNCATE on 25 and 72 public objects respectively. So
-- these two tests were not protecting anything on production — they were
-- passing locally on a premise that was never true live.
--
-- NOTHING IS OR WAS EXPOSED. Checked, rather than assumed: every table in
-- `public` has row security ENABLED (zero exceptions), the four objects with
-- RLS on and no policies deny everything by definition, and both legacy views
-- are `security_invoker = true`, so a caller reaching them gets their own RLS
-- on `resources` / `bookings` underneath. RLS is the club's enforcement and it
-- holds. What went missing is the second layer behind it.
--
-- WHY NOT A BLANKET REVOKE
-- `authenticated` legitimately needs INSERT and UPDATE on most of `public` —
-- that is how the app writes anything at all through PostgREST. Revoking
-- broadly would break the club. This migration touches only objects the design
-- says are not written directly, and each one was checked against the code
-- first. In particular `team_membership_leave_requests` keeps its INSERT:
-- `membership-actions.ts` inserts the coach's "this player has left" request
-- through PostgREST as the user, under `team_membership_leave_requests`'s own
-- INSERT policy. Only UPDATE, DELETE and TRUNCATE go — the decision is taken
-- by an RPC, which is exactly what that test says.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n (no policy added, dropped or
-- altered — GRANTs only, and only narrowing); data touched: none; rollback: §3.
-- =============================================================================


-- =============================================================================
-- 1. THE LEGACY VIEWS ARE READ-ONLY (20260824100000 said so; now it is true)
-- =============================================================================
-- Frozen at the P1.6 cutover and kept under their old names so nothing that
-- still reads them breaks. Nothing writes them — checked across apps/web and
-- apps/mobile — and the unified tables are where writes belong.

revoke insert, update, delete, truncate
  on public.function_rooms, public.room_bookings,
     public.booking_payments, public.booking_emails
  from anon, authenticated;

-- SELECT is the point of them, and is left exactly as 20260824100000 granted it.


-- =============================================================================
-- 2. A LEAVE REQUEST IS RAISED BY A COACH AND DECIDED BY AN RPC
-- =============================================================================
-- INSERT stays (the coach raises it; the INSERT policy says who may).
-- The decision — approved, rejected — is taken by the RPC that also ends the
-- membership, so no direct UPDATE should exist for anybody, administrator
-- included. DELETE and TRUNCATE were never wanted.

revoke update, delete, truncate on public.team_membership_leave_requests
  from anon, authenticated;

-- `anon` has no business raising one either: a leave request names a child.
revoke insert on public.team_membership_leave_requests from anon;


-- =============================================================================
-- 3. ROLLBACK (documented, not executed)
-- =============================================================================
--   grant insert, update, delete, truncate
--     on public.function_rooms, public.room_bookings,
--        public.booking_payments, public.booking_emails
--     to anon, authenticated;
--   grant insert, update, delete, truncate
--     on public.team_membership_leave_requests to anon, authenticated;
-- Restoring these puts back Supabase's default privileges. It does not expose
-- anything by itself — RLS is what refuses — but it removes the second layer
-- again, and the two tests named at the top will go red.
-- =============================================================================
