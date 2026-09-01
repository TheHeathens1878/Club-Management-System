-- =============================================================================
-- Sign-up name handling (20260901120000)
-- =============================================================================
--   A  first_name/last_name in the metadata are taken as typed
--   B  a surname the old split would have mangled survives
--   C  full_name alone still splits, for the join wizard, invites and imports
--   D  one half on its own is not trusted — it falls back to the split
--   E  profiles.full_name is written either way
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(7);

-- A. the two halves as typed ---------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('5e5e5e5e-1111-4111-8111-000000000001', 'sn-pair@test.invalid',
   '{"first_name": "Anne Marie", "last_name": "Wilson", "full_name": "Anne Marie Wilson", "dob": "1984-02-02"}'::jsonb);

select is(
  (select (first_name, last_name) from public.people p
     join public.profiles pr on pr.person_id = p.id
    where pr.id = '5e5e5e5e-1111-4111-8111-000000000001'),
  ('Anne Marie'::text, 'Wilson'::text),
  'first_name and last_name are taken as typed');

-- B. the surname the split used to mangle -------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('5e5e5e5e-1111-4111-8111-000000000002', 'sn-decruz@test.invalid',
   '{"first_name": "Maria", "last_name": "de la Cruz", "dob": "1990-05-05"}'::jsonb);

select is(
  (select last_name from public.people p
     join public.profiles pr on pr.person_id = p.id
    where pr.id = '5e5e5e5e-1111-4111-8111-000000000002'),
  'de la Cruz',
  'a surname of three words is not reduced to its last word');

select is(
  (select full_name from public.profiles where id = '5e5e5e5e-1111-4111-8111-000000000002'),
  'Maria de la Cruz',
  'and the profile name is built from the two halves when no full name was sent');

-- C. full_name alone still splits ----------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('5e5e5e5e-1111-4111-8111-000000000003', 'sn-full@test.invalid',
   '{"full_name": "Sam Splitter", "dob": "1988-08-08"}'::jsonb);

select is(
  (select (first_name, last_name) from public.people p
     join public.profiles pr on pr.person_id = p.id
    where pr.id = '5e5e5e5e-1111-4111-8111-000000000003'),
  ('Sam'::text, 'Splitter'::text),
  'a caller that sends only a full name still has it split — the join wizard, invites, imports');

select is(
  (select full_name from public.profiles where id = '5e5e5e5e-1111-4111-8111-000000000003'),
  'Sam Splitter',
  'and the full name it sent is the one the profile keeps');

-- D. half a pair is not a pair --------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('5e5e5e5e-1111-4111-8111-000000000004', 'sn-half@test.invalid',
   '{"first_name": "Halfy", "full_name": "Robin Halfway", "dob": "1991-01-01"}'::jsonb);

select is(
  (select (first_name, last_name) from public.people p
     join public.profiles pr on pr.person_id = p.id
    where pr.id = '5e5e5e5e-1111-4111-8111-000000000004'),
  ('Robin'::text, 'Halfway'::text),
  'a first name with no surname beside it is ignored in favour of the full name');

-- E. dob and phone still land, as account_requests already asserts -------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('5e5e5e5e-1111-4111-8111-000000000005', 'sn-phone@test.invalid',
   '{"first_name": "Pat", "last_name": "Phone", "dob": "1975-03-03", "phone": "07700 900123"}'::jsonb);

select is(
  (select phone from public.people p
     join public.profiles pr on pr.person_id = p.id
    where pr.id = '5e5e5e5e-1111-4111-8111-000000000005'),
  '07700 900123',
  'the phone still lands on the person');

select * from finish();
rollback;
