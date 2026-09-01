-- =============================================================================
-- Match stats and the coach's scoreline — fixture_player_stats, coach_*_score
-- =============================================================================
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(39);

insert into auth.users (id, email, raw_user_meta_data) values
  ('a5a5a5a5-1111-4111-8111-000000000001', 's-admin@test.invalid',  '{"full_name": "Ada Admin"}'::jsonb),
  ('a5a5a5a5-1111-4111-8111-000000000002', 's-coach@test.invalid',  '{"full_name": "Cy Coach"}'::jsonb),
  ('a5a5a5a5-1111-4111-8111-000000000003', 's-player@test.invalid', '{"full_name": "Pam Player"}'::jsonb),
  ('a5a5a5a5-1111-4111-8111-000000000004', 's-parent@test.invalid', '{"full_name": "Pat Parent"}'::jsonb),
  ('a5a5a5a5-1111-4111-8111-000000000005', 's-other@test.invalid',  '{"full_name": "Ollie Other"}'::jsonb);
update public.profiles set role = 'committee' where id = 'a5a5a5a5-1111-4111-8111-000000000001';
select set_config('s.admin',  (select person_id::text from public.profiles where id = 'a5a5a5a5-1111-4111-8111-000000000001'), true);
select set_config('s.coach',  (select person_id::text from public.profiles where id = 'a5a5a5a5-1111-4111-8111-000000000002'), true);
select set_config('s.player', (select person_id::text from public.profiles where id = 'a5a5a5a5-1111-4111-8111-000000000003'), true);
select set_config('s.parent', (select person_id::text from public.profiles where id = 'a5a5a5a5-1111-4111-8111-000000000004'), true);
select set_config('s.other',  (select person_id::text from public.profiles where id = 'a5a5a5a5-1111-4111-8111-000000000005'), true);
update public.people set dob = '1988-08-08'
 where id in (current_setting('s.admin')::uuid, current_setting('s.coach')::uuid, current_setting('s.player')::uuid,
              current_setting('s.parent')::uuid, current_setting('s.other')::uuid);
insert into public.people (id, first_name, last_name, dob) values
  ('c5c5c5c5-1111-4111-8111-000000000001', 'Kid', 'Striker', current_date - interval '12 years');
insert into public.guardianships (guardian_person_id, child_person_id, relationship)
  values (current_setting('s.parent')::uuid, 'c5c5c5c5-1111-4111-8111-000000000001', 'parent');
-- The coach's DBS + safeguarding certificates used to be inserted here so the
-- SG-6 tier-1 guard would let them onto a team with minors. That tier was
-- retired by 20260825440000 (SAFEGUARDING.md SG-6): the FA Clubs Portal holds
-- the paperwork, and the app can no longer write a certification at all.

insert into public.seasons (id, name, starts_on, ends_on)
  values ('5a5a5a5a-1111-4111-8111-000000000001', 'Stats 2033/34', '2033-08-01', '2034-05-31');
insert into public.teams (id, name, age_group) values
  ('7a7a7a7a-1111-4111-8111-000000000001', 'Stats U13s',  'U13'),
  ('7a7a7a7a-1111-4111-8111-000000000002', 'Stats Other', 'U13');
insert into public.team_memberships (person_id, team_id, season_id, role) values
  (current_setting('s.coach')::uuid,  '7a7a7a7a-1111-4111-8111-000000000001', '5a5a5a5a-1111-4111-8111-000000000001', 'coach'),
  (current_setting('s.player')::uuid, '7a7a7a7a-1111-4111-8111-000000000001', '5a5a5a5a-1111-4111-8111-000000000001', 'player'),
  ('c5c5c5c5-1111-4111-8111-000000000001', '7a7a7a7a-1111-4111-8111-000000000001', '5a5a5a5a-1111-4111-8111-000000000001', 'player'),
  (current_setting('s.other')::uuid,  '7a7a7a7a-1111-4111-8111-000000000002', '5a5a5a5a-1111-4111-8111-000000000001', 'player');

