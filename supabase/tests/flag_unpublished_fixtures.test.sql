-- =============================================================================
-- Somebody is told when a fixture is kept back (20260826110000)
-- =============================================================================
-- What this suite covers:
--   A  shape: fixtures.no_longer_published_at
--   B  a kept-back fixture is flagged, and every club administrator is told
--   C  the SECOND run says nothing — the flag is the record of "already said",
--      which is what stops the nightly cron repeating itself for a fortnight
--   D  the flag is cleared the moment Full-Time publishes the fixture again
--   E  the brake flags nothing and tells nobody, because a run that does not
--      believe its payload must not raise an alarm it cannot unsend
--
-- Assertion count, kept in step as sections are added: A 2, B 5, C 2, D 2,
-- E 3  =  14.
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(14);

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1b2c3d4-2611-4111-8111-000000000001', 'flag-admin@test.invalid', '{"full_name": "Ada Admin"}'::jsonb);
select set_config('fl.admin', (select person_id::text from public.profiles where id = 'a1b2c3d4-2611-4111-8111-000000000001'), true);
insert into public.person_roles (person_id, role, granted_by)
  values (current_setting('fl.admin')::uuid, 'club_admin', 'a1b2c3d4-2611-4111-8111-000000000001');

insert into public.seasons (id, name, starts_on, ends_on, is_current)
  values ('5111a111-2611-4111-8111-000000000001', 'FLAG 2043/44', '2043-08-01', '2044-05-31', true);
insert into public.teams (id, name, age_group)
  values ('7111a111-2611-4111-8111-000000000001', 'Flag Wanderers', 'U14');

-- Two fixtures the club holds. `KEPT` has a team sheet, so the importer will
-- not remove it; `BARE` has nothing, so it is deleted silently.
insert into public.fixtures (id, team_id, season_id, opponent, is_home, kickoff_at, status, source, external_ref)
values
  ('f111a111-2611-4111-8111-000000000001', '7111a111-2611-4111-8111-000000000001', '5111a111-2611-4111-8111-000000000001',
   'Kept Rangers', true, '2043-10-14 10:00+01', 'scheduled', 'fulltime', 'FLAG-KEPT'),
  ('f111a111-2611-4111-8111-000000000002', '7111a111-2611-4111-8111-000000000001', '5111a111-2611-4111-8111-000000000001',
   'Bare Athletic', true, '2043-10-21 10:00+01', 'scheduled', 'fulltime', 'FLAG-BARE');
insert into public.fixture_lineups (fixture_id, formation)
  values ('f111a111-2611-4111-8111-000000000001', '4-4-2');


-- ---------------------------------------------------------------------------
-- A. Shape                                                            (2)
-- ---------------------------------------------------------------------------
select has_column('public', 'fixtures', 'no_longer_published_at', 'fixtures.no_longer_published_at');
select col_is_null('public', 'fixtures', 'no_longer_published_at',
  'it is nullable — null means Full-Time still publishes it');


-- ---------------------------------------------------------------------------
-- B. The run that finds it flags it and tells the club                (5)
-- ---------------------------------------------------------------------------
-- The payload covers 7 to 28 October and mentions neither of the two above.
select set_config('fl.payload', $j$[
  {"externalRef":"FLAG-A","kickoffAt":"2043-10-07T09:00:00Z","opponent":"Listed One","isHome":true,"status":"scheduled"},
  {"externalRef":"FLAG-B","kickoffAt":"2043-10-28T09:00:00Z","opponent":"Listed Two","isHome":true,"status":"scheduled"}
]$j$, true);

select is((select count(*)::int from public.import_fixtures(
  '7111a111-2611-4111-8111-000000000001', '5111a111-2611-4111-8111-000000000001',
  current_setting('fl.payload')::jsonb, 'scheduled', null)), 1, 'the first run happens');

select isnt((select no_longer_published_at from public.fixtures
              where id = 'f111a111-2611-4111-8111-000000000001'), null,
  'the fixture that was kept back is flagged');

select is((select count(*)::int from public.fixtures
            where id = 'f111a111-2611-4111-8111-000000000002'), 0,
  'and the one with nothing on it was simply removed, as before');

select is((select count(*)::int from public.outbound_messages
            where person_id = current_setting('fl.admin')::uuid
              and channel = 'in_app'
              and subject like '%no longer in Full-Time%'), 1,
  'the club administrator is told, once');

select ok((select body from public.outbound_messages
            where person_id = current_setting('fl.admin')::uuid
              and subject like '%no longer in Full-Time%' limit 1) like '%Kept Rangers%',
  'and the message names the fixture rather than just counting it');


