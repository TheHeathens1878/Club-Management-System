-- =============================================================================
-- Home kick-off time, central venues, bulk allocation (Adam, 2026-08-25)
-- =============================================================================
-- "On the teams page, I want the ability to allocate all fixtures to a pitch.
--  I also need the option to mark that team as playing at a central venue (not
--  managed by us) and all fixtures allocated to a central venue. In the bit on
--  Teams where you set the home venue, I want the ability to put down home KO
--  time. When allocating fixtures, the system should default to that pitch and
--  time."
--
--   1. teams gains home_kickoff_time (the usual home kick-off, London time) and
--      central_venue_name (non-null = the team plays somewhere the club does
--      not manage, so its fixtures never occupy our pitches). The two are
--      mutually exclusive with home_resource_id — a central-venue team has no
--      home pitch — and the existing home-resource guard now says so.
--   2. allocate_fixture() gains p_kickoff_time. Given, the fixture is re-timed
--      to that London wall-clock time on its own date and the booking window is
--      built from the new time; omitted (every existing caller), nothing about
--      the function changes. The old 4-argument signature is dropped so there
--      is exactly one function.
--   3. allocate_team_fixtures(team, pitch?, time?) puts every future scheduled
--      home fixture on one pitch — defaulting to the team's home pitch and
--      home kick-off — one sub-transaction per fixture, so a clash on one
--      Sunday does not undo the rest. Clashes come back by name in the result.
--   4. allocate_team_fixtures_central(team) points every future scheduled
--      fixture (home and away — at a central venue the team is never the
--      host) at the named venue and frees any pitch bookings they held.
--   5. New fixtures for a central-venue team arrive with the venue already
--      filled in (BEFORE INSERT trigger), so nightly Full-Time imports stay
--      right without re-running the bulk action.
--
-- Rollback: drop functions allocate_team_fixtures, allocate_team_fixtures_central,
-- fixtures_central_venue_default (+trigger); drop function
-- allocate_fixture(uuid, uuid, integer, integer, time) and restore the
-- 4-argument body from 20260824200000; restore teams_home_resource_guard from
-- 20260824200000 (trigger back to update of home_resource_id only); alter
-- table teams drop column home_kickoff_time, drop column central_venue_name.
-- =============================================================================


-- 1. Columns ------------------------------------------------------------------
alter table public.teams
  add column if not exists home_kickoff_time  time,
  add column if not exists central_venue_name text
    check (central_venue_name is null or btrim(central_venue_name) <> '');

comment on column public.teams.home_kickoff_time is
  'The team''s usual home kick-off (Europe/London wall clock). Allocation defaults fixtures to it.';
comment on column public.teams.central_venue_name is
  'Set = the team plays at a venue the club does not manage. Its fixtures carry this as venue_text and never book our pitches.';

-- A home pitch must be a pitch, and a central-venue team has no home pitch.
create or replace function public.teams_home_resource_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if new.home_resource_id is not null
     and not exists (select 1 from public.resources r where r.id = new.home_resource_id and r.type = 'pitch') then
    raise exception 'teams: the home pitch must be a pitch resource' using errcode = 'P0001';
  end if;
  if new.home_resource_id is not null and new.central_venue_name is not null then
    raise exception 'teams: a team playing at a central venue has no home pitch — clear one of the two' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all privileges on function public.teams_home_resource_guard() from public, anon, authenticated, service_role;
drop trigger if exists trg_teams_home_resource_guard on public.teams;
create trigger trg_teams_home_resource_guard
  before insert or update of home_resource_id, central_venue_name on public.teams
  for each row execute function public.teams_home_resource_guard();


-- 2. allocate_fixture() learns a kick-off time --------------------------------
-- Body from 20260824200000 plus: an effective kick-off (argument time on the
-- fixture's own London date, else the fixture's current time), the window
-- computed from it, and kickoff_at written in the same UPDATE as booking_id —
-- so trg_fixtures_sync_booking sees a booking already in the right place and
-- does nothing, while the events trigger moves the linked event.
drop function if exists public.allocate_fixture(uuid, uuid, integer, integer);

