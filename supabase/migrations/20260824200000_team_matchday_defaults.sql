-- =============================================================================
-- Team match-day defaults (Adam, 2026-08-23)
-- =============================================================================
-- "Select a venue and pitch for each team; allocating fixtures should default
--  to that. Teams settings should have length of game (e.g. 2x35 min halves)
--  and default before and after (allow 10 mins for half time)."
--
--   1. teams gains: home_resource_id (the team's home pitch — venue is the
--      name prefix on resources, no separate model needed), match_halves,
--      half_length_minutes, half_time_minutes, and per-team default pre/post
--      buffers. All staff-editable (the teams_staff_update_guard restricts
--      only name/age group/status).
--   2. team_match_duration(team_id) → minutes (halves × half length + half
--      time), null while the team has no half length set.
--   3. New fixtures default duration_minutes from the team's settings instead
--      of the blanket 90 (INSERT only, and only when the incoming value IS the
--      default 90, so an admin's explicit duration and existing fixtures are
--      never touched).
--   4. allocate_fixture() buffer default chain becomes: explicit argument →
--      team default → pitch default.
--
-- Rollback: restore allocate_fixture from 20260823160000; drop trigger
-- trg_fixtures_default_duration + function fixtures_default_duration,
-- function team_match_duration; alter table teams drop the six columns.
-- =============================================================================


-- 1. Columns ------------------------------------------------------------------
alter table public.teams
  add column if not exists home_resource_id            uuid references public.resources (id) on delete set null,
  add column if not exists match_halves                integer not null default 2 check (match_halves between 1 and 4),
  add column if not exists half_length_minutes         integer check (half_length_minutes is null or half_length_minutes between 5 and 60),
  add column if not exists half_time_minutes           integer not null default 10 check (half_time_minutes between 0 and 30),
  add column if not exists default_pre_buffer_minutes  integer check (default_pre_buffer_minutes  is null or default_pre_buffer_minutes  between 0 and 120),
  add column if not exists default_post_buffer_minutes integer check (default_post_buffer_minutes is null or default_post_buffer_minutes between 0 and 120);

comment on column public.teams.home_resource_id is
  'The team''s home pitch. Fixture allocation defaults to it. The venue is the pitch name''s prefix.';
comment on column public.teams.half_length_minutes is
  'Minutes per half (e.g. 35 for 2×35). Null = not set; fixtures then default to 90 minutes.';
comment on column public.teams.half_time_minutes is
  'The half-time interval included in the pitch slot (e.g. 10).';

-- A home pitch must be a pitch.
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
  return new;
end $$;
revoke all privileges on function public.teams_home_resource_guard() from public, anon, authenticated, service_role;
drop trigger if exists trg_teams_home_resource_guard on public.teams;
create trigger trg_teams_home_resource_guard
  before insert or update of home_resource_id on public.teams
  for each row execute function public.teams_home_resource_guard();


-- 2. team_match_duration() ----------------------------------------------------
create or replace function public.team_match_duration(p_team_id uuid)
  returns integer
  language sql
  stable
  security definer
  set search_path = public
as $$
  select case when t.half_length_minutes is null then null
              else t.match_halves * t.half_length_minutes + t.half_time_minutes end
  from public.teams t where t.id = p_team_id;
$$;
revoke all privileges on function public.team_match_duration(uuid) from public, anon;
grant execute on function public.team_match_duration(uuid) to authenticated, service_role;


-- 3. Fixture duration defaults from the team ---------------------------------
create or replace function public.fixtures_default_duration()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare v integer;
begin
  -- Only an untouched default is replaced; an explicit duration wins.
  if new.duration_minutes = 90 then
    v := public.team_match_duration(new.team_id);
    if v is not null then
      new.duration_minutes := least(greatest(v, 10), 600);
    end if;
  end if;
  return new;
end $$;
revoke all privileges on function public.fixtures_default_duration() from public, anon, authenticated, service_role;
drop trigger if exists trg_fixtures_default_duration on public.fixtures;
create trigger trg_fixtures_default_duration
  before insert on public.fixtures
  for each row execute function public.fixtures_default_duration();


-- 4. allocate_fixture(): team buffers before pitch buffers --------------------
-- Body identical to 20260823160000 except the two coalesce chains.
create or replace function public.allocate_fixture(
  p_fixture_id   uuid,
  p_resource_id  uuid,
  p_pre_buffer_minutes  integer default null,
  p_post_buffer_minutes integer default null
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
  select starts_at, ends_at into v_start, v_end from public.fixture_booking_window(p_fixture_id);

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
     set booking_id = v_booking_id, venue_resource_id = p_resource_id, allocation_conflict = false
   where id = p_fixture_id;

  return v_booking_id;
end;
$$;
