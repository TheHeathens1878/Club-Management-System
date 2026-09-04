-- =============================================================================
-- Names wear their hats in the member list (20260904150000)
-- =============================================================================
--   A participant reads their room-mates' hats: Admin, staff roles with team
--   names. Referee shows only inside the Referees group. Outsiders get
--   nothing; a plain member wears no labels at all.
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(7);

insert into auth.users (id, email, raw_user_meta_data) values
  ('e4e4e4e4-7777-4111-8111-000000000001', 'ml-admin@test.invalid',  '{"full_name": "Ada Admin", "dob": "1975-01-01"}'::jsonb),
  ('e4e4e4e4-7777-4111-8111-000000000002', 'ml-coach@test.invalid',  '{"full_name": "Cal Coach", "dob": "1984-02-02"}'::jsonb),
  ('e4e4e4e4-7777-4111-8111-000000000003', 'ml-plain@test.invalid',  '{"full_name": "Mo Member", "dob": "1990-03-03"}'::jsonb),
  ('e4e4e4e4-7777-4111-8111-000000000004', 'ml-out@test.invalid',    '{"full_name": "Odi Out", "dob": "1988-04-04"}'::jsonb);
select set_config('ml.admin', (select person_id::text from public.profiles where id = 'e4e4e4e4-7777-4111-8111-000000000001'), true);
select set_config('ml.coach', (select person_id::text from public.profiles where id = 'e4e4e4e4-7777-4111-8111-000000000002'), true);
select set_config('ml.plain', (select person_id::text from public.profiles where id = 'e4e4e4e4-7777-4111-8111-000000000003'), true);
select set_config('ml.out',   (select person_id::text from public.profiles where id = 'e4e4e4e4-7777-4111-8111-000000000004'), true);
insert into public.person_roles (person_id, role, granted_by) values
  (current_setting('ml.admin')::uuid, 'club_admin', 'e4e4e4e4-7777-4111-8111-000000000001'),
  (current_setting('ml.coach')::uuid, 'referee',    'e4e4e4e4-7777-4111-8111-000000000001');

update public.seasons set is_current = false where is_current;
insert into public.seasons (id, name, starts_on, ends_on, is_current)
  values ('5a5a5a5a-7777-4111-8111-000000000001', 'Hats 2045/46', current_date - 30, current_date + 300, true);
insert into public.teams (id, name) values
  ('9e9e9e9e-7777-4111-8111-000000000001', 'ML Mavericks'),
  ('9e9e9e9e-7777-4111-8111-000000000002', 'ML Cobras');
insert into public.team_memberships (person_id, team_id, season_id, role) values
  (current_setting('ml.coach')::uuid, '9e9e9e9e-7777-4111-8111-000000000001', '5a5a5a5a-7777-4111-8111-000000000001', 'coach'),
  (current_setting('ml.coach')::uuid, '9e9e9e9e-7777-4111-8111-000000000002', '5a5a5a5a-7777-4111-8111-000000000001', 'coach');

insert into public.conversations (id, type, title, created_by_person_id) values
  ('c5050505-7777-4111-8111-000000000001', 'group', 'ML Ordinary group', current_setting('ml.admin')::uuid),
  ('c5050505-7777-4111-8111-000000000002', 'group', 'Referees',          current_setting('ml.admin')::uuid);
insert into public.conversation_participants (conversation_id, person_id, basis) values
  ('c5050505-7777-4111-8111-000000000001', current_setting('ml.admin')::uuid, 'member'),
  ('c5050505-7777-4111-8111-000000000001', current_setting('ml.coach')::uuid, 'member'),
  ('c5050505-7777-4111-8111-000000000001', current_setting('ml.plain')::uuid, 'member'),
  ('c5050505-7777-4111-8111-000000000002', current_setting('ml.coach')::uuid, 'member');

-- A participant reads the room's hats ------------------------------------------
set local request.jwt.claims to '{"sub":"e4e4e4e4-7777-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select is((select l.labels from public.conversation_member_labels('c5050505-7777-4111-8111-000000000001') l
           where l.person_id = current_setting('ml.admin')::uuid),
  array['Admin'], 'the administrator wears Admin');
select is((select l.labels from public.conversation_member_labels('c5050505-7777-4111-8111-000000000001') l
           where l.person_id = current_setting('ml.coach')::uuid),
  array['Coach ML Cobras', 'Coach ML Mavericks'],
  'a coach wears one label per team — and NO Referee outside the Referees group');
select is((select l.labels from public.conversation_member_labels('c5050505-7777-4111-8111-000000000001') l
           where l.person_id = current_setting('ml.plain')::uuid),
  '{}'::text[], 'a plain member wears nothing — no children, no memberships leak');
reset role;

-- Referee shows only in the Referees group --------------------------------------
set local request.jwt.claims to '{"sub":"e4e4e4e4-7777-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select is((select l.labels from public.conversation_member_labels('c5050505-7777-4111-8111-000000000002') l
           where l.person_id = current_setting('ml.coach')::uuid),
  array['Referee', 'Coach ML Cobras', 'Coach ML Mavericks'],
  'inside the Referees group the referee hat shows first');
reset role;

-- Outsiders ----------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"e4e4e4e4-7777-4111-8111-000000000004","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.conversation_member_labels('c5050505-7777-4111-8111-000000000001')),
  0::bigint, 'a non-participant reads nothing at all');
reset role;

-- Grants --------------------------------------------------------------------------
select is(has_function_privilege('authenticated', 'public.conversation_member_labels(uuid)', 'execute'),
  true, 'authenticated may ask');
select is(has_function_privilege('anon', 'public.conversation_member_labels(uuid)', 'execute'),
  false, 'anon may not');

select * from finish();
rollback;
