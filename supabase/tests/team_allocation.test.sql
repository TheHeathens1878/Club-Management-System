-- =============================================================================
-- Bulk allocation, home kick-off, central venues (20260824340000)
-- =============================================================================
--   A  columns + guard: central venue and home pitch are mutually exclusive
--   B  allocate_team_fixtures(): every future scheduled home fixture lands on
--      the home pitch at the home kick-off; a clash is reported, not fatal
--   C  allocate_team_fixtures_central(): fixtures point at the central venue,
--      pitch bookings are freed; new fixtures inherit the venue on insert
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(17);

insert into public.seasons (id, name, starts_on, ends_on) values
  ('6a6a6a6a-2222-4222-8222-000000000001', 'TA 2036/37', '2036-08-01', '2037-05-31');
insert into public.teams (id, name, age_group) values
  ('8a8a8a8a-2222-4222-8222-000000000001', 'TA U12s', 'U12');
insert into public.resources (id, type, name, default_pre_buffer_minutes, default_post_buffer_minutes) values
  ('b3b3b3b3-2222-4222-8222-000000000041', 'pitch', 'TA Park – Pitch 1', 15, 15);

-- A. columns + guard ----------------------------------------------------------
select has_column('public', 'teams', 'home_kickoff_time',  'teams.home_kickoff_time');
select has_column('public', 'teams', 'central_venue_name', 'teams.central_venue_name');

update public.teams
   set home_resource_id = 'b3b3b3b3-2222-4222-8222-000000000041', home_kickoff_time = '10:30'
 where id = '8a8a8a8a-2222-4222-8222-000000000001';
select throws_ok($$
  update public.teams set central_venue_name = 'Timperley Sports Club'
   where id = '8a8a8a8a-2222-4222-8222-000000000001'
$$, 'P0001', null, 'a central venue and a home pitch cannot both be set');

-- B. bulk allocation ----------------------------------------------------------
-- Two future home fixtures (09:00 as imported), one away; a training booking
-- already sits across the second fixture's 10:30 slot.
insert into public.fixtures (id, team_id, season_id, opponent, is_home, kickoff_at, source, external_ref) values
  ('c3c3c3c3-2222-4222-8222-000000000001', '8a8a8a8a-2222-4222-8222-000000000001', '6a6a6a6a-2222-4222-8222-000000000001',
   'Rovers', true,  '2036-09-06 09:00+01', 'fulltime', 'ta-1'),
  ('c3c3c3c3-2222-4222-8222-000000000002', '8a8a8a8a-2222-4222-8222-000000000001', '6a6a6a6a-2222-4222-8222-000000000001',
   'City',   true,  '2036-09-13 09:00+01', 'fulltime', 'ta-2'),
  ('c3c3c3c3-2222-4222-8222-000000000003', '8a8a8a8a-2222-4222-8222-000000000001', '6a6a6a6a-2222-4222-8222-000000000001',
   'Town',   false, '2036-09-20 09:00+01', 'fulltime', 'ta-3');
insert into public.bookings (id, resource_id, starts_at, ends_at, status, kind, occasion, booker_name, booker_email) values
  ('b4b4b4b4-2222-4222-8222-000000000001', 'b3b3b3b3-2222-4222-8222-000000000041',
   '2036-09-13 10:00+01', '2036-09-13 12:00+01', 'confirmed', 'training', 'TA blocker', 'TA Tester', 'ta@test.invalid');

select set_config('ta.res',
  public.allocate_team_fixtures('8a8a8a8a-2222-4222-8222-000000000001')::text, true);
select is((current_setting('ta.res')::jsonb->>'total')::int, 2, 'only future scheduled home fixtures are considered');
select is((current_setting('ta.res')::jsonb->>'allocated')::int, 1, 'the free Sunday is allocated');
select is(jsonb_array_length(current_setting('ta.res')::jsonb->'conflicts'), 1, 'the taken Sunday is a reported conflict');
select ok(current_setting('ta.res')::jsonb->'conflicts'->0->>'error' like '%already booked%',
  'the conflict carries the database''s own message');

select is((select kickoff_at from public.fixtures where id = 'c3c3c3c3-2222-4222-8222-000000000001'),
  '2036-09-06 10:30+01'::timestamptz, 'the fixture is re-timed to the home kick-off');
select is((select b.status::text from public.bookings b
            join public.fixtures f on f.booking_id = b.id
           where f.id = 'c3c3c3c3-2222-4222-8222-000000000001'),
  'confirmed', 'the allocated fixture holds a confirmed booking on the home pitch');
select is((select booking_id from public.fixtures where id = 'c3c3c3c3-2222-4222-8222-000000000003'),
  null::uuid, 'an away fixture is never allocated');

-- C. central venue ------------------------------------------------------------
select set_config('ta.b1',
  (select booking_id from public.fixtures where id = 'c3c3c3c3-2222-4222-8222-000000000001')::text, true);

update public.teams
   set home_resource_id = null, central_venue_name = 'Timperley Sports Club'
 where id = '8a8a8a8a-2222-4222-8222-000000000001';
select throws_ok($$
  select public.allocate_team_fixtures('8a8a8a8a-2222-4222-8222-000000000001')
$$, 'P0001', null, 'pitch allocation refuses a central-venue team by name');

select set_config('ta.cen',
  public.allocate_team_fixtures_central('8a8a8a8a-2222-4222-8222-000000000001')::text, true);
select is((current_setting('ta.cen')::jsonb->>'updated')::int, 3, 'home and away fixtures all point at the central venue');
select is((current_setting('ta.cen')::jsonb->>'bookings_freed')::int, 1, 'the pitch booking is freed');
select is((select status::text from public.bookings where id = current_setting('ta.b1')::uuid),
  'cancelled', 'the freed booking is cancelled, not deleted');
select is((select count(*) from public.fixtures
           where team_id = '8a8a8a8a-2222-4222-8222-000000000001' and venue_text = 'Timperley Sports Club'),
  3::bigint, 'every fixture carries the central venue as its venue text');
select is((select count(*) from public.fixtures
           where team_id = '8a8a8a8a-2222-4222-8222-000000000001' and booking_id is not null),
  0::bigint, 'nothing of the team''s remains on our pitch calendar');

-- A newly imported fixture arrives with the venue already filled in.
insert into public.fixtures (id, team_id, season_id, opponent, is_home, kickoff_at, source, external_ref) values
  ('c3c3c3c3-2222-4222-8222-000000000004', '8a8a8a8a-2222-4222-8222-000000000001', '6a6a6a6a-2222-4222-8222-000000000001',
   'United', true, '2036-09-27 09:00+01', 'fulltime', 'ta-4');
select is((select venue_text from public.fixtures where id = 'c3c3c3c3-2222-4222-8222-000000000004'),
  'Timperley Sports Club', 'a new fixture for a central-venue team inherits the venue');

select * from finish();
rollback;