-- Fixture 1 is a U13 game Full-Time did publish a result for; fixture 2 is the
-- kind of game Full-Time never carries a score for at all.
insert into public.fixtures (id, team_id, season_id, opponent, is_home, kickoff_at, status, source, external_ref,
                             home_score, away_score) values
  ('faf9f9f9-1111-4111-8111-000000000001', '7a7a7a7a-1111-4111-8111-000000000001', '5a5a5a5a-1111-4111-8111-000000000001',
   'Angel FC', true, '2033-09-10 10:30+01', 'played', 'fulltime', 'ft-stats-1', 2, 2),
  ('faf9f9f9-1111-4111-8111-000000000002', '7a7a7a7a-1111-4111-8111-000000000001', '5a5a5a5a-1111-4111-8111-000000000001',
   'Bramhall FC', false, '2033-09-17 10:30+01', 'played', 'manual', null, null, null);


-- =============================================================================
-- A. shape
-- =============================================================================

select has_table('public', 'fixture_player_stats', 'fixture_player_stats');
select has_column('public', 'fixtures', 'coach_home_score', 'fixtures.coach_home_score');
select has_column('public', 'fixtures', 'coach_away_score', 'fixtures.coach_away_score');
select ok((select relrowsecurity from pg_class where oid = 'public.fixture_player_stats'::regclass),
  'RLS is on fixture_player_stats');
select ok(not has_table_privilege('anon', 'public.fixture_player_stats', 'SELECT'),
  'anon cannot read match stats');


-- =============================================================================
-- B. constraints and the guard (owner rights; RLS comes in D)
-- =============================================================================

select lives_ok(
  $$insert into public.fixture_player_stats (fixture_id, person_id, goals, assists, captain, player_of_match)
    values ('faf9f9f9-1111-4111-8111-000000000001', 'c5c5c5c5-1111-4111-8111-000000000001', 2, 1, true, true)$$,
  'a live player gets a stats line');
select throws_ok(
  $$insert into public.fixture_player_stats (fixture_id, person_id, goals)
    values ('faf9f9f9-1111-4111-8111-000000000001', 'c5c5c5c5-1111-4111-8111-000000000001', 1)$$,
  '23505', null, 'one line per player per fixture');
select throws_ok(
  $$insert into public.fixture_player_stats (fixture_id, person_id, captain)
    values ('faf9f9f9-1111-4111-8111-000000000001', current_setting('s.player')::uuid, true)$$,
  '23505', null, 'a match has one captain');
select throws_ok(
  $$insert into public.fixture_player_stats (fixture_id, person_id, player_of_match)
    values ('faf9f9f9-1111-4111-8111-000000000001', current_setting('s.player')::uuid, true)$$,
  '23505', null, 'and one player of the match');
select throws_ok(
  $$insert into public.fixture_player_stats (fixture_id, person_id, goals)
    values ('faf9f9f9-1111-4111-8111-000000000001', current_setting('s.player')::uuid, -1)$$,
  '23514', null, 'goals cannot be negative');
select throws_ok(
  $$insert into public.fixture_player_stats (fixture_id, person_id, goals)
    values ('faf9f9f9-1111-4111-8111-000000000001', current_setting('s.other')::uuid, 1)$$,
  'P0001', null, 'a player from another team gets no line');
select throws_ok(
  $$insert into public.fixture_player_stats (fixture_id, person_id, goals)
    values ('faf9f9f9-1111-4111-8111-000000000001', current_setting('s.coach')::uuid, 1)$$,
  'P0001', null, 'a coach is not a player and gets no line');
select throws_ok(
  $$update public.fixtures set coach_home_score = 3
     where id = 'faf9f9f9-1111-4111-8111-000000000002'$$,
  '23514', null, 'a coach score is set as a pair or not at all');
select throws_ok(
  $$update public.fixtures set coach_home_score = 3, coach_away_score = -1
     where id = 'faf9f9f9-1111-4111-8111-000000000002'$$,
  '23514', null, 'a coach score cannot be negative');

