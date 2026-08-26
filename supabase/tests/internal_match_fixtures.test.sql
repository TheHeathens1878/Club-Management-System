-- =============================================================================
-- An internal match is one game on two teams' pages (20260825410000)
-- =============================================================================
-- Adam, 2026-08-26: a match between two of the club's own teams should show up
-- on BOTH teams' fixture lists, not only on the one that booked the pitch.
--
--   A  shape: the columns and the function exist, and only a signed-in member
--      may call it
--   B  a coach's match REQUEST carries the opposition team and creates no
--      fixture — the pending row is not on anybody's matchday tab yet
--   C  confirming creates exactly TWO linked rows: home on the booking's own
--      team with the booking link, away on the opposition with none
--   D  confirming twice creates no more (idempotent)
--   E  cancelling the BOOKING cancels both fixtures, and cancelling either
--      FIXTURE cancels the other — status only, never a delete
--   F  an EXTERNAL match creates no mirror and no fixture at all
--   G  a coach cannot create the pair (42501); a team cannot play itself
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(35);

-- Fixtures ---------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('c0c0c0c0-4100-4111-8111-000000000001', 'im-admin@test.invalid', '{"full_name": "Ada Admin"}'::jsonb),
  ('c0c0c0c0-4100-4111-8111-000000000002', 'im-coach@test.invalid', '{"full_name": "Cy Coach"}'::jsonb);
-- `profiles.role = 'committee'` maps to club_admin, the same shape
-- coach_match_booking.test.sql uses.
update public.profiles set role = 'committee' where id = 'c0c0c0c0-4100-4111-8111-000000000001';
select set_config('im.admin', (select person_id::text from public.profiles where id = 'c0c0c0c0-4100-4111-8111-000000000001'), true);
select set_config('im.coach', (select person_id::text from public.profiles where id = 'c0c0c0c0-4100-4111-8111-000000000002'), true);
update public.people set dob = '1980-01-01'
 where id in (current_setting('im.admin')::uuid, current_setting('im.coach')::uuid);

-- The season the fixtures must land in. `create_internal_match_fixtures()`
-- reads `seasons.is_current`, which is what every other season lookup in this
-- schema does; the decoy below is here so a bug that picked "any season" or
-- "the newest season" would be visible rather than accidentally right.
update public.seasons set is_current = false where is_current;
insert into public.seasons (id, name, starts_on, ends_on, is_current) values
  ('5c0c0c0c-4100-4111-8111-000000000001', 'IM 2034/35', '2034-08-01', '2035-05-31', true),
  ('5c0c0c0c-4100-4111-8111-000000000002', 'IM 2035/36', '2035-08-01', '2036-05-31', false);

insert into public.teams (id, name) values
  ('7c0c0c0c-4100-4111-8111-000000000001', 'IM U14 Mavericks'),
  ('7c0c0c0c-4100-4111-8111-000000000002', 'IM U18 Cobras');
insert into public.team_memberships (person_id, team_id, season_id, role) values
  (current_setting('im.coach')::uuid, '7c0c0c0c-4100-4111-8111-000000000001',
   '5c0c0c0c-4100-4111-8111-000000000001', 'coach');
insert into public.resources (id, type, name) values
  ('c1c0c0c0-4100-4111-8111-000000000011', 'pitch', 'IM Pitch A');


-- A. shape ----------------------------------------------------------------------
select has_column('public', 'bookings', 'opponent_team_id',
  'a booking records the club team a match is against');
select has_column('public', 'fixtures', 'mirror_fixture_id',
  'a fixture records the other side of the same match');
select has_function('public', 'create_internal_match_fixtures', array['uuid'],
  'the pair is built by a function, not by the screen');
select is(has_function_privilege('authenticated',
  'public.create_internal_match_fixtures(uuid)', 'EXECUTE'), true,
  'a signed-in member may call it — the function itself asks whether they are a club admin');
select is(has_function_privilege('anon',
  'public.create_internal_match_fixtures(uuid)', 'EXECUTE'), false,
  'nobody signed out may');


