-- =============================================================================
-- A guardian edits a child's contact details (20260825120000)
-- =============================================================================
--   A  an active guardian updates email, phone, address and preferred name
--   B  the name and the date of birth are untouched by the same call
--   C  an ENDED guardianship is refused
--   D  a "child" who has turned 18 is refused
--   E  another adult, guardian of nobody here, is refused
--   F  the audit row names the fields that changed and none of their values
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(12);

insert into auth.users (id, email, raw_user_meta_data) values
  ('c1c1c1c1-aaaa-4111-8111-000000000001', 'cd-mum@test.invalid',   '{"full_name": "Mary Mum", "dob": "1985-01-01"}'::jsonb),
  ('c1c1c1c1-aaaa-4111-8111-000000000002', 'cd-other@test.invalid', '{"full_name": "Otto Other", "dob": "1980-02-02"}'::jsonb);
select set_config('cd.mum',   (select person_id::text from public.profiles where id = 'c1c1c1c1-aaaa-4111-8111-000000000001'), true);
select set_config('cd.other', (select person_id::text from public.profiles where id = 'c1c1c1c1-aaaa-4111-8111-000000000002'), true);

-- The lead contact's own address. The "Same address as lead contact" tick-box
-- on /family posts THIS object as the child's, which is why the child's
-- address is a plain jsonb argument and not a pointer at anyone's record: the
-- separated parent unticks it, types their own, and neither rewrites the other.
update public.people
   set address = '{"line1": "1 Lead Street", "town": "Sale", "postcode": "M33 1AA"}'::jsonb
 where id = current_setting('cd.mum')::uuid;

insert into public.people (id, first_name, last_name, dob) values
  ('c1c1c1c1-aaaa-4111-8111-00000000000a', 'Katie', 'Kid',   (current_date - interval '10 years')::date),
  ('c1c1c1c1-aaaa-4111-8111-00000000000b', 'Eddie', 'Ended', (current_date - interval '11 years')::date),
  ('c1c1c1c1-aaaa-4111-8111-00000000000c', 'Gemma', 'Grown', (current_date - interval '12 years')::date);
insert into public.guardianships (guardian_person_id, child_person_id, relationship) values
  (current_setting('cd.mum')::uuid, 'c1c1c1c1-aaaa-4111-8111-00000000000a', 'parent'),
  (current_setting('cd.mum')::uuid, 'c1c1c1c1-aaaa-4111-8111-00000000000b', 'parent'),
  (current_setting('cd.mum')::uuid, 'c1c1c1c1-aaaa-4111-8111-00000000000c', 'parent');

-- Eddie's arrangement has ended; Gemma has since turned 18. Both links stay in
-- place (SG-4 does not delete them) and both stop conferring authority.
update public.guardianships set ended_at = now()
 where child_person_id = 'c1c1c1c1-aaaa-4111-8111-00000000000b';
update public.people set dob = (current_date - interval '20 years')::date
 where id = 'c1c1c1c1-aaaa-4111-8111-00000000000c';


-- A / B / C / D. the guardian's own session ---------------------------------------
set local request.jwt.claims to '{"sub":"c1c1c1c1-aaaa-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;

select lives_ok($$
  select public.update_child_details(
    'c1c1c1c1-aaaa-4111-8111-00000000000a',
    'Katie.Kid@test.invalid',
    '07700 900111',
    '{"line1": "1 Lead Street", "town": "Sale", "postcode": "M33 1AA"}'::jsonb,
    'Kate')
$$, 'an active guardian updates their child''s contact details');

select throws_like($$
  select public.update_child_details('c1c1c1c1-aaaa-4111-8111-00000000000b', 'eddie@test.invalid')
$$, '%active guardian%', 'an ended guardianship confers nothing');

select throws_like($$
  select public.update_child_details('c1c1c1c1-aaaa-4111-8111-00000000000c', 'gemma@test.invalid')
$$, '%18 or over%', 'a child who has turned 18 keeps their own contact details');

reset role;


-- E. a stranger to this child -------------------------------------------------------
set local request.jwt.claims to '{"sub":"c1c1c1c1-aaaa-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_like($$
  select public.update_child_details('c1c1c1c1-aaaa-4111-8111-00000000000a', 'otto@test.invalid')
$$, '%active guardian%', 'another adult is not a guardian of this child');
reset role;


-- What actually landed ---------------------------------------------------------------
select is((select email from public.people where id = 'c1c1c1c1-aaaa-4111-8111-00000000000a'),
  'katie.kid@test.invalid', 'the email is stored, folded to lower case');
select is((select phone from public.people where id = 'c1c1c1c1-aaaa-4111-8111-00000000000a'),
  '07700 900111', 'the phone is stored');
select is((select address ->> 'postcode' from public.people where id = 'c1c1c1c1-aaaa-4111-8111-00000000000a'),
  'M33 1AA', 'the address is stored as the same object shape the join wizard writes');
select is((select preferred_name from public.people where id = 'c1c1c1c1-aaaa-4111-8111-00000000000a'),
  'Kate', 'the preferred name is stored');

-- B. the two fields the function does not accept -------------------------------------
select is((select first_name || ' ' || last_name from public.people where id = 'c1c1c1c1-aaaa-4111-8111-00000000000a'),
  'Katie Kid', 'the name is untouched - the club corrects a name');
select is((select dob from public.people where id = 'c1c1c1c1-aaaa-4111-8111-00000000000a'),
  (current_date - interval '10 years')::date, 'the date of birth is untouched [SG-0]');

-- F. the audit row ---------------------------------------------------------------------
select is((select detail -> 'fields' from public.audit_log
            where action = 'people.child.updated'
              and entity_id = 'c1c1c1c1-aaaa-4111-8111-00000000000a'),
  '["email", "phone", "address", "preferred_name"]'::jsonb,
  'the audit row names every field that changed');
select ok((select detail::text from public.audit_log
            where action = 'people.child.updated'
              and entity_id = 'c1c1c1c1-aaaa-4111-8111-00000000000a')
          not like '%katie.kid%',
  'and none of their values - an audit trail is read by more people than people is');

select * from finish();
rollback;