-- ---------------------------------------------------------------------------
-- C. The next run is silent                                           (2)
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public.import_fixtures(
  '7111a111-2611-4111-8111-000000000001', '5111a111-2611-4111-8111-000000000001',
  current_setting('fl.payload')::jsonb, 'scheduled', null)), 1, 'the cron runs again');

select is((select count(*)::int from public.outbound_messages
            where person_id = current_setting('fl.admin')::uuid
              and subject like '%no longer in Full-Time%'), 1,
  'and says nothing new — one message for one fixture, not one a night');


-- ---------------------------------------------------------------------------
-- D. Published again means published again                            (2)
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public.import_fixtures(
  '7111a111-2611-4111-8111-000000000001', '5111a111-2611-4111-8111-000000000001',
  $j$[
    {"externalRef":"FLAG-A","kickoffAt":"2043-10-07T09:00:00Z","opponent":"Listed One","isHome":true,"status":"scheduled"},
    {"externalRef":"FLAG-KEPT","kickoffAt":"2043-10-14T09:00:00Z","opponent":"Kept Rangers","isHome":true,"status":"scheduled"},
    {"externalRef":"FLAG-B","kickoffAt":"2043-10-28T09:00:00Z","opponent":"Listed Two","isHome":true,"status":"scheduled"}
  ]$j$::jsonb, 'scheduled', null)), 1, 'a later run publishes it again');

select is((select no_longer_published_at from public.fixtures
            where id = 'f111a111-2611-4111-8111-000000000001'), null,
  'and the flag goes, because the game is in the fixture list again');


-- ---------------------------------------------------------------------------
-- E. The brake tells nobody                                           (3)
-- ---------------------------------------------------------------------------
-- Four fixtures with team sheets in one window, against a payload of two.
insert into public.fixtures (id, team_id, season_id, opponent, is_home, kickoff_at, status, source, external_ref)
values
  ('f111a111-2611-4111-8111-000000000011', '7111a111-2611-4111-8111-000000000001', '5111a111-2611-4111-8111-000000000001', 'Brake A', true, '2044-02-06 10:00+00', 'scheduled', 'fulltime', 'FLAG-C1'),
  ('f111a111-2611-4111-8111-000000000012', '7111a111-2611-4111-8111-000000000001', '5111a111-2611-4111-8111-000000000001', 'Brake B', true, '2044-02-13 10:00+00', 'scheduled', 'fulltime', 'FLAG-C2'),
  ('f111a111-2611-4111-8111-000000000013', '7111a111-2611-4111-8111-000000000001', '5111a111-2611-4111-8111-000000000001', 'Brake C', true, '2044-02-20 10:00+00', 'scheduled', 'fulltime', 'FLAG-C3'),
  ('f111a111-2611-4111-8111-000000000014', '7111a111-2611-4111-8111-000000000001', '5111a111-2611-4111-8111-000000000001', 'Brake D', true, '2044-02-27 10:00+00', 'scheduled', 'fulltime', 'FLAG-C4');
insert into public.fixture_lineups (fixture_id, formation) values
  ('f111a111-2611-4111-8111-000000000011', '4-4-2'),
  ('f111a111-2611-4111-8111-000000000012', '4-4-2'),
  ('f111a111-2611-4111-8111-000000000013', '4-4-2'),
  ('f111a111-2611-4111-8111-000000000014', '4-4-2');

select is((select count(*)::int from public.import_fixtures(
  '7111a111-2611-4111-8111-000000000001', '5111a111-2611-4111-8111-000000000001',
  $j$[
    {"externalRef":"FLAG-D0","kickoffAt":"2044-02-01T10:00:00Z","opponent":"The Only One Sent","isHome":true,"status":"scheduled"},
    {"externalRef":"FLAG-D9","kickoffAt":"2044-03-01T10:00:00Z","opponent":"And Its Bookend","isHome":true,"status":"scheduled"}
  ]$j$::jsonb, 'scheduled', null)), 1, 'a short-looking run happens');

select is((select count(*)::int from public.fixtures
            where id::text like 'f111a111-2611-4111-8111-00000000001%'
              and no_longer_published_at is not null), 0,
  'the brake flags nothing — the run has just said it does not believe the payload');

select is((select count(*)::int from public.outbound_messages
            where person_id = current_setting('fl.admin')::uuid
              and subject like '%no longer in Full-Time%'), 1,
  'and tells nobody, because a false alarm cannot be unsent');

select * from finish();
rollback;