-- B. the request carries the opposition, and creates nothing else ---------------
set local request.jwt.claims to '{"sub":"c0c0c0c0-4100-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;

select set_config('im.match',
  (select booking_id::text from public.request_team_pitch_booking(
     '7c0c0c0c-4100-4111-8111-000000000001',
     'c1c0c0c0-4100-4111-8111-000000000011',
     'fixture',
     array['2034-10-07 10:00+01'::timestamptz],
     array['2034-10-07 11:30+01'::timestamptz],
     'Cy Coach', 'im-coach@test.invalid', 'IM U14 Mavericks v IM U18 Cobras', null, null,
     '7c0c0c0c-4100-4111-8111-000000000002')), true);

-- G (first half). The refusals a coach gets, said while they are still a coach.
select throws_ok($$
  select * from public.create_internal_match_fixtures(current_setting('im.match')::uuid)
$$, '42501', null, 'a coach cannot create the fixtures — confirming is a club administrator''s');

select throws_like($$
  select * from public.request_team_pitch_booking(
    '7c0c0c0c-4100-4111-8111-000000000001',
    'c1c0c0c0-4100-4111-8111-000000000011',
    'fixture',
    array['2034-11-04 10:00+01'::timestamptz], array['2034-11-04 11:30+01'::timestamptz],
    'Cy Coach', 'im-coach@test.invalid', null, null, null,
    '7c0c0c0c-4100-4111-8111-000000000001')
$$, '%cannot play itself%', 'a team cannot be its own opposition');

-- F (first half). The external match: no opposition team, and nothing else
-- about the booking changes.
select set_config('im.external',
  (select booking_id::text from public.request_team_pitch_booking(
     '7c0c0c0c-4100-4111-8111-000000000001',
     'c1c0c0c0-4100-4111-8111-000000000011',
     'fixture',
     array['2034-10-14 10:00+01'::timestamptz],
     array['2034-10-14 11:30+01'::timestamptz],
     'Cy Coach', 'im-coach@test.invalid', 'IM U14 Mavericks v Sale Sharks', null, null,
     null)), true);

reset role;
-- `reset role` alone leaves the coach's jwt claims in place, and the questions
-- below are "what does the TABLE hold" — asked as the session, not as a coach
-- whose RLS would answer for them.
set local request.jwt.claims to '';

select is((select opponent_team_id::text || ' / ' || status::text || ' / ' || coalesce(fixture_id::text, 'no fixture')
             from public.bookings where id = current_setting('im.match')::uuid),
  '7c0c0c0c-4100-4111-8111-000000000002 / pending / no fixture',
  'a match request names the opposition team, is pending, and is linked to no fixture yet');

select is((select count(*) from public.fixtures
            where team_id in ('7c0c0c0c-4100-4111-8111-000000000001',
                              '7c0c0c0c-4100-4111-8111-000000000002')), 0::bigint,
  'and a PENDING request puts a fixture on nobody''s page');

select is((select opponent_team_id from public.bookings where id = current_setting('im.external')::uuid),
  null, 'an external opposition is a name, not a team — no opponent_team_id');


-- C. confirming creates the pair ------------------------------------------------
set local request.jwt.claims to '{"sub":"c0c0c0c0-4100-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;

select is((select public.is_club_admin()), true, 'the confirming caller really is a club admin');

select lives_ok($$
  update public.bookings set status = 'confirmed' where id = current_setting('im.match')::uuid
$$, 'the administrator confirms the request');

select is((select count(*) from public.create_internal_match_fixtures(current_setting('im.match')::uuid)),
  2::bigint, 'confirming creates exactly two fixture rows');

reset role;
set local request.jwt.claims to '';

select is((select count(*) from public.fixtures
            where team_id in ('7c0c0c0c-4100-4111-8111-000000000001',
                              '7c0c0c0c-4100-4111-8111-000000000002')), 2::bigint,
  'two rows in the table, one per team — no more');

