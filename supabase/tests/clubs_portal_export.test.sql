-- =============================================================================
-- The FA Clubs Portal export (20260906120000)
-- =============================================================================
--   A  a contact carries what the Portal asks: dob, sex, email, address —
--      a postcode is required with an address, sex is male/female
--   B  the lead booker links to their own record; a stranger cannot be linked
--   C  the export resolves a contact three ways: linked, matching guardian,
--      typed — and reads the player's own fields
--   D  doors: club administrators only, one audit row per call, anon shut out
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(24);

-- An administrator, a parent, a coach; a child, an adult player.
insert into auth.users (id, email, raw_user_meta_data) values
  ('c1c1c1c1-0906-4111-8111-000000000001', 'cp-admin@test.invalid',  '{"full_name": "Clara Admin",  "dob": "1975-01-01"}'::jsonb),
  ('c1c1c1c1-0906-4111-8111-000000000002', 'cp-parent@test.invalid', '{"full_name": "Petra Parent", "dob": "1984-05-05"}'::jsonb),
  ('c1c1c1c1-0906-4111-8111-000000000003', 'cp-coach@test.invalid',  '{"full_name": "Colin Coach",  "dob": "1980-01-01"}'::jsonb);
select set_config('cp.admin',  (select person_id::text from public.profiles where id = 'c1c1c1c1-0906-4111-8111-000000000001'), true);
select set_config('cp.parent', (select person_id::text from public.profiles where id = 'c1c1c1c1-0906-4111-8111-000000000002'), true);
select set_config('cp.coach',  (select person_id::text from public.profiles where id = 'c1c1c1c1-0906-4111-8111-000000000003'), true);
insert into public.person_roles (person_id, role, granted_by)
  values (current_setting('cp.admin')::uuid, 'club_admin', 'c1c1c1c1-0906-4111-8111-000000000001');
update public.people
   set sex = 'female', phone = '07700 900001', email = 'petra@test.invalid',
       address = '{"line1":"1 Parent Road","town":"Sale","postcode":"M33 1AA"}'::jsonb
 where id = current_setting('cp.parent')::uuid;

insert into public.people (id, first_name, last_name, dob, sex, id_verified, address) values
  ('9e9e9e9e-0906-4111-8111-000000000001', 'Kit', 'Child', current_date - interval '10 years', 'male', true,
   '{"line1":"1 Parent Road","town":"Sale","postcode":"M33 1AA"}'::jsonb),
  ('9e9e9e9e-0906-4111-8111-000000000002', 'Ann', 'Adult', '1990-03-03', 'female', false, null);
insert into public.guardianships (guardian_person_id, child_person_id, relationship)
  values (current_setting('cp.parent')::uuid, '9e9e9e9e-0906-4111-8111-000000000001', 'parent');

insert into public.seasons (id, name, starts_on, ends_on, is_current)
  values ('5c5c5c5c-0906-4111-8111-000000000001', 'CP 2060/61', current_date - 30, current_date + 300, true);
insert into public.teams (id, name, age_group) values
  ('7c7c7c7c-0906-4111-8111-000000000001', 'CP Under 11s', 'U11'),
  ('7c7c7c7c-0906-4111-8111-000000000002', 'CP Ladies', 'Open');
insert into public.team_memberships (person_id, team_id, season_id, role) values
  ('9e9e9e9e-0906-4111-8111-000000000001', '7c7c7c7c-0906-4111-8111-000000000001', '5c5c5c5c-0906-4111-8111-000000000001', 'player'),
  ('9e9e9e9e-0906-4111-8111-000000000002', '7c7c7c7c-0906-4111-8111-000000000002', '5c5c5c5c-0906-4111-8111-000000000001', 'player'),
  (current_setting('cp.coach')::uuid,      '7c7c7c7c-0906-4111-8111-000000000001', '5c5c5c5c-0906-4111-8111-000000000001', 'coach');

-- A. the fields -------------------------------------------------------------------
select has_column('public', 'emergency_contacts', 'contact_person_id', 'emergency_contacts.contact_person_id');
select has_column('public', 'emergency_contacts', 'dob',               'emergency_contacts.dob');
select has_column('public', 'emergency_contacts', 'address',           'emergency_contacts.address');

set local request.jwt.claims to '{"sub":"c1c1c1c1-0906-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select throws_ok($$
  select public.set_emergency_contacts('9e9e9e9e-0906-4111-8111-000000000002',
    '[{"first_name":"Gran","last_name":"Adult","phone":"07700 900002","address":{"line1":"2 Gran Lane","town":"Sale"}}]'::jsonb)
$$, 'P0001', null, 'an address without a postcode is refused');
select throws_ok($$
  select public.set_emergency_contacts('9e9e9e9e-0906-4111-8111-000000000002',
    '[{"first_name":"Gran","last_name":"Adult","phone":"07700 900002","sex":"other"}]'::jsonb)
$$, 'P0001', null, 'sex is male or female or blank');
select throws_ok($$
  select public.set_emergency_contacts('9e9e9e9e-0906-4111-8111-000000000002',
    '[{"first_name":"Gran","last_name":"Adult","phone":"07700 900002","dob":"2099-01-01"}]'::jsonb)
$$, 'P0001', null, 'a date of birth in the future is refused');
select lives_ok($$
  select public.set_emergency_contacts('9e9e9e9e-0906-4111-8111-000000000002',
    '[{"first_name":"Gran","last_name":"Adult","phone":"07700 900002","relationship":"Grandmother",
       "dob":"1950-06-06","sex":"female","email":"gran@test.invalid",
       "address":{"line1":"2 Gran Lane","line2":"","town":"Sale","postcode":"M33 2BB"}}]'::jsonb)
