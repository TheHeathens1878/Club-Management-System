-- =============================================================================
-- Editing an event (20260825130000)
-- =============================================================================
--   A  a member of the team who is not staff is refused
--   B  the team's coach edits the name, the type and the time
--   C  a fixture-mirrored event is refused - the fixture is the master record
--   D  a cancelled event and a past event are refused
--   E  the pitch booking moves with the event
--   F  a new time is "the details have changed": the household is told
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(10);

insert into auth.users (id, email, raw_user_meta_data) values
  ('ee1e1e1e-bbbb-4111-8111-000000000001', 'ee-coach@test.invalid',  '{"full_name": "Cy Coach", "dob": "1982-02-02"}'::jsonb),
  ('ee1e1e1e-bbbb-4111-8111-000000000002', 'ee-parent@test.invalid', '{"full_name": "Pam Parent", "dob": "1985-03-03"}'::jsonb);
select set_config('ee.coach',  (select person_id::text from public.profiles where id = 'ee1e1e1e-bbbb-4111-8111-000000000001'), true);
select set_config('ee.parent', (select person_id::text from public.profiles where id = 'ee1e1e1e-bbbb-4111-8111-000000000002'), true);

insert into public.people (id, first_name, last_name, dob)
  values ('ee1e1e1e-bbbb-4111-8111-00000000000a', 'Kid', 'Player', (current_date - interval '10 years')::date);
insert into public.guardianships (guardian_person_id, child_person_id, relationship)
  values (current_setting('ee.parent')::uuid, 'ee1e1e1e-bbbb-4111-8111-00000000000a', 'parent');

insert into public.seasons (id, name, starts_on, ends_on, is_current)
  values ('5e5e5e5e-bbbb-4111-8111-000000000001', 'EE 2052/53', current_date - 30, current_date + 300, true);
insert into public.teams (id, name, age_group)
  values ('9e9e9e9e-bbbb-4111-8111-000000000001', 'EE Rovers', 'U11');
insert into public.resources (id, type, name, active) values
  ('7e7e7e7e-bbbb-4111-8111-000000000001', 'pitch', 'EE Pitch 1', true),
  ('7e7e7e7e-bbbb-4111-8111-000000000002', 'pitch', 'EE Pitch 2', true);
insert into public.team_memberships (person_id, team_id, season_id, role) values
  (current_setting('ee.coach')::uuid,  '9e9e9e9e-bbbb-4111-8111-000000000001', '5e5e5e5e-bbbb-4111-8111-000000000001', 'coach'),
  (current_setting('ee.parent')::uuid, '9e9e9e9e-bbbb-4111-8111-000000000001', '5e5e5e5e-bbbb-4111-8111-000000000001', 'player'),
  ('ee1e1e1e-bbbb-4111-8111-00000000000a', '9e9e9e9e-bbbb-4111-8111-000000000001', '5e5e5e5e-bbbb-4111-8111-000000000001', 'player');

insert into public.fixtures (id, team_id, season_id, opponent, is_home, kickoff_at)
  values ('f7f7f7f7-bbbb-4111-8111-000000000001', '9e9e9e9e-bbbb-4111-8111-000000000001',
          '5e5e5e5e-bbbb-4111-8111-000000000001', 'Foe FC', true, now() + interval '20 days');


-- The coach's three events: a plain practice, one holding a pitch, and one in
-- the past.
set local request.jwt.claims to '{"sub":"ee1e1e1e-bbbb-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select set_config('ee.plain', public.create_team_event(
  '9e9e9e9e-bbbb-4111-8111-000000000001', 'practice', 'Tuesday practice',
  now() + interval '5 days', 60, null, 'The rec')::text, true);
select set_config('ee.booked', public.create_team_event(
  '9e9e9e9e-bbbb-4111-8111-000000000001', 'practice', 'Booked practice',
  now() + interval '6 days', 60, '7e7e7e7e-bbbb-4111-8111-000000000001', null, null, true)::text, true);
select set_config('ee.past', public.create_team_event(
  '9e9e9e9e-bbbb-4111-8111-000000000001', 'social', 'Last month''s quiz',
  now() - interval '30 days', 120, null, 'The clubhouse')::text, true);
select set_config('ee.gone', public.create_team_event(
  '9e9e9e9e-bbbb-4111-8111-000000000001', 'practice', 'Called off',
  now() + interval '7 days', 60, null, 'The rec')::text, true);
select public.cancel_team_event(current_setting('ee.gone')::uuid);
reset role;


-- A. a player's parent is not staff ------------------------------------------------
set local request.jwt.claims to '{"sub":"ee1e1e1e-bbbb-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_like($$
  select public.update_team_event(current_setting('ee.plain')::uuid, 'practice', 'Renamed by a parent',
    now() + interval '5 days', 60, null, 'The rec')
$$, '%staff or a club admin%', 'a parent on the team cannot edit its events');
reset role;


-- B / C / D / E. the coach ------------------------------------------------------------
set local request.jwt.claims to '{"sub":"ee1e1e1e-bbbb-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;

select set_config('ee.newtime', (date_trunc('hour', now()) + interval '5 days 3 hours')::text, true);
select lives_ok($$
  select public.update_team_event(current_setting('ee.plain')::uuid, 'social', 'Renamed practice',
    current_setting('ee.newtime')::timestamptz, 90, null, 'The other rec', 'Bring boots', 15)
$$, 'the team''s coach edits their own event');

select throws_like($$
  select public.update_team_event(
    (select id from public.events where fixture_id = 'f7f7f7f7-bbbb-4111-8111-000000000001'),
    'league_match', 'Hand-edited fixture', now() + interval '20 days', 90)
$$, '%mirrors a fixture%', 'a fixture-mirrored event is edited through its fixture');

select throws_like($$
  select public.update_team_event(current_setting('ee.gone')::uuid, 'practice', 'Back on',
    now() + interval '7 days', 60, null, 'The rec')
$$, '%cancelled%', 'a cancelled event cannot be edited');

select throws_like($$
  select public.update_team_event(current_setting('ee.past')::uuid, 'social', 'This month''s quiz',
    now() + interval '2 days', 120, null, 'The clubhouse')
$$, '%already started%', 'a past event cannot be edited');

select lives_ok($$
  select public.update_team_event(current_setting('ee.booked')::uuid, 'practice', 'Booked practice',
    (date_trunc('hour', now()) + interval '6 days 4 hours')::timestamptz, 60,
    '7e7e7e7e-bbbb-4111-8111-000000000001')
$$, 'a booked event moves, and takes its pitch with it');
reset role;


-- What landed ---------------------------------------------------------------------------
select is((select title from public.events where id = current_setting('ee.plain')::uuid),
  'Renamed practice', 'the new name is stored');
select is((select starts_at from public.events where id = current_setting('ee.plain')::uuid),
  current_setting('ee.newtime')::timestamptz, 'and the new start time');
select is((select b.starts_at
             from public.bookings b
             join public.events e on e.booking_id = b.id
            where e.id = current_setting('ee.booked')::uuid),
  (date_trunc('hour', now()) + interval '6 days 4 hours')::timestamptz,
  'the pitch booking moved with the event - the diary cannot disagree with the event');

-- F. the household is told, once ------------------------------------------------------------
select ok((select count(*) from public.outbound_messages
            where person_id = current_setting('ee.parent')::uuid
              and channel = 'in_app'
              and subject like 'Details changed:%') >= 1,
  'a new time reaches the household as "the details have changed"');

select * from finish();
rollback;
