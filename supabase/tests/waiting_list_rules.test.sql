-- =============================================================================
-- Waiting list rules of 2026-08-25 evening (20260825290000)
-- =============================================================================
--   A  the age group settings are a club administrator's: the RPC refuses a
--      coach with a readable 42501, the table itself refuses the write, and an
--      administrator's call lands
--   B  waiting_list_open_age_groups() is the source of truth -- nothing ticked,
--      nothing returned
--   C  a coach sees their own band and the one below and NOTHING else, even
--      holding a grant to another band; my_waiting_list_age_groups() says so
--   D  a grant cannot widen a coach (readable P0001), but still carries someone
--      who coaches no U-band team
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(15);

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-7777-4111-8111-000000000001', 'wr-admin@test.invalid', '{"full_name": "Ada Admin", "dob": "1975-01-01"}'::jsonb),
  ('11111111-7777-4111-8111-000000000002', 'wr-coach@test.invalid', '{"full_name": "Cai Coach", "dob": "1983-02-02"}'::jsonb),
  ('11111111-7777-4111-8111-000000000003', 'wr-lead@test.invalid',  '{"full_name": "Rec Lead", "dob": "1985-03-03"}'::jsonb);
select set_config('wr.admin', (select person_id::text from public.profiles where id = '11111111-7777-4111-8111-000000000001'), true);
select set_config('wr.coach', (select person_id::text from public.profiles where id = '11111111-7777-4111-8111-000000000002'), true);
select set_config('wr.lead',  (select person_id::text from public.profiles where id = '11111111-7777-4111-8111-000000000003'), true);

insert into public.person_roles (person_id, role, granted_by)
  values (current_setting('wr.admin')::uuid, 'club_admin', '11111111-7777-4111-8111-000000000001');

insert into public.seasons (id, name, starts_on, ends_on, is_current)
  values ('5e5e5e5e-7777-4111-8111-000000000001', 'WR 2060/61', '2060-08-01', '2061-05-31', false);
insert into public.teams (id, name, age_group)
  values ('7e7e7e7e-7777-4111-8111-000000000001', 'WR U12 Reds', 'U12');
insert into public.team_memberships (person_id, team_id, season_id, role)
  values (current_setting('wr.coach')::uuid, '7e7e7e7e-7777-4111-8111-000000000001',
          '5e5e5e5e-7777-4111-8111-000000000001', 'coach');

-- A clean slate: this file owns the age group settings for the length of the
-- transaction, so "nothing is open" means exactly that.
delete from public.waiting_list_age_groups;

insert into public.waiting_list_entries (id, player_name, dob, age_group, parent_name, parent_email, parent_phone, status) values
  ('a171a171-7777-4111-8111-000000000012', 'Kid Twelve',   '2014-09-01', 'U12', 'Pat Parent', 'wr12@test.invalid', '07700 900001', 'pending'),
  ('a171a171-7777-4111-8111-000000000011', 'Kid Eleven',   '2015-09-01', 'U11', 'Pat Parent', 'wr11@test.invalid', '07700 900002', 'pending'),
  ('a171a171-7777-4111-8111-000000000013', 'Kid Thirteen', '2013-09-01', 'U13', 'Pat Parent', 'wr13@test.invalid', '07700 900003', 'pending'),
  ('a171a171-7777-4111-8111-000000000008', 'Kid Eight',    '2018-09-01', 'U08', 'Pat Parent', 'wr08@test.invalid', '07700 900004', 'pending');

-- Grants to a band the coach does not coach. Written server-side (no
-- auth.uid()), exactly as migrate_neon left them behind: the point of C is
-- that such a row no longer widens anybody who coaches.
insert into public.waiting_list_access (person_id, age_group)
  values (current_setting('wr.coach')::uuid, 'U08'),
         (current_setting('wr.lead')::uuid,  'U08');

-- A. the settings are the administrator's -------------------------------------
set local request.jwt.claims to '{"sub":"11111111-7777-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_like(
  $$ select public.set_waiting_list_age_group('U12', true, true) $$,
  '%club administrator%',
  'a coach cannot open an age group through the RPC');
select throws_ok(
  $$ update public.waiting_list_age_groups set is_open = true where age_group = 'U12' $$,
  '42501',
  'and the table itself refuses a coach the write');
select throws_ok(
  $$ insert into public.waiting_list_age_groups (age_group, is_open) values ('U12', true) $$,
  '42501',
  'including adding a group of their own');
reset role;

set local request.jwt.claims to '{"sub":"11111111-7777-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$ select public.set_waiting_list_age_group('U12', true, true) $$,
  'a club administrator opens U12');
select lives_ok(
  $$ select public.set_waiting_list_age_group('U11', false, false) $$,
  'and leaves U11 closed');
reset role;
set local request.jwt.claims to '{}';

select is((select array_agg(o.age_group order by o.age_group)
             from public.waiting_list_open_age_groups() o),
  array['U12'], 'only the ticked group is open for new entries');

-- B. nothing ticked, nothing returned -----------------------------------------
set local request.jwt.claims to '{"sub":"11111111-7777-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$ select public.set_waiting_list_age_group('U12', false, false) $$,
  'the administrator closes the last open group');
reset role;
set local request.jwt.claims to '{}';

select is((select count(*) from public.waiting_list_open_age_groups()), 0::bigint,
  'with nothing ticked the public open-groups function returns nothing');

-- Reopen U12 so the rest of the file works against a normal club.
set local request.jwt.claims to '{"sub":"11111111-7777-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select public.set_waiting_list_age_group('U12', true, true);
reset role;
set local request.jwt.claims to '{}';

-- C. own band and the one below, and nothing else ------------------------------
set local request.jwt.claims to '{"sub":"11111111-7777-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select is((select array_agg(distinct age_group order by age_group)
             from public.waiting_list_entries where id::text like 'a171a171-%'),
  array['U11', 'U12'],
  'a U12 coach reads U12 and U11 -- not the U13 above, and not the U08 they hold a grant for');
select is((select array_agg(m.age_group order by m.age_group)
             from public.my_waiting_list_age_groups() as m(age_group)),
  array['U11', 'U12'],
  'and my_waiting_list_age_groups() names exactly those two');
reset role;

-- The same kind of grant still carries someone who coaches no U-band team.
set local request.jwt.claims to '{"sub":"11111111-7777-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select is((select array_agg(distinct age_group order by age_group)
             from public.waiting_list_entries where id::text like 'a171a171-%'),
  array['U08'],
  'a recruitment lead who coaches nothing reads exactly their granted band');
reset role;

set local request.jwt.claims to '{"sub":"11111111-7777-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.waiting_list_entries where id::text like 'a171a171-%'), 4::bigint,
  'a club administrator reads every band');

-- D. a grant cannot widen a coach (still the administrator, interactively) -----
select throws_like(
  $$ insert into public.waiting_list_access (person_id, age_group)
     values (current_setting('wr.coach')::uuid, 'U16') $$,
  '%grant cannot widen%',
  'an administrator cannot grant a coach a band outside their own and the one below');
select lives_ok(
  $$ insert into public.waiting_list_access (person_id, age_group)
     values (current_setting('wr.coach')::uuid, 'U11') $$,
  'a grant inside the rule is accepted');
select lives_ok(
  $$ insert into public.waiting_list_access (person_id, age_group)
     values (current_setting('wr.lead')::uuid, 'U16') $$,
  'and someone who coaches no U-band team may still be granted anything');
reset role;
set local request.jwt.claims to '{}';

select * from finish();
rollback;
