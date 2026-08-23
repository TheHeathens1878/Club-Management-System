-- =============================================================================
-- Gaps 8 + 10 — booking availability/attendance; team recruiting (20260824170000)
-- =============================================================================
--   A  a player sets their own availability on a training booking; a parent
--      sets it for their child; a coach sets it for a team member; nobody
--      can set it for a non-member; an unrelated login sees nothing
--   B  attendance: coach marks; player cannot; player reads own row
--   C  recruiting: anon sees recruiting teams only, contact only when shown;
--      coach may edit the recruiting block, not the name
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(18);

insert into auth.users (id, email, raw_user_meta_data) values
  ('e1e1e1e1-1111-4111-8111-000000000001', 'at-admin@test.invalid',  '{"full_name": "Ada Admin"}'::jsonb),
  ('e1e1e1e1-1111-4111-8111-000000000002', 'at-coach@test.invalid',  '{"full_name": "Cy Coach", "dob": "1980-01-01"}'::jsonb),
  ('e1e1e1e1-1111-4111-8111-000000000003', 'at-player@test.invalid', '{"full_name": "Pl Ayer", "dob": "1999-01-01"}'::jsonb),
  ('e1e1e1e1-1111-4111-8111-000000000004', 'at-parent@test.invalid', '{"full_name": "Pa Rent", "dob": "1979-01-01"}'::jsonb),
  ('e1e1e1e1-1111-4111-8111-000000000005', 'at-other@test.invalid',  '{"full_name": "Ol Other", "dob": "1979-01-01"}'::jsonb);
update public.profiles set role = 'committee' where id = 'e1e1e1e1-1111-4111-8111-000000000001';
select set_config('at.coach',  (select person_id::text from public.profiles where id = 'e1e1e1e1-1111-4111-8111-000000000002'), true);
select set_config('at.player', (select person_id::text from public.profiles where id = 'e1e1e1e1-1111-4111-8111-000000000003'), true);
select set_config('at.parent', (select person_id::text from public.profiles where id = 'e1e1e1e1-1111-4111-8111-000000000004'), true);
select set_config('at.other',  (select person_id::text from public.profiles where id = 'e1e1e1e1-1111-4111-8111-000000000005'), true);

insert into public.seasons (id, name, starts_on, ends_on, is_current) values ('5f5f5f5f-1111-4111-8111-000000000001', 'AT 2034/35', '2034-08-01', '2035-05-31', true);
insert into public.teams (id, name, age_group) values
  ('7f7f7f7f-1111-4111-8111-000000000001', 'AT Adults', 'Open'),
  ('7f7f7f7f-1111-4111-8111-000000000002', 'AT U9s', 'U9');
insert into public.people (id, first_name, last_name, dob) values ('9f9f9f9f-1111-4111-8111-000000000001', 'Kid', 'Player', '2019-01-01');
insert into public.guardianships (guardian_person_id, child_person_id, relationship) values (current_setting('at.parent')::uuid, '9f9f9f9f-1111-4111-8111-000000000001', 'parent');
insert into public.certifications (person_id, type, issued_on, expires_on, verified_at) values
  (current_setting('at.coach')::uuid, 'fa_dbs', '2026-01-01', '2037-01-01', now()),
  (current_setting('at.coach')::uuid, 'safeguarding_children', '2026-01-01', '2037-01-01', now());
insert into public.team_memberships (person_id, team_id, season_id, role) values
  (current_setting('at.coach')::uuid,  '7f7f7f7f-1111-4111-8111-000000000001', '5f5f5f5f-1111-4111-8111-000000000001', 'coach'),
  (current_setting('at.player')::uuid, '7f7f7f7f-1111-4111-8111-000000000001', '5f5f5f5f-1111-4111-8111-000000000001', 'player'),
  (current_setting('at.coach')::uuid,  '7f7f7f7f-1111-4111-8111-000000000002', '5f5f5f5f-1111-4111-8111-000000000001', 'coach'),
  ('9f9f9f9f-1111-4111-8111-000000000001', '7f7f7f7f-1111-4111-8111-000000000002', '5f5f5f5f-1111-4111-8111-000000000001', 'player');
insert into public.resources (id, type, name) values ('c1c1c1c1-1111-4111-8111-000000000031', 'pitch', 'AT Pitch');
-- one training session shared by both teams
insert into public.bookings (id, resource_id, kind, status, starts_at, ends_at, team_id, booker_name, booker_email, occasion)
values ('e2e2e2e2-1111-4111-8111-000000000001', 'c1c1c1c1-1111-4111-8111-000000000031', 'training', 'confirmed',
        '2034-09-05 18:00+01', '2034-09-05 19:00+01', '7f7f7f7f-1111-4111-8111-000000000001', 'Club', 'club@test.invalid', 'Training');
