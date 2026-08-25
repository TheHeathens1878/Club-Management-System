-- =============================================================================
-- my_capabilities() (20260824330000)
-- =============================================================================
-- The one-call shape must agree with the accessors it replaces, for every kind
-- of user — otherwise a menu item appears or vanishes for the wrong person.
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(18);

insert into auth.users (id, email, raw_user_meta_data) values
  ('c8c8c8c8-5555-4111-8111-000000000001', 'mc-coach@test.invalid',  '{"full_name": "Mo Coach", "dob": "1981-01-01"}'::jsonb),
  ('c8c8c8c8-5555-4111-8111-000000000002', 'mc-parent@test.invalid', '{"full_name": "Pia Parent", "dob": "1983-03-03"}'::jsonb),
  ('c8c8c8c8-5555-4111-8111-000000000003', 'mc-admin@test.invalid',  '{"full_name": "Al Admin", "dob": "1975-05-05"}'::jsonb),
  ('c8c8c8c8-5555-4111-8111-000000000004', 'mc-nobody@test.invalid', '{"full_name": "Nemo Nobody", "dob": "1990-09-09"}'::jsonb);
select set_config('mc.coach',  (select person_id::text from public.profiles where id = 'c8c8c8c8-5555-4111-8111-000000000001'), true);
select set_config('mc.parent', (select person_id::text from public.profiles where id = 'c8c8c8c8-5555-4111-8111-000000000002'), true);
select set_config('mc.admin',  (select person_id::text from public.profiles where id = 'c8c8c8c8-5555-4111-8111-000000000003'), true);

insert into public.person_roles (person_id, role, granted_by) values
  (current_setting('mc.admin')::uuid, 'club_admin',        'c8c8c8c8-5555-4111-8111-000000000003'),
  (current_setting('mc.admin')::uuid, 'safeguarding_lead', 'c8c8c8c8-5555-4111-8111-000000000003'),
  (current_setting('mc.coach')::uuid, 'coach',             'c8c8c8c8-5555-4111-8111-000000000003'),
  (current_setting('mc.parent')::uuid, 'parent',           'c8c8c8c8-5555-4111-8111-000000000003');

insert into public.people (id, first_name, last_name, dob)
  values ('c8c8c8c8-5555-4111-8111-00000000000a', 'Kit', 'Kid', (current_date - interval '9 years')::date);
insert into public.guardianships (guardian_person_id, child_person_id, relationship)
  values (current_setting('mc.parent')::uuid, 'c8c8c8c8-5555-4111-8111-00000000000a', 'parent');

insert into public.seasons (id, name, starts_on, ends_on, is_current)
  values ('5c5c5c5c-5555-4111-8111-000000000001', 'MC 2040/41', '2040-08-01', '2041-05-31', true);
insert into public.teams (id, name) values ('8b8b8b8b-5555-4111-8111-000000000001', 'MC Town');
insert into public.team_memberships (person_id, team_id, season_id, role) values
  (current_setting('mc.coach')::uuid,  '8b8b8b8b-5555-4111-8111-000000000001', '5c5c5c5c-5555-4111-8111-000000000001', 'coach'),
  (current_setting('mc.parent')::uuid, '8b8b8b8b-5555-4111-8111-000000000001', '5c5c5c5c-5555-4111-8111-000000000001', 'player'),
  ('c8c8c8c8-5555-4111-8111-00000000000a', '8b8b8b8b-5555-4111-8111-000000000001', '5c5c5c5c-5555-4111-8111-000000000001', 'player');
insert into public.waiting_list_access (person_id, age_group) values (current_setting('mc.coach')::uuid, 'U10');

-- The coach ---------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"c8c8c8c8-5555-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select public.my_capabilities() ->> 'person_id'), current_setting('mc.coach'),
  'the caller''s own person id comes back');
select is((select (public.my_capabilities() ->> 'is_team_staff')::boolean), true, 'a coach membership is team staff');
select is((select (public.my_capabilities() ->> 'has_coach_role')::boolean), true, 'the coach app role is reported');
select is((select (public.my_capabilities() ->> 'has_player_membership')::boolean), false,
  'coaching a team is not playing for it');
select is((select (public.my_capabilities() ->> 'has_waiting_list_access')::boolean), true,
  'a waiting-list grant is reported');
select is((select (public.my_capabilities() ->> 'is_club_admin')::boolean), false, 'a coach is not a club admin');
-- The whole point: identical answers to the accessors it replaces.
select is((select (public.my_capabilities() ->> 'is_club_admin')::boolean), public.is_club_admin(),
  'is_club_admin agrees with the accessor');
select is((select (public.my_capabilities() ->> 'is_safeguarding_lead')::boolean), public.is_safeguarding_lead(),
  'is_safeguarding_lead agrees with the accessor');
reset role;

-- The team arrays (20260824380000): names for the role-switcher ------------------
set local request.jwt.claims to '{"sub":"c8c8c8c8-5555-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select public.my_capabilities() -> 'staff_teams' -> 0 ->> 'name'), 'MC Town',
  'staff_teams names the coached team');
select is((select jsonb_array_length(public.my_capabilities() -> 'player_teams')), 0,
  'a pure coach has no player_teams — and the key is an empty array, not null');
reset role;

-- The parent --------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"c8c8c8c8-5555-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select is((select (public.my_capabilities() ->> 'is_guardian')::boolean), true, 'an active guardianship is reported');
select is((select (public.my_capabilities() ->> 'has_player_membership')::boolean), true,
  'a parent who also plays holds a player membership');
select is((select (public.my_capabilities() ->> 'is_team_staff')::boolean), false, 'playing is not staffing');
select is((select public.my_capabilities() -> 'parent_teams' -> 0 ->> 'name'), 'MC Town',
  'parent_teams names the child''s team');
select is((select public.my_capabilities() -> 'parent_teams' -> 0 -> 'children' ->> 0), 'Kit Kid',
  'and says which child the hat is for');
reset role;

-- The admin ---------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"c8c8c8c8-5555-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select is((select (public.my_capabilities() ->> 'is_club_admin')::boolean), true, 'the club admin role is reported');
select is((select (public.my_capabilities() ->> 'is_safeguarding_lead')::boolean), true,
  'the safeguarding lead role is reported');
reset role;

-- Somebody the club has not linked to anything -----------------------------------
set local request.jwt.claims to '{"sub":"c8c8c8c8-5555-4111-8111-000000000004","role":"authenticated"}';
set local role authenticated;
select is((select public.my_capabilities()), jsonb_build_object(
    'person_id', (select person_id::text from public.profiles where id = 'c8c8c8c8-5555-4111-8111-000000000004'),
    'is_club_admin', false, 'is_safeguarding_lead', false, 'has_waiting_list_access', false,
    'has_coach_role', false, 'has_parent_role', false, 'is_team_staff', false,
    'has_player_membership', false, 'is_guardian', false,
    'staff_teams', '[]'::jsonb, 'player_teams', '[]'::jsonb, 'parent_teams', '[]'::jsonb),
  'an unlinked account holds nothing, and every key is still present');
reset role;

select * from finish();
rollback;
