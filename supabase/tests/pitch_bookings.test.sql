-- =============================================================================
-- Gap 3 — pitch bookings by team (20260824110000 + 20260824120000)
-- =============================================================================
--   A  shape: training kind, bookings.team_id, booking_teams, functions
--   B  a coach (team staff, no app role) can request a pending training slot on
--      a pitch for their own team; not for another team; not confirmed; not a
--      function room; refused past slots
--   C  a coach can cancel their own team's booking but cannot confirm it or
--      move a confirmed one; an admin can confirm
--   D  visibility: a parent of a player sees pitch_calendar rows without PII;
--      an unrelated login sees nothing; booker email never in pitch_calendar
--   E  shared teams via booking_teams; GiST exclusion still applies
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(31);

-- Fixtures ---------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('b8b8b8b8-1111-4111-8111-000000000001', 'pb-admin@test.invalid',   '{"full_name": "Ada Admin"}'::jsonb),
  ('b8b8b8b8-1111-4111-8111-000000000002', 'pb-coach@test.invalid',   '{"full_name": "Cy Coach"}'::jsonb),
  ('b8b8b8b8-1111-4111-8111-000000000003', 'pb-other@test.invalid',   '{"full_name": "Ol Other"}'::jsonb),
  ('b8b8b8b8-1111-4111-8111-000000000004', 'pb-parent@test.invalid',  '{"full_name": "Pat Parent"}'::jsonb);
update public.profiles set role = 'committee' where id = 'b8b8b8b8-1111-4111-8111-000000000001';
select set_config('pb.admin',  (select person_id::text from public.profiles where id = 'b8b8b8b8-1111-4111-8111-000000000001'), true);
select set_config('pb.coach',  (select person_id::text from public.profiles where id = 'b8b8b8b8-1111-4111-8111-000000000002'), true);
select set_config('pb.other',  (select person_id::text from public.profiles where id = 'b8b8b8b8-1111-4111-8111-000000000003'), true);
select set_config('pb.parent', (select person_id::text from public.profiles where id = 'b8b8b8b8-1111-4111-8111-000000000004'), true);
update public.people set dob = '1980-01-01' where id in (current_setting('pb.coach')::uuid, current_setting('pb.other')::uuid, current_setting('pb.parent')::uuid, current_setting('pb.admin')::uuid);

insert into public.seasons (id, name, starts_on, ends_on) values ('5c5c5c5c-1111-4111-8111-000000000001', 'PB 2034/35', '2034-08-01', '2035-05-31');
insert into public.teams (id, name) values
  ('7c7c7c7c-1111-4111-8111-000000000001', 'PB U15s'),
  ('7c7c7c7c-1111-4111-8111-000000000002', 'PB U16s');
insert into public.team_memberships (person_id, team_id, season_id, role) values
  (current_setting('pb.coach')::uuid, '7c7c7c7c-1111-4111-8111-000000000001', '5c5c5c5c-1111-4111-8111-000000000001', 'coach');
-- a child player with the parent as guardian
insert into public.people (id, first_name, last_name, dob) values ('9c9c9c9c-1111-4111-8111-000000000001', 'Kid', 'Player', '2020-01-01');
insert into public.guardianships (guardian_person_id, child_person_id, relationship) values (current_setting('pb.parent')::uuid, '9c9c9c9c-1111-4111-8111-000000000001', 'parent');
-- the coach needs certs to sit on a team with a minor (SG-6)
insert into public.certifications (person_id, type, issued_on, expires_on, verified_at) values
  (current_setting('pb.coach')::uuid, 'fa_dbs', '2026-01-01', '2037-01-01', now()),
  (current_setting('pb.coach')::uuid, 'safeguarding_children', '2026-01-01', '2037-01-01', now());
insert into public.team_memberships (person_id, team_id, season_id, role) values
  ('9c9c9c9c-1111-4111-8111-000000000001', '7c7c7c7c-1111-4111-8111-000000000001', '5c5c5c5c-1111-4111-8111-000000000001', 'player');

insert into public.resources (id, type, name) values
  ('c8c8c8c8-1111-4111-8111-000000000011', 'pitch', 'PB Pitch A'),
  ('c8c8c8c8-1111-4111-8111-000000000013', 'function_room', 'PB Room Z');

-- A. shape ---------------------------------------------------------------------
select ok('training'::public.booking_kind is not null, 'training is a booking kind');
select has_column('public', 'bookings', 'team_id', 'bookings.team_id');
select has_table('public', 'booking_teams', 'booking_teams');
select has_function('public', 'pitch_calendar', array['timestamp with time zone', 'timestamp with time zone'], 'pitch_calendar()');
select has_function('public', 'can_view_pitch_calendar', 'can_view_pitch_calendar()');
select trigger_is('public', 'bookings', 'trg_bookings_team_guard', 'public', 'bookings_team_guard', 'team guard trigger');

