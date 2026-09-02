-- =============================================================================
-- The pitch calendar names both teams (20260902190000)
-- =============================================================================
--   A  a fixture booking that carries NO team of its own — the shape the
--      newer allocation paths create — still labels "Team v Opponent",
--      because the fixture always knows its team
--   B  and the team_id/team_name columns carry the same fallback, so the
--      "My teams" narrowing and a coach's manage link see these bookings
--   C  a fixture booking that DOES carry its team is unchanged
--   D  a training booking's label is still its occasion
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(5);

insert into auth.users (id, email, raw_user_meta_data) values
  ('bca10000-2222-4111-8111-000000000001', 'bt-coach@test.invalid', '{"full_name":"Cy Coach","dob":"1985-05-05"}'::jsonb);
select set_config('bt.coach',
  (select person_id::text from public.profiles where id = 'bca10000-2222-4111-8111-000000000001'), true);

insert into public.seasons (id, name, starts_on, ends_on) values
  ('5ca10000-2222-4111-8111-000000000001', 'BT 2044/45', '2044-08-01', '2045-05-31');
insert into public.teams (id, name) values
  ('7ca10000-2222-4111-8111-000000000001', 'BT U12 Arrows');
insert into public.team_memberships (person_id, team_id, season_id, role) values
  (current_setting('bt.coach')::uuid, '7ca10000-2222-4111-8111-000000000001',
   '5ca10000-2222-4111-8111-000000000001', 'coach');

insert into public.resources (id, type, name) values
  ('cca10000-2222-4111-8111-000000000001', 'pitch', 'BT Pitch A');

insert into public.fixtures (id, team_id, season_id, opponent, is_home, kickoff_at) values
  ('fca10000-2222-4111-8111-000000000001', '7ca10000-2222-4111-8111-000000000001',
   '5ca10000-2222-4111-8111-000000000001', 'Sale United U12 Mambas', true, '2044-09-10 10:30+01'),
  ('fca10000-2222-4111-8111-000000000002', '7ca10000-2222-4111-8111-000000000001',
   '5ca10000-2222-4111-8111-000000000001', 'Lymm Rovers U12', true, '2044-09-17 10:30+01');

-- The bug's shape: fixture_id set, team_id NOT — exactly what prod holds.
insert into public.bookings (id, resource_id, kind, status, starts_at, ends_at, fixture_id,
                             booker_name, booker_email, occasion) values
  ('bca10000-2222-4111-8111-00000000000b', 'cca10000-2222-4111-8111-000000000001', 'fixture',
   'confirmed', '2044-09-10 10:00+01', '2044-09-10 12:00+01',
   'fca10000-2222-4111-8111-000000000001', 'The Club', 'club@test.invalid',
   'BT U12 Arrows v Sale United U12 Mambas (fixture)');

-- The older shape, with the team on the booking too.
insert into public.bookings (id, resource_id, kind, status, starts_at, ends_at, fixture_id, team_id,
                             booker_name, booker_email, occasion) values
  ('bca10000-2222-4111-8111-00000000000c', 'cca10000-2222-4111-8111-000000000001', 'fixture',
   'confirmed', '2044-09-17 10:00+01', '2044-09-17 12:00+01',
   'fca10000-2222-4111-8111-000000000002', '7ca10000-2222-4111-8111-000000000001',
   'The Club', 'club@test.invalid', null);

-- And an ordinary training session, to prove its label is untouched.
insert into public.bookings (id, resource_id, kind, status, starts_at, ends_at, team_id,
                             booker_name, booker_email, occasion) values
  ('bca10000-2222-4111-8111-00000000000d', 'cca10000-2222-4111-8111-000000000001', 'training',
   'confirmed', '2044-09-12 18:00+01', '2044-09-12 19:00+01',
   '7ca10000-2222-4111-8111-000000000001', 'The Club', 'club@test.invalid', 'Tuesday training');

set local role authenticated;
set local request.jwt.claims to '{"sub":"bca10000-2222-4111-8111-000000000001","role":"authenticated"}';

select is(
  (select label from public.pitch_calendar('2044-09-01', '2044-10-01')
    where booking_id = 'bca10000-2222-4111-8111-00000000000b'),
  'BT U12 Arrows v Sale United U12 Mambas',
  'a fixture booking with no team of its own still names both teams');

select is(
  (select (team_id::text, team_name) from public.pitch_calendar('2044-09-01', '2044-10-01')
    where booking_id = 'bca10000-2222-4111-8111-00000000000b'),
  ('7ca10000-2222-4111-8111-000000000001'::text, 'BT U12 Arrows'::text),
  'and the row carries the fixture''s team, so My-teams narrowing sees it');

select is(
  (select label from public.pitch_calendar('2044-09-01', '2044-10-01')
    where booking_id = 'bca10000-2222-4111-8111-00000000000c'),
  'BT U12 Arrows v Lymm Rovers U12',
  'a fixture booking that carries its team is unchanged');

select is(
  (select label from public.pitch_calendar('2044-09-01', '2044-10-01')
    where booking_id = 'bca10000-2222-4111-8111-00000000000d'),
  'Tuesday training',
  'a training booking''s label is still its occasion');

select is(
  (select count(*) from public.pitch_calendar('2044-09-01', '2044-10-01')),
  3::bigint,
  'the coach sees exactly the three bookings on their pitch');

reset role;
set local request.jwt.claims to '{}';

select * from finish();

rollback;
