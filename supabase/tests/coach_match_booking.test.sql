-- =============================================================================
-- The team path is a request desk, and a coach may ask for a match (20260825400000)
-- =============================================================================
-- Adam, 2026-08-25, on /pitches/book while wearing the Coach hat:
--   "I can still book a pitch as confirmed using my coach login … remove this
--    functionality", "allow coaches to cancel bookings", "in what is the pitch
--    for, match should be an option".
--
--   A  shape: the team path exists and is callable by a signed-in member
--   B  a booking made through the TEAM PATH is pending EVEN WHEN THE CALLER
--      HOLDS AN ADMIN ROLE — the hat cannot be seen from here, so the path is
--      what carries the rule
--   C  an administrator booking through the ADMIN PATH still confirms on the
--      spot, and the desk's own closures are untouched
--   D  a coach may ask for a MATCH; the label carries the opposition; the
--      allocator's fixture link is not a coach's to set
--   E  a coach cancels their team's booking, pending or confirmed, and still
--      cannot confirm one — nor touch an allocated fixture's slot
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(22);

-- Fixtures ---------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('c0c0c0c0-3800-4111-8111-000000000001', 'cm-admin@test.invalid', '{"full_name": "Ada Admin"}'::jsonb),
  ('c0c0c0c0-3800-4111-8111-000000000002', 'cm-coach@test.invalid', '{"full_name": "Cy Coach"}'::jsonb);
-- Adam's own shape: a committee sign-in that ALSO runs a team. `profiles.role`
-- committee maps to club_admin, so `has_any_role(['staff','club_admin'])` is
-- true for this person and `bookings_team_guard()` exempts them entirely.
update public.profiles set role = 'committee' where id = 'c0c0c0c0-3800-4111-8111-000000000001';
select set_config('cm.admin', (select person_id::text from public.profiles where id = 'c0c0c0c0-3800-4111-8111-000000000001'), true);
select set_config('cm.coach', (select person_id::text from public.profiles where id = 'c0c0c0c0-3800-4111-8111-000000000002'), true);
update public.people set dob = '1980-01-01'
 where id in (current_setting('cm.admin')::uuid, current_setting('cm.coach')::uuid);

insert into public.seasons (id, name, starts_on, ends_on) values
  ('5c0c0c0c-3800-4111-8111-000000000001', 'CM 2034/35', '2034-08-01', '2035-05-31');
insert into public.teams (id, name) values
  ('7c0c0c0c-3800-4111-8111-000000000001', 'CM U14 Mavericks'),
  ('7c0c0c0c-3800-4111-8111-000000000002', 'CM U18 Cobras');
insert into public.team_memberships (person_id, team_id, season_id, role) values
  (current_setting('cm.coach')::uuid, '7c0c0c0c-3800-4111-8111-000000000001',
   '5c0c0c0c-3800-4111-8111-000000000001', 'coach'),
  -- The committee member coaches the same team: this is the exact sign-in that
  -- could confirm its own bookings while wearing the Coach hat.
  (current_setting('cm.admin')::uuid, '7c0c0c0c-3800-4111-8111-000000000001',
   '5c0c0c0c-3800-4111-8111-000000000001', 'manager');
insert into public.resources (id, type, name) values
  ('c1c0c0c0-3800-4111-8111-000000000011', 'pitch', 'CM Pitch A'),
  ('c1c0c0c0-3800-4111-8111-000000000012', 'function_room', 'CM Function Room');

-- A. shape ---------------------------------------------------------------------
select has_function('public', 'request_team_pitch_booking',
  array['uuid', 'uuid', 'booking_kind', 'timestamptz[]', 'timestamptz[]', 'text', 'text', 'text', 'text', 'uuid'],
  'the team pitch-booking path exists');
select is(has_function_privilege('authenticated',
  'public.request_team_pitch_booking(uuid,uuid,public.booking_kind,timestamptz[],timestamptz[],text,text,text,text,uuid)',
  'EXECUTE'), true, 'a signed-in member may call it');
select is(has_function_privilege('anon',
  'public.request_team_pitch_booking(uuid,uuid,public.booking_kind,timestamptz[],timestamptz[],text,text,text,text,uuid)',
  'EXECUTE'), false, 'nobody signed out may');


-- B. the team path pins the booking, whatever role the caller holds -------------
-- The committee sign-in — the one `bookings_team_guard()` exempts — going
-- through the coach's path. This is the bug Adam reported, from the database's
-- side: nothing about this caller says "coach", so the PATH has to say it.
set local request.jwt.claims to '{"sub":"c0c0c0c0-3800-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;

