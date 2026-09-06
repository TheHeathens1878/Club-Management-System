-- =============================================================================
-- A withdrawn fixture frees its pitch (20260906110000)
-- =============================================================================
--   A  a fixture with only a pitch booked is retired: the fixture goes, the
--      booking is cancelled, the audit row says so
--   B  a fixture with a pitch AND a team sheet is kept back and flagged, but
--      its booking is cancelled all the same, and the message says so
--   C  the brake still holds everything, pitch included
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(12);

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1b2c3d4-0906-4111-8111-000000000001', 'wf-admin@test.invalid', '{"full_name": "Wanda Admin"}'::jsonb);
select set_config('wf.admin', (select person_id::text from public.profiles where id = 'a1b2c3d4-0906-4111-8111-000000000001'), true);
insert into public.person_roles (person_id, role, granted_by)
  values (current_setting('wf.admin')::uuid, 'club_admin', 'a1b2c3d4-0906-4111-8111-000000000001');

insert into public.seasons (id, name, starts_on, ends_on, is_current)
  values ('5111a111-0906-4111-8111-000000000001', 'WF 2045/46', '2045-08-01', '2046-05-31', true);
insert into public.teams (id, name, age_group)
  values ('7111a111-0906-4111-8111-000000000001', 'Withdrawn Wanderers', 'U13');
insert into public.resources (id, type, name, active)
  values ('917c917c-0906-4111-8111-000000000001', 'pitch', 'WF Pitch 1', true);

-- PITCHED has a pitch and nothing else; SHEETED has a pitch and a team sheet.
insert into public.fixtures (id, team_id, season_id, opponent, is_home, kickoff_at, status, source, external_ref)
values
  ('f111a111-0906-4111-8111-000000000001', '7111a111-0906-4111-8111-000000000001', '5111a111-0906-4111-8111-000000000001',
   'Pitched Rovers', true, '2045-10-14 10:00+01', 'scheduled', 'fulltime', 'WF-PITCHED'),
  ('f111a111-0906-4111-8111-000000000002', '7111a111-0906-4111-8111-000000000001', '5111a111-0906-4111-8111-000000000001',
   'Sheeted Town', true, '2045-10-21 10:00+01', 'scheduled', 'fulltime', 'WF-SHEETED');
select public.allocate_fixture('f111a111-0906-4111-8111-000000000001', '917c917c-0906-4111-8111-000000000001');
select public.allocate_fixture('f111a111-0906-4111-8111-000000000002', '917c917c-0906-4111-8111-000000000001');
insert into public.fixture_lineups (fixture_id, formation)
  values ('f111a111-0906-4111-8111-000000000002', '4-3-3');

select set_config('wf.pitched_booking',
  (select booking_id::text from public.fixtures where id = 'f111a111-0906-4111-8111-000000000001'), true);
select set_config('wf.sheeted_booking',
  (select booking_id::text from public.fixtures where id = 'f111a111-0906-4111-8111-000000000002'), true);
select isnt(current_setting('wf.pitched_booking'), '', 'both fixtures hold a confirmed pitch booking to begin with');

-- The payload covers 7 to 28 October and mentions neither.
select set_config('wf.payload', $j$[
  {"externalRef":"WF-A","kickoffAt":"2045-10-07T09:00:00Z","opponent":"Listed One","isHome":true,"status":"scheduled"},
  {"externalRef":"WF-B","kickoffAt":"2045-10-28T09:00:00Z","opponent":"Listed Two","isHome":true,"status":"scheduled"}
]$j$, true);

select is((select count(*)::int from public.import_fixtures(
  '7111a111-0906-4111-8111-000000000001', '5111a111-0906-4111-8111-000000000001',
  current_setting('wf.payload')::jsonb, 'scheduled', null)), 1, 'the run happens');

-- A. pitch only ------------------------------------------------------------------
select is((select count(*)::int from public.fixtures where id = 'f111a111-0906-4111-8111-000000000001'), 0,
  'a fixture that had only a pitch is removed — the pitch was never a reason to keep it');
