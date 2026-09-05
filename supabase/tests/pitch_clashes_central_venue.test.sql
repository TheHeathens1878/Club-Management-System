-- =============================================================================
-- The clashes report skips central-venue teams (20260905140000)
-- =============================================================================
--   A  a home fixture for a team with no pitch of ours waits for one
--   B  a home fixture for a central-venue team does not — it never will
--   C  the waiting row carries the team's home pitch id, the flagged row its
--      current pitch id, so the report page can offer the allocator
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(7);

insert into auth.users (id, email, raw_user_meta_data) values
  ('c2a5c2a5-dddd-4111-8111-000000000001', 'cv-admin@test.invalid', '{"full_name": "Ada Admin", "dob": "1974-01-01"}'::jsonb);
insert into public.person_roles (person_id, role, granted_by)
  values ((select person_id from public.profiles where id = 'c2a5c2a5-dddd-4111-8111-000000000001'),
          'club_admin', 'c2a5c2a5-dddd-4111-8111-000000000001');

insert into public.seasons (id, name, starts_on, ends_on, is_current)
  values ('5ea50e50-eeee-4111-8111-000000000001', 'CV 2052/53', current_date - 30, current_date + 300, true);
insert into public.resources (id, type, name, active) values
  ('917c917c-eeee-4111-8111-000000000001', 'pitch', 'CV Pitch 1', true);
insert into public.teams (id, name, age_group, home_resource_id) values
  ('7ea77ea7-eeee-4111-8111-000000000001', 'CV Home', 'U12', '917c917c-eeee-4111-8111-000000000001');
insert into public.teams (id, name, age_group, central_venue_name) values
  ('7ea77ea7-eeee-4111-8111-000000000002', 'CV Central', 'U14', 'Partington Sports Village');

-- One home fixture each, next week.
insert into public.fixtures (id, team_id, season_id, opponent, is_home, kickoff_at) values
  ('f17c0000-eeee-4111-8111-000000000001', '7ea77ea7-eeee-4111-8111-000000000001',
   '5ea50e50-eeee-4111-8111-000000000001', 'Wanderers', true, date_trunc('hour', now()) + interval '7 days'),
  ('f17c0000-eeee-4111-8111-000000000002', '7ea77ea7-eeee-4111-8111-000000000002',
   '5ea50e50-eeee-4111-8111-000000000001', 'Athletic',  true, date_trunc('hour', now()) + interval '7 days');

-- A flagged one on the home team, allocated then marked as a refused move.
insert into public.fixtures (id, team_id, season_id, opponent, is_home, kickoff_at) values
  ('f17c0000-eeee-4111-8111-000000000003', '7ea77ea7-eeee-4111-8111-000000000001',
   '5ea50e50-eeee-4111-8111-000000000001', 'Casuals', true, date_trunc('hour', now()) + interval '9 days');
select public.allocate_fixture('f17c0000-eeee-4111-8111-000000000003', '917c917c-eeee-4111-8111-000000000001');
update public.fixtures set allocation_conflict = true where id = 'f17c0000-eeee-4111-8111-000000000003';

set local request.jwt.claims to '{"sub":"c2a5c2a5-dddd-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select set_config('cv.report', public.pitch_clash_report(30)::text, true);
reset role;

-- A
select is(
  (select count(*) from jsonb_array_elements(current_setting('cv.report')::jsonb -> 'unallocated') u
    where u ->> 'fixture_id' = 'f17c0000-eeee-4111-8111-000000000001'),
  1::bigint, 'the home team''s fixture is waiting for a pitch');

-- B
select is(
  (select count(*) from jsonb_array_elements(current_setting('cv.report')::jsonb -> 'unallocated') u
    where u ->> 'fixture_id' = 'f17c0000-eeee-4111-8111-000000000002'),
  0::bigint, 'the central-venue team''s fixture is not — it never needs one of ours');
select is(
  (select count(*) from jsonb_array_elements(current_setting('cv.report')::jsonb -> 'unallocated') u
    where u ->> 'team_id' = '7ea77ea7-eeee-4111-8111-000000000002'),
  0::bigint, 'nothing of that team''s appears in the waiting list at all');

-- C
select is(
  (select u ->> 'home_resource_id' from jsonb_array_elements(current_setting('cv.report')::jsonb -> 'unallocated') u
    where u ->> 'fixture_id' = 'f17c0000-eeee-4111-8111-000000000001'),
  '917c917c-eeee-4111-8111-000000000001', 'the waiting row names the team''s home pitch by id');
select is(
  (select u ->> 'home_pitch_name' from jsonb_array_elements(current_setting('cv.report')::jsonb -> 'unallocated') u
    where u ->> 'fixture_id' = 'f17c0000-eeee-4111-8111-000000000001'),
  'CV Pitch 1', 'and by name, as before');
select is(
  (select x ->> 'venue_resource_id' from jsonb_array_elements(current_setting('cv.report')::jsonb -> 'flagged') x
    where x ->> 'fixture_id' = 'f17c0000-eeee-4111-8111-000000000003'),
  '917c917c-eeee-4111-8111-000000000001', 'a flagged row names its current pitch by id');
select is(
  (select x ->> 'team_id' from jsonb_array_elements(current_setting('cv.report')::jsonb -> 'flagged') x
    where x ->> 'fixture_id' = 'f17c0000-eeee-4111-8111-000000000003'),
  '7ea77ea7-eeee-4111-8111-000000000001', 'and its team, so the page can link into the fixture');

select * from finish();
rollback;