-- The home side: the team that asked for the pitch, holding the booking link.
select is((select f.team_id::text || ' / home:' || f.is_home::text
                  || ' / opponent:' || f.opponent
                  || ' / booking:' || (f.booking_id = current_setting('im.match')::uuid)::text
             from public.fixtures f where f.booking_id = current_setting('im.match')::uuid),
  '7c0c0c0c-4100-4111-8111-000000000001 / home:true / opponent:IM U18 Cobras / booking:true',
  'the booking''s own team is HOME, named against the opposition, and keeps the booking link');

-- The away mirror: the opposition's page, no booking. `fixtures.booking_id` and
-- `bookings.fixture_id` are both UNIQUE, so only one of the pair can hold it.
select is((select f.is_home::text || ' / opponent:' || f.opponent
                  || ' / booking:' || coalesce(f.booking_id::text, 'none')
             from public.fixtures f where f.team_id = '7c0c0c0c-4100-4111-8111-000000000002'),
  'false / opponent:IM U14 Mavericks / booking:none',
  'the opposition gets the AWAY mirror, and it holds no booking');

select is((select count(*) from public.fixtures a
            join public.fixtures b on b.id = a.mirror_fixture_id
           where a.mirror_fixture_id is not null and b.mirror_fixture_id = a.id), 2::bigint,
  'each row points at the other, both ways');

select is((select count(*) from public.fixtures a
             join public.fixtures b on b.id = a.mirror_fixture_id
            where a.kickoff_at = b.kickoff_at
              and a.duration_minutes = b.duration_minutes
              and a.venue_resource_id = b.venue_resource_id
              and a.season_id = b.season_id
              and a.status = b.status), 2::bigint,
  'same kickoff, same duration, same venue, same season, same status — one game seen twice');

select is((select distinct season_id from public.fixtures
            where team_id = '7c0c0c0c-4100-4111-8111-000000000002'),
  '5c0c0c0c-4100-4111-8111-000000000001'::uuid,
  'the season is the CURRENT one, not merely a season that brackets the date');

select is((select min(duration_minutes)::text || '/' || max(duration_minutes)::text
             from public.fixtures
            where team_id in ('7c0c0c0c-4100-4111-8111-000000000001',
                              '7c0c0c0c-4100-4111-8111-000000000002')), '90/90',
  'the fixture is as long as the pitch slot the coach asked for, on both sides');

select is((select b.fixture_id = f.id
             from public.bookings b
             join public.fixtures f on f.booking_id = b.id
            where b.id = current_setting('im.match')::uuid), true,
  'and the booking points back at the home fixture — the 1:1 link, both ways');


-- D. confirming twice ------------------------------------------------------------
set local request.jwt.claims to '{"sub":"c0c0c0c0-4100-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;

select is((select count(*) from public.create_internal_match_fixtures(current_setting('im.match')::uuid)),
  2::bigint, 'a second confirmation returns the pair that already exists');

reset role;
set local request.jwt.claims to '';

select is((select count(*) from public.fixtures
            where team_id in ('7c0c0c0c-4100-4111-8111-000000000001',
                              '7c0c0c0c-4100-4111-8111-000000000002')), 2::bigint,
  'and it is still two rows, not four');


-- F. an external match stays a booking and nothing else --------------------------
set local request.jwt.claims to '{"sub":"c0c0c0c0-4100-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;

select lives_ok($$
  update public.bookings set status = 'confirmed' where id = current_setting('im.external')::uuid
$$, 'the administrator confirms the external match too');

select throws_like($$
  select * from public.create_internal_match_fixtures(current_setting('im.external')::uuid)
$$, '%club from outside%',
  'an external opposition has no team page, so there is no mirror to make');

reset role;
set local request.jwt.claims to '';

select is((select count(*) from public.fixtures
            where team_id in ('7c0c0c0c-4100-4111-8111-000000000001',
                              '7c0c0c0c-4100-4111-8111-000000000002')), 2::bigint,
  'and an external match adds no fixture at all — exactly as before this migration');


