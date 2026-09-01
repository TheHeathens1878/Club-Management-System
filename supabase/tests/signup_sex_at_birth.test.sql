-- =============================================================================
-- Biological sex at birth on sign-up (20260901140000)
-- =============================================================================
--   A  'male' / 'female' in the sign-up metadata land on the person
--   B  the case people actually type is accepted
--   C  anything else is stored as nothing, and does not fail the sign-up
--   D  a sign-up that says nothing about it still works
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(5);

insert into auth.users (id, email, raw_user_meta_data) values
  ('5c5c5c5c-2222-4111-8111-000000000001', 'sx-f@test.invalid',
   '{"first_name": "Fay", "last_name": "Female", "dob": "1990-01-01", "sex": "female"}'::jsonb),
  ('5c5c5c5c-2222-4111-8111-000000000002', 'sx-m@test.invalid',
   '{"first_name": "Mal", "last_name": "Male", "dob": "1990-01-01", "sex": "Male"}'::jsonb);

select is(
  (select p.sex from public.people p join public.profiles pr on pr.person_id = p.id
    where pr.id = '5c5c5c5c-2222-4111-8111-000000000001'),
  'female', 'female lands on the person');

select is(
  (select p.sex from public.people p join public.profiles pr on pr.person_id = p.id
    where pr.id = '5c5c5c5c-2222-4111-8111-000000000002'),
  'male', 'and the case somebody actually types is accepted');

-- C. anything else is nothing, not a refusal ------------------------------------
select lives_ok($$
  insert into auth.users (id, email, raw_user_meta_data) values
    ('5c5c5c5c-2222-4111-8111-000000000003', 'sx-odd@test.invalid',
     '{"first_name": "Odd", "last_name": "Value", "dob": "1990-01-01", "sex": "whatever"}'::jsonb)
$$, 'a value the column will not take does not fail the whole sign-up');

select is(
  (select p.sex from public.people p join public.profiles pr on pr.person_id = p.id
    where pr.id = '5c5c5c5c-2222-4111-8111-000000000003'),
  null, 'it is simply not recorded');

-- D. and saying nothing is still fine -------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('5c5c5c5c-2222-4111-8111-000000000004', 'sx-none@test.invalid',
   '{"first_name": "No", "last_name": "Answer", "dob": "1990-01-01"}'::jsonb);

select is(
  (select p.sex from public.people p join public.profiles pr on pr.person_id = p.id
    where pr.id = '5c5c5c5c-2222-4111-8111-000000000004'),
  null, 'a sign-up that says nothing about it still works — the join wizard and imports do');

select * from finish();
rollback;
