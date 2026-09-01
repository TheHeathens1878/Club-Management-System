-- =============================================================================
-- club_overview() (20260824420000)
-- =============================================================================
--   Gate, and the arithmetic a dashboard must not get wrong: player counts are
--   distinct people, an unallocated home fixture is one with no CONFIRMED
--   booking, and every key is present even on an empty club.
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(8);

insert into auth.users (id, email, raw_user_meta_data) values
  ('c5c5c5c5-aaaa-4111-8111-000000000001', 'ov-admin@test.invalid',  '{"full_name": "Ada Admin", "dob": "1975-01-01"}'::jsonb),
  ('c5c5c5c5-aaaa-4111-8111-000000000002', 'ov-player@test.invalid', '{"full_name": "Pat Player", "dob": "1996-02-02"}'::jsonb);
select set_config('ov.admin',  (select person_id::text from public.profiles where id = 'c5c5c5c5-aaaa-4111-8111-000000000001'), true);
select set_config('ov.player', (select person_id::text from public.profiles where id = 'c5c5c5c5-aaaa-4111-8111-000000000002'), true);
insert into public.person_roles (person_id, role, granted_by)
  values (current_setting('ov.admin')::uuid, 'club_admin', 'c5c5c5c5-aaaa-4111-8111-000000000001');

insert into public.seasons (id, name, starts_on, ends_on, is_current)
  values ('5f5f5f5f-aaaa-4111-8111-000000000001', 'OV 2048/49', current_date - 30, current_date + 300, true);
insert into public.teams (id, name, age_group) values
  ('9d9d9d9d-aaaa-4111-8111-000000000001', 'OV One', 'U10'),
  ('9d9d9d9d-aaaa-4111-8111-000000000002', 'OV Two', 'U10');
-- The same person on two teams counts once.
insert into public.team_memberships (person_id, team_id, season_id, role) values
  (current_setting('ov.player')::uuid, '9d9d9d9d-aaaa-4111-8111-000000000001', '5f5f5f5f-aaaa-4111-8111-000000000001', 'player'),
  (current_setting('ov.player')::uuid, '9d9d9d9d-aaaa-4111-8111-000000000002', '5f5f5f5f-aaaa-4111-8111-000000000001', 'player');

insert into public.fixtures (id, team_id, season_id, opponent, is_home, kickoff_at)
values ('f7f7f7f7-aaaa-4111-8111-000000000001', '9d9d9d9d-aaaa-4111-8111-000000000001',
        '5f5f5f5f-aaaa-4111-8111-000000000001', 'Foe', true, now() + interval '5 days');

-- The gate --------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"c5c5c5c5-aaaa-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_like($$ select public.club_overview() $$, '%for administrators%',
  'a player has no club overview');
reset role;

-- The numbers -----------------------------------------------------------------
set local request.jwt.claims to '{"sub":"c5c5c5c5-aaaa-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select (public.club_overview() ->> 'players')::integer), 1,
  'a player on two teams is one registered player');
select is((select (public.club_overview() ->> 'players_this_month')::integer), 1,
  'joined this month counts');
select is((select (public.club_overview() ->> 'teams_active')::integer) >= 2, true,
  'active teams are counted');
select is((select (public.club_overview() ->> 'unallocated_home_fixtures')::integer), 1,
  'a home fixture with no confirmed booking needs a pitch');
select is((select (public.club_overview() ->> 'arrears_pence')::integer), 0,
  'no subscriptions, no arrears — zero, not null');
select is((select (public.club_overview() ->> 'pending_account_requests')::integer), 0,
  'no requests waiting');
select is((select public.club_overview() ? 'season_name'), true, 'the season is named');
reset role;

select * from finish();
rollback;