-- B. coach requests ------------------------------------------------------------
set local request.jwt.claims to '{"sub":"b8b8b8b8-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;

select lives_ok($$
  insert into public.bookings (id, resource_id, kind, status, starts_at, ends_at, team_id, booker_person_id, booker_name, booker_email, occasion)
  values ('d8d8d8d8-1111-4111-8111-000000000001', 'c8c8c8c8-1111-4111-8111-000000000011', 'training', 'pending',
          '2034-09-05 18:00+01', '2034-09-05 19:00+01', '7c7c7c7c-1111-4111-8111-000000000001',
          current_setting('pb.coach')::uuid, 'Cy Coach', 'pb-coach@test.invalid', 'U15 training')
$$, 'coach requests a pending training slot for their team');

select throws_ok($$
  insert into public.bookings (resource_id, kind, status, starts_at, ends_at, team_id, booker_person_id, booker_name, booker_email)
  values ('c8c8c8c8-1111-4111-8111-000000000011', 'training', 'pending', '2034-09-06 18:00+01', '2034-09-06 19:00+01',
          '7c7c7c7c-1111-4111-8111-000000000002', current_setting('pb.coach')::uuid, 'Cy', 'pb-coach@test.invalid')
$$, '42501', null, 'coach cannot book for a team they do not staff');

select throws_ok($$
  insert into public.bookings (resource_id, kind, status, starts_at, ends_at, team_id, booker_person_id, booker_name, booker_email)
  values ('c8c8c8c8-1111-4111-8111-000000000011', 'training', 'confirmed', '2034-09-07 18:00+01', '2034-09-07 19:00+01',
          '7c7c7c7c-1111-4111-8111-000000000001', current_setting('pb.coach')::uuid, 'Cy', 'pb-coach@test.invalid')
$$, '42501', null, 'coach cannot create a confirmed booking');

select throws_ok($$
  insert into public.bookings (resource_id, kind, status, starts_at, ends_at, team_id, booker_person_id, booker_name, booker_email)
  values ('c8c8c8c8-1111-4111-8111-000000000013', 'block', 'pending', '2034-09-07 18:00+01', '2034-09-07 19:00+01',
          '7c7c7c7c-1111-4111-8111-000000000001', current_setting('pb.coach')::uuid, 'Cy', 'pb-coach@test.invalid')
$$, '42501', null, 'coach cannot book a function room through the team path');

select throws_ok($$
  insert into public.bookings (resource_id, kind, status, starts_at, ends_at, team_id, booker_person_id, booker_name, booker_email)
  values ('c8c8c8c8-1111-4111-8111-000000000011', 'block', 'pending', '2020-09-07 18:00+01', '2020-09-07 19:00+01',
          '7c7c7c7c-1111-4111-8111-000000000001', current_setting('pb.coach')::uuid, 'Cy', 'pb-coach@test.invalid')
$$, 'P0001', null, 'coach cannot book a slot in the past');

-- the coach sees their own booking through the member-read policy
select is((select count(*) from public.bookings where id = 'd8d8d8d8-1111-4111-8111-000000000001'), 1::bigint,
  'coach can read their team''s pitch booking');

-- C. status transitions --------------------------------------------------------
select throws_ok($$
  update public.bookings set status = 'confirmed' where id = 'd8d8d8d8-1111-4111-8111-000000000001'
$$, 'P0001', null, 'coach cannot confirm');

select lives_ok($$
  update public.bookings set occasion = 'U15 training (moved)', starts_at = '2034-09-05 18:30+01', ends_at = '2034-09-05 19:30+01'
   where id = 'd8d8d8d8-1111-4111-8111-000000000001'
$$, 'coach can edit their pending booking');

reset role;
set local request.jwt.claims to '{"sub":"b8b8b8b8-1111-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok($$
  update public.bookings set status = 'confirmed' where id = 'd8d8d8d8-1111-4111-8111-000000000001'
$$, 'club_admin confirms the booking');
reset role;

set local request.jwt.claims to '{"sub":"b8b8b8b8-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_ok($$
  update public.bookings set starts_at = '2034-09-05 19:00+01', ends_at = '2034-09-05 20:00+01'
   where id = 'd8d8d8d8-1111-4111-8111-000000000001'
