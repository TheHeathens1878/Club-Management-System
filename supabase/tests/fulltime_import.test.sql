-- =============================================================================
-- P2.4 — import_fixtures(), record_fixture_import_failure(), fixture_import_runs
-- =============================================================================
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(30);

insert into auth.users (id, email, raw_user_meta_data) values
  ('a6a6a6a6-1111-4111-8111-000000000001', 'i-admin@test.invalid', '{"full_name": "Ada Admin"}'::jsonb),
  ('a6a6a6a6-1111-4111-8111-000000000002', 'i-coach@test.invalid', '{"full_name": "Cy Coach"}'::jsonb);
update public.profiles set role = 'committee' where id = 'a6a6a6a6-1111-4111-8111-000000000001';

insert into public.seasons (id, name, starts_on, ends_on, is_current)
  values ('5c5c5c5c-1111-4111-8111-000000000001', 'Imp 2035/36', '2035-08-01', '2036-05-31', false);
insert into public.teams (id, name) values ('7c7c7c7c-1111-4111-8111-000000000001', 'Imp U12s');
insert into public.team_fulltime_links (team_id, source_url, league_id, ft_season_id)
  values ('7c7c7c7c-1111-4111-8111-000000000001', 'https://fulltime.thefa.com/fixtures.html?league=1', '1', '2');

-- a manual fixture the importer must never touch
insert into public.fixtures (id, team_id, season_id, opponent, is_home, kickoff_at, source, external_ref)
  values ('f6f6f6f6-1111-4111-8111-000000000009', '7c7c7c7c-1111-4111-8111-000000000001', '5c5c5c5c-1111-4111-8111-000000000001',
          'Friendly XI', true, '2035-09-01 10:30+01', 'manual', 'manual-1');

select has_table('public', 'fixture_import_runs', 'fixture_import_runs');
select ok((select relrowsecurity from pg_class where oid = 'public.fixture_import_runs'::regclass), 'RLS on runs');
select ok(not has_function_privilege('authenticated', 'public.fulltime_import_targets()', 'EXECUTE'), 'targets() is service_role only');

-- Run 1: two fixtures
select results_eq(
  $$select inserted, updated, unchanged from public.import_fixtures(
      '7c7c7c7c-1111-4111-8111-000000000001', '5c5c5c5c-1111-4111-8111-000000000001',
      '[{"externalRef":"A1","kickoffAt":"2035-09-08T09:30:00Z","opponent":"Angel FC","isHome":true,"competition":"League","status":"scheduled"},
        {"externalRef":"A2","kickoffAt":"2035-09-15T09:30:00Z","opponent":"Rovers","isHome":false,"competition":"League","status":"scheduled"}]'::jsonb,
      'scheduled', 'https://fulltime.thefa.com/fixtures.html?league=1')$$,
  $$values (2, 0, 0)$$, 'run 1 inserts two fixtures');
select is((select count(*) from public.fixtures where team_id = '7c7c7c7c-1111-4111-8111-000000000001' and source = 'fulltime'), 2::bigint, 'two fulltime rows');
select is((select (last_import_status, last_import_count) from public.team_fulltime_links where team_id = '7c7c7c7c-1111-4111-8111-000000000001'),
  ('ok'::text, 2), 'link mirrors the run outcome');
select is((select (status, inserted, trigger) from public.fixture_import_runs where team_id = '7c7c7c7c-1111-4111-8111-000000000001' order by id desc limit 1),
  ('ok'::text, 2, 'scheduled'::text), 'run row written');

-- Run 2: identical payload → unchanged, last_seen bumped, no duplicates
select set_config('i.seen0', (select last_seen_at::text from public.fixtures where external_ref = 'A1' and team_id = '7c7c7c7c-1111-4111-8111-000000000001'), true);
select results_eq(
  $$select inserted, updated, unchanged from public.import_fixtures(
      '7c7c7c7c-1111-4111-8111-000000000001', '5c5c5c5c-1111-4111-8111-000000000001',
      '[{"externalRef":"A1","kickoffAt":"2035-09-08T09:30:00Z","opponent":"Angel FC","isHome":true,"competition":"League","status":"scheduled"},
        {"externalRef":"A2","kickoffAt":"2035-09-15T09:30:00Z","opponent":"Rovers","isHome":false,"competition":"League","status":"scheduled"}]'::jsonb)$$,
  $$values (0, 0, 2)$$, 'repeat run reconciles cleanly: nothing inserted or updated');
select is((select count(*) from public.fixtures where team_id = '7c7c7c7c-1111-4111-8111-000000000001' and source = 'fulltime'), 2::bigint, 'still two rows (no duplicates)');

-- Run 3: reschedule + postponement + a result → updates of the same rows
select results_eq(
  $$select inserted, updated, unchanged from public.import_fixtures(
      '7c7c7c7c-1111-4111-8111-000000000001', '5c5c5c5c-1111-4111-8111-000000000001',
      '[{"externalRef":"A1","kickoffAt":"2035-09-09T13:00:00Z","opponent":"Angel FC","isHome":true,"competition":"League","status":"scheduled"},
        {"externalRef":"A2","kickoffAt":"2035-09-15T09:30:00Z","opponent":"Rovers","isHome":false,"competition":"League","status":"postponed"},
        {"externalRef":"A3","kickoffAt":"2035-08-25T09:30:00Z","opponent":"Town","isHome":true,"competition":"Cup","status":"played","homeScore":2,"awayScore":1}]'::jsonb)$$,
  $$values (1, 2, 0)$$, 'reschedule and postponement are updates; the played cup tie is new');