select is((select public.is_club_admin()), true,
  'the caller really does hold club admin — this is not a coach in disguise');

select set_config('cm.b1',
  (select booking_id::text from public.request_team_pitch_booking(
     '7c0c0c0c-3800-4111-8111-000000000001',
     'c1c0c0c0-3800-4111-8111-000000000011',
     'training',
     array['2034-09-05 18:00+01'::timestamptz],
     array['2034-09-05 19:00+01'::timestamptz],
     'Ada Admin', 'cm-admin@test.invalid', 'U14 training', null, null)), true);

select is((select status::text from public.bookings where id = current_setting('cm.b1')::uuid),
  'pending',
  'a booking made through the team path is a REQUEST even for a club administrator');
select is((select booker_person_id from public.bookings where id = current_setting('cm.b1')::uuid),
  current_setting('cm.admin')::uuid, 'and it is booked as the caller, not as nobody');

-- A weekly repeat is ONE statement, so the desk gets one arrival notice.
select is((select count(*) from public.request_team_pitch_booking(
     '7c0c0c0c-3800-4111-8111-000000000001',
     'c1c0c0c0-3800-4111-8111-000000000011',
     'training',
     array['2034-09-12 18:00+01'::timestamptz, '2034-09-19 18:00+01'::timestamptz],
     array['2034-09-12 19:00+01'::timestamptz, '2034-09-19 19:00+01'::timestamptz],
     'Ada Admin', 'cm-admin@test.invalid', 'U14 training', null,
     '9c0c0c0c-3800-4111-8111-000000000001')), 2::bigint,
  'a weekly repeat comes back as one id per week');
select is((select count(*) from public.bookings
            where recurrence_group_id = '9c0c0c0c-3800-4111-8111-000000000001'
              and status = 'pending'), 2::bigint,
  'and every week of it is pending too');

-- The function refuses what it is not for, rather than writing something odd.
select throws_like($$
  select * from public.request_team_pitch_booking(
    '7c0c0c0c-3800-4111-8111-000000000001',
    'c1c0c0c0-3800-4111-8111-000000000012',   -- the function room
    'training',
    array['2034-09-26 18:00+01'::timestamptz], array['2034-09-26 19:00+01'::timestamptz],
    'Ada Admin', 'cm-admin@test.invalid', null, null, null)
$$, '%may only book pitches%', 'the team path is for pitches, not the function room');

select throws_like($$
  select * from public.request_team_pitch_booking(
    '7c0c0c0c-3800-4111-8111-000000000001',
    'c1c0c0c0-3800-4111-8111-000000000011',
    'maintenance',
    array['2034-09-26 18:00+01'::timestamptz], array['2034-09-26 19:00+01'::timestamptz],
    'Ada Admin', 'cm-admin@test.invalid', null, null, null)
$$, '%training, a match or another use%', 'and for training, a match or another use — not maintenance');


-- C. the admin path is unchanged ------------------------------------------------
-- Same person, same team, same pitch: a direct INSERT still confirms on the
-- spot. That is the Club admin hat, and it is what ask 1 leaves alone.
select lives_ok($$
  insert into public.bookings (id, resource_id, kind, status, starts_at, ends_at, team_id,
                               booker_person_id, booker_name, booker_email, occasion)
  values ('b0c0c0c0-3800-4111-8111-000000000009', 'c1c0c0c0-3800-4111-8111-000000000011', 'training',
          'confirmed', '2034-10-03 18:00+01', '2034-10-03 19:00+01', '7c0c0c0c-3800-4111-8111-000000000001',
          current_setting('cm.admin')::uuid, 'Ada Admin', 'cm-admin@test.invalid', 'Admin-made session')
$$, 'an administrator books directly through the admin path');
select is((select status::text from public.bookings where id = 'b0c0c0c0-3800-4111-8111-000000000009'),
  'confirmed', 'and it is confirmed on the spot, exactly as before');

-- The function-room desk's own closure: no team, a room, still confirmed. The
-- staff exemption 20260825170000 kept on purpose is untouched.
select lives_ok($$
  insert into public.bookings (id, resource_id, kind, status, starts_at, ends_at,
                               booker_person_id, booker_name, booker_email, occasion)
  values ('b0c0c0c0-3800-4111-8111-000000000010', 'c1c0c0c0-3800-4111-8111-000000000012', 'block',
          'confirmed', '2034-10-04 18:00+01', '2034-10-04 23:00+01',
          current_setting('cm.admin')::uuid, 'Ada Admin', 'cm-admin@test.invalid', 'Room closed')
$$, 'the function-room desk still closes its own room');
select is((select status::text from public.bookings where id = 'b0c0c0c0-3800-4111-8111-000000000010'),
  'confirmed', 'and that closure is confirmed, not left on a requests desk');