delete from public.fixture_player_stats;


-- =============================================================================
-- C. set_fixture_stats — the whole-fixture write
-- =============================================================================

-- the coach: staff of the fixture's team
set local request.jwt.claims to '{"sub":"a5a5a5a5-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$select public.set_fixture_stats('faf9f9f9-1111-4111-8111-000000000001', $j$[
      {"person_id": "c5c5c5c5-1111-4111-8111-000000000001", "goals": 2, "assists": 1, "captain": false, "player_of_match": true}
    ]$j$::jsonb)$$,
  'the coach records the match stats');
reset role;
select is((select count(*) from public.fixture_player_stats
            where fixture_id = 'faf9f9f9-1111-4111-8111-000000000001'), 1::bigint,
  'one line is stored');
select is((select goals from public.fixture_player_stats
            where fixture_id = 'faf9f9f9-1111-4111-8111-000000000001'), 2::smallint,
  'with the goals the coach entered');
select is((select updated_by from public.fixture_player_stats
            where fixture_id = 'faf9f9f9-1111-4111-8111-000000000001'),
  'a5a5a5a5-1111-4111-8111-000000000002'::uuid, 'updated_by is stamped from the caller');

-- the whole fixture is replaced, and a line with nothing on it is not stored
set local request.jwt.claims to '{"sub":"a5a5a5a5-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$select public.set_fixture_stats('faf9f9f9-1111-4111-8111-000000000001', $j$[
      {"person_id": "c5c5c5c5-1111-4111-8111-000000000001", "goals": 1, "assists": 0, "captain": true, "player_of_match": false},
      {"person_id": "d2d2d2d2-1111-4111-8111-000000000001", "goals": 0, "assists": 0, "captain": false, "player_of_match": false}
    ]$j$::jsonb)$$,
  'a second save replaces the fixture''s stats');
reset role;
select is((select count(*) from public.fixture_player_stats
            where fixture_id = 'faf9f9f9-1111-4111-8111-000000000001'), 1::bigint,
  'a blank line is dropped rather than stored as a row of zeroes');

set local request.jwt.claims to '{"sub":"a5a5a5a5-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select public.set_fixture_stats('faf9f9f9-1111-4111-8111-000000000001', $j$[
      {"person_id": "c5c5c5c5-1111-4111-8111-000000000001", "captain": true},
      {"person_id": "e2e2e2e2-1111-4111-8111-000000000001", "captain": true}
    ]$j$::jsonb)$$,
  'P0001', 'set_fixture_stats: a match has one captain, not 2', 'two captains are refused by name');
select throws_ok(
  $$select public.set_fixture_stats('faf9f9f9-1111-4111-8111-000000000001', $j$[
      {"person_id": "c5c5c5c5-1111-4111-8111-000000000001", "player_of_match": true},
      {"person_id": "e2e2e2e2-1111-4111-8111-000000000001", "player_of_match": true}
    ]$j$::jsonb)$$,
  'P0001', 'set_fixture_stats: a match has one player of the match, not 2',
  'two players of the match are refused by name');
select throws_ok(
  $$select public.set_fixture_stats('faf9f9f9-1111-4111-8111-000000000001', $j$[
      {"person_id": "c5c5c5c5-1111-4111-8111-000000000001", "goals": 1},
      {"person_id": "c5c5c5c5-1111-4111-8111-000000000001", "goals": 2}
    ]$j$::jsonb)$$,
  'P0001', 'set_fixture_stats: the same player appears twice', 'the same player twice is refused');
select throws_ok(
  $$select public.set_fixture_stats('faf9f9f9-1111-4111-8111-000000000001', $j$[
      {"person_id": "aaaaaaaa-1111-4111-8111-00000000ffff", "goals": 1}
    ]$j$::jsonb)$$,
  'P0001', null, 'a non-member cannot be credited with a goal — the guard still runs');
select is((select count(*) from public.fixture_player_stats
            where fixture_id = 'faf9f9f9-1111-4111-8111-000000000001'), 1::bigint,
  'a refused save leaves the stats exactly as they were');