select is((select kickoff_at from public.fixtures where external_ref = 'A1' and team_id = '7c7c7c7c-1111-4111-8111-000000000001'),
  '2035-09-09 13:00+00'::timestamptz, 'A1 moved');
select is((select status::text from public.fixtures where external_ref = 'A2' and team_id = '7c7c7c7c-1111-4111-8111-000000000001'),
  'postponed', 'A2 postponed');
select is((select (status::text, home_score, away_score) from public.fixtures where external_ref = 'A3' and team_id = '7c7c7c7c-1111-4111-8111-000000000001'),
  ('played'::text, 2, 1), 'result imported');
select is((select count(*) from public.fixtures where team_id = '7c7c7c7c-1111-4111-8111-000000000001'), 4::bigint, 'three fulltime + one manual');

-- Run 4: a fixture missing from the page is NOT cancelled; the manual row is untouched
select results_eq(
  $$select inserted, updated, unchanged from public.import_fixtures(
      '7c7c7c7c-1111-4111-8111-000000000001', '5c5c5c5c-1111-4111-8111-000000000001',
      '[{"externalRef":"A1","kickoffAt":"2035-09-09T13:00:00Z","opponent":"Angel FC","isHome":true,"competition":"League","status":"scheduled"}]'::jsonb)$$,
  $$values (0, 0, 1)$$, 'a shorter page touches only what it lists');
select is((select status::text from public.fixtures where external_ref = 'A2' and team_id = '7c7c7c7c-1111-4111-8111-000000000001'),
  'postponed', 'absent fixture keeps its state (absence is not cancellation)');
select is((select (opponent, source::text) from public.fixtures where id = 'f6f6f6f6-1111-4111-8111-000000000009'),
  ('Friendly XI'::text, 'manual'::text), 'manual fixture untouched');

-- A manual row carrying an imported ref is the admin's
select results_eq(
  $$select inserted, updated, unchanged from public.import_fixtures(
      '7c7c7c7c-1111-4111-8111-000000000001', '5c5c5c5c-1111-4111-8111-000000000001',
      '[{"externalRef":"manual-1","kickoffAt":"2035-09-01T09:30:00Z","opponent":"Someone Else","isHome":true,"status":"scheduled"}]'::jsonb)$$,
  $$values (0, 0, 1)$$, 'an import never overwrites a manual row');

-- Validation
select throws_ok(
  $$select * from public.import_fixtures('7c7c7c7c-1111-4111-8111-000000000001', '5c5c5c5c-1111-4111-8111-000000000001', '{"not":"an array"}'::jsonb)$$,
  '22023', null, 'payload must be an array');
select throws_ok(
  $$select * from public.import_fixtures('7c7c7c7c-1111-4111-8111-000000000001', '5c5c5c5c-1111-4111-8111-000000000001', '[{"kickoffAt":"2035-09-09T13:00:00Z","opponent":"X"}]'::jsonb)$$,
  '22023', null, 'every fixture needs an externalRef');
select throws_ok(
  $$select * from public.import_fixtures('7c7c7c7c-1111-4111-8111-000000000001', '5c5c5c5c-1111-4111-8111-000000000001', '[{"externalRef":"Z","kickoffAt":"2035-09-09T13:00:00Z","opponent":"X","status":"weird"}]'::jsonb)$$,
  '22P02', null, 'an unknown status is refused');
-- a half-score is dropped rather than violating the pair check
select lives_ok(
  $$select * from public.import_fixtures('7c7c7c7c-1111-4111-8111-000000000001', '5c5c5c5c-1111-4111-8111-000000000001', '[{"externalRef":"A4","kickoffAt":"2035-10-01T13:00:00Z","opponent":"X","isHome":true,"status":"played","homeScore":3}]'::jsonb)$$,
  'a lone score is tolerated');
select is((select (home_score, away_score) from public.fixtures where external_ref = 'A4' and team_id = '7c7c7c7c-1111-4111-8111-000000000001'),
  (null::integer, null::integer), 'and stored as no score');

-- Failure recording
select set_config('i.audit0', (select count(*)::text from public.audit_log where action = 'fixtures.import_failed'), true);
select lives_ok(
  $$select public.record_fixture_import_failure('7c7c7c7c-1111-4111-8111-000000000001', 'scheduled', 'challenge', 'https://fulltime.thefa.com/x', 'Cloudflare challenge')$$,
  'a challenge is recorded');
select is((select (last_import_status, last_error) from public.team_fulltime_links where team_id = '7c7c7c7c-1111-4111-8111-000000000001'),
  ('challenge'::text, 'Cloudflare challenge'::text), 'link shows the challenge');
select is((select count(*) from public.audit_log where action = 'fixtures.import_failed'), current_setting('i.audit0')::bigint + 1,
  'failure alerts via audit_log');

-- Who may call
set local request.jwt.claims to '{"sub":"a6a6a6a6-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select * from public.import_fixtures('7c7c7c7c-1111-4111-8111-000000000001', '5c5c5c5c-1111-4111-8111-000000000001', '[]'::jsonb)$$,
  '42501', null, 'a coach cannot import');
select is((select count(*) from public.fixture_import_runs), 0::bigint, 'a coach sees no runs');
reset role;
set local request.jwt.claims to '{"sub":"a6a6a6a6-1111-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$select * from public.import_fixtures('7c7c7c7c-1111-4111-8111-000000000001', '5c5c5c5c-1111-4111-8111-000000000001', '[]'::jsonb, 'manual_csv')$$,
  'club_admin runs a manual import');
select ok((select count(*) from public.fixture_import_runs where team_id = '7c7c7c7c-1111-4111-8111-000000000001') >= 6, 'club_admin reads the runs');
reset role;

select * from finish();

rollback;
