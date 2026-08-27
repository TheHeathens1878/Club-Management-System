-- =============================================================================
-- A team's staff may delete their own team's fixtures
-- =============================================================================
-- Adam, 2026-08-27: "As an admin and coach, I should be able to delete
-- previously created fixtures."
--
-- `fixtures_admin_delete` (for delete using is_club_admin()) was the only
-- delete policy, so #203's Delete button was offered to club administrators
-- alone. A coach who has entered a friendly twice, or who is looking at one of
-- the phantom imports #204/#206 flagged, had to ask an administrator to remove
-- a row on their own team's page.
--
-- `fixtures_staff_delete` adds exactly that: `is_team_staff(team_id)`, the same
-- test `fixtures_staff_update` already uses to decide which fixtures a coach
-- may write. Policies are OR'd, so administrators are unaffected. Nothing else
-- widens: a coach still sees and writes only their own team's rows.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--   It does not carve out league fixtures. Deleting a game Full-Time still
--   publishes is not destructive so much as futile — the next import creates
--   it again from the same external_ref — but the CASCADE takes the team
--   sheet, the availability answers and the match stats with it, and those do
--   not come back. The screen says so plainly rather than the database
--   refusing, because the coach is the person who knows whether the game is
--   real; and there is a genuine case for it, which is the phantom fixture the
--   importer flagged and would not remove.
--
--   The other side of an INTERNAL match stays a club administrator's to
--   remove. A coach staffs one of the two teams, so a delete of both sides
--   would silently take only theirs and leave the other team's page pointing
--   at nothing. `delete_fixture` refuses that case in words instead.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS **yes — one new DELETE policy
-- on public.fixtures**; data touched: none; rollback: §3.
-- =============================================================================

-- =============================================================================
-- 1. THE POLICY
-- =============================================================================

drop policy if exists fixtures_staff_delete on public.fixtures;

create policy fixtures_staff_delete on public.fixtures
  for delete
  to authenticated
  using (public.is_team_staff(team_id));

comment on policy fixtures_staff_delete on public.fixtures is
  'A team''s coach, assistant coach or manager may delete their own team''s fixtures (Adam, 2026-08-27). The same is_team_staff() test fixtures_staff_update uses. Club administrators keep fixtures_admin_delete.';


-- =============================================================================
-- 2. WHAT IS STILL THE CLUB'S
-- =============================================================================
-- Nothing here — stated so the next reader does not go looking. The mirrored
-- half of an internal match is refused by the application (delete_fixture),
-- not by a policy, because the refusal is about the OTHER team's row and a
-- policy on this row cannot see it. `fixtures_guard()` still refuses any
-- change to `mirror_fixture_id` from a non-administrator (20260825450000), so
-- a coach cannot point a fixture at another team's game and then delete it.


-- =============================================================================
-- 3. ROLLBACK (documented, not executed)
-- =============================================================================
--   drop policy if exists fixtures_staff_delete on public.fixtures;
-- =============================================================================
