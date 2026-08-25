-- =============================================================================
-- Club rules of 2026-08-25 (20260825070000)
-- =============================================================================
--   A  waiting_list_age_number: strict U-band parsing — an Over-45s team can
--      never match "U45"
--   B  a coach automatically reads their age group and the one below, nothing
--      more; a coach of a non-U team reads nothing
--   C  my_capabilities' has_waiting_list_access follows the same truth
--   D  the end-of-season rollover bumps live entries one band; decided entries
--      keep the band they were decided at
--   (The admins-only club noticeboard is asserted in board.test.sql.)
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(11);

-- A. the parser ---------------------------------------------------------------
select is(public.waiting_list_age_number('U08'), 8, 'U08 → 8');
select is(public.waiting_list_age_number('O45'), null, 'O45 is not a U-band');
select is(public.waiting_list_age_number('Open age'), null, 'no number, no band');

-- People: a U12 coach and an open-age coach.
insert into auth.users (id, email, raw_user_meta_data) values
  ('c1c1c1c1-9999-4111-8111-000000000001', 'cr-coach@test.invalid', '{"full_name": "Cee Coach", "dob": "1980-01-01"}'::jsonb),
  ('c1c1c1c1-9999-4111-8111-000000000002', 'cr-vets@test.invalid',  '{"full_name": "Vee Vets", "dob": "1975-01-01"}'::jsonb);
select set_config('cr.coach', (select person_id::text from public.profiles where id = 'c1c1c1c1-9999-4111-8111-000000000001'), true);
select set_config('cr.vets',  (select person_id::text from public.profiles where id = 'c1c1c1c1-9999-4111-8111-000000000002'), true);

insert into public.seasons (id, name, starts_on, ends_on, is_current)
  values ('5c5c5c5c-9999-4111-8111-000000000001', 'CR 2054/55', '2054-08-01', '2055-05-31', true),
         ('5c5c5c5c-9999-4111-8111-000000000002', 'CR 2055/56', '2055-08-01', '2056-05-31', false);
insert into public.teams (id, name, age_group) values
  ('7c7c7c7c-9999-4111-8111-000000000001', 'CR U12 Reds', 'U12'),
  ('7c7c7c7c-9999-4111-8111-000000000002', 'CR Vets', 'Open');
insert into public.team_memberships (person_id, team_id, season_id, role) values
  (current_setting('cr.coach')::uuid, '7c7c7c7c-9999-4111-8111-000000000001', '5c5c5c5c-9999-4111-8111-000000000001', 'coach'),
  (current_setting('cr.vets')::uuid,  '7c7c7c7c-9999-4111-8111-000000000002', '5c5c5c5c-9999-4111-8111-000000000001', 'coach');

insert into public.waiting_list_entries (id, player_name, dob, age_group, parent_name, parent_email, parent_phone, status) values
  ('ac1dac1d-9999-4111-8111-000000000013', 'Kid Thirteen', '2013-09-01', 'U13', 'Pat Parent', 'cr13@test.invalid', '07700 900001', 'pending'),
  ('ac1dac1d-9999-4111-8111-000000000012', 'Kid Twelve',   '2014-09-01', 'U12', 'Pat Parent', 'cr12@test.invalid', '07700 900002', 'pending'),
  ('ac1dac1d-9999-4111-8111-000000000011', 'Kid Eleven',   '2015-09-01', 'U11', 'Pat Parent', 'cr11@test.invalid', '07700 900003', 'pending'),
  ('ac1dac1d-9999-4111-8111-000000000010', 'Kid Ten',      '2016-09-01', 'U10', 'Pat Parent', 'cr10@test.invalid', '07700 900004', 'pending'),
  ('ac1dac1d-9999-4111-8111-000000000099', 'Kid Done',     '2014-03-01', 'U12', 'Pat Parent', 'cr99@test.invalid', '07700 900005', 'accepted');

-- B. the automatic scope ------------------------------------------------------
set local request.jwt.claims to '{"sub":"c1c1c1c1-9999-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select array_agg(distinct age_group order by age_group) from public.waiting_list_entries where id::text like 'ac1dac1d-%'),
  array['U11', 'U12'], 'a U12 coach reads U12 and U11 — their age group and the one below, nothing more');

-- C. the capability follows ---------------------------------------------------
select is((public.my_capabilities()->>'has_waiting_list_access')::boolean, true,
  'the U12 coach holds the waiting-list capability without a grant');
reset role;
set local request.jwt.claims to '{"sub":"c1c1c1c1-9999-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.waiting_list_entries where id::text like 'ac1dac1d-%'), 0::bigint,
  'an open-age coach reads no waiting-list entries');
select is((public.my_capabilities()->>'has_waiting_list_access')::boolean, false,
  'and holds no waiting-list capability');
reset role;
set local request.jwt.claims to '{}';

-- D. the rollover bumps the list ----------------------------------------------
select set_config('cr.rollover',
  (public.end_of_season_rollover('5c5c5c5c-9999-4111-8111-000000000002',
     array['7c7c7c7c-9999-4111-8111-000000000001', '7c7c7c7c-9999-4111-8111-000000000002']::uuid[]))::text, true);
select ok((current_setting('cr.rollover')::jsonb->>'waiting_list_bumped')::integer >= 4,
  'the rollover reports the live entries it bumped');
select is((select age_group from public.waiting_list_entries where id = 'ac1dac1d-9999-4111-8111-000000000012'),
  'U13', 'a pending U12 becomes U13');
select is((select age_group from public.waiting_list_entries where id = 'ac1dac1d-9999-4111-8111-000000000099'),
  'U12', 'a decided entry keeps the band it was decided at');
select is((select age_group from public.teams where id = '7c7c7c7c-9999-4111-8111-000000000001'),
  'U13', 'and the team went up with it');

select * from finish();
rollback;
