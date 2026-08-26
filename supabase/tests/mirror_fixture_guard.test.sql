-- =============================================================================
-- The mirror column is the club's, and both sides move together (20260825450000)
-- =============================================================================
--   A  a coach cannot point their fixture's mirror at another team's game
--   B  a club administrator can (it is how a confirmed match is paired)
--   C  postponing one side postpones the other; un-cancelling brings it back
--   D  moving the kickoff, the length or the pitch moves both
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(9);

insert into auth.users (id, email, raw_user_meta_data) values
  ('m1m1m1m1-4545-4111-8111-000000000001', 'mg-coach@test.invalid', '{"full_name": "Cy Coach", "dob": "1985-01-01"}'::jsonb),
  ('m1m1m1m1-4545-4111-8111-000000000002', 'mg-admin@test.invalid', '{"full_name": "Ada Admin", "dob": "1975-02-02"}'::jsonb);
select set_config('mg.coach', (select person_id::text from public.profiles where id = 'm1m1m1m1-4545-4111-8111-000000000001'), true);
select set_config('mg.admin', (select person_id::text from public.profiles where id = 'm1m1m1m1-4545-4111-8111-000000000002'), true);
insert into public.person_roles (person_id, role, granted_by)
  values (current_setting('mg.admin')::uuid, 'club_admin', 'm1m1m1m1-4545-4111-8111-000000000002');

insert into public.seasons (id, name, starts_on, ends_on, is_current)
  values ('5m5m5m5m-4545-4111-8111-000000000001', 'Mirror 2043/44', '2043-08-01', '2044-05-31', true);
insert into public.teams (id, name, age_group) values
  ('7m7m7m7m-4545-4111-8111-000000000001', 'Mirror Mine',  'U14'),
  ('7m7m7m7m-4545-4111-8111-000000000002', 'Mirror Yours', 'U14');
-- The coach staffs ONE of them.
insert into public.team_memberships (person_id, team_id, season_id, role)
  values (current_setting('mg.coach')::uuid, '7m7m7m7m-4545-4111-8111-000000000001',
          '5m5m5m5m-4545-4111-8111-000000000001', 'coach');

insert into public.fixtures (id, team_id, season_id, opponent, is_home, kickoff_at, duration_minutes, status) values
  ('f1f1f1f1-4545-4111-8111-000000000001', '7m7m7m7m-4545-4111-8111-000000000001',
   '5m5m5m5m-4545-4111-8111-000000000001', 'Mirror Yours', true,  '2043-10-07 10:00+01', 90, 'scheduled'),
  ('f1f1f1f1-4545-4111-8111-000000000002', '7m7m7m7m-4545-4111-8111-000000000002',
   '5m5m5m5m-4545-4111-8111-000000000001', 'Mirror Mine',  false, '2043-10-07 10:00+01', 90, 'scheduled');


-- A. the coach ---------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"m1m1m1m1-4545-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;

select throws_like(
  $$ update public.fixtures set mirror_fixture_id = 'f1f1f1f1-4545-4111-8111-000000000002'
      where id = 'f1f1f1f1-4545-4111-8111-000000000001' $$,
  '%set when a club administrator confirms the booking%',
  'a coach cannot pair their fixture with another team''s game');

-- And the fixture they may otherwise write is untouched by the refusal.
select lives_ok(
  $$ update public.fixtures set notes = 'bring the nets'
      where id = 'f1f1f1f1-4545-4111-8111-000000000001' $$,
  'a coach still writes their own fixture');
reset role;

select is((select mirror_fixture_id from public.fixtures where id = 'f1f1f1f1-4545-4111-8111-000000000001'), null,
  'nothing was paired');


-- B. the club administrator ---------------------------------------------------------
set local request.jwt.claims to '{"sub":"m1m1m1m1-4545-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$ update public.fixtures set mirror_fixture_id = 'f1f1f1f1-4545-4111-8111-000000000002'
      where id = 'f1f1f1f1-4545-4111-8111-000000000001' $$,
  'a club administrator pairs the two sides');
update public.fixtures set mirror_fixture_id = 'f1f1f1f1-4545-4111-8111-000000000001'
 where id = 'f1f1f1f1-4545-4111-8111-000000000002';
reset role;


-- C. the whole status, both ways -----------------------------------------------------
update public.fixtures set status = 'postponed' where id = 'f1f1f1f1-4545-4111-8111-000000000001';
select is((select status::text from public.fixtures where id = 'f1f1f1f1-4545-4111-8111-000000000002'),
  'postponed', 'postponing one side postpones the other');

update public.fixtures set status = 'cancelled' where id = 'f1f1f1f1-4545-4111-8111-000000000002';
select is((select status::text from public.fixtures where id = 'f1f1f1f1-4545-4111-8111-000000000001'),
  'cancelled', 'and cancelling the away side cancels the home one');

update public.fixtures set status = 'scheduled' where id = 'f1f1f1f1-4545-4111-8111-000000000001';
select is((select status::text from public.fixtures where id = 'f1f1f1f1-4545-4111-8111-000000000002'),
  'scheduled', 'un-cancelling brings the mirror back — it used to stay cancelled for ever');


-- D. a reschedule moves both ---------------------------------------------------------
update public.fixtures
   set kickoff_at = '2043-10-07 14:00+01', duration_minutes = 70
 where id = 'f1f1f1f1-4545-4111-8111-000000000001';
select is(
  (select kickoff_at from public.fixtures where id = 'f1f1f1f1-4545-4111-8111-000000000002'),
  '2043-10-07 14:00+01'::timestamptz,
  'moving the kickoff moves the mirror');
select is(
  (select duration_minutes from public.fixtures where id = 'f1f1f1f1-4545-4111-8111-000000000002'),
  70, 'and so does changing the length');

select * from finish();
rollback;
