-- =============================================================================
-- booking_contacts (20260825010000)
-- =============================================================================
--   A  staff read and write the contacts book; a plain member gets nothing
--   B  one contact per email — a case-shifted duplicate is refused
--   C  bookings.contact_id points into the book and survives contact deletion
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(7);

insert into auth.users (id, email, raw_user_meta_data) values
  ('bc0bc0bc-eeee-4111-8111-000000000001', 'bc-staff@test.invalid',  '{"full_name": "Stef Staff", "dob": "1980-01-01"}'::jsonb),
  ('bc0bc0bc-eeee-4111-8111-000000000002', 'bc-member@test.invalid', '{"full_name": "Mem Member", "dob": "1990-02-02"}'::jsonb);
insert into public.person_roles (person_id, role, granted_by)
  values ((select person_id from public.profiles where id = 'bc0bc0bc-eeee-4111-8111-000000000001'),
          'staff', 'bc0bc0bc-eeee-4111-8111-000000000001');

insert into public.resources (id, type, name, active) values
  ('b00c0000-eeee-4111-8111-000000000001', 'function_room', 'BC Function Room', true);

-- --- A: staff in, members out ----------------------------------------------
set local request.jwt.claims to '{"sub":"bc0bc0bc-eeee-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$ insert into public.booking_contacts (first_name, last_name, email, phone)
     values ('Karen', 'Hayes', 'karen@test.invalid', '07700 900001') $$,
  'staff can add a hire contact');
select is(
  (select count(*)::integer from public.booking_contacts),
  1,
  'staff read the contacts book');

set local request.jwt.claims to '{"sub":"bc0bc0bc-eeee-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select is(
  (select count(*)::integer from public.booking_contacts),
  0,
  'a plain member sees no hire contacts');
select throws_ok(
  $$ insert into public.booking_contacts (first_name, last_name, email) values ('X', 'Ray', 'x@test.invalid') $$,
  '42501', null,
  'a plain member cannot write the contacts book');

reset role;

-- --- B: one contact per email ------------------------------------------------
select throws_ok(
  $$ insert into public.booking_contacts (first_name, last_name, email) values ('Karen', 'H', 'KAREN@test.invalid') $$,
  '23505', null,
  'a case-shifted duplicate email is refused');

-- --- C: bookings point into the book -----------------------------------------
insert into public.bookings (id, resource_id, kind, status, starts_at, ends_at,
                             booker_name, booker_email, contact_id)
values ('b00c0000-eeee-4111-8111-00000000000b', 'b00c0000-eeee-4111-8111-000000000001',
        'hire', 'confirmed', now() + interval '30 days', now() + interval '30 days 4 hours',
        'Karen Hayes', 'karen@test.invalid',
        (select id from public.booking_contacts where email = 'karen@test.invalid'));
select ok(
  (select contact_id is not null from public.bookings
    where id = 'b00c0000-eeee-4111-8111-00000000000b'),
  'a booking carries its contact');

delete from public.booking_contacts where email = 'karen@test.invalid';
select ok(
  (select contact_id is null from public.bookings
    where id = 'b00c0000-eeee-4111-8111-00000000000b'),
  'deleting the contact leaves the booking (and its snapshot) intact');

select * from finish();
rollback;
