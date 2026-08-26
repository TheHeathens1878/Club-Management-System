-- =============================================================================
-- P2.3 — fixtures, availability, selections, team_fulltime_links
-- =============================================================================
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(46);

insert into auth.users (id, email, raw_user_meta_data) values
  ('a4a4a4a4-1111-4111-8111-000000000001', 'f-admin@test.invalid',  '{"full_name": "Ada Admin"}'::jsonb),
  ('a4a4a4a4-1111-4111-8111-000000000002', 'f-coach@test.invalid',  '{"full_name": "Cy Coach"}'::jsonb),
  ('a4a4a4a4-1111-4111-8111-000000000003', 'f-player@test.invalid', '{"full_name": "Pam Player"}'::jsonb),
  ('a4a4a4a4-1111-4111-8111-000000000004', 'f-parent@test.invalid', '{"full_name": "Pat Parent"}'::jsonb),
  ('a4a4a4a4-1111-4111-8111-000000000005', 'f-other@test.invalid',  '{"full_name": "Ollie Other"}'::jsonb);
update public.profiles set role = 'committee' where id = 'a4a4a4a4-1111-4111-8111-000000000001';
select set_config('f.admin',  (select person_id::text from public.profiles where id = 'a4a4a4a4-1111-4111-8111-000000000001'), true);
select set_config('f.coach',  (select person_id::text from public.profiles where id = 'a4a4a4a4-1111-4111-8111-000000000002'), true);
select set_config('f.player', (select person_id::text from public.profiles where id = 'a4a4a4a4-1111-4111-8111-000000000003'), true);
select set_config('f.parent', (select person_id::text from public.profiles where id = 'a4a4a4a4-1111-4111-8111-000000000004'), true);
select set_config('f.other',  (select person_id::text from public.profiles where id = 'a4a4a4a4-1111-4111-8111-000000000005'), true);
update public.people set dob = '1988-08-08'
 where id in (current_setting('f.admin')::uuid, current_setting('f.coach')::uuid, current_setting('f.player')::uuid,
              current_setting('f.parent')::uuid, current_setting('f.other')::uuid);
insert into public.people (id, first_name, last_name, dob) values
  ('c4c4c4c4-1111-4111-8111-000000000001', 'Kid', 'Keeper', current_date - interval '12 years');
insert into public.guardianships (guardian_person_id, child_person_id, relationship)
  values (current_setting('f.parent')::uuid, 'c4c4c4c4-1111-4111-8111-000000000001', 'parent');
-- The coach's DBS + safeguarding certificates used to be inserted here so the
-- SG-6 tier-1 guard would let them onto a team with minors. That tier was
-- retired by 20260825440000 (SAFEGUARDING.md SG-6): the FA Clubs Portal holds
-- the paperwork, and the app can no longer write a certification at all.

insert into public.seasons (id, name, starts_on, ends_on) values ('5a5a5a5a-1111-4111-8111-000000000001', 'Fix 2033/34', '2033-08-01', '2034-05-31');
insert into public.teams (id, name) values ('7a7a7a7a-1111-4111-8111-000000000001', 'Fix U13s'), ('7a7a7a7a-1111-4111-8111-000000000002', 'Fix Other');
insert into public.team_memberships (person_id, team_id, season_id, role) values
  (current_setting('f.coach')::uuid,  '7a7a7a7a-1111-4111-8111-000000000001', '5a5a5a5a-1111-4111-8111-000000000001', 'coach'),
  (current_setting('f.player')::uuid, '7a7a7a7a-1111-4111-8111-000000000001', '5a5a5a5a-1111-4111-8111-000000000001', 'player'),
  ('c4c4c4c4-1111-4111-8111-000000000001', '7a7a7a7a-1111-4111-8111-000000000001', '5a5a5a5a-1111-4111-8111-000000000001', 'player');
insert into public.resources (id, type, name) values ('c5a5c5a5-1111-4111-8111-000000000001', 'pitch', 'Fix Pitch');
insert into public.resources (id, type, name) values ('c5a5c5a5-1111-4111-8111-000000000002', 'function_room', 'Fix Room');

-- A. shape
select has_table('public', 'fixtures', 'fixtures');
select has_table('public', 'availability', 'availability');
select has_table('public', 'selections', 'selections');
select has_table('public', 'team_fulltime_links', 'team_fulltime_links');
select enum_has_labels('public', 'fixture_status', array['scheduled','postponed','cancelled','played','abandoned'], 'fixture_status');
select enum_has_labels('public', 'fixture_source', array['fulltime','manual'], 'fixture_source');
select ok((select bool_and(relrowsecurity) from pg_class where oid in
  ('public.fixtures'::regclass, 'public.availability'::regclass, 'public.selections'::regclass, 'public.team_fulltime_links'::regclass)),
  'RLS on all four');
select ok(not has_table_privilege('anon', 'public.fixtures', 'SELECT'), 'anon cannot read fixtures');