$$, 'P0001', null, 'coach cannot move a confirmed booking');
select lives_ok($$
  update public.bookings set status = 'cancelled' where id = 'd8d8d8d8-1111-4111-8111-000000000001'
$$, 'coach can cancel their confirmed booking');
select throws_ok($$
  update public.bookings set status = 'pending' where id = 'd8d8d8d8-1111-4111-8111-000000000001'
$$, 'P0001', null, 'a cancelled booking stays cancelled');
reset role;

-- a live one for the visibility and sharing checks
insert into public.bookings (id, resource_id, kind, status, starts_at, ends_at, team_id, booker_person_id, booker_name, booker_email, occasion)
values ('d8d8d8d8-1111-4111-8111-000000000002', 'c8c8c8c8-1111-4111-8111-000000000011', 'training', 'confirmed',
        '2034-09-12 18:00+01', '2034-09-12 19:00+01', '7c7c7c7c-1111-4111-8111-000000000001',
        current_setting('pb.coach')::uuid, 'Cy Coach', 'pb-coach@test.invalid', 'U15 training');

-- D. visibility ----------------------------------------------------------------
set local request.jwt.claims to '{"sub":"b8b8b8b8-1111-4111-8111-000000000004","role":"authenticated"}';
set local role authenticated;
select ok(public.can_view_pitch_calendar(), 'a guardian of a player can view the pitch calendar');
select is((select count(*) from public.pitch_calendar('2034-09-01', '2034-10-01') where booking_id = 'd8d8d8d8-1111-4111-8111-000000000002'), 1::bigint,
  'parent sees the training session in pitch_calendar');
select is((select (label, team_name, kind::text) from public.pitch_calendar('2034-09-01', '2034-10-01') where booking_id = 'd8d8d8d8-1111-4111-8111-000000000002'),
  ('U15 training'::text, 'PB U15s'::text, 'training'::text), 'calendar row carries label, team and kind');
select is((select count(*) from public.bookings where id = 'd8d8d8d8-1111-4111-8111-000000000002'), 0::bigint,
  'parent cannot read the raw booking row (PII stays behind pitch_calendar)');
update public.bookings set status = 'cancelled' where id = 'd8d8d8d8-1111-4111-8111-000000000002';
reset role;
select is((select status::text from public.bookings where id = 'd8d8d8d8-1111-4111-8111-000000000002'), 'confirmed',
  'parent cannot change it (no row is visible to update)');
set local request.jwt.claims to '{"sub":"b8b8b8b8-1111-4111-8111-000000000004","role":"authenticated"}';
set local role authenticated;
reset role;

set local request.jwt.claims to '{"sub":"b8b8b8b8-1111-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select ok(not public.can_view_pitch_calendar(), 'an unrelated login cannot view the pitch calendar');
select is((select count(*) from public.pitch_calendar('2034-09-01', '2034-10-01')), 0::bigint, 'unrelated login gets no calendar rows');
select is((select count(*) from public.bookings where id = 'd8d8d8d8-1111-4111-8111-000000000002'), 0::bigint, 'unrelated login cannot read the booking');
reset role;

select ok(not exists (
  select 1 from information_schema.columns
   where table_schema = 'public' and table_name = 'pitch_calendar'),
  'pitch_calendar is a function, not a table');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'pitch_calendar'
              and pg_get_function_result(p.oid) ilike '%booker%'), 0::bigint,
  'pitch_calendar exposes no booker columns');

-- E. sharing + exclusion -------------------------------------------------------
set local request.jwt.claims to '{"sub":"b8b8b8b8-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select lives_ok($$
  insert into public.booking_teams (booking_id, team_id) values ('d8d8d8d8-1111-4111-8111-000000000002', '7c7c7c7c-1111-4111-8111-000000000002')
$$, 'owning team''s coach can share the session with another team');
select is((select shared_team_ids from public.pitch_calendar('2034-09-01', '2034-10-01') where booking_id = 'd8d8d8d8-1111-4111-8111-000000000002'),
  array['7c7c7c7c-1111-4111-8111-000000000002']::uuid[], 'calendar lists the shared team');
select throws_ok($$
  insert into public.bookings (resource_id, kind, status, starts_at, ends_at, team_id, booker_person_id, booker_name, booker_email)
  values ('c8c8c8c8-1111-4111-8111-000000000011', 'training', 'pending', '2034-09-12 18:30+01', '2034-09-12 19:30+01',
          '7c7c7c7c-1111-4111-8111-000000000001', current_setting('pb.coach')::uuid, 'Cy', 'pb-coach@test.invalid')
$$, '23P01', null, 'a clashing request on the same pitch is refused by the exclusion constraint');
reset role;

select * from finish();
rollback;
