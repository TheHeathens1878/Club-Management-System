-- =============================================================================
-- A hirer is not asked for a date of birth (20260912100000)
-- =============================================================================
--   A  a member with no date of birth is still held at /complete-profile
--   B  a hirer (profiles.role = booker) with no date of birth is not
--   C  the same hirer, once a member again, is asked like anyone else
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(3);

insert into auth.users (id, email, raw_user_meta_data) values
  ('b00c0001-0912-4111-8111-000000000001', 'hirer-member@test.invalid', '{"full_name": "Hilda Hirer"}'::jsonb),
  ('b00c0001-0912-4111-8111-000000000002', 'hirer-booker@test.invalid', '{"full_name": "Bertie Booker"}'::jsonb);

-- The sign-up trigger made each a people row with no date of birth.
select is(
  (select dob from public.people where id = (select person_id from public.profiles where id = 'b00c0001-0912-4111-8111-000000000001')),
  null,
  'the trigger leaves the date of birth unknown');

update public.profiles set role = 'booker' where id = 'b00c0001-0912-4111-8111-000000000002';

set local request.jwt.claims to '{"sub":"b00c0001-0912-4111-8111-000000000001","role":"authenticated"}';
select is(public.needs_dob_completion(), true, 'A: a member without a date of birth is asked for it');

set local request.jwt.claims to '{"sub":"b00c0001-0912-4111-8111-000000000002","role":"authenticated"}';
select is(public.needs_dob_completion(), false, 'B: a hirer without a date of birth is not asked');

select * from finish();
rollback;