reset role;

-- a player of the team is not staff
set local request.jwt.claims to '{"sub":"a5a5a5a5-1111-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select public.set_fixture_stats('faf9f9f9-1111-4111-8111-000000000001', '[]'::jsonb)$$,
  '42501', null, 'a player cannot record the match stats');
reset role;


-- =============================================================================
-- D. RLS and the coach's scoreline
-- =============================================================================

-- coach: writes the club's own score over Full-Time's 2-2
set local request.jwt.claims to '{"sub":"a5a5a5a5-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$update public.fixtures set coach_home_score = 4, coach_away_score = 1
     where id = 'faf9f9f9-1111-4111-8111-000000000001'$$,
  'the coach enters the scoreline');
reset role;
select is((select coach_home_score from public.fixtures where id = 'faf9f9f9-1111-4111-8111-000000000001'),
  4, 'the coach''s home score is stored');
select is((select home_score from public.fixtures where id = 'faf9f9f9-1111-4111-8111-000000000001'),
  2, 'and Full-Time''s own score is left exactly where it was');

-- the squad and their parents read the stats
set local request.jwt.claims to '{"sub":"a5a5a5a5-1111-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.fixture_player_stats), 1::bigint, 'a squad player reads the stats');
reset role;
set local request.jwt.claims to '{"sub":"a5a5a5a5-1111-4111-8111-000000000004","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.fixture_player_stats), 1::bigint,
  'a guardian sees that their child scored');
reset role;

-- a stranger: reads nothing, writes nothing
set local request.jwt.claims to '{"sub":"a5a5a5a5-1111-4111-8111-000000000005","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.fixture_player_stats), 0::bigint,
  'another team''s player sees no stats');
select throws_ok(
  $$insert into public.fixture_player_stats (fixture_id, person_id, goals)
    values ('faf9f9f9-1111-4111-8111-000000000001', 'c5c5c5c5-1111-4111-8111-000000000001', 9)$$,
  '42501', null, 'another team''s player cannot write stats');
-- A write policy the caller fails is silence, not an error, on UPDATE: the row
-- is simply not visible to write, so nothing changes.
select lives_ok(
  $$update public.fixtures set coach_home_score = 9, coach_away_score = 9
     where id = 'faf9f9f9-1111-4111-8111-000000000001'$$,
  'a stranger''s scoreline update runs');
reset role;
select is((select coach_home_score from public.fixtures where id = 'faf9f9f9-1111-4111-8111-000000000001'),
  4, 'but changes nothing — the score is the coach''s');


-- =============================================================================
-- E. the importer never touches the coach's score
-- =============================================================================

-- Exactly what `import_fixtures()` writes when Full-Time's result moves: it
-- names the columns it updates, and the coach's pair is not among them.
update public.fixtures
   set kickoff_at = kickoff_at, opponent = 'Angel FC', is_home = true, competition = null,
       status = 'played', home_score = 3, away_score = 0, venue_text = null,
       imported_at = now(), last_seen_at = now()
 where id = 'faf9f9f9-1111-4111-8111-000000000001';
select is((select coach_home_score from public.fixtures where id = 'faf9f9f9-1111-4111-8111-000000000001'),
  4, 'a re-import leaves the coach''s home score untouched');
select is((select coach_away_score from public.fixtures where id = 'faf9f9f9-1111-4111-8111-000000000001'),
  1, 'and the coach''s away score');
select is((select home_score from public.fixtures where id = 'faf9f9f9-1111-4111-8111-000000000001'),
  3, 'while Full-Time''s own score moves');


-- =============================================================================
-- F. the fixture owns its stats
-- =============================================================================

delete from public.fixtures where id = 'faf9f9f9-1111-4111-8111-000000000001';
select is((select count(*) from public.fixture_player_stats
            where fixture_id = 'faf9f9f9-1111-4111-8111-000000000001'), 0::bigint,
  'deleting a fixture takes its stats with it');

select * from finish();

rollback;
