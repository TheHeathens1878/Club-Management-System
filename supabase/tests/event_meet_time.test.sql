-- =============================================================================
-- "Meet at" (20260824410000)
-- =============================================================================
--   · matches default to 30 minutes before kick-off (fixture sync included)
--   · practices and socials default to none
--   · an explicit value is respected, and event_detail computes the clock time
--   · a reschedule carries the meet time with it (relative, not a timestamp)
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(6);

insert into public.seasons (id, name, starts_on, ends_on, is_current)
  values ('7f7f7f7f-9999-4111-8111-000000000001', 'MT 2048/49', '2048-07-01', '2049-06-30', true);
insert into public.teams (id, name, age_group)
  values ('7e7e7e7e-9999-4111-8111-000000000001', 'MT Rangers', 'U15');

-- A fixture mirrors in with the default.
insert into public.fixtures (id, team_id, season_id, opponent, is_home, kickoff_at)
  values ('7d7d7d7d-9999-4111-8111-000000000001', '7e7e7e7e-9999-4111-8111-000000000001',
          '7f7f7f7f-9999-4111-8111-000000000001', 'Meet FC', true, now() + interval '10 days');
select is((select meet_minutes_before from public.events
            where fixture_id = '7d7d7d7d-9999-4111-8111-000000000001'), 30,
  'a fixture''s event meets 30 minutes before kick-off by default');

-- Socials default to no meet time; an explicit practice value is respected.
insert into public.events (id, team_id, type, title, starts_at)
  values ('7c7c7c7c-9999-4111-8111-000000000001', '7e7e7e7e-9999-4111-8111-000000000001',
          'social', 'MT quiz night', now() + interval '12 days');
select is((select meet_minutes_before from public.events where id = '7c7c7c7c-9999-4111-8111-000000000001'),
  null, 'a social has no separate meet time unless one is set');

insert into public.events (id, team_id, type, title, starts_at, meet_minutes_before)
  values ('7b7b7b7b-9999-4111-8111-000000000001', '7e7e7e7e-9999-4111-8111-000000000001',
          'practice', 'MT drills', now() + interval '13 days', 15);
select is((select meet_minutes_before from public.events where id = '7b7b7b7b-9999-4111-8111-000000000001'),
  15, 'an explicit meet time is respected');

-- event_detail computes the clock time from the offset.
select is(
  (select ((public.event_detail(e.id) ->> 'meet_at')::timestamptz) from public.events e
    where e.fixture_id = '7d7d7d7d-9999-4111-8111-000000000001'),
  (select e.starts_at - interval '30 minutes' from public.events e
    where e.fixture_id = '7d7d7d7d-9999-4111-8111-000000000001'),
  'event_detail''s meet_at is thirty minutes before the start');

-- A reschedule carries it: the offset is unchanged, the clock time moves.
update public.fixtures set kickoff_at = now() + interval '11 days'
 where id = '7d7d7d7d-9999-4111-8111-000000000001';
select is((select meet_minutes_before from public.events
            where fixture_id = '7d7d7d7d-9999-4111-8111-000000000001'), 30,
  'the offset survives a reschedule');
select is(
  (select ((public.event_detail(e.id) ->> 'meet_at')::timestamptz) from public.events e
    where e.fixture_id = '7d7d7d7d-9999-4111-8111-000000000001'),
  (select kickoff_at - interval '30 minutes' from public.fixtures
    where id = '7d7d7d7d-9999-4111-8111-000000000001'),
  'and the meet clock time follows the new kick-off');

select * from finish();
rollback;