-- B. fixtures constraints
insert into public.fixtures (id, team_id, season_id, opponent, is_home, competition, kickoff_at, source, external_ref)
  values ('f1f1f1f1-1111-4111-8111-000000000001', '7a7a7a7a-1111-4111-8111-000000000001', '5a5a5a5a-1111-4111-8111-000000000001',
          'Angel FC', true, 'League', '2033-09-10 10:30+01', 'fulltime', '29899584');
select throws_ok(
  $$insert into public.fixtures (team_id, season_id, opponent, is_home, kickoff_at, source, external_ref)
    values ('7a7a7a7a-1111-4111-8111-000000000001', '5a5a5a5a-1111-4111-8111-000000000001', 'Angel FC', true, '2033-09-17 10:30+01', 'fulltime', '29899584')$$,
  '23505', null, 'external_ref unique per team');
select lives_ok(
  $$insert into public.fixtures (team_id, season_id, opponent, is_home, kickoff_at, source, external_ref)
    values ('7a7a7a7a-1111-4111-8111-000000000002', '5a5a5a5a-1111-4111-8111-000000000001', 'Angel FC', false, '2033-09-17 10:30+01', 'fulltime', '29899584')$$,
  'same external_ref on another team is fine');
select throws_ok(
  $$insert into public.fixtures (team_id, season_id, opponent, is_home, kickoff_at, source)
    values ('7a7a7a7a-1111-4111-8111-000000000001', '5a5a5a5a-1111-4111-8111-000000000001', 'X', true, '2033-09-24 10:30+01', 'fulltime')$$,
  '23514', null, 'a fulltime fixture needs an external_ref');
select throws_ok(
  $$update public.fixtures set external_ref = 'changed' where id = 'f1f1f1f1-1111-4111-8111-000000000001'$$,
  'P0001', null, 'external_ref of an imported fixture is immutable');
select throws_ok(
  $$update public.fixtures set venue_resource_id = 'c5a5c5a5-1111-4111-8111-000000000002' where id = 'f1f1f1f1-1111-4111-8111-000000000001'$$,
  'P0001', null, 'venue must be a pitch, not a function room');
select lives_ok(
  $$update public.fixtures set venue_resource_id = 'c5a5c5a5-1111-4111-8111-000000000001' where id = 'f1f1f1f1-1111-4111-8111-000000000001'$$,
  'venue can be a pitch');
select throws_ok(
  $$update public.fixtures set home_score = 2 where id = 'f1f1f1f1-1111-4111-8111-000000000001'$$,
  '23514', null, 'scores come as a pair');
select lives_ok(
  $$update public.fixtures set home_score = 2, away_score = 5, status = 'played' where id = 'f1f1f1f1-1111-4111-8111-000000000001'$$,
  'result recorded');

-- C. team_fulltime_links
select throws_ok(
  $$insert into public.team_fulltime_links (team_id, source_url, league_id, ft_season_id)
    values ('7a7a7a7a-1111-4111-8111-000000000001', 'https://example.com/x', '1', '2')$$,
  '23514', null, 'source_url must be a fulltime.thefa.com URL');
select lives_ok(
  $$insert into public.team_fulltime_links (team_id, source_url, league_id, ft_season_id, division_id, fixture_group_key)
    values ('7a7a7a7a-1111-4111-8111-000000000001', 'https://fulltime.thefa.com/fixtures.html?league=314585552&selectedSeason=249484346', '314585552', '249484346', '239850554', '1_652413140')$$,
  'link stored');
select lives_ok(
  $$update public.team_fulltime_links set ft_season_id = '736475439', source_url = 'https://fulltime.thefa.com/fixtures.html?league=314585552&selectedSeason=736475439'
     where team_id = '7a7a7a7a-1111-4111-8111-000000000001'$$,
  're-link updates the row');
select is((select count(*) from public.fixtures where team_id = '7a7a7a7a-1111-4111-8111-000000000001'), 1::bigint,
  're-linking does not orphan or delete fixtures');

-- D. availability / selections guards
select throws_ok(
  $$insert into public.availability (fixture_id, person_id, status)
    values ('f1f1f1f1-1111-4111-8111-000000000001', current_setting('f.other')::uuid, 'available')$$,
  'P0001', null, 'availability requires a live membership on the fixture''s team');
select lives_ok(
  $$insert into public.availability (fixture_id, person_id, status)
    values ('f1f1f1f1-1111-4111-8111-000000000001', current_setting('f.player')::uuid, 'available')$$,
  'a member can have availability');
select throws_ok(
  $$insert into public.selections (fixture_id, person_id)
    values ('f1f1f1f1-1111-4111-8111-000000000001', current_setting('f.coach')::uuid)$$,
  'P0001', null, 'a coach cannot be selected as a player');