$$, 'a typed contact with everything the Portal asks is stored');
reset role;
select is((select address from public.emergency_contacts where person_id = '9e9e9e9e-0906-4111-8111-000000000002' and "position" = 1),
  '{"line1":"2 Gran Lane","town":"Sale","postcode":"M33 2BB"}'::jsonb, 'only the filled-in address keys are kept');
select is((select sex || '|' || dob::text || '|' || email from public.emergency_contacts
            where person_id = '9e9e9e9e-0906-4111-8111-000000000002' and "position" = 1),
  'female|1950-06-06|gran@test.invalid', 'and the rest of the contact with them');

-- B. the link ---------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"c1c1c1c1-0906-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  format($$ select public.set_emergency_contacts('9e9e9e9e-0906-4111-8111-000000000001',
    '[{"first_name":"Petra","last_name":"Parent","phone":"07700 900001","contact_person_id":"%s"}]'::jsonb) $$,
    '9e9e9e9e-0906-4111-8111-000000000002'),
  '42501', null, 'a parent cannot link a contact to somebody else''s record');
select lives_ok(
  format($$ select public.set_emergency_contacts('9e9e9e9e-0906-4111-8111-000000000001',
    '[{"first_name":"Petra","last_name":"Parent","phone":"07700 900001","relationship":"Mother","contact_person_id":"%s"},
      {"first_name":"Uncle","last_name":"Bob","phone":"07700 900003","dob":"1970-01-01","sex":"male",
       "address":{"line1":"3 Bob Street","postcode":"M33 3CC"}}]'::jsonb) $$,
    current_setting('cp.parent')),
  'the parent links contact 1 to their own record and types contact 2');
reset role;
select is((select contact_person_id from public.emergency_contacts
            where person_id = '9e9e9e9e-0906-4111-8111-000000000001' and "position" = 1),
  current_setting('cp.parent')::uuid, 'contact 1 points at the parent');

-- C. the export -------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"c1c1c1c1-0906-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select set_config('cp.rows', (select jsonb_agg(to_jsonb(r))::text from public.clubs_portal_export(
  array['7c7c7c7c-0906-4111-8111-000000000001', '7c7c7c7c-0906-4111-8111-000000000002']::uuid[]) r), true);
reset role;

select is((select count(*) from jsonb_array_elements(current_setting('cp.rows')::jsonb)),
  2::bigint, 'two players across the two teams — the coach is not a player');
select is((select r ->> 'age_proved' from jsonb_array_elements(current_setting('cp.rows')::jsonb) r
            where r ->> 'person_id' = '9e9e9e9e-0906-4111-8111-000000000001'),
  'true', 'the child''s age is recorded as proved');
select is((select r -> 'contact1' ->> 'dob' from jsonb_array_elements(current_setting('cp.rows')::jsonb) r
            where r ->> 'person_id' = '9e9e9e9e-0906-4111-8111-000000000001'),
  '1984-05-05', 'the linked parent''s date of birth comes from their own record');
select is((select r -> 'contact1' ->> 'source' from jsonb_array_elements(current_setting('cp.rows')::jsonb) r
            where r ->> 'person_id' = '9e9e9e9e-0906-4111-8111-000000000001'),
  'linked', 'and the export says so');
select is((select r -> 'contact1' -> 'address' ->> 'postcode' from jsonb_array_elements(current_setting('cp.rows')::jsonb) r
            where r ->> 'person_id' = '9e9e9e9e-0906-4111-8111-000000000001'),
  'M33 1AA', 'with their postcode');
select is((select r -> 'contact2' ->> 'first_name' from jsonb_array_elements(current_setting('cp.rows')::jsonb) r
            where r ->> 'person_id' = '9e9e9e9e-0906-4111-8111-000000000001'),
  'Uncle', 'contact 2 is the typed one');
select is((select r -> 'contact1' ->> 'email' from jsonb_array_elements(current_setting('cp.rows')::jsonb) r
            where r ->> 'person_id' = '9e9e9e9e-0906-4111-8111-000000000002'),
  'gran@test.invalid', 'the adult player''s typed contact reads back as typed');

-- A row written before the link existed: name only, matching the guardian.
delete from public.emergency_contacts where person_id = '9e9e9e9e-0906-4111-8111-000000000001';
insert into public.emergency_contacts (person_id, "position", first_name, last_name, phone)
  values ('9e9e9e9e-0906-4111-8111-000000000001', 1, 'petra', 'PARENT', '07700 900001');
set local request.jwt.claims to '{"sub":"c1c1c1c1-0906-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select (r.contact1 ->> 'source') || '|' || (r.contact1 ->> 'sex')
             from public.clubs_portal_export(array['7c7c7c7c-0906-4111-8111-000000000001']::uuid[]) r
            where r.person_id = '9e9e9e9e-0906-4111-8111-000000000001'),
  'guardian|female', 'an unlinked contact whose name matches a guardian is read from the guardian');
reset role;

-- D. doors ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"c1c1c1c1-0906-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select throws_ok($$
  select * from public.clubs_portal_export(array['7c7c7c7c-0906-4111-8111-000000000001']::uuid[])
$$, '42501', null, 'a coach cannot export');
reset role;
select is((select count(*) from public.audit_log where action = 'teams.clubs_portal.exported'),
  2::bigint, 'each successful export wrote one audit row');
select ok((select (detail ->> 'players')::int = 2 from public.audit_log
            where action = 'teams.clubs_portal.exported' order by created_at limit 1),
  'counting players, never naming them');
select ok(not has_function_privilege('anon', 'public.clubs_portal_export(uuid[])', 'EXECUTE'),
  'anon has no door');

select * from finish();
rollback;
