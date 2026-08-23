-- =============================================================================
-- P2.5 — pitch allocation
-- =============================================================================
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(36);

insert into auth.users (id, email, raw_user_meta_data) values
  ('a5a5a5a5-1111-4111-8111-000000000001', 'p-admin@test.invalid', '{"full_name": "Ada Admin"}'::jsonb),
  ('a5a5a5a5-1111-4111-8111-000000000002', 'p-coach@test.invalid', '{"full_name": "Cy Coach"}'::jsonb);
update public.profiles set role = 'committee' where id = 'a5a5a5a5-1111-4111-8111-000000000001';
select set_config('p.coach', (select person_id::text from public.profiles where id = 'a5a5a5a5-1111-4111-8111-000000000002'), true);
update public.people set dob = '1980-01-01' where id = current_setting('p.coach')::uuid;

insert into public.seasons (id, name, starts_on, ends_on) values ('5b5b5b5b-1111-4111-8111-000000000001', 'Pitch 2034/35', '2034-08-01', '2035-05-31');
insert into public.teams (id, name) values ('7b7b7b7b-1111-4111-8111-000000000001', 'Pitch U15s');
insert into public.team_memberships (person_id, team_id, season_id, role)
  values (current_setting('p.coach')::uuid, '7b7b7b7b-1111-4111-8111-000000000001', '5b5b5b5b-1111-4111-8111-000000000001', 'coach');
insert into public.resources (id, type, name, default_pre_buffer_minutes, default_post_buffer_minutes) values
  ('c6c6c6c6-1111-4111-8111-000000000011', 'pitch', 'Pitch A', 15, 15),
  ('c6c6c6c6-1111-4111-8111-000000000012', 'pitch', 'Pitch B', 0, 0),
  ('c6c6c6c6-1111-4111-8111-000000000013', 'function_room', 'Room Z', 0, 0);
insert into public.fixtures (id, team_id, season_id, opponent, is_home, competition, kickoff_at, source, external_ref, duration_minutes) values
  ('f5f5f5f5-1111-4111-8111-000000000001', '7b7b7b7b-1111-4111-8111-000000000001', '5b5b5b5b-1111-4111-8111-000000000001', 'Angel FC', true,  'League', '2034-09-09 10:30+01', 'fulltime', '1001', 90),
  ('f5f5f5f5-1111-4111-8111-000000000002', '7b7b7b7b-1111-4111-8111-000000000001', '5b5b5b5b-1111-4111-8111-000000000001', 'Rovers',   true,  'Cup',    '2034-09-16 10:30+01', 'fulltime', '1002', 90),
  ('f5f5f5f5-1111-4111-8111-000000000003', '7b7b7b7b-1111-4111-8111-000000000001', '5b5b5b5b-1111-4111-8111-000000000001', 'Away FC',  false, 'League', '2034-09-23 10:30+01', 'fulltime', '1003', 90);

-- A. shape
select has_column('public', 'fixtures', 'booking_id', 'fixtures.booking_id');
select has_column('public', 'fixtures', 'allocation_conflict', 'fixtures.allocation_conflict');
select has_column('public', 'bookings', 'fixture_id', 'bookings.fixture_id');
select has_view('public', 'unallocated_home_fixtures', 'unallocated_home_fixtures view');
select has_function('public', 'allocate_fixture', array['uuid', 'uuid', 'integer', 'integer'], 'allocate_fixture()');
select has_function('public', 'pitch_grid', array['timestamp with time zone', 'timestamp with time zone'], 'pitch_grid()');

-- B. unallocated view: both home fixtures, not the away one
select is((select array_agg(id order by kickoff_at) from public.unallocated_home_fixtures where team_id = '7b7b7b7b-1111-4111-8111-000000000001'),
  array['f5f5f5f5-1111-4111-8111-000000000001', 'f5f5f5f5-1111-4111-8111-000000000002']::uuid[],
  'unallocated view lists the two home fixtures only');

-- C. allocation
select throws_ok(
  $$select public.allocate_fixture('f5f5f5f5-1111-4111-8111-000000000003', 'c6c6c6c6-1111-4111-8111-000000000011')$$,
  'P0001', null, 'an away fixture cannot be allocated');
