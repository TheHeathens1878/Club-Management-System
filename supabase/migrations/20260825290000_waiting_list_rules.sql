-- =============================================================================
-- Waiting list: whose list it is, and who says it is open (Adam, 2026-08-25)
-- =============================================================================
-- "Coaches should not be able to set which age groups are open for new entries
--  and advertised publicly on the waiting list. All coaches should only be able
--  to see their age group and the age group below. Message to say we aren't
--  operating a waiting list if 'Open for new entries' is not ticked."
--
-- BEFORE
--   * waiting_list_age_groups carried INSERT/UPDATE/DELETE to `authenticated`,
--     gated only by the `wl_age_groups_admin` policy. A coach's UPDATE was not
--     refused -- it matched no row under the policy's USING and wrote nothing,
--     silently; only the ON CONFLICT path of an upsert raised anything, and
--     what it raised was a bare RLS violation. Nothing said "administrators
--     only" out loud.
--   * can_view_waiting_list_age_group() OR'd three sources: club_admin, an
--     explicit waiting_list_access grant, and (since 20260825070000) the
--     coach's own U band plus the one below. So an administrator could grant a
--     coach ANY age group -- U08 to a U16 coach -- and the grant widened them
--     past the rule. The grant was the wider exception.
--   * A coach reading the desk saw "Your age groups: ..." built from
--     waiting_list_access rows only, so a coach who had the automatic band and
--     no grant row was told they had no access at all.
--
-- AFTER
--   * The settings are written through set_waiting_list_age_group() alone --
--     SECURITY DEFINER, club_admin or a readable 42501, audited. INSERT,
--     UPDATE and DELETE on waiting_list_age_groups are revoked from
--     `authenticated` outright; SELECT stays (the desk, /join and the public
--     form all read the open list). The `wl_age_groups_admin` policy is left
--     in place as the second lock.
--   * can_view_waiting_list_age_group(): a coach -- anyone who is live staff
--     (coach / assistant_coach / manager) of a team in a U band -- sees their
--     own band and the one below, and NOTHING else. A grant adds nothing for
--     them. Grants keep working for people who coach no U-band team (a
--     recruitment lead, a secretary), which is what the grant screen is for.
--     Club admins still see everything.
--   * trg_waiting_list_access_band refuses, with a readable P0001, an
--     interactive grant that would hand a coach a band outside their own + one
--     below -- so the /access screen cannot create a grant that the read rule
--     then ignores. Server-side callers (auth.uid() is null: migrate_neon,
--     seeds, cron) are exempt, as the rollover guard is.
--   * my_waiting_list_age_groups() names the bands the caller may read, so the
--     desk can tell a coach the truth without a grant row.
--
-- The "no waiting list at the moment" message is a read of
-- waiting_list_open_age_groups() in the web app -- no new flag, no new column.
--
-- PR METADATA (PLAN.md 11): migrations y; RLS y (table privileges narrowed on
-- waiting_list_age_groups, read rule for waiting-list entries/notes narrowed
-- via can_view_waiting_list_age_group); data touched: none (no row is
-- rewritten; existing waiting_list_access rows are left in place and simply
-- stop widening a coach); rollback: restore
-- can_view_waiting_list_age_group() from 20260825070000, re-grant
-- `insert, update, delete on public.waiting_list_age_groups to authenticated`,
-- and drop trg_waiting_list_access_band,
-- public.waiting_list_access_within_band(),
-- public.set_waiting_list_age_group(text, boolean, boolean, boolean),
-- public.my_waiting_list_age_groups() and
-- public.my_waiting_list_coach_bands().
-- =============================================================================

-- 1. The bands a person coaches, as numbers. One place, three callers.
create or replace function public.my_waiting_list_coach_bands()
  returns setof integer
  language sql
  stable
  security definer
  set search_path = public
as $fn$
  select distinct public.waiting_list_age_number(t.age_group)
  from public.team_memberships m
  join public.teams t on t.id = m.team_id
  where m.person_id = public.current_person_id()
    and m.left_at is null
    and m.role in ('coach', 'assistant_coach', 'manager')
    and public.waiting_list_age_number(t.age_group) is not null;
$fn$;

revoke all privileges on function public.my_waiting_list_coach_bands() from public, anon;
grant execute on function public.my_waiting_list_coach_bands() to authenticated, service_role;

-- 2. The rule. A coach is their own band and the one below -- full stop. A
--    grant only speaks for someone who coaches no U-band team.
create or replace function public.can_view_waiting_list_age_group(p_age_group text)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $fn$
  select public.is_club_admin()
      or exists (select 1 from public.my_waiting_list_coach_bands() as cb(band)
                  where public.waiting_list_age_number(p_age_group) in (cb.band, cb.band - 1))
      or (not exists (select 1 from public.my_waiting_list_coach_bands() as cb(band))
          and exists (select 1 from public.waiting_list_access a
                       where a.person_id = public.current_person_id()
                         and a.age_group = p_age_group));
$fn$;

-- 3. The bands the caller may read, named. Admins get every configured group;
--    a coach gets their band and the one below whether or not anybody has
--    entered the list yet; everyone else gets their grants.
create or replace function public.my_waiting_list_age_groups()
  returns setof text
  language sql
  stable
  security definer
  set search_path = public
