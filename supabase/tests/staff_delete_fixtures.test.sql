-- =============================================================================
-- A team's staff may delete their own team's fixtures (20260827100000)
-- =============================================================================
-- This is an RLS WIDENING, so what matters is the edge, not the middle:
--
--   A  shape: the policy exists, and DELETE on fixtures is still policied
--   B  a coach deletes a fixture belonging to the team they staff
--   C  a coach may NOT delete another team's fixture — the whole point of
--      is_team_staff(team_id) being row-scoped
--   D  a parent of a player in the squad may not delete anything
--   E  a club administrator is unaffected and may still delete either
--   F  the cascade is the same one #203 warned about: the team sheet goes
--
-- Assertion count, kept in step: A 2, B 2, C 2, D 2, E 2, F 1  =  11.
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(11);

insert into auth.users (id, email, raw_user_meta_data) values
  ('ab12cd34-2710-4111-8111-000000000001', 'sd-coach@test.invalid',  '{"full_name": "Cy Coach", "dob": "1985-01-01"}'::jsonb),
  ('ab12cd34-2710-4111-8111-000000000002', 'sd-admin@test.invalid',  '{"full_name": "Ada Admin", "dob": "1975-02-02"}'::jsonb),
  ('ab12cd34-2710-4111-8111-000000000003', 'sd-parent@test.invalid', '{"full_name": "Pat Parent", "dob": "1980-03-03"}'::jsonb);
select set_config('sd.coach',  (select person_id::text from public.profiles where id = 'ab12cd34-2710-4111-8111-000000000001'), true);
select set_config('sd.admin',  (select person_id::text from public.profiles where id = 'ab12cd34-2710-4111-8111-000000000002'), true);
select set_config('sd.parent', (select person_id::text from public.profiles where id = 'ab12cd34-2710-4111-8111-000000000003'), true);
insert into public.person_roles (person_id, role, granted_by)
  values (current_setting('sd.admin')::uuid, 'club_admin', 'ab12cd34-2710-4111-8111-000000000002');

insert into public.seasons (id, name, starts_on, ends_on, is_current)
  values ('5d000000-2710-4111-8111-000000000001', 'SD 2043/44', '2043-08-01', '2044-05-31', true);
insert into public.teams (id, name, age_group) values
  ('7d000000-2710-4111-8111-000000000001', 'SD Mine',   'U14'),
  ('7d000000-2710-4111-8111-000000000002', 'SD Theirs', 'U14');

-- The coach staffs ONE of the two teams. The parent's child plays for it.
insert into public.people (id, first_name, last_name, dob)
  values ('cd000000-2710-4111-8111-000000000001', 'Kit', 'Player', (current_date - interval '12 years')::date);
insert into public.guardianships (guardian_person_id, child_person_id, relationship)
  values (current_setting('sd.parent')::uuid, 'cd000000-2710-4111-8111-000000000001', 'parent');
insert into public.team_memberships (person_id, team_id, season_id, role) values
  (current_setting('sd.coach')::uuid, '7d000000-2710-4111-8111-000000000001', '5d000000-2710-4111-8111-000000000001', 'coach'),
  ('cd000000-2710-4111-8111-000000000001', '7d000000-2710-4111-8111-000000000001', '5d000000-2710-4111-8111-000000000001', 'player');

insert into public.fixtures (id, team_id, season_id, opponent, is_home, kickoff_at, status, source) values
  ('fd000000-2710-4111-8111-000000000001', '7d000000-2710-4111-8111-000000000001', '5d000000-2710-4111-8111-000000000001',
   'Mine A', true, '2043-10-07 10:00+01', 'scheduled', 'manual'),
  ('fd000000-2710-4111-8111-000000000002', '7d000000-2710-4111-8111-000000000001', '5d000000-2710-4111-8111-000000000001',
   'Mine B', true, '2043-10-14 10:00+01', 'scheduled', 'manual'),
  ('fd000000-2710-4111-8111-000000000003', '7d000000-2710-4111-8111-000000000002', '5d000000-2710-4111-8111-000000000001',
   'Theirs A', true, '2043-10-07 10:00+01', 'scheduled', 'manual'),
  ('fd000000-2710-4111-8111-000000000004', '7d000000-2710-4111-8111-000000000002', '5d000000-2710-4111-8111-000000000001',
   'Theirs B', true, '2043-10-21 10:00+01', 'scheduled', 'manual');

-- A team sheet on the coach's first fixture, to prove the cascade.
insert into public.fixture_lineups (fixture_id, formation)
  values ('fd000000-2710-4111-8111-000000000001', '4-4-2');


-- ---------------------------------------------------------------------------
-- A. Shape                                                            (2)
-- ---------------------------------------------------------------------------
select ok(
  exists (select 1 from pg_policies
           where schemaname = 'public' and tablename = 'fixtures'
             and policyname = 'fixtures_staff_delete' and cmd = 'DELETE'),
  'fixtures_staff_delete exists and is a DELETE policy');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.fixtures'::regclass),
  'and row security is still on for fixtures');


-- ---------------------------------------------------------------------------
-- B. The coach deletes their own team's fixture                       (2)
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"ab12cd34-2710-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$ delete from public.fixtures where id = 'fd000000-2710-4111-8111-000000000001' $$,
  'the coach deletes a fixture on the team they staff');

reset role;
set local request.jwt.claims to '{}';

select is((select count(*)::int from public.fixtures
            where id = 'fd000000-2710-4111-8111-000000000001'), 0,
  'and it is really gone, asked as the owner');


-- ---------------------------------------------------------------------------
-- C. But not another team's                                           (2)
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"ab12cd34-2710-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;

-- A DELETE with no matching policy row removes nothing and raises nothing,
-- so the assertion is about what survived, not about an exception.
delete from public.fixtures where id = 'fd000000-2710-4111-8111-000000000003';
reset role;
set local request.jwt.claims to '{}';

select is((select count(*)::int from public.fixtures
            where id = 'fd000000-2710-4111-8111-000000000003'), 1,
  'another team''s fixture is untouched — is_team_staff(team_id) is row-scoped');

select is((select opponent from public.fixtures
            where id = 'fd000000-2710-4111-8111-000000000003'), 'Theirs A',
  'and unchanged, not merely present');


-- ---------------------------------------------------------------------------
-- D. A parent of a player in the squad may not                        (2)
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"ab12cd34-2710-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
delete from public.fixtures where id = 'fd000000-2710-4111-8111-000000000002';
reset role;
set local request.jwt.claims to '{}';

select is((select count(*)::int from public.fixtures
            where id = 'fd000000-2710-4111-8111-000000000002'), 1,
  'a parent of a player in the squad deletes nothing');
select is((select count(*)::int from public.fixtures
            where team_id = '7d000000-2710-4111-8111-000000000002'), 2,
  'and reaches no other team either');


-- ---------------------------------------------------------------------------
-- E. The club administrator is unaffected                             (2)
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"ab12cd34-2710-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$ delete from public.fixtures where id = 'fd000000-2710-4111-8111-000000000004' $$,
  'a club administrator deletes a fixture on a team they do not staff');
reset role;
set local request.jwt.claims to '{}';

select is((select count(*)::int from public.fixtures
            where id = 'fd000000-2710-4111-8111-000000000004'), 0,
  'and it is gone');


-- ---------------------------------------------------------------------------
-- F. The cascade                                                      (1)
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public.fixture_lineups
            where fixture_id = 'fd000000-2710-4111-8111-000000000001'), 0,
  'the team sheet went with the fixture the coach deleted — which is what the screen warns about');

select * from finish();
rollback;
