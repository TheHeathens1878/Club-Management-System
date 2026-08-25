-- =============================================================================
-- my_capabilities() learns which teams — the role-switcher's vocabulary
-- =============================================================================
-- Adam, 2026-08-25: the "Viewing as" control becomes a dropdown of role–team
-- combinations — "Club Admin / Coach – U14 Mavericks / Parent – U14 Mavericks /
-- Coach – U18 Cobras / Parent – U18 Cobras", plus "Player – O45 Men" for a
-- playing member. The five coarse views stay; what the menu needs on top is
-- WHICH teams each hat applies to, with names, in the same single round trip.
--
-- Three arrays join the jsonb (empty arrays, never null — the reader loops
-- without a guard):
--   staff_teams   — teams where the caller holds a live coach/assistant_coach/
--                   manager membership
--   player_teams  — live player memberships of their own
--   parent_teams  — teams where a child they actively guard holds a live
--                   membership (the child's name rides along so the switcher
--                   can say who the hat is for when two children share a team)
--
-- Same discipline as before: every clause pinned to the caller's own person,
-- SECURITY DEFINER because its parts already are, a shape and not a new
-- authority. Same-signature replace — callers that ignore the new keys are
-- untouched.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n; data touched: none;
-- rollback: restore the 20260824330000 body.
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
      where g.guardian_person_id = me.person_id and g.ended_at is null),
    'staff_teams', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name)
      from (select distinct m.team_id from public.team_memberships m
            where m.person_id = me.person_id and m.left_at is null
              and m.role in ('coach', 'assistant_coach', 'manager')) s
      join public.teams t on t.id = s.team_id), '[]'::jsonb),
    'player_teams', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name)
      from (select distinct m.team_id from public.team_memberships m
            where m.person_id = me.person_id and m.left_at is null and m.role = 'player') s
      join public.teams t on t.id = s.team_id), '[]'::jsonb),
    'parent_teams', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'children', s.children) order by t.name)
      from (select m.team_id,
                   jsonb_agg(distinct p.first_name || ' ' || p.last_name) as children
            from public.guardianships g
            join public.team_memberships m on m.person_id = g.child_person_id and m.left_at is null
            join public.people p on p.id = g.child_person_id and p.deleted_at is null
            where g.guardian_person_id = me.person_id and g.ended_at is null
            group by m.team_id) s
      join public.teams t on t.id = s.team_id), '[]'::jsonb)
  )
  from me;
$$;

notify pgrst, 'reload schema';


-- =============================================================================
-- ROLLBACK (documented, not executed)
-- =============================================================================
-- Restore the function body from 20260824330000_my_capabilities.sql (drops the
-- three team arrays; nothing else changes).
