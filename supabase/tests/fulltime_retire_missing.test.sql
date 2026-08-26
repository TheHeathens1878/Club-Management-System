-- =============================================================================
-- The importer retires what Full-Time has stopped publishing (20260826100000)
-- =============================================================================
-- What this suite covers:
--   A  shape: fixture_import_runs.retired / .kept_back
--   B  a ref the payload did not mention, inside the window it covered, with
--      nothing built on it: deleted, and written to audit_log
--   C  the three things that protect a fixture from being retired — outside
--      the window, entered by hand, already played
--   D  a team sheet or a pitch keeps it, with a warning naming it
--   E  the brake: a run that would retire more than half of what it imported
--      retires nothing at all
--   F  the ordinary upsert counts still say what they used to
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(23);

insert into public.seasons (id, name, starts_on, ends_on, is_current)
  values ('50000000-2626-4111-8111-000000000001', 'FTR 2043/44', '2043-08-01', '2044-05-31', true);
insert into public.teams (id, name, age_group)
  values ('70000000-2626-4111-8111-000000000001', 'FTR Rovers', 'U13');

-- Six fixtures the club already holds. All inside the window the payloads
-- below cover (7 to 28 October), except `outside`, which is in December.
insert into public.fixtures (id, team_id, season_id, opponent, is_home, kickoff_at, status, source, external_ref, home_score, away_score)
values
  -- kept by every payload: its ref is always sent
  ('f0000000-2626-4111-8111-000000000001', '70000000-2626-4111-8111-000000000001', '50000000-2626-4111-8111-000000000001',
   'Still Listed FC', true, '2043-10-07 10:00+01', 'scheduled', 'fulltime', 'REF-KEPT', null, null),
  -- the phantom: nothing built on it, and the payload stops mentioning it
  ('f0000000-2626-4111-8111-000000000002', '70000000-2626-4111-8111-000000000001', '50000000-2626-4111-8111-000000000001',
   'Withdrawn United', true, '2043-10-14 10:00+01', 'scheduled', 'fulltime', 'REF-GONE', null, null),
  -- same, but in December: outside every window below
  ('f0000000-2626-4111-8111-000000000003', '70000000-2626-4111-8111-000000000001', '50000000-2626-4111-8111-000000000001',
   'Far Future FC', true, '2043-12-16 10:00+01', 'scheduled', 'fulltime', 'REF-OUTSIDE', null, null),
  -- entered by hand: never the importer's to remove
  ('f0000000-2626-4111-8111-000000000004', '70000000-2626-4111-8111-000000000001', '50000000-2626-4111-8111-000000000001',
   'Friendly Athletic', true, '2043-10-21 10:00+01', 'scheduled', 'manual', 'REF-MANUAL', null, null),
  -- already played: history is not rewritten
  ('f0000000-2626-4111-8111-000000000005', '70000000-2626-4111-8111-000000000001', '50000000-2626-4111-8111-000000000001',
   'Beaten Wanderers', true, '2043-10-21 12:00+01', 'played', 'fulltime', 'REF-PLAYED', 3, 1),
  -- a team sheet hangs off this one
  ('f0000000-2626-4111-8111-000000000006', '70000000-2626-4111-8111-000000000001', '50000000-2626-4111-8111-000000000001',
   'Picked Rangers', true, '2043-10-28 10:00+01', 'scheduled', 'fulltime', 'REF-LINEUP', null, null);

insert into public.fixture_lineups (fixture_id, formation)
  values ('f0000000-2626-4111-8111-000000000006', '4-4-2');


-- ---------------------------------------------------------------------------
-- A. Shape
-- ---------------------------------------------------------------------------
select has_column('public', 'fixture_import_runs', 'retired', 'fixture_import_runs.retired');
select has_column('public', 'fixture_import_runs', 'kept_back', 'fixture_import_runs.kept_back');


-- ---------------------------------------------------------------------------
-- B / C / D. One run: the payload covers 7–28 October and mentions two refs
-- ---------------------------------------------------------------------------
select set_config('ftr.run', (
  select run_id::text from public.import_fixtures(
    '70000000-2626-4111-8111-000000000001',
    '50000000-2626-4111-8111-000000000001',
    $j$[
      {"externalRef":"REF-KEPT","kickoffAt":"2043-10-07T09:00:00Z","opponent":"Still Listed FC","isHome":true,"status":"scheduled"},
      {"externalRef":"REF-NEW","kickoffAt":"2043-10-28T09:00:00Z","opponent":"Re-Issued Town","isHome":true,"status":"scheduled"}
    ]$j$::jsonb,
    'scheduled', 'https://fulltime.example/widget')), true);

select is((select count(*)::int from public.fixtures
            where id = 'f0000000-2626-4111-8111-000000000002'), 0,
  'a fixture the payload stopped mentioning, inside the window, with nothing on it, is gone');

select is((select count(*)::int from public.audit_log
            where action = 'fixture.retired'
              and entity_id = 'f0000000-2626-4111-8111-000000000002'), 1,
  'and the audit log says so, once');

select is((select detail->>'external_ref' from public.audit_log
            where action = 'fixture.retired'
              and entity_id = 'f0000000-2626-4111-8111-000000000002'), 'REF-GONE',
  'carrying the Full-Time ref it was published under');

select is((select detail->>'opponent' from public.audit_log
            where action = 'fixture.retired'
              and entity_id = 'f0000000-2626-4111-8111-000000000002'), 'Withdrawn United',
  'and who it was against, so it can be re-entered by hand');

