-- =============================================================================
-- Matchday reads (20260824410000)
-- =============================================================================
--   A  scoping: a coach's desk is their teams; an admin's is the club; a
--      player's is empty
--   B  matchday_fixtures: pitch, allocation, and the RSVP arithmetic
--   C  training_sessions: the week's sessions with the same arithmetic
--   D  training_attendance_term: there/(marked) — late still trained, and the
--      unmarked are not silently absent
--   E  social_events: club-public numbers, manage flag for staff
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(15);

insert into auth.users (id, email, raw_user_meta_data) values
  ('a9a9a9a9-9999-4111-8111-000000000001', 'md-admin@test.invalid',  '{"full_name": "Ada Admin", "dob": "1976-01-01"}'::jsonb),
  ('a9a9a9a9-9999-4111-8111-000000000002', 'md-coach@test.invalid',  '{"full_name": "Cal Coach", "dob": "1984-02-02"}'::jsonb),
  ('a9a9a9a9-9999-4111-8111-000000000003', 'md-player@test.invalid', '{"full_name": "Pat Player", "dob": "1997-03-03"}'::jsonb);
select set_config('md.admin',  (select person_id::text from public.profiles where id = 'a9a9a9a9-9999-4111-8111-000000000001'), true);
select set_config('md.coach',  (select person_id::text from public.profiles where id = 'a9a9a9a9-9999-4111-8111-000000000002'), true);
select set_config('md.player', (select person_id::text from public.profiles where id = 'a9a9a9a9-9999-4111-8111-000000000003'), true);
insert into public.person_roles (person_id, role, granted_by)
  values (current_setting('md.admin')::uuid, 'club_admin', 'a9a9a9a9-9999-4111-8111-000000000001');

insert into public.seasons (id, name, starts_on, ends_on, is_current)
  values ('5e5e5e5e-9999-4111-8111-000000000001', 'MD 2046/47', current_date - 30, current_date + 300, true);
insert into public.teams (id, name, age_group) values
  ('9c9c9c9c-9999-4111-8111-000000000001', 'MD Foxes', 'U13'),
  ('9c9c9c9c-9999-4111-8111-000000000002', 'MD Owls', 'U15');
insert into public.resources (id, type, name, active)
  values ('7c7c7c7c-9999-4111-8111-000000000001', 'pitch', 'MD Pitch', true);
insert into public.team_memberships (person_id, team_id, season_id, role) values
  (current_setting('md.coach')::uuid,  '9c9c9c9c-9999-4111-8111-000000000001', '5e5e5e5e-9999-4111-8111-000000000001', 'coach'),
  (current_setting('md.player')::uuid, '9c9c9c9c-9999-4111-8111-000000000001', '5e5e5e5e-9999-4111-8111-000000000001', 'player');

insert into public.fixtures (id, team_id, season_id, opponent, is_home, kickoff_at, venue_resource_id) values
  ('f5f5f5f5-9999-4111-8111-000000000001', '9c9c9c9c-9999-4111-8111-000000000001', '5e5e5e5e-9999-4111-8111-000000000001', 'Foe FC', true,  now() + interval '3 days', '7c7c7c7c-9999-4111-8111-000000000001'),
  ('f5f5f5f5-9999-4111-8111-000000000002', '9c9c9c9c-9999-4111-8111-000000000002', '5e5e5e5e-9999-4111-8111-000000000001', 'Owl Foe', false, now() + interval '4 days', null);

set local request.jwt.claims to '{"sub":"a9a9a9a9-9999-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select public.respond_to_event(
  (select id from public.events where fixture_id = 'f5f5f5f5-9999-4111-8111-000000000001'),
  current_setting('md.player')::uuid, 'accepted');
reset role;

-- A. scoping -------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"a9a9a9a9-9999-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.matchday_fixtures(now(), now() + interval '14 days')), 1::bigint,
  'a coach''s desk is their teams only');
reset role;
set local request.jwt.claims to '{"sub":"a9a9a9a9-9999-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.matchday_fixtures(now(), now() + interval '14 days')), 2::bigint,
  'an admin''s desk is the whole club');
