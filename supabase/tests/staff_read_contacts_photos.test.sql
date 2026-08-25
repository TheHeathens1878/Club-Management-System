-- =============================================================================
-- A team's staff read their players' emergency contacts and photos (20260825280000)
-- =============================================================================
--   A  the coach of a team reads a squad player's emergency contacts, person
--      row and photo object
--   B  the coach of ANOTHER team reads none of them
--   C  a player on the team is not staff and reads nothing about a team-mate
--   D  reading is all it is — the coach still cannot set the contacts
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(11);

insert into auth.users (id, email, raw_user_meta_data) values
  ('d7d7d7d7-2222-4111-8111-000000000001', 'sr-coach@test.invalid',  '{"full_name": "Cy Coach"}'::jsonb),
  ('d7d7d7d7-2222-4111-8111-000000000002', 'sr-other@test.invalid',  '{"full_name": "Otto Othercoach"}'::jsonb),
  ('d7d7d7d7-2222-4111-8111-000000000003', 'sr-player@test.invalid', '{"full_name": "Pam Player"}'::jsonb),
  ('d7d7d7d7-2222-4111-8111-000000000004', 'sr-mate@test.invalid',   '{"full_name": "Max Mate"}'::jsonb);
select set_config('sr.coach',  (select person_id::text from public.profiles where id = 'd7d7d7d7-2222-4111-8111-000000000001'), true);
select set_config('sr.other',  (select person_id::text from public.profiles where id = 'd7d7d7d7-2222-4111-8111-000000000002'), true);
select set_config('sr.player', (select person_id::text from public.profiles where id = 'd7d7d7d7-2222-4111-8111-000000000003'), true);
select set_config('sr.mate',   (select person_id::text from public.profiles where id = 'd7d7d7d7-2222-4111-8111-000000000004'), true);
update public.people set dob = '1988-08-08'
 where id in (current_setting('sr.coach')::uuid, current_setting('sr.other')::uuid,
              current_setting('sr.player')::uuid, current_setting('sr.mate')::uuid);

insert into public.seasons (id, name, starts_on, ends_on)
  values ('5d5d5d5d-2222-4111-8111-000000000001', 'Staff-read 2035/36', '2035-08-01', '2036-05-31');
insert into public.teams (id, name, age_group) values
  ('7d7d7d7d-2222-4111-8111-000000000001', 'Readers U15s', 'U15'),
  ('7d7d7d7d-2222-4111-8111-000000000002', 'Readers Other', 'U15');
insert into public.team_memberships (person_id, team_id, season_id, role) values
  (current_setting('sr.coach')::uuid,  '7d7d7d7d-2222-4111-8111-000000000001', '5d5d5d5d-2222-4111-8111-000000000001', 'coach'),
  (current_setting('sr.player')::uuid, '7d7d7d7d-2222-4111-8111-000000000001', '5d5d5d5d-2222-4111-8111-000000000001', 'player'),
  (current_setting('sr.mate')::uuid,   '7d7d7d7d-2222-4111-8111-000000000001', '5d5d5d5d-2222-4111-8111-000000000001', 'player'),
  (current_setting('sr.other')::uuid,  '7d7d7d7d-2222-4111-8111-000000000002', '5d5d5d5d-2222-4111-8111-000000000001', 'coach');

-- The player's own contacts and photo, written as the owner (the table has no
-- client write policy; the RPC is exercised elsewhere).
insert into public.emergency_contacts (person_id, "position", name, phone, relationship) values
  (current_setting('sr.player')::uuid, 1, 'Mary Player', '07700 900001', 'Mother');
update public.people set photo_path = current_setting('sr.player') || '/face.jpg'
 where id = current_setting('sr.player')::uuid;
insert into storage.objects (bucket_id, name, owner, metadata)
  values ('person-photos', current_setting('sr.player') || '/face.jpg', null, '{}'::jsonb);


-- A. the team's coach ---------------------------------------------------------------
set local request.jwt.claims to '{"sub":"d7d7d7d7-2222-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;

select is((select count(*) from public.emergency_contacts
            where person_id = current_setting('sr.player')::uuid), 1::bigint,
  'the coach reads a squad player''s emergency contact');
select is((select photo_path from public.people where id = current_setting('sr.player')::uuid),
  current_setting('sr.player') || '/face.jpg',
  'the coach reads the player''s person row, photo path included');
select is((select count(*) from storage.objects
            where bucket_id = 'person-photos' and name = current_setting('sr.player') || '/face.jpg'), 1::bigint,
  'and the photo object itself');
select ok(public.is_staff_for_person(current_setting('sr.player')::uuid),
  'is_staff_for_person answers yes for the coach');

-- D. reading is all it is
select throws_ok(
  $$ select public.set_emergency_contacts(current_setting('sr.player')::uuid,
       '[{"name": "Someone Else", "phone": "07700 900999"}]'::jsonb) $$,
  '42501', null,
  'the coach still cannot set a player''s contacts');
reset role;


-- B. the coach of another team ------------------------------------------------------
set local request.jwt.claims to '{"sub":"d7d7d7d7-2222-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;

select is((select count(*) from public.emergency_contacts
            where person_id = current_setting('sr.player')::uuid), 0::bigint,
  'another team''s coach reads no emergency contacts');
select is((select count(*) from public.people where id = current_setting('sr.player')::uuid), 0::bigint,
  'nor the person row');
select is((select count(*) from storage.objects
            where bucket_id = 'person-photos' and name = current_setting('sr.player') || '/face.jpg'), 0::bigint,
  'nor the photo');
select ok(not public.is_staff_for_person(current_setting('sr.player')::uuid),
  'is_staff_for_person answers no for them');
reset role;


-- C. a team-mate is not staff --------------------------------------------------------
set local request.jwt.claims to '{"sub":"d7d7d7d7-2222-4111-8111-000000000004","role":"authenticated"}';
set local role authenticated;

select is((select count(*) from public.emergency_contacts
            where person_id = current_setting('sr.player')::uuid), 0::bigint,
  'a player reads no team-mate''s emergency contacts');
select is((select count(*) from public.people where id = current_setting('sr.player')::uuid), 0::bigint,
  'nor their team-mate''s person row');
reset role;

select * from finish();
rollback;
