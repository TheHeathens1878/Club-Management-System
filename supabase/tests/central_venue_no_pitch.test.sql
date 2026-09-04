-- =============================================================================
-- Central-venue teams need no pitch (20260904090000)
-- =============================================================================
--   A team whose home ground is a central venue the club does not manage gets
--   no pitch booking, so its home fixtures belong in neither the /pitches
--   work list (`unallocated_home_fixtures`) nor the lobby's counter
--   (`club_overview()`). A whitespace-only central venue cannot exist at all
--   — `teams_central_venue_name_check` refuses it — so the view's btrim guard
--   is belt-and-braces, and the CHECK is what this file pins.
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(6);

insert into auth.users (id, email, raw_user_meta_data) values
  ('c7c7c7c7-aaaa-4111-8111-000000000001', 'cv-admin@test.invalid', '{"full_name": "Ada Admin", "dob": "1975-01-01"}'::jsonb);
insert into public.person_roles (person_id, role, granted_by)
  values ((select person_id from public.profiles where id = 'c7c7c7c7-aaaa-4111-8111-000000000001'),
          'club_admin', 'c7c7c7c7-aaaa-4111-8111-000000000001');

insert into public.seasons (id, name, starts_on, ends_on, is_current)
  values ('5c5c5c5c-aaaa-4111-8111-000000000001', 'CV 2050/51', current_date - 30, current_date + 300, true);

-- Two teams: one at home, one at a central venue.
insert into public.teams (id, name, central_venue_name) values
  ('9c9c9c9c-aaaa-4111-8111-000000000001', 'CV Home',    null),
  ('9c9c9c9c-aaaa-4111-8111-000000000002', 'CV Central', 'Partington Sports Village');

-- One upcoming home fixture each, none with a booking.
insert into public.fixtures (id, team_id, season_id, opponent, is_home, kickoff_at) values
  ('fc0c0c0c-aaaa-4111-8111-000000000001', '9c9c9c9c-aaaa-4111-8111-000000000001', '5c5c5c5c-aaaa-4111-8111-000000000001', 'Foe A', true, now() + interval '5 days'),
  ('fc0c0c0c-aaaa-4111-8111-000000000002', '9c9c9c9c-aaaa-4111-8111-000000000002', '5c5c5c5c-aaaa-4111-8111-000000000001', 'Foe B', true, now() + interval '5 days');

-- The view --------------------------------------------------------------------
select is((select count(*) from public.unallocated_home_fixtures
           where team_id = '9c9c9c9c-aaaa-4111-8111-000000000001'), 1::bigint,
  'a home team''s fixture waits for a pitch');
select is((select count(*) from public.unallocated_home_fixtures
           where team_id = '9c9c9c9c-aaaa-4111-8111-000000000002'), 0::bigint,
  'a central-venue team''s fixture never appears in the work list');
select throws_ok(
  $$update public.teams set central_venue_name = '   '
     where id = '9c9c9c9c-aaaa-4111-8111-000000000001'$$,
  '23514', null,
  'a whitespace-only central venue cannot exist — the CHECK refuses it');

-- Clearing the central venue puts the team back on the list ------------------
update public.teams set central_venue_name = null
 where id = '9c9c9c9c-aaaa-4111-8111-000000000002';
select is((select count(*) from public.unallocated_home_fixtures
           where team_id = '9c9c9c9c-aaaa-4111-8111-000000000002'), 1::bigint,
  'a team that leaves its central venue needs pitches again');
update public.teams set central_venue_name = 'Partington Sports Village'
 where id = '9c9c9c9c-aaaa-4111-8111-000000000002';

-- The lobby counter -----------------------------------------------------------
set local request.jwt.claims to '{"sub":"c7c7c7c7-aaaa-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select (public.club_overview() ->> 'unallocated_home_fixtures')::integer), 1,
  'the overview counts the home team, not the central-venue team');
reset role;

-- The view kept security_invoker through the replace --------------------------
select is((select 'security_invoker=true' = any(c.reloptions)
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname = 'unallocated_home_fixtures'), true,
  'unallocated_home_fixtures is still security_invoker');

select * from finish();
rollback;