as $fn$
  select t.age_group from (
    select g.age_group
      from public.waiting_list_age_groups g
     where public.is_club_admin()
    union
    select 'U' || lpad(s.n::text, 2, '0') as age_group
      from (select cb.band as n from public.my_waiting_list_coach_bands() as cb(band)
            union
            select cb.band - 1 from public.my_waiting_list_coach_bands() as cb(band)
             where cb.band - 1 >= 5) s
     where not public.is_club_admin()
    union
    select a.age_group
      from public.waiting_list_access a
     where a.person_id = public.current_person_id()
       and not public.is_club_admin()
       and not exists (select 1 from public.my_waiting_list_coach_bands() as cb(band))
  ) t
  order by 1;
$fn$;

revoke all privileges on function public.my_waiting_list_age_groups() from public, anon;
grant execute on function public.my_waiting_list_age_groups() to authenticated, service_role;

-- 4. A grant may not widen a coach. Interactive callers only: migrate_neon and
--    the seeds run with no auth.uid() and are left alone, because the read
--    rule above already ignores an out-of-band grant for a coach.
create or replace function public.waiting_list_access_within_band()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $fn$
declare
  v_bands   integer[];
  v_wanted  integer := public.waiting_list_age_number(new.age_group);
  v_allowed text;
begin
  if auth.uid() is null then
    return new;
  end if;

  select coalesce(array_agg(distinct s.b), '{}'::integer[])
    into v_bands
  from (select public.waiting_list_age_number(t.age_group) as b
        from public.team_memberships m
        join public.teams t on t.id = m.team_id
        where m.person_id = new.person_id
          and m.left_at is null
          and m.role in ('coach', 'assistant_coach', 'manager')
          and public.waiting_list_age_number(t.age_group) is not null) s;

  -- Not a coach of any U-band team: the grant is the whole of their access.
  if coalesce(array_length(v_bands, 1), 0) = 0 then
    return new;
  end if;

  if v_wanted is not null
     and exists (select 1 from unnest(v_bands) as u(band)
                  where v_wanted in (u.band, u.band - 1)) then
    return new;
  end if;

  select string_agg(x.g, ', ' order by x.g) into v_allowed
  from (select 'U' || lpad(u.band::text, 2, '0') as g from unnest(v_bands) as u(band)
        union
        select 'U' || lpad((u.band - 1)::text, 2, '0') from unnest(v_bands) as u(band)
         where u.band - 1 >= 5) x;

  raise exception
    'waiting list access: they coach a team, so they see % -- their own age group and the one below. A grant cannot widen that.',
    coalesce(v_allowed, 'nothing')
    using errcode = 'P0001';
end;
$fn$;

drop trigger if exists trg_waiting_list_access_band on public.waiting_list_access;
create trigger trg_waiting_list_access_band
  before insert or update on public.waiting_list_access
  for each row execute function public.waiting_list_access_within_band();

-- 5. Opening, closing and advertising an age group is a club administrator's
--    act and says so. The table stops taking writes from `authenticated`
--    altogether, so there is one door and it is this one.
create or replace function public.set_waiting_list_age_group(
  p_age_group              text,
  p_is_open                boolean,
  p_is_publicly_advertised boolean default false,
  p_show_coach_contact     boolean default null
)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $fn$
declare
  v_group text := btrim(coalesce(p_age_group, ''));
  v_show  boolean;
begin
  if not public.is_club_admin() then
    raise exception 'Only a club administrator can open, close or advertise a waiting list age group.'
      using errcode = '42501';
  end if;
  if v_group = '' then
    raise exception 'waiting list: choose an age group' using errcode = 'P0001';
  end if;

  -- An omitted show_coach_contact keeps whatever the group already had.
  v_show := coalesce(
    p_show_coach_contact,
    (select g.show_coach_contact from public.waiting_list_age_groups g where g.age_group = v_group),
    false);

  insert into public.waiting_list_age_groups as t
    (age_group, is_open, is_publicly_advertised, show_coach_contact)
  values (v_group, coalesce(p_is_open, false), coalesce(p_is_publicly_advertised, false),
          coalesce(v_show, false))
  on conflict (age_group) do update set
    is_open                = excluded.is_open,
    is_publicly_advertised = excluded.is_publicly_advertised,
    show_coach_contact     = excluded.show_coach_contact;

  insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, detail)
  values (auth.uid(), (select email from auth.users where id = auth.uid()),
          'waiting_list.age_group_set', 'waiting_list_age_groups', v_group,
          jsonb_build_object('is_open', coalesce(p_is_open, false),
                             'is_publicly_advertised', coalesce(p_is_publicly_advertised, false),
                             'show_coach_contact', coalesce(v_show, false)));
end;
$fn$;

revoke all privileges on function public.set_waiting_list_age_group(text, boolean, boolean, boolean) from public, anon;
grant execute on function public.set_waiting_list_age_group(text, boolean, boolean, boolean) to authenticated, service_role;

-- 6. No hand on the table but that one. SELECT stays: the desk, /join and the
--    public form all need to know which groups are open.
revoke insert, update, delete on public.waiting_list_age_groups from authenticated;

comment on function public.set_waiting_list_age_group(text, boolean, boolean, boolean) is
  'Open/close/advertise one waiting list age group. Club administrators only (42501 otherwise); the only write path to waiting_list_age_groups.';
comment on function public.can_view_waiting_list_age_group(text) is
  'May the caller read this age group''s waiting list? Club admin: everything. A coach of a U-band team: their band and the one below, and nothing else -- a grant cannot widen them. Anyone else: their waiting_list_access grants.';
comment on function public.my_waiting_list_age_groups() is
  'The waiting list age groups the caller may read, named.';

notify pgrst, 'reload schema';
