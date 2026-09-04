-- =============================================================================
-- Matchday scope (20260904100000)
-- =============================================================================
--   The desk defaults to the caller's own teams and widens to the whole club
--   only for people who already hold a desk somewhere: staff, committee,
--   admins. A parent or player asking for 'club' still gets their own —
--   which for them is nothing.
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(7);

insert into auth.users (id, email, raw_user_meta_data) values
  ('b1b1b1b1-9999-4111-8111-000000000001', 'sc-admin@test.invalid',  '{"full_name": "Ada Admin", "dob": "1976-01-01"}'::jsonb),
  ('b1b1b1b1-9999-4111-8111-000000000002', 'sc-coach@test.invalid',  '{"full_name": "Cal Coach", "dob": "1984-02-02"}'::jsonb),
  ('b1b1b1b1-9999-4111-8111-000000000003', 'sc-player@test.invalid', '{"full_name": "Pat Player", "dob": "1997-03-03"}'::jsonb);
select set_config('sc.admin',  (select person_id::text from public.profiles where id = 'b1b1b1b1-9999-4111-8111-000000000001'), true);
select set_config('sc.coach',  (select person_id::text from public.profiles where id = 'b1b1b1b1-9999-4111-8111-000000000002'), true);
select set_config('sc.player', (select person_id::text from public.profiles where id = 'b1b1b1b1-9999-4111-8111-000000000003'), true);
insert into public.person_roles (person_id, role, granted_by)
  values (current_setting('sc.admin')::uuid, 'club_admin', 'b1b1b1b1-9999-4111-8111-000000000001');

insert into public.seasons (id, name, starts_on, ends_on, is_current)
  values ('5d5d5d5d-9999-4111-8111-000000000001', 'SC 2052/53', current_date - 30, current_date + 300, true);
insert into public.teams (id, name, age_group) values
  ('9b9b9b9b-9999-4111-8111-000000000001', 'SC Foxes', 'U13'),
  ('9b9b9b9b-9999-4111-8111-000000000002', 'SC Owls', 'U15');
insert into public.team_memberships (person_id, team_id, season_id, role) values
  (current_setting('sc.coach')::uuid,  '9b9b9b9b-9999-4111-8111-000000000001', '5d5d5d5d-9999-4111-8111-000000000001', 'coach'),
  (current_setting('sc.player')::uuid, '9b9b9b9b-9999-4111-8111-000000000001', '5d5d5d5d-9999-4111-8111-000000000001', 'player');

insert into public.fixtures (id, team_id, season_id, opponent, is_home, kickoff_at) values
  ('fb0b0b0b-9999-4111-8111-000000000001', '9b9b9b9b-9999-4111-8111-000000000001', '5d5d5d5d-9999-4111-8111-000000000001', 'Foe FC',  true, now() + interval '3 days'),
  ('fb0b0b0b-9999-4111-8111-000000000002', '9b9b9b9b-9999-4111-8111-000000000002', '5d5d5d5d-9999-4111-8111-000000000001', 'Owl Foe', true, now() + interval '4 days');

-- One function, three arguments — the two-argument one is gone, so PostgREST
-- never faces a choice.
select has_function('public', 'matchday_fixtures',
  array['timestamp with time zone', 'timestamp with time zone', 'text'],
  'matchday_fixtures(from, to, scope)');
select hasnt_function('public', 'matchday_fixtures',
  array['timestamp with time zone', 'timestamp with time zone'],
  'the two-argument matchday_fixtures is dropped');

-- The coach ---------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"b1b1b1b1-9999-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.matchday_fixtures(now(), now() + interval '14 days')), 1::bigint,
  'a coach''s desk still defaults to their own teams');
select is((select count(*) from public.matchday_fixtures(now(), now() + interval '14 days', 'club')), 2::bigint,
  'a coach asking for the club sees the whole club');
reset role;

-- The player --------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"b1b1b1b1-9999-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.matchday_fixtures(now(), now() + interval '14 days', 'club')), 0::bigint,
  'a player asking for the club still gets their own desk — nothing');
reset role;

-- The grants --------------------------------------------------------------------
select is(has_function_privilege('authenticated',
  'public.matchday_fixtures(timestamptz, timestamptz, text)', 'execute'), true,
  'authenticated may call the desk');
select is(has_function_privilege('anon',
  'public.matchday_fixtures(timestamptz, timestamptz, text)', 'execute'), false,
  'anon may not');

select * from finish();
rollback;
