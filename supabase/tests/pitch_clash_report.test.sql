-- =============================================================================
-- pitch_clash_report (20260825000000)
-- =============================================================================
--   A  the guard: not an administrator → P0001; a silly horizon → P0001
--   B  a home fixture without a booking appears under `unallocated`
--   C  a flagged fixture appears under `flagged` with its audit conflict text
--   D  one team with two overlapping bookings on DIFFERENT pitches appears
--      under `team_overlaps` — the case the GiST constraint cannot see
--   E  a fixture whose booking was shifted behind the sync trigger's back
--      appears under `out_of_step` with time_mismatch = true
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(9);

insert into auth.users (id, email, raw_user_meta_data) values
  ('c1a5c1a5-dddd-4111-8111-000000000001', 'cr-admin@test.invalid',  '{"full_name": "Ada Admin", "dob": "1974-01-01"}'::jsonb),
  ('c1a5c1a5-dddd-4111-8111-000000000002', 'cr-player@test.invalid', '{"full_name": "Pat Player", "dob": "1994-02-02"}'::jsonb);
insert into public.person_roles (person_id, role, granted_by)
  values ((select person_id from public.profiles where id = 'c1a5c1a5-dddd-4111-8111-000000000001'),
          'club_admin', 'c1a5c1a5-dddd-4111-8111-000000000001');

insert into public.seasons (id, name, starts_on, ends_on, is_current)
  values ('5ea50e50-dddd-4111-8111-000000000001', 'CR 2052/53', current_date - 30, current_date + 300, true);
insert into public.teams (id, name, age_group) values
  ('7ea77ea7-dddd-4111-8111-000000000001', 'CR United', 'U12'),
  ('7ea77ea7-dddd-4111-8111-000000000002', 'CR Rovers', 'U14');
insert into public.resources (id, type, name, active) values
  ('917c917c-dddd-4111-8111-000000000001', 'pitch', 'CR Pitch 1', true),
  ('917c917c-dddd-4111-8111-000000000002', 'pitch', 'CR Pitch 2', true);

-- B: a home fixture with no booking, next week.
insert into public.fixtures (id, team_id, season_id, opponent, is_home, kickoff_at)
  values ('f17c0000-dddd-4111-8111-000000000001', '7ea77ea7-dddd-4111-8111-000000000001',
          '5ea50e50-dddd-4111-8111-000000000001', 'Wanderers',
          true, date_trunc('hour', now()) + interval '7 days');

-- C: a flagged fixture and the audit row the sync trigger would have written.
insert into public.fixtures (id, team_id, season_id, opponent, is_home, kickoff_at)
  values ('f17c0000-dddd-4111-8111-000000000002', '7ea77ea7-dddd-4111-8111-000000000001',
          '5ea50e50-dddd-4111-8111-000000000001', 'Athletic',
          true, date_trunc('hour', now()) + interval '8 days');
update public.fixtures set allocation_conflict = true
 where id = 'f17c0000-dddd-4111-8111-000000000002';
insert into public.audit_log (action, entity, entity_id, detail)
  values ('fixtures.allocation_conflict', 'fixtures', 'f17c0000-dddd-4111-8111-000000000002',
          '{"conflicts": "Casuals 10:00-12:00 (hire)"}'::jsonb);

-- D: CR Rovers booked on both pitches at overlapping times.
insert into public.bookings (resource_id, kind, status, starts_at, ends_at, booker_name, booker_email, team_id, occasion)
  values ('917c917c-dddd-4111-8111-000000000001', 'block', 'confirmed',
          date_trunc('hour', now()) + interval '10 days',
          date_trunc('hour', now()) + interval '10 days' + interval '90 minutes',
          'CR Rovers', 'x@test.invalid', '7ea77ea7-dddd-4111-8111-000000000002', 'Training A'),
         ('917c917c-dddd-4111-8111-000000000002', 'block', 'confirmed',
          date_trunc('hour', now()) + interval '10 days' + interval '60 minutes',
          date_trunc('hour', now()) + interval '10 days' + interval '150 minutes',
          'CR Rovers', 'x@test.invalid', '7ea77ea7-dddd-4111-8111-000000000002', 'Training B');

-- E: an allocated fixture whose booking is then shifted with the managed flag
-- set, exactly the bypass the report exists to catch.
insert into public.fixtures (id, team_id, season_id, opponent, is_home, kickoff_at)
  values ('f17c0000-dddd-4111-8111-000000000003', '7ea77ea7-dddd-4111-8111-000000000002',
          '5ea50e50-dddd-4111-8111-000000000001', 'Casuals',
          true, date_trunc('hour', now()) + interval '14 days');
select public.allocate_fixture('f17c0000-dddd-4111-8111-000000000003',
                               '917c917c-dddd-4111-8111-000000000001');
select set_config('app.fixture_booking_managed', 'true', true);
update public.bookings
   set starts_at = starts_at + interval '30 minutes',
       ends_at   = ends_at   + interval '30 minutes'
 where id = (select booking_id from public.fixtures
             where id = 'f17c0000-dddd-4111-8111-000000000003');
select set_config('app.fixture_booking_managed', '', true);

-- --- A: the guard ------------------------------------------------------------
set local request.jwt.claims to '{"sub":"c1a5c1a5-dddd-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$ select public.pitch_clash_report() $$,
  'P0001', 'pitch_clash_report: the clashes report is for administrators',
  'a player is refused the report');

set local request.jwt.claims to '{"sub":"c1a5c1a5-dddd-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$ select public.pitch_clash_report(0) $$,
  'P0001', 'pitch_clash_report: the horizon must be between 1 and 365 days',
  'a zero-day horizon is refused');
select lives_ok(
  $$ select public.pitch_clash_report(30) $$,
  'an administrator gets the report');

-- --- B–E: the four sections --------------------------------------------------
select set_config('cr.report', public.pitch_clash_report(30)::text, true);

select ok(
  (current_setting('cr.report')::jsonb -> 'unallocated')
    @> '[{"fixture_id": "f17c0000-dddd-4111-8111-000000000001"}]'::jsonb,
  'the bookingless home fixture is listed under unallocated');

select ok(
  (current_setting('cr.report')::jsonb -> 'flagged')
    @> '[{"fixture_id": "f17c0000-dddd-4111-8111-000000000002"}]'::jsonb,
  'the flagged fixture is listed under flagged');
select is(
  (select x ->> 'conflicts' from jsonb_array_elements(current_setting('cr.report')::jsonb -> 'flagged') x
    where x ->> 'fixture_id' = 'f17c0000-dddd-4111-8111-000000000002'),
  'Casuals 10:00-12:00 (hire)',
  'the flagged fixture carries its latest audit conflict text');

select is(
  jsonb_array_length(current_setting('cr.report')::jsonb -> 'team_overlaps'),
  1,
  'exactly one team-in-two-places pair is found');
select is(
  (select x -> 'first' ->> 'pitch_name'
     from jsonb_array_elements(current_setting('cr.report')::jsonb -> 'team_overlaps') x limit 1),
  'CR Pitch 1',
  'the overlap pair names the pitches');

select ok(
  (select (x ->> 'time_mismatch')::boolean
     from jsonb_array_elements(current_setting('cr.report')::jsonb -> 'out_of_step') x
    where x ->> 'fixture_id' = 'f17c0000-dddd-4111-8111-000000000003'),
  'the shifted booking is listed under out_of_step as a time mismatch');

select * from finish();
rollback;
