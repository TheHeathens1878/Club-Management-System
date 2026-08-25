-- =============================================================================
-- Connected adults follow the family membership (Adam, 2026-08-25)
-- =============================================================================
-- "A connected adult may come under a family membership which will be at lead
--  contact level. They will have their own login but membership paid by
--  another adult."
--
-- 20260824470000 defined the household as "adults this login created who hold
-- no login of their own" — the join wizard's spouse. That definition loses the
-- spouse the moment their login is linked to the same person row, even though
-- nothing about the family changed: the membership still sits with the lead
-- contact who pays. The connection is the MEMBERSHIP, not the absence of a
-- login.
--
-- `my_household()` is therefore redefined (new columns — drop and recreate) as
-- the union of three shapes, each scoped hard to the caller:
--
--   * created-by-me: adults this login created who hold no login yet — the
--     20260824470000 shape, unchanged.
--   * on-my-membership: adults on a membership whose `primary_person_id` is
--     the caller (the lead contact) — WITH or WITHOUT their own login.
--     Children stay off this list; My Children is their page.
--   * my-lead: the other direction. When the caller sits on a membership they
--     do not hold, the lead contact who pays appears in THEIR list, flagged.
--
-- No season filter: a membership names the family, and the connection outlives
-- the season it was bought in. The club edits `membership_people` if a family
-- genuinely changes shape.
--
-- No write path changes. `create_membership()` still only covers the caller,
-- their guarded children and the login-less adults they created — a
-- login-holding adult arrives on a membership by being added BEFORE their
-- login existed and linked to the same person row afterwards (the invite /
-- account-request flow).
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n (no tables, no policy
-- changes; the function scopes to the caller's own memberships and creations);
-- data touched: none; rollback: drop this function and restore
-- 20260824470000's my_household().
-- =============================================================================

drop function if exists public.my_household();

create function public.my_household()
  returns table (
    person_id uuid, first_name text, last_name text,
    email text, phone text, is_adult boolean,
    has_login boolean, on_my_membership boolean, my_lead boolean
  )
  language sql
  stable
  security definer
  set search_path = public
as $$
  with me as (select public.current_person_id() as pid),
  created_by_me as (
    select p.id
    from public.people p
    where p.created_by = auth.uid()
      and p.deleted_at is null
      and not public.is_minor(p.id)
      and p.id is distinct from (select pid from me)
      and not exists (select 1 from public.profiles pr where pr.person_id = p.id)
  ),
  on_mine as (
    select mp.person_id as id
    from public.memberships m
    join public.membership_people mp on mp.membership_id = m.id
    where m.primary_person_id = (select pid from me)
      and mp.person_id <> m.primary_person_id
      and not public.is_minor(mp.person_id)
  ),
  my_leads as (
    select m.primary_person_id as id
    from public.memberships m
    join public.membership_people mp on mp.membership_id = m.id
    where mp.person_id = (select pid from me)
      and m.primary_person_id <> mp.person_id
  )
  select p.id, p.first_name, p.last_name, p.email, p.phone,
         not public.is_minor(p.id),
         exists (select 1 from public.profiles pr where pr.person_id = p.id),
         p.id in (select id from on_mine),
         p.id in (select id from my_leads)
  from public.people p
  where p.deleted_at is null
    and p.id in (
      select id from created_by_me
      union
      select id from on_mine
      union
      select id from my_leads
    )
  order by p.first_name, p.last_name;
$$;

revoke all privileges on function public.my_household() from public, anon;
grant execute on function public.my_household() to authenticated, service_role;

notify pgrst, 'reload schema';

-- ROLLBACK: drop function public.my_household(); then re-create the
-- 20260824470000 version.