-- C. The three protections
select is((select count(*)::int from public.fixtures
            where id = 'f0000000-2626-4111-8111-000000000003'), 1,
  'a fixture OUTSIDE the window the payload covered is not touched');
select is((select count(*)::int from public.fixtures
            where id = 'f0000000-2626-4111-8111-000000000004'), 1,
  'a fixture entered by hand is never the importer''s to remove');
select is((select count(*)::int from public.fixtures
            where id = 'f0000000-2626-4111-8111-000000000005'), 1,
  'and a played fixture stays — history is not rewritten');

-- D. A team sheet keeps it
select is((select count(*)::int from public.fixtures
            where id = 'f0000000-2626-4111-8111-000000000006'), 1,
  'a fixture with a team sheet is kept back rather than deleted');
select is((select count(*)::int from public.audit_log
            where action = 'fixture.retired'
              and entity_id = 'f0000000-2626-4111-8111-000000000006'), 0,
  'and it is not reported as retired, because it was not');

select is((select retired from public.fixture_import_runs where id = current_setting('ftr.run')::bigint), 1,
  'the run counted the one it removed');
select is((select kept_back from public.fixture_import_runs where id = current_setting('ftr.run')::bigint), 1,
  'and the one it kept back');
select ok((select warnings::text from public.fixture_import_runs where id = current_setting('ftr.run')::bigint)
          like '%Picked Rangers%',
  'the warning names the fixture an administrator has to decide about');
select ok((select warnings::text from public.fixture_import_runs where id = current_setting('ftr.run')::bigint)
          like '%team sheet%',
  'and says why it was left');

-- And the new ref arrived as an ordinary insert.
select is((select opponent from public.fixtures
            where team_id = '70000000-2626-4111-8111-000000000001' and external_ref = 'REF-NEW'),
  'Re-Issued Town', 'the replacement fixture imported normally');


-- ---------------------------------------------------------------------------
-- E. The brake
-- ---------------------------------------------------------------------------
-- Four more phantoms in one window, against a payload of one. Retiring four on
-- the word of a single-fixture payload is what a half-loaded fetch looks like.
insert into public.fixtures (team_id, season_id, opponent, is_home, kickoff_at, status, source, external_ref)
values
  ('70000000-2626-4111-8111-000000000001', '50000000-2626-4111-8111-000000000001', 'Brake A', true, '2044-02-06 10:00+00', 'scheduled', 'fulltime', 'REF-B1'),
  ('70000000-2626-4111-8111-000000000001', '50000000-2626-4111-8111-000000000001', 'Brake B', true, '2044-02-13 10:00+00', 'scheduled', 'fulltime', 'REF-B2'),
  ('70000000-2626-4111-8111-000000000001', '50000000-2626-4111-8111-000000000001', 'Brake C', true, '2044-02-20 10:00+00', 'scheduled', 'fulltime', 'REF-B3'),
  ('70000000-2626-4111-8111-000000000001', '50000000-2626-4111-8111-000000000001', 'Brake D', true, '2044-02-27 10:00+00', 'scheduled', 'fulltime', 'REF-B4');

select set_config('ftr.brake', (
  select run_id::text from public.import_fixtures(
    '70000000-2626-4111-8111-000000000001',
    '50000000-2626-4111-8111-000000000001',
    $j$[
      {"externalRef":"REF-B0","kickoffAt":"2044-02-01T10:00:00Z","opponent":"The Only One Sent","isHome":true,"status":"scheduled"},
      {"externalRef":"REF-B9","kickoffAt":"2044-03-01T10:00:00Z","opponent":"And Its Bookend","isHome":true,"status":"scheduled"}
    ]$j$::jsonb,
    'scheduled', 'https://fulltime.example/widget')), true);

select is((select count(*)::int from public.fixtures
            where team_id = '70000000-2626-4111-8111-000000000001'
              and external_ref in ('REF-B1','REF-B2','REF-B3','REF-B4')), 4,
  'a run that would retire more than half of what it imported retires nothing');
select is((select retired from public.fixture_import_runs where id = current_setting('ftr.brake')::bigint), 0,
  'the run says it removed none');
select is((select kept_back from public.fixture_import_runs where id = current_setting('ftr.brake')::bigint), 4,
  'and that four were left standing');
select ok((select warnings::text from public.fixture_import_runs where id = current_setting('ftr.brake')::bigint)
          like '%short fetch%',
  'and names a short fetch as the likely reason, rather than saying nothing');


-- ---------------------------------------------------------------------------
-- F. The ordinary counts still mean what they meant
-- ---------------------------------------------------------------------------
select is((select inserted from public.import_fixtures(
    '70000000-2626-4111-8111-000000000001',
    '50000000-2626-4111-8111-000000000001',
    $j$[{"externalRef":"REF-KEPT","kickoffAt":"2043-10-07T09:00:00Z","opponent":"Still Listed FC","isHome":true,"status":"scheduled"}]$j$::jsonb,
    'manual_url', null)), 0, 'a ref already held inserts nothing');

select is((select updated from public.import_fixtures(
    '70000000-2626-4111-8111-000000000001',
    '50000000-2626-4111-8111-000000000001',
    $j$[{"externalRef":"REF-KEPT","kickoffAt":"2043-10-07T14:00:00Z","opponent":"Still Listed FC","isHome":true,"status":"scheduled"}]$j$::jsonb,
    'manual_url', null)), 1, 'a reschedule is an update of the same row, not a duplicate');

select is((select count(*)::int from public.fixtures
            where team_id = '70000000-2626-4111-8111-000000000001' and external_ref = 'REF-KEPT'), 1,
  'and there is still exactly one of it');

select * from finish();
rollback;