select throws_ok(
  $$select public.allocate_fixture('f5f5f5f5-1111-4111-8111-000000000001', 'c6c6c6c6-1111-4111-8111-000000000013')$$,
  'P0001', null, 'a function room is not a pitch');
select set_config('p.b1', public.allocate_fixture('f5f5f5f5-1111-4111-8111-000000000001', 'c6c6c6c6-1111-4111-8111-000000000011')::text, true);
select is(
  (select (kind::text, status::text, starts_at, ends_at, pre_buffer_minutes, post_buffer_minutes, blocked_from, blocked_until, fixture_id)
     from public.bookings where id = current_setting('p.b1')::uuid),
  ('fixture'::text, 'confirmed'::text, '2034-09-09 10:30+01'::timestamptz, '2034-09-09 12:00+01'::timestamptz, 15, 15,
   '2034-09-09 10:15+01'::timestamptz, '2034-09-09 12:15+01'::timestamptz, 'f5f5f5f5-1111-4111-8111-000000000001'::uuid),
  'allocation creates a confirmed fixture booking with the pitch''s default buffers');
select is(
  (select (booking_id, venue_resource_id, allocation_conflict) from public.fixtures where id = 'f5f5f5f5-1111-4111-8111-000000000001'),
  (current_setting('p.b1')::uuid, 'c6c6c6c6-1111-4111-8111-000000000011'::uuid, false),
  'fixture links the booking and the venue');
select is((select count(*) from public.unallocated_home_fixtures where id = 'f5f5f5f5-1111-4111-8111-000000000001'), 0::bigint,
  'allocated fixture leaves the unallocated view');

-- allocation blocks a conflicting hire booking
select throws_ok(
  $$insert into public.bookings (resource_id, kind, status, starts_at, ends_at, booker_name, booker_email)
    values ('c6c6c6c6-1111-4111-8111-000000000011', 'hire', 'confirmed', '2034-09-09 12:10+01', '2034-09-09 14:00+01', 'Hirer', 'h@test.invalid')$$,
  '23P01', null, 'a hire booking inside the fixture''s post-buffer is refused');
-- and vice versa: a hire booking blocks an allocation
insert into public.bookings (id, resource_id, kind, status, starts_at, ends_at, booker_name, booker_email)
  values ('d7d7d7d7-1111-4111-8111-000000000001', 'c6c6c6c6-1111-4111-8111-000000000012', 'hire', 'confirmed',
          '2034-09-16 11:00+01', '2034-09-16 13:00+01', 'Hirer', 'h@test.invalid');
select throws_ok(
  $$select public.allocate_fixture('f5f5f5f5-1111-4111-8111-000000000002', 'c6c6c6c6-1111-4111-8111-000000000012')$$,
  '23P01', null, 'allocating onto a pitch with a clashing hire is refused');
select throws_like(
  $$select public.allocate_fixture('f5f5f5f5-1111-4111-8111-000000000002', 'c6c6c6c6-1111-4111-8111-000000000012')$$,
  '%Hirer 16/09 11:00–13:00 (hire)%', 'the error names the clashing booking');
select is((select booking_id from public.fixtures where id = 'f5f5f5f5-1111-4111-8111-000000000002'), null,
  'a refused allocation writes nothing');
-- same fixture on the other pitch works; explicit buffers honoured
select set_config('p.b2', public.allocate_fixture('f5f5f5f5-1111-4111-8111-000000000002', 'c6c6c6c6-1111-4111-8111-000000000011', 30, 0)::text, true);
select is((select (pre_buffer_minutes, post_buffer_minutes) from public.bookings where id = current_setting('p.b2')::uuid), (30, 0),
  'explicit buffers override the pitch defaults');
-- re-allocating moves the same booking (no second row)
select is(public.allocate_fixture('f5f5f5f5-1111-4111-8111-000000000001', 'c6c6c6c6-1111-4111-8111-000000000012'),
  current_setting('p.b1')::uuid, 're-allocation reuses the linked booking');
select is((select resource_id from public.bookings where id = current_setting('p.b1')::uuid),
  'c6c6c6c6-1111-4111-8111-000000000012'::uuid, 'the booking moved to Pitch B');

-- D. reschedule moves the booking; a clash flags instead
update public.fixtures set kickoff_at = '2034-09-09 14:00+01' where id = 'f5f5f5f5-1111-4111-8111-000000000001';
select is((select (starts_at, ends_at) from public.bookings where id = current_setting('p.b1')::uuid),
  ('2034-09-09 14:00+01'::timestamptz, '2034-09-09 15:30+01'::timestamptz), 'reschedule moved the linked booking');