select is((select status::text from public.bookings where id = current_setting('wf.pitched_booking')::uuid),
  'cancelled', 'and its booking is cancelled, not left holding the slot');
select is((select fixture_id from public.bookings where id = current_setting('wf.pitched_booking')::uuid),
  null, 'with the link to the fixture cut');
select is((select (detail ->> 'booking_cancelled')::uuid from public.audit_log
            where action = 'fixture.retired' and entity_id = 'f111a111-0906-4111-8111-000000000001'),
  current_setting('wf.pitched_booking')::uuid, 'the audit row names the booking it cancelled');

-- B. pitch and team sheet -------------------------------------------------------------
select isnt((select no_longer_published_at from public.fixtures where id = 'f111a111-0906-4111-8111-000000000002'),
  null, 'a fixture with a team sheet is kept back and flagged, as before');
select is((select status::text from public.bookings where id = current_setting('wf.sheeted_booking')::uuid),
  'cancelled', 'but its pitch booking is cancelled all the same');
select is((select booking_id from public.fixtures where id = 'f111a111-0906-4111-8111-000000000002'),
  null, 'and the fixture no longer points at it');
select ok((select body from public.outbound_messages
            where person_id = current_setting('wf.admin')::uuid
              and subject like '%no longer in Full-Time%' limit 1) like '%pitch booking has been cancelled%',
  'the administrator is told the pitch was freed');
select ok((select warnings::text from public.fixture_import_runs
            where team_id = '7111a111-0906-4111-8111-000000000001' order by id desc limit 1)
          like '%2 pitch bookings were cancelled%',
  'the run''s warnings count the bookings freed');

-- C. the brake -----------------------------------------------------------------
-- Three more pitched fixtures inside a window that publishes only one: more
-- than half missing, so nothing moves — bookings included.
insert into public.fixtures (id, team_id, season_id, opponent, is_home, kickoff_at, status, source, external_ref)
values
  ('f111a111-0906-4111-8111-000000000003', '7111a111-0906-4111-8111-000000000001', '5111a111-0906-4111-8111-000000000001',
   'Brake One', true, '2045-11-04 10:00+00', 'scheduled', 'fulltime', 'WF-BR1'),
  ('f111a111-0906-4111-8111-000000000004', '7111a111-0906-4111-8111-000000000001', '5111a111-0906-4111-8111-000000000001',
   'Brake Two', true, '2045-11-11 10:00+00', 'scheduled', 'fulltime', 'WF-BR2'),
  ('f111a111-0906-4111-8111-000000000005', '7111a111-0906-4111-8111-000000000001', '5111a111-0906-4111-8111-000000000001',
   'Brake Three', true, '2045-11-18 10:00+00', 'scheduled', 'fulltime', 'WF-BR3');
select public.allocate_fixture('f111a111-0906-4111-8111-000000000003', '917c917c-0906-4111-8111-000000000001');
select public.allocate_fixture('f111a111-0906-4111-8111-000000000004', '917c917c-0906-4111-8111-000000000001');
select public.allocate_fixture('f111a111-0906-4111-8111-000000000005', '917c917c-0906-4111-8111-000000000001');
select public.import_fixtures(
  '7111a111-0906-4111-8111-000000000001', '5111a111-0906-4111-8111-000000000001',
  $j$[{"externalRef":"WF-C","kickoffAt":"2045-11-01T10:00:00Z","opponent":"Listed Three","isHome":true,"status":"scheduled"},
      {"externalRef":"WF-D","kickoffAt":"2045-11-25T10:00:00Z","opponent":"Listed Four","isHome":true,"status":"scheduled"}]$j$::jsonb,
  'scheduled', null);
select is((select count(*)::int from public.bookings b
            join public.fixtures f on f.booking_id = b.id
           where f.id in ('f111a111-0906-4111-8111-000000000003', 'f111a111-0906-4111-8111-000000000004', 'f111a111-0906-4111-8111-000000000005')
             and b.status = 'confirmed'), 3,
  'the brake leaves all three bookings confirmed — a short fetch frees nothing');

select * from finish();
rollback;