insert into public.booking_teams (booking_id, team_id) values ('e2e2e2e2-1111-4111-8111-000000000001', '7f7f7f7f-1111-4111-8111-000000000002');

-- A. availability
set local request.jwt.claims to '{"sub":"e1e1e1e1-1111-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select lives_ok($$ insert into public.booking_availability (booking_id, person_id, status) values ('e2e2e2e2-1111-4111-8111-000000000001', current_setting('at.player')::uuid, 'available') $$,
  'player sets own availability');
select throws_ok($$ insert into public.booking_availability (booking_id, person_id, status) values ('e2e2e2e2-1111-4111-8111-000000000001', current_setting('at.coach')::uuid, 'available') $$,
  '42501', null, 'player cannot set someone else''s');
reset role;

set local request.jwt.claims to '{"sub":"e1e1e1e1-1111-4111-8111-000000000004","role":"authenticated"}';
set local role authenticated;
select lives_ok($$ insert into public.booking_availability (booking_id, person_id, status, note) values ('e2e2e2e2-1111-4111-8111-000000000001', '9f9f9f9f-1111-4111-8111-000000000001', 'maybe', 'dentist') $$,
  'parent sets availability for their child (shared-team session)');
select is((select count(*) from public.booking_availability), 1::bigint, 'parent sees only their child''s row');
reset role;

set local request.jwt.claims to '{"sub":"e1e1e1e1-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.booking_availability), 2::bigint, 'coach sees both rows');
select lives_ok($$ update public.booking_availability set status = 'unavailable' where person_id = current_setting('at.player')::uuid $$, 'coach can correct a member''s availability');
select throws_ok($$ insert into public.booking_availability (booking_id, person_id, status) values ('e2e2e2e2-1111-4111-8111-000000000001', current_setting('at.other')::uuid, 'available') $$,
  '42501', null, 'availability cannot be recorded for a non-member');
reset role;

set local request.jwt.claims to '{"sub":"e1e1e1e1-1111-4111-8111-000000000005","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.booking_availability), 0::bigint, 'unrelated login sees nothing');
reset role;

-- B. attendance
set local request.jwt.claims to '{"sub":"e1e1e1e1-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select lives_ok($$ insert into public.booking_attendance (booking_id, person_id, status) values
  ('e2e2e2e2-1111-4111-8111-000000000001', current_setting('at.player')::uuid, 'present'),
  ('e2e2e2e2-1111-4111-8111-000000000001', '9f9f9f9f-1111-4111-8111-000000000001', 'late') $$, 'coach marks attendance');
reset role;
set local request.jwt.claims to '{"sub":"e1e1e1e1-1111-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select throws_ok($$ insert into public.booking_attendance (booking_id, person_id, status) values ('e2e2e2e2-1111-4111-8111-000000000001', current_setting('at.player')::uuid, 'present') $$,
  '42501', null, 'a player cannot mark attendance');
select is((select status::text from public.booking_attendance where person_id = current_setting('at.player')::uuid), 'present', 'player reads own attendance');
select is((select count(*) from public.booking_attendance), 1::bigint, 'player sees only their own row');
reset role;

-- C. recruiting
update public.teams set recruiting = true, join_type = 'trial', session_details = 'Tue 6pm', contact_name = 'Cy', contact_email = 'cy@test.invalid', show_coach_contact = false
 where id = '7f7f7f7f-1111-4111-8111-000000000002';
set local role anon;
select is((select count(*) from public.recruiting_teams()), 1::bigint, 'anon sees the one recruiting team');
select is((select (name, join_type, session_details, contact_email) from public.recruiting_teams()),
  ('AT U9s'::text, 'trial'::text, 'Tue 6pm'::text, null::text), 'contact hidden until show_coach_contact');
reset role;
update public.teams set show_coach_contact = true where id = '7f7f7f7f-1111-4111-8111-000000000002';
set local role anon;
select is((select contact_email from public.recruiting_teams()), 'cy@test.invalid', 'contact shown when allowed');
reset role;

set local request.jwt.claims to '{"sub":"e1e1e1e1-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select lives_ok($$ update public.teams set recruiting = false, join_instructions = 'Email Cy' where id = '7f7f7f7f-1111-4111-8111-000000000002' $$,
  'coach edits their team''s recruiting block');
select throws_ok($$ update public.teams set name = 'Renamed' where id = '7f7f7f7f-1111-4111-8111-000000000002' $$,
  'P0001', null, 'coach cannot rename the team');
reset role;
set local request.jwt.claims to '{"sub":"e1e1e1e1-1111-4111-8111-000000000005","role":"authenticated"}';
set local role authenticated;
update public.teams set recruiting = true where id = '7f7f7f7f-1111-4111-8111-000000000002';
reset role;
select is((select recruiting from public.teams where id = '7f7f7f7f-1111-4111-8111-000000000002'), false, 'unrelated login cannot touch the team');

select * from finish();
rollback;