-- clash: move fixture 1 onto the hire's slot on Pitch B (16/09 11:00–13:00)
select set_config('p.audit0', (select count(*)::text from public.audit_log where action = 'fixtures.allocation_conflict'), true);
update public.fixtures set kickoff_at = '2034-09-16 11:30+01' where id = 'f5f5f5f5-1111-4111-8111-000000000001';
select is((select (kickoff_at, allocation_conflict) from public.fixtures where id = 'f5f5f5f5-1111-4111-8111-000000000001'),
  ('2034-09-16 11:30+01'::timestamptz, true), 'a clashing reschedule keeps the new kickoff and flags the fixture');
select is((select starts_at from public.bookings where id = current_setting('p.b1')::uuid), '2034-09-09 14:00+01'::timestamptz,
  'the booking was NOT moved onto the taken slot (no double-booking)');
select is((select count(*) from public.audit_log where action = 'fixtures.allocation_conflict'),
  current_setting('p.audit0')::bigint + 1, 'the conflict is audit-logged for the admin');
select is((select count(*) from public.unallocated_home_fixtures where id = 'f5f5f5f5-1111-4111-8111-000000000001'), 1::bigint,
  'a flagged fixture reappears in the unallocated view');
-- moving it somewhere free clears the flag
update public.fixtures set kickoff_at = '2034-09-16 15:00+01' where id = 'f5f5f5f5-1111-4111-8111-000000000001';
select is((select (allocation_conflict) from public.fixtures where id = 'f5f5f5f5-1111-4111-8111-000000000001'), (false),
  'a reschedule to a free slot clears the flag');
select is((select starts_at from public.bookings where id = current_setting('p.b1')::uuid), '2034-09-16 15:00+01'::timestamptz,
  'and moves the booking');

-- postponed frees the pitch; back to scheduled re-books
update public.fixtures set status = 'postponed' where id = 'f5f5f5f5-1111-4111-8111-000000000001';
select is((select status::text from public.bookings where id = current_setting('p.b1')::uuid), 'cancelled', 'postponement cancels the booking');
update public.fixtures set status = 'scheduled' where id = 'f5f5f5f5-1111-4111-8111-000000000001';
select is((select status::text from public.bookings where id = current_setting('p.b1')::uuid), 'confirmed', 'back to scheduled re-books');

-- E. the linked booking is managed through the fixture
select throws_ok(
  $$update public.bookings set status = 'cancelled' where id = current_setting('p.b1')::uuid$$,
  'P0001', null, 'a fixture booking cannot be cancelled directly');
select throws_ok(
  $$delete from public.bookings where id = current_setting('p.b1')::uuid$$,
  'P0001', null, 'a fixture booking cannot be deleted directly');
select lives_ok($$select public.unallocate_fixture('f5f5f5f5-1111-4111-8111-000000000001')$$, 'unallocate');
select is((select (status::text, fixture_id) from public.bookings where id = current_setting('p.b1')::uuid), ('cancelled'::text, null::uuid),
  'unallocate cancels and unlinks the booking');
select is((select (booking_id, venue_resource_id) from public.fixtures where id = 'f5f5f5f5-1111-4111-8111-000000000001'), (null::uuid, null::uuid),
  'unallocate clears the fixture');

-- F. pitch grid + RLS on the functions
select is((select count(*) from public.pitch_grid('2034-09-16 00:00+01', '2034-09-17 00:00+01') where booking_id is not null), 2::bigint,
  'pitch_grid lists the two live bookings on 16/09 (hire + fixture 2)');
set local request.jwt.claims to '{"sub":"a5a5a5a5-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select public.allocate_fixture('f5f5f5f5-1111-4111-8111-000000000002', 'c6c6c6c6-1111-4111-8111-000000000012')$$,
  '42501', null, 'a coach cannot allocate');
reset role;
set local request.jwt.claims to '{"sub":"a5a5a5a5-1111-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok($$select public.unallocate_fixture('f5f5f5f5-1111-4111-8111-000000000002')$$, 'club_admin can unallocate through RLS');
reset role;

select * from finish();

rollback;