create function public.allocate_fixture(
  p_fixture_id   uuid,
  p_resource_id  uuid,
  p_pre_buffer_minutes  integer default null,
  p_post_buffer_minutes integer default null,
  p_kickoff_time        time    default null
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  f   public.fixtures%rowtype;
  r   public.resources%rowtype;
  t   public.teams%rowtype;
  v_pre  integer;
  v_post integer;
  v_kick  timestamptz;
  v_start timestamptz;
  v_end   timestamptz;
  v_booking_id uuid;
  v_msg text;
begin
  if auth.uid() is not null and not public.is_club_admin() then
    raise exception 'allocate_fixture: club_admin only' using errcode = '42501';
  end if;
  select * into f from public.fixtures where id = p_fixture_id;
  if not found then raise exception 'allocate_fixture: unknown fixture %', p_fixture_id using errcode = 'P0001'; end if;
  if not f.is_home then
    raise exception 'allocate_fixture: only home fixtures are allocated to a pitch' using errcode = 'P0001';
  end if;
  if f.status not in ('scheduled', 'played') then
    raise exception 'allocate_fixture: a % fixture has no pitch slot', f.status using errcode = 'P0001';
  end if;
  select * into r from public.resources where id = p_resource_id;
  if not found or r.type = 'function_room' then
    raise exception 'allocate_fixture: % is not a pitch', p_resource_id using errcode = 'P0001';
  end if;
  if not r.active then
    raise exception 'allocate_fixture: pitch "%" is inactive', r.name using errcode = 'P0001';
  end if;
  select * into t from public.teams where id = f.team_id;

  v_pre  := coalesce(p_pre_buffer_minutes,  t.default_pre_buffer_minutes,  r.default_pre_buffer_minutes);
  v_post := coalesce(p_post_buffer_minutes, t.default_post_buffer_minutes, r.default_post_buffer_minutes);

  -- The kick-off the booking is built around: the given London time on the
  -- fixture's own date, or the fixture's time as it stands.
  if p_kickoff_time is null then
    v_kick := f.kickoff_at;
  else
    v_kick := ((f.kickoff_at at time zone 'Europe/London')::date + p_kickoff_time) at time zone 'Europe/London';
  end if;
  v_start := v_kick;
  v_end   := v_kick + make_interval(mins => f.duration_minutes);

  v_msg := public.fixture_conflict_message(p_resource_id, v_start, v_end, v_pre, v_post, f.booking_id);
  if v_msg <> '' then
    raise exception 'allocate_fixture: pitch "%" is already booked: %', r.name, v_msg using errcode = '23P01';
  end if;

  if f.booking_id is null then
    insert into public.bookings (resource_id, kind, status, starts_at, ends_at, pre_buffer_minutes, post_buffer_minutes,
                                 booker_name, booker_email, occasion, fixture_id, created_by)
    values (p_resource_id, 'fixture', 'confirmed', v_start, v_end, v_pre, v_post,
            t.name, '—', format('%s v %s (%s)', t.name, f.opponent, coalesce(f.competition, 'fixture')),
            f.id, auth.uid())
    returning id into v_booking_id;
  else
    perform set_config('app.fixture_booking_managed', 'true', true);
    update public.bookings
       set resource_id = p_resource_id, starts_at = v_start, ends_at = v_end,
           pre_buffer_minutes = v_pre, post_buffer_minutes = v_post, status = 'confirmed',
           occasion = format('%s v %s (%s)', t.name, f.opponent, coalesce(f.competition, 'fixture'))
     where id = f.booking_id
    returning id into v_booking_id;
    perform set_config('app.fixture_booking_managed', '', true);
  end if;

  update public.fixtures
     set booking_id = v_booking_id, venue_resource_id = p_resource_id,
         kickoff_at = v_kick, allocation_conflict = false
   where id = p_fixture_id;

  return v_booking_id;
end;
$$;


-- 3. Allocate every home fixture at once --------------------------------------
create or replace function public.allocate_team_fixtures(
  p_team_id      uuid,
  p_resource_id  uuid default null,
  p_kickoff_time time default null
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  t public.teams%rowtype;
  f record;
  v_resource  uuid;
  v_ko        time;
  v_allocated integer := 0;
  v_total     integer := 0;
  v_conflicts jsonb := '[]'::jsonb;
begin
  if auth.uid() is not null and not public.is_club_admin() then
    raise exception 'allocate_team_fixtures: club_admin only' using errcode = '42501';
  end if;
  select * into t from public.teams where id = p_team_id;
  if not found then
    raise exception 'allocate_team_fixtures: unknown team %', p_team_id using errcode = 'P0001';
  end if;
  if t.central_venue_name is not null then
    raise exception 'allocate_team_fixtures: % plays at % — use allocate_team_fixtures_central()', t.name, t.central_venue_name
      using errcode = 'P0001';
  end if;
  v_resource := coalesce(p_resource_id, t.home_resource_id);
  if v_resource is null then
    raise exception 'allocate_team_fixtures: no pitch given and % has no home pitch', t.name using errcode = 'P0001';
  end if;
  v_ko := coalesce(p_kickoff_time, t.home_kickoff_time);

  for f in
    select id, opponent, kickoff_at from public.fixtures
    where team_id = p_team_id and is_home and status = 'scheduled' and kickoff_at >= now()
    order by kickoff_at
  loop
    v_total := v_total + 1;
    begin
      perform public.allocate_fixture(f.id, v_resource, null, null, v_ko);
      v_allocated := v_allocated + 1;
    exception when others then
      -- One taken slot must not undo the other twelve Sundays: the failure is
      -- reported by name (the database's own message) and the loop carries on.
      v_conflicts := v_conflicts || jsonb_build_object(
        'fixture_id', f.id,
        'label', format('%s v %s', to_char(f.kickoff_at at time zone 'Europe/London', 'DD/MM'), f.opponent),
        'error', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('total', v_total, 'allocated', v_allocated, 'conflicts', v_conflicts);
end;
$$;


-- 4. Point everything at the central venue ------------------------------------
create or replace function public.allocate_team_fixtures_central(p_team_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  t public.teams%rowtype;
  v_updated integer;
  v_freed   integer;
begin
  if auth.uid() is not null and not public.is_club_admin() then
    raise exception 'allocate_team_fixtures_central: club_admin only' using errcode = '42501';
  end if;
  select * into t from public.teams where id = p_team_id;
  if not found then
    raise exception 'allocate_team_fixtures_central: unknown team %', p_team_id using errcode = 'P0001';
  end if;
  if t.central_venue_name is null then
    raise exception 'allocate_team_fixtures_central: % has no central venue set', t.name using errcode = 'P0001';
  end if;

  -- Any pitch bookings the fixtures held are freed first — the venue is not
  -- ours, so nothing of the team's should sit on our calendar.
  perform set_config('app.fixture_booking_managed', 'true', true);
  with freed as (
    update public.bookings b
       set status = 'cancelled', fixture_id = null
      from public.fixtures f
     where f.team_id = p_team_id and f.status = 'scheduled' and f.kickoff_at >= now()
       and b.id = f.booking_id
    returning b.id
  )
  select count(*) into v_freed from freed;
  perform set_config('app.fixture_booking_managed', '', true);

  with pointed as (
    update public.fixtures
       set booking_id = null, venue_resource_id = null,
           venue_text = t.central_venue_name, allocation_conflict = false
     where team_id = p_team_id and status = 'scheduled' and kickoff_at >= now()
    returning id
  )
  select count(*) into v_updated from pointed;

  return jsonb_build_object('updated', v_updated, 'bookings_freed', v_freed);
end;
$$;


-- 5. New fixtures for a central-venue team arrive with the venue filled in ----
create or replace function public.fixtures_central_venue_default()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare v text;
begin
  if new.venue_text is null or btrim(new.venue_text) = '' then
    select central_venue_name into v from public.teams where id = new.team_id;
    if v is not null then
      new.venue_text := v;
    end if;
  end if;
  return new;
end $$;
revoke all privileges on function public.fixtures_central_venue_default() from public, anon, authenticated, service_role;
drop trigger if exists trg_fixtures_central_venue_default on public.fixtures;
create trigger trg_fixtures_central_venue_default
  before insert on public.fixtures
  for each row execute function public.fixtures_central_venue_default();


-- 6. Grants -------------------------------------------------------------------
revoke all privileges on function public.allocate_fixture(uuid, uuid, integer, integer, time) from public, anon;
grant execute on function public.allocate_fixture(uuid, uuid, integer, integer, time) to authenticated, service_role;
revoke all privileges on function public.allocate_team_fixtures(uuid, uuid, time) from public, anon;
grant execute on function public.allocate_team_fixtures(uuid, uuid, time) to authenticated, service_role;
revoke all privileges on function public.allocate_team_fixtures_central(uuid) from public, anon;
grant execute on function public.allocate_team_fixtures_central(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
