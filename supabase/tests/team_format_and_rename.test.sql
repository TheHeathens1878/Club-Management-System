-- =============================================================================
-- A team's own playing format, and renaming one (20260902150000)
-- =============================================================================
--   A  playing_format defaults to null — every existing team reads its format
--      from the age group, and the summer rollover keeps working
--   B  the four shapes the club fields are allowed; anything else is refused
--   C  a rename carries the team's message rooms with it
--   D  and its fixtures' event titles
--   E  a rename leaves a booking's occasion alone — a booking records what was
--      arranged, under the name it was arranged in
--   F  nothing else about the team moves
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(11);

insert into public.seasons (id, name, starts_on, ends_on, is_current)
  values ('50f00000-9999-4111-8111-000000000001', 'TF 2044/45', '2044-08-01', '2045-05-31', true);
insert into public.teams (id, name, age_group)
  values ('7f000000-9999-4111-8111-000000000001', 'TF Ladies', 'Open Age');

insert into auth.users (id, email, raw_user_meta_data) values
  ('7f000000-9999-4111-8111-0000000000a1', 'tf-coach@test.invalid', '{"full_name":"Cass Coach","dob":"1986-06-06"}'::jsonb),
  ('7f000000-9999-4111-8111-0000000000a2', 'tf-play@test.invalid',  '{"full_name":"Pia Player","dob":"1994-04-04"}'::jsonb);
select set_config('tf.coach',  (select person_id::text from public.profiles where id = '7f000000-9999-4111-8111-0000000000a1'), true);
select set_config('tf.player', (select person_id::text from public.profiles where id = '7f000000-9999-4111-8111-0000000000a2'), true);


-- =============================================================================
-- A / B. the format
-- =============================================================================
select is((select playing_format from public.teams where id = '7f000000-9999-4111-8111-000000000001'),
  null, 'a team starts with no format of its own — the age group answers');

select lives_ok($$
  update public.teams set playing_format = '9v9' where id = '7f000000-9999-4111-8111-000000000001'
$$, 'an adult side may be recorded as playing 9-a-side, which no age group can say');

select throws_ok($$
  update public.teams set playing_format = '6v6' where id = '7f000000-9999-4111-8111-000000000001'
$$, '23514', null, 'a shape the club has no formation for is refused');

select lives_ok($$
  update public.teams set playing_format = null where id = '7f000000-9999-4111-8111-000000000001'
$$, 'and it can be handed back to the age group');
update public.teams set playing_format = '9v9' where id = '7f000000-9999-4111-8111-000000000001';


-- =============================================================================
-- C / D / E. the rename
-- =============================================================================
-- Two live memberships make the team rooms, and a fixture makes the event.
insert into public.team_memberships (person_id, team_id, season_id, role) values
  (current_setting('tf.coach')::uuid,  '7f000000-9999-4111-8111-000000000001', '50f00000-9999-4111-8111-000000000001', 'coach'),
  (current_setting('tf.player')::uuid, '7f000000-9999-4111-8111-000000000001', '50f00000-9999-4111-8111-000000000001', 'player');

insert into public.fixtures (id, team_id, season_id, opponent, is_home, kickoff_at)
  values ('f0000000-9999-4111-8111-000000000001', '7f000000-9999-4111-8111-000000000001',
          '50f00000-9999-4111-8111-000000000001', 'Away Rovers Ladies', true, now() + interval '10 days');

select is((select title from public.events where fixture_id = 'f0000000-9999-4111-8111-000000000001'),
  'TF Ladies v Away Rovers Ladies (H)', 'the event names the team as it stands');
select ok(
  exists (select 1 from public.conversations
           where team_id = '7f000000-9999-4111-8111-000000000001' and type = 'team'
             and title like 'TF Ladies%'),
  'and so does the team room');

-- A booking under the old name, to prove it is left alone.
insert into public.resources (id, name, type, active)
  values ('7e000000-9999-4111-8111-000000000001', 'TF Park - Pitch 1', 'pitch', true);
insert into public.bookings (id, resource_id, kind, status, starts_at, ends_at, occasion, team_id, booker_name, booker_email)
  values ('b0000000-9999-4111-8111-000000000001', '7e000000-9999-4111-8111-000000000001',
          'fixture', 'confirmed', now() + interval '10 days', now() + interval '10 days 90 minutes',
          'TF Ladies v Away Rovers Ladies (fixture)', '7f000000-9999-4111-8111-000000000001', 'Club', 'tf-book@test.invalid');

update public.teams set name = 'TF Women' where id = '7f000000-9999-4111-8111-000000000001';

select ok(
  exists (select 1 from public.conversations
           where team_id = '7f000000-9999-4111-8111-000000000001' and type = 'team'
             and title like 'TF Women%'),
  'renaming the team renames its room');
select ok(
  exists (select 1 from public.conversations
           where team_id = '7f000000-9999-4111-8111-000000000001' and type = 'announcement'
             and title like 'TF Women announcements%'),
  'and its announcements room, infix and season intact');
select is((select title from public.events where fixture_id = 'f0000000-9999-4111-8111-000000000001'),
  'TF Women v Away Rovers Ladies (H)', 'and its fixtures on the calendar');
select is((select occasion from public.bookings where id = 'b0000000-9999-4111-8111-000000000001'),
  'TF Ladies v Away Rovers Ladies (fixture)',
  'but NOT the booking — that records what was arranged, under the name it was arranged in');


-- =============================================================================
-- F. nothing else moved
-- =============================================================================
select is((select playing_format from public.teams where id = '7f000000-9999-4111-8111-000000000001'),
  '9v9', 'the format survived the rename');

select * from finish();
rollback;