reset role;


-- D. a coach may ask for a match ------------------------------------------------
set local request.jwt.claims to '{"sub":"c0c0c0c0-3800-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;

select set_config('cm.match',
  (select booking_id::text from public.request_team_pitch_booking(
     '7c0c0c0c-3800-4111-8111-000000000001',
     'c1c0c0c0-3800-4111-8111-000000000011',
     'fixture',
     array['2034-10-07 10:00+01'::timestamptz],
     array['2034-10-07 11:30+01'::timestamptz],
     'Cy Coach', 'cm-coach@test.invalid', 'CM U14 Mavericks v CM U18 Cobras', null, null)), true);

select is((select kind::text || ' / ' || status::text || ' / ' || coalesce(occasion, '-')
                  || ' / fixture link: ' || coalesce(fixture_id::text, 'none')
             from public.bookings where id = current_setting('cm.match')::uuid),
  'fixture / pending / CM U14 Mavericks v CM U18 Cobras / fixture link: none',
  'a coach''s match is a pending fixture-kind booking, labelled with the opposition and linked to no fixture row');

-- The link itself stays the allocator's. A coach posting one is refused with a
-- sentence, not a bare policy violation.
select throws_like($$
  insert into public.bookings (resource_id, kind, status, starts_at, ends_at, team_id, fixture_id,
                               booker_person_id, booker_name, booker_email)
  values ('c1c0c0c0-3800-4111-8111-000000000011', 'fixture', 'pending',
          '2034-10-14 10:00+01', '2034-10-14 11:30+01', '7c0c0c0c-3800-4111-8111-000000000001',
          '8c0c0c0c-3800-4111-8111-000000000001',
          current_setting('cm.coach')::uuid, 'Cy', 'cm-coach@test.invalid')
$$, '%allocated on Pitches%', 'a coach may not link a booking to a fixture row');


-- E. cancelling is the coach's, confirming is not --------------------------------
select throws_like($$
  update public.bookings set status = 'confirmed' where id = current_setting('cm.match')::uuid
$$, '%only a club administrator can confirm%', 'a coach still cannot confirm their own request');

select lives_ok($$
  update public.bookings set status = 'cancelled' where id = current_setting('cm.match')::uuid
$$, 'a coach cancels their team''s match request');
select is((select status::text from public.bookings where id = current_setting('cm.match')::uuid),
  'cancelled', 'and it is cancelled, not deleted — the row is the history');

-- The administrator's own confirmed session, cancelled by the team's coach:
-- Adam, 2026-08-25, "allow coaches to cancel bookings" — a confirmed one too.
select lives_ok($$
  update public.bookings set status = 'cancelled' where id = 'b0c0c0c0-3800-4111-8111-000000000009'
$$, 'a coach cancels a CONFIRMED booking for their own team');

reset role;

-- An allocated fixture's slot is not the coach's, even when it is their team's.
set local request.jwt.claims to '{"sub":"c0c0c0c0-3800-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
insert into public.fixtures (id, team_id, season_id, opponent, is_home, kickoff_at)
values ('8c0c0c0c-3800-4111-8111-000000000002', '7c0c0c0c-3800-4111-8111-000000000001',
        '5c0c0c0c-3800-4111-8111-000000000001', 'Sale Sharks', true, '2034-10-21 10:00+01');
insert into public.bookings (id, resource_id, kind, status, starts_at, ends_at, team_id, fixture_id,
                             booker_person_id, booker_name, booker_email)
values ('b0c0c0c0-3800-4111-8111-000000000011', 'c1c0c0c0-3800-4111-8111-000000000011', 'fixture',
        'confirmed', '2034-10-21 10:00+01', '2034-10-21 11:30+01', '7c0c0c0c-3800-4111-8111-000000000001',
        '8c0c0c0c-3800-4111-8111-000000000002',
        current_setting('cm.admin')::uuid, 'Ada Admin', 'cm-admin@test.invalid');
reset role;

set local request.jwt.claims to '{"sub":"c0c0c0c0-3800-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_like($$
  update public.bookings set status = 'cancelled' where id = 'b0c0c0c0-3800-4111-8111-000000000011'
$$, '%belongs to a fixture%', 'a coach cannot cancel an allocated fixture''s pitch slot');
select is((select status::text from public.bookings where id = 'b0c0c0c0-3800-4111-8111-000000000011'),
  'confirmed', 'and the league game keeps its pitch');
reset role;

select * from finish();
rollback;
