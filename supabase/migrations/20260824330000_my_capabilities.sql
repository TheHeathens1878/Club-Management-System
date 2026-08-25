-- =============================================================================
-- my_capabilities() — the whole nav in one round trip
-- =============================================================================
-- Adam, 2026-08-25: "It's very slow to navigate, quite unresponsive."
--
-- The signed-in shell asked the database the same handful of questions one at a
-- time, on every navigation: current_person_id(), is_club_admin(),
-- is_safeguarding_lead(), a waiting_list_access count, then person_roles,
-- team_memberships and guardianships. Seven round trips for one menu, on top of
-- the auth call — and the app's functions were running in a different
-- continent from its database (fixed separately by pinning the Vercel region to
-- London), so each of those was ~160ms rather than ~10ms.
--
-- This is the same set of answers, computed once, in one call. It is NOT a new
-- authority: every clause is the same predicate the individual accessors use,
-- so nothing widens. The per-question accessors stay — other screens use them,
-- and SECURITY DEFINER helpers like is_club_admin() are called from RLS
-- policies where a jsonb blob would be useless.
--
-- SECURITY DEFINER for the same reason its parts are: current_person_id() and
-- the role helpers already are, and the three table reads below are all pinned
-- to the caller's own person id — never a wildcard that an administrator's own
-- policies would answer for the whole club.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n (no policy changes, no new
-- tables); data touched: none; rollback: drop function.
-- =============================================================================

create or replace function public.my_capabilities()
  returns jsonb
  language sql
  stable
  security definer
  set search_path = public
as $$
  with me as (select public.current_person_id() as person_id)
  select jsonb_build_object(
    'person_id', me.person_id,
    'is_club_admin', public.is_club_admin(),
    'is_safeguarding_lead', public.is_safeguarding_lead(),
    'has_waiting_list_access', exists (
      select 1 from public.waiting_list_access w where w.person_id = me.person_id),
    'has_coach_role', exists (
      select 1 from public.person_roles r
      where r.person_id = me.person_id and r.revoked_at is null and r.role = 'coach'),
    'has_parent_role', exists (
      select 1 from public.person_roles r
      where r.person_id = me.person_id and r.revoked_at is null and r.role = 'parent'),
    'is_team_staff', exists (
      select 1 from public.team_memberships m
      where m.person_id = me.person_id and m.left_at is null
        and m.role in ('coach', 'assistant_coach', 'manager')),
    'has_player_membership', exists (
      select 1 from public.team_memberships m
      where m.person_id = me.person_id and m.left_at is null and m.role = 'player'),
    'is_guardian', exists (
      select 1 from public.guardianships g
      where g.guardian_person_id = me.person_id and g.ended_at is null)
  )
  from me;
$$;

comment on function public.my_capabilities() is
  'Every answer the signed-in nav needs, in one call. The same predicates as the individual accessors — a shape, not a new authority.';

revoke all privileges on function public.my_capabilities() from public, anon;
grant execute on function public.my_capabilities() to authenticated, service_role;

notify pgrst, 'reload schema';


-- =============================================================================
-- ROLLBACK (documented, not executed)
-- =============================================================================
-- drop function public.my_capabilities();  -- the app falls back to the
-- individual accessors, which are unchanged.
