-- =============================================================================
-- Member self-service reads — the "Me page" (Adam, 2026-08-25)
-- =============================================================================
-- "When I first login to the app, it should have a 'Me' page … Me — My
-- Profile, Connected Adults, My Children … Club — Registrations." Two
-- SECURITY DEFINER reads give those pages their data; the WRITES they sit
-- beside already exist from the join flow (`update_own_contact`,
-- `add_household_adult`, `add_child`).
--
--   * `my_household()` — the ADULTS connected to this account: people the
--     caller created at /join who have no login of their own (the
--     `is_household_member_of` shape, listed instead of checked). Children
--     are deliberately absent — My Children (`my_children()`) is their page.
--   * `my_registrations()` — every registration the caller may care for: their
--     own, their guarded children's, and their household adults'. The FORM
--     (medical answers) is deliberately not returned — this is a status list,
--     and pitch-side medical access has its own audited accessor.
--
-- PR METADATA (PLAN.md §11): migrations y; RLS n (no tables, no policy
-- changes; both functions scope to the caller's own household); data touched:
-- none; rollback: drop the two functions.
-- =============================================================================

create or replace function public.my_household()
  returns table (
    person_id uuid, first_name text, last_name text,
    email text, phone text, is_adult boolean
  )
  language sql
  stable
  security definer
  set search_path = public
as $$
  select p.id, p.first_name, p.last_name, p.email, p.phone, not public.is_minor(p.id)
  from public.people p
  where p.created_by = auth.uid()
    and p.deleted_at is null
    and not public.is_minor(p.id)
    and p.id is distinct from public.current_person_id()
    and not exists (select 1 from public.profiles pr where pr.person_id = p.id)
  order by p.first_name, p.last_name;
$$;

create or replace function public.my_registrations()
  returns table (
    registration_id uuid, person_id uuid, person_name text, is_self boolean,
    team_name text, season_name text, status text,
    submitted_at timestamptz, decided_at timestamptz
  )
  language sql
  stable
  security definer
  set search_path = public
as $$
  with me as (select public.current_person_id() as pid),
  mine as (
    select pid as person_id from me where pid is not null
    union
    select g.child_person_id from public.guardianships g, me
    where g.guardian_person_id = me.pid and g.ended_at is null
    union
    select p.id from public.people p, me
    where p.created_by = auth.uid() and p.deleted_at is null
      and not exists (select 1 from public.profiles pr where pr.person_id = p.id)
  )
  select r.id, r.person_id, p.first_name || ' ' || p.last_name,
         r.person_id = (select pid from me),
         t.name, s.name, r.status::text,
         r.created_at, r.decided_at
  from public.registrations r
  join mine on mine.person_id = r.person_id
  join public.people p on p.id = r.person_id
  join public.seasons s on s.id = r.season_id
  left join public.teams t on t.id = r.team_id
  order by r.created_at desc;
$$;

revoke all privileges on function public.my_household()      from public, anon;
revoke all privileges on function public.my_registrations()  from public, anon;
grant execute on function public.my_household(), public.my_registrations() to authenticated, service_role;

notify pgrst, 'reload schema';

-- ROLLBACK: drop function public.my_registrations(); drop function public.my_household();