reset role;
set local request.jwt.claims to '{"sub":"a9a9a9a9-9999-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.matchday_fixtures(now(), now() + interval '14 days')), 0::bigint,
  'a player has no matchday desk');
reset role;

-- B. the arithmetic -------------------------------------------------------------
set local request.jwt.claims to '{"sub":"a9a9a9a9-9999-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select is((select (accepted, declined, squad) from public.matchday_fixtures(now(), now() + interval '14 days')
            where fixture_id = 'f5f5f5f5-9999-4111-8111-000000000001'),
  (1, 0, 1), 'accepted / declined / squad come from the events mirror');
select is((select pitch_name from public.matchday_fixtures(now(), now() + interval '14 days')
            where fixture_id = 'f5f5f5f5-9999-4111-8111-000000000001'), 'MD Pitch', 'the pitch is named');
select is((select allocated from public.matchday_fixtures(now(), now() + interval '14 days')
            where fixture_id = 'f5f5f5f5-9999-4111-8111-000000000001'), false,
  'named is not booked — allocated needs a confirmed booking');
reset role;

-- C. training ---------------------------------------------------------------------
insert into public.bookings (id, resource_id, team_id, kind, status, starts_at, ends_at, booker_name, booker_email, occasion)
values ('b5b5b5b5-9999-4111-8111-000000000001', '7c7c7c7c-9999-4111-8111-000000000001',
        '9c9c9c9c-9999-4111-8111-000000000001', 'training', 'confirmed',
        now() + interval '1 day', now() + interval '1 day 1 hour', 'Cal Coach', 'md-coach@test.invalid', 'Tuesday session');
set local request.jwt.claims to '{"sub":"a9a9a9a9-9999-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.training_sessions(now(), now() + interval '7 days')), 1::bigint,
  'the week''s training lists the session');
select is((select booked_by from public.training_sessions(now(), now() + interval '7 days')
            where booking_id = 'b5b5b5b5-9999-4111-8111-000000000001'), 'Cal Coach', 'with who booked it');
reset role;

-- D. attendance ---------------------------------------------------------------------
insert into public.booking_attendance (booking_id, person_id, status)
  values ('b5b5b5b5-9999-4111-8111-000000000001', current_setting('md.player')::uuid, 'late');
set local request.jwt.claims to '{"sub":"a9a9a9a9-9999-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select is((select (marked, there) from public.training_attendance_term()
            where team_id = '9c9c9c9c-9999-4111-8111-000000000001'),
  (1, 1), 'late still trained — the term bar counts them there');
reset role;

-- E. social -----------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"a9a9a9a9-9999-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select set_config('md.social', public.create_team_event(
  '9c9c9c9c-9999-4111-8111-000000000001', 'social', 'End of season BBQ',
  now() + interval '20 days', 180, null, 'The terrace', null, false)::text, true);
reset role;

set local request.jwt.claims to '{"sub":"a9a9a9a9-9999-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.social_events()), 1::bigint, 'a member sees the club''s socials');
select is((select venue from public.social_events() where event_id = current_setting('md.social')::uuid),
  'The terrace', 'with the venue');
select is((select can_manage from public.social_events() where event_id = current_setting('md.social')::uuid),
  false, 'but no manage controls');
reset role;
set local request.jwt.claims to '{"sub":"a9a9a9a9-9999-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select is((select can_manage from public.social_events() where event_id = current_setting('md.social')::uuid),
  true, 'the team''s staff manage their social');
reset role;

-- Fixture events RSVP'd through the social page's numbers stay coherent with the
-- squad denominator used everywhere else.
set local request.jwt.claims to '{"sub":"a9a9a9a9-9999-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select squad from public.matchday_fixtures(now(), now() + interval '14 days')
            where fixture_id = 'f5f5f5f5-9999-4111-8111-000000000002'), 0,
  'a team with no players yet shows a zero squad, not an error');
select is((select count(*) from public.training_attendance_term() where team_id = '9c9c9c9c-9999-4111-8111-000000000002'),
  0::bigint, 'teams with no registers taken stay off the bars');
reset role;

select * from finish();
rollback;
