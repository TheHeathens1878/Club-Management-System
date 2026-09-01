-- =============================================================================
-- The family tree drawn around somebody else (20260827130000)
-- =============================================================================
-- What this suite covers:
--   A  shape: the function exists and returns jsonb
--   B  an administrator gets the tree around the PERSON they asked about, not
--      around themselves — the mistake that would make the whole tab lie
--   C  the children branch, and each child's other guardians
--   D  the adults branch: who is on the person's membership
--   E  a member with no club role is refused outright
--   F  no date of birth is ever returned, only the age-group hint
--
-- Assertion count, kept in step: A 2, B 3, C 3, D 1, E 1, F 2  =  12.
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(12);

insert into auth.users (id, email, raw_user_meta_data) values
  ('a5a5a5a5-2713-4111-8111-000000000001', 'ft-admin@test.invalid',  '{"full_name": "Ada Admin", "dob": "1975-01-01"}'::jsonb),
  ('a5a5a5a5-2713-4111-8111-000000000002', 'ft-parent@test.invalid', '{"full_name": "Pat Parent", "dob": "1985-02-02"}'::jsonb),
  ('a5a5a5a5-2713-4111-8111-000000000003', 'ft-nobody@test.invalid', '{"full_name": "Ned Nobody", "dob": "1990-03-03"}'::jsonb);
select set_config('ft.admin',  (select person_id::text from public.profiles where id = 'a5a5a5a5-2713-4111-8111-000000000001'), true);
select set_config('ft.parent', (select person_id::text from public.profiles where id = 'a5a5a5a5-2713-4111-8111-000000000002'), true);
insert into public.person_roles (person_id, role, granted_by)
  values (current_setting('ft.admin')::uuid, 'club_admin', 'a5a5a5a5-2713-4111-8111-000000000001');

-- The parent's family: one child, and an ex-partner who also guards that child.
insert into public.people (id, first_name, last_name, dob) values
  -- Ten years before the start of the CURRENT season, in January — not ten
  -- years before today. A U-band is measured from the season, which turns
  -- over mid-year, so a rolling dob crosses that line and the child silently
  -- drops a band: this fixture was U11 all summer and became a U10 on the
  -- day the 2026/27 season began (CI, 2026-09-01). The season expression is
  -- the one the function itself uses; a January birthday is nowhere near the
  -- 1 September boundary, so the band is U11 in every season.
  ('c5c5c5c5-2713-4111-8111-000000000001', 'Kit', 'Parent',
   make_date((case when extract(month from current_date) >= 7
                   then extract(year from current_date)::int
                   else extract(year from current_date)::int - 1 end) - 10, 1, 15)),
  ('c5c5c5c5-2713-4111-8111-000000000002', 'Ex',  'Partner', '1986-04-04');
insert into public.guardianships (guardian_person_id, child_person_id, relationship) values
  (current_setting('ft.parent')::uuid, 'c5c5c5c5-2713-4111-8111-000000000001', 'parent'),
  ('c5c5c5c5-2713-4111-8111-000000000002', 'c5c5c5c5-2713-4111-8111-000000000001', 'parent');

-- And an adult on the parent's membership.
insert into public.people (id, first_name, last_name, dob)
  values ('c5c5c5c5-2713-4111-8111-000000000003', 'Sam', 'Spouse', '1984-05-05');
insert into public.seasons (id, name, starts_on, ends_on, is_current)
  values ('55555555-2713-4111-8111-000000000001', 'FT 2043/44', '2043-08-01', '2044-05-31', true);
insert into public.memberships (id, season_id, primary_person_id, kind)
  values ('11111111-2713-4111-8111-000000000001', '55555555-2713-4111-8111-000000000001',
          current_setting('ft.parent')::uuid, 'family');
insert into public.membership_people (membership_id, person_id) values
  ('11111111-2713-4111-8111-000000000001', current_setting('ft.parent')::uuid),
  ('11111111-2713-4111-8111-000000000001', 'c5c5c5c5-2713-4111-8111-000000000003');


-- ---------------------------------------------------------------------------
-- A. Shape                                                            (2)
-- ---------------------------------------------------------------------------
select has_function('public', 'family_tree_for', array['uuid'], 'family_tree_for(uuid)');
select is(pg_get_function_result('public.family_tree_for(uuid)'::regprocedure), 'jsonb',
  'it returns jsonb, the same shape my_family_tree() returns');


-- ---------------------------------------------------------------------------
-- B / C / D / F. The administrator asks about the PARENT                (9)
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"a5a5a5a5-2713-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;

select set_config('ft.tree',
  public.family_tree_for(current_setting('ft.parent')::uuid)::text, true);

reset role;
set local request.jwt.claims to '{}';

-- B. The root is the person asked about, NOT the administrator asking.
select is(
  (current_setting('ft.tree')::jsonb #>> '{self,person_id}'),
  current_setting('ft.parent'),
  'the tree is rooted on the person asked about, not on the administrator');
select is(
  (current_setting('ft.tree')::jsonb #>> '{self,first_name}'), 'Pat',
  'and it is their name at the top');
select isnt(
  (current_setting('ft.tree')::jsonb #>> '{self,person_id}'),
  current_setting('ft.admin'),
  'which is the mistake that would make the whole tab lie');

-- C. The children, and the child's other guardian.
select is(
  jsonb_array_length(current_setting('ft.tree')::jsonb -> 'children'), 1,
  'the one child they guard is in the tree');
select is(
  (current_setting('ft.tree')::jsonb #>> '{children,0,first_name}'), 'Kit',
  'by name');
select is(
  (current_setting('ft.tree')::jsonb #>> '{children,0,guardians,0,first_name}'), 'Ex',
  'and the child''s other guardian hangs off them');

-- D. The adults branch.
select ok(
  (current_setting('ft.tree')::jsonb -> 'adults')::text like '%Sam%',
  'the adult on their membership is in the tree');

-- F. No dates of birth, ever.
select is(
  (current_setting('ft.tree')::jsonb #>> '{children,0,age_group}'), 'U11',
  'a child carries an age group, which is what the family screens show');
select ok(
  (current_setting('ft.tree')::jsonb)::text not like '%dob%',
  'and no date of birth appears anywhere in the payload');


-- ---------------------------------------------------------------------------
-- E. Anybody else is refused                                           (1)
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"a5a5a5a5-2713-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  format('select public.family_tree_for(%L)', current_setting('ft.parent')),
  '42501', null,
  'a member with no club role cannot draw somebody else''s family');
reset role;
set local request.jwt.claims to '{}';

select * from finish();
rollback;