-- E. cancelling ------------------------------------------------------------------
-- Route 1: the BOOKING. `bookings_fixture_guard()` lets this one status change
-- through for an internal match (and only for an internal match), and
-- `bookings_cancel_internal_match()` + `fixtures_cancel_mirror()` take the pair.
set local request.jwt.claims to '{"sub":"c0c0c0c0-4100-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;

select lives_ok($$
  update public.bookings set status = 'cancelled' where id = current_setting('im.match')::uuid
$$, 'an administrator cancels an internal match''s booking');

reset role;
set local request.jwt.claims to '';

select is((select count(*) from public.fixtures
            where team_id in ('7c0c0c0c-4100-4111-8111-000000000001',
                              '7c0c0c0c-4100-4111-8111-000000000002')
              and status = 'cancelled'), 2::bigint,
  'BOTH fixtures are cancelled — the game is off on both teams'' pages');

select is((select count(*) from public.fixtures
            where team_id in ('7c0c0c0c-4100-4111-8111-000000000001',
                              '7c0c0c0c-4100-4111-8111-000000000002')), 2::bigint,
  'and neither row is deleted — cancelled is a status, and the rows are the history');


-- Route 2: the FIXTURE. A second match, cancelled from the other end.
set local request.jwt.claims to '{"sub":"c0c0c0c0-4100-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;

select set_config('im.match2',
  (select booking_id::text from public.request_team_pitch_booking(
     '7c0c0c0c-4100-4111-8111-000000000002',
     'c1c0c0c0-4100-4111-8111-000000000011',
     'fixture',
     array['2034-11-11 10:00+01'::timestamptz],
     array['2034-11-11 11:30+01'::timestamptz],
     'Ada Admin', 'im-admin@test.invalid', 'IM U18 Cobras v IM U14 Mavericks', null, null,
     '7c0c0c0c-4100-4111-8111-000000000001')), true);
update public.bookings set status = 'confirmed' where id = current_setting('im.match2')::uuid;
select set_config('im.home2',
  (select match_fixture_id::text from public.create_internal_match_fixtures(current_setting('im.match2')::uuid)
    where at_home), true);

select lives_ok($$
  update public.fixtures set status = 'cancelled' where id = current_setting('im.home2')::uuid
$$, 'an administrator calls the second match off from the fixture instead');

reset role;
set local request.jwt.claims to '';

select is((select count(*) from public.fixtures
            where mirror_fixture_id is not null
              and kickoff_at = '2034-11-11 10:00+01'::timestamptz
              and status = 'cancelled'), 2::bigint,
  'cancelling either fixture cancels the other');

select is((select status::text from public.bookings where id = current_setting('im.match2')::uuid),
  'cancelled',
  'and the pitch is freed too — fixtures_sync_booking() has always done that half');


-- G (second half). The unknown and the not-a-match ------------------------------
set local request.jwt.claims to '{"sub":"c0c0c0c0-4100-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;

select throws_like($$
  select * from public.create_internal_match_fixtures('00000000-4100-4111-8111-0000000000ff')
$$, '%unknown booking%', 'an id that is not a booking is refused by name');

select set_config('im.training',
  (select booking_id::text from public.request_team_pitch_booking(
     '7c0c0c0c-4100-4111-8111-000000000001',
     'c1c0c0c0-4100-4111-8111-000000000011',
     'training',
     array['2034-11-18 18:00+00'::timestamptz],
     array['2034-11-18 19:00+00'::timestamptz],
     'Ada Admin', 'im-admin@test.invalid', 'IM training', null, null,
     '7c0c0c0c-4100-4111-8111-000000000002')), true);

select throws_like($$
  select * from public.create_internal_match_fixtures(current_setting('im.training')::uuid)
$$, '%not a match%', 'a training session is not a match, whatever the caller passed');

reset role;
set local request.jwt.claims to '';

select is((select opponent_team_id from public.bookings where id = current_setting('im.training')::uuid),
  null, 'and an opposition team posted on a training request is dropped, not stored');

select * from finish();
rollback;