select lives_ok(
  $$insert into public.selections (fixture_id, person_id, role, shirt_number)
    values ('f1f1f1f1-1111-4111-8111-000000000001', 'c4c4c4c4-1111-4111-8111-000000000001', 'starter', 1)$$,
  'a live player can be selected');

-- E. RLS
-- player: reads fixtures, writes own availability, cannot write selections, cannot touch links
set local request.jwt.claims to '{"sub":"a4a4a4a4-1111-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select ok((select count(*) from public.fixtures) >= 2, 'player reads fixtures');
select lives_ok(
  $$update public.availability set status = 'unavailable' where person_id = current_setting('f.player')::uuid$$,
  'player updates own availability');
select is((select count(*) from public.availability where person_id <> current_setting('f.player')::uuid), 0::bigint,
  'player sees no one else''s availability');
select is((select count(*) from public.selections), 1::bigint, 'player sees the team''s selections');
select throws_ok(
  $$insert into public.selections (fixture_id, person_id) values ('f1f1f1f1-1111-4111-8111-000000000001', current_setting('f.player')::uuid)$$,
  '42501', null, 'player cannot select');
select is((select count(*) from public.team_fulltime_links), 0::bigint, 'player cannot see Full-Time links');
select throws_ok(
  $$insert into public.fixtures (team_id, season_id, opponent, is_home, kickoff_at)
    values ('7a7a7a7a-1111-4111-8111-000000000001', '5a5a5a5a-1111-4111-8111-000000000001', 'Manual', true, '2033-10-01 10:30+01')$$,
  '42501', null, 'player cannot add a fixture');
reset role;
select is((select set_by from public.availability where person_id = current_setting('f.player')::uuid),
  'a4a4a4a4-1111-4111-8111-000000000003'::uuid, 'set_by stamped from the caller');

-- parent: writes the minor child's availability, reads selections
set local request.jwt.claims to '{"sub":"a4a4a4a4-1111-4111-8111-000000000004","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$insert into public.availability (fixture_id, person_id, status, note)
    values ('f1f1f1f1-1111-4111-8111-000000000001', 'c4c4c4c4-1111-4111-8111-000000000001', 'maybe', 'dentist')$$,
  'guardian sets the child''s availability');
select throws_ok(
  $$insert into public.availability (fixture_id, person_id, status)
    values ('f1f1f1f1-1111-4111-8111-000000000001', current_setting('f.player')::uuid, 'available')$$,
  '42501', null, 'guardian cannot set an unrelated adult''s availability');
select is((select count(*) from public.selections), 1::bigint, 'guardian reads the team''s selections');
reset role;

-- coach: reads all availability on the team, writes selections, adds manual fixtures, no links
set local request.jwt.claims to '{"sub":"a4a4a4a4-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.availability), 2::bigint, 'coach reads every availability on their team');
select lives_ok(
  $$insert into public.selections (fixture_id, person_id, role) values ('f1f1f1f1-1111-4111-8111-000000000001', current_setting('f.player')::uuid, 'substitute')$$,
  'coach selects a player');
select lives_ok(
  $$insert into public.fixtures (team_id, season_id, opponent, is_home, kickoff_at)
    values ('7a7a7a7a-1111-4111-8111-000000000001', '5a5a5a5a-1111-4111-8111-000000000001', 'Friendly XI', true, '2033-10-01 10:30+01')$$,
  'coach adds a manual fixture for their team');
select throws_ok(
  $$insert into public.fixtures (team_id, season_id, opponent, is_home, kickoff_at)
    values ('7a7a7a7a-1111-4111-8111-000000000002', '5a5a5a5a-1111-4111-8111-000000000001', 'X', true, '2033-10-01 10:30+01')$$,
  '42501', null, 'coach cannot add a fixture for another team');
select is((select count(*) from public.team_fulltime_links), 0::bigint, 'coach cannot see Full-Time links');
reset role;

-- other (no membership): reads fixtures, nothing else
set local request.jwt.claims to '{"sub":"a4a4a4a4-1111-4111-8111-000000000005","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.availability), 0::bigint, 'outsider sees no availability');
select is((select count(*) from public.selections), 0::bigint, 'outsider sees no selections');
reset role;

-- admin: links
set local request.jwt.claims to '{"sub":"a4a4a4a4-1111-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.team_fulltime_links), 1::bigint, 'club_admin reads links');
select lives_ok(
  $$update public.team_fulltime_links set enabled = false where team_id = '7a7a7a7a-1111-4111-8111-000000000001'$$,
  'club_admin edits a link');
select lives_ok(
  $$delete from public.team_fulltime_links where team_id = '7a7a7a7a-1111-4111-8111-000000000001'$$,
  'club_admin removes a link');
reset role;
select is((select count(*) from public.fixtures where team_id = '7a7a7a7a-1111-4111-8111-000000000001'), 2::bigint,
  'removing the link leaves the fixtures in place');

select * from finish();

rollback;
