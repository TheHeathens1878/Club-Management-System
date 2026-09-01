-- =============================================================================
-- Emergency contacts live on the person (20260825150000)
-- =============================================================================
--   A  a guardian records two contacts for their minor child and reads them back
--   B  setting one afterwards REPLACES the pair — one row, at position 1
--   C  a third contact is refused
--   D  a contact with no phone number is refused
--   E  another adult can neither set them nor see them
--   F  an adult records their own
--   G  a guardian of a child who has turned 18 is refused (can_act_for lapses)
--   H  an ENDED guardianship is refused
--   I  a club administrator can both set and read
--   J  a coach with no link to the child reads nothing
--   K  the audit row counts the contacts and never names them
--   L  the registration form no longer asks the question
--   M  authenticated may read the table and may not write it
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(26);

insert into auth.users (id, email, raw_user_meta_data) values
  ('ec000000-1111-4111-8111-000000000001', 'ec-mum@test.invalid',      '{"full_name": "Mary Mum",   "dob": "1985-01-01"}'::jsonb),
  ('ec000000-1111-4111-8111-000000000002', 'ec-other@test.invalid',    '{"full_name": "Otto Other", "dob": "1980-02-02"}'::jsonb),
  ('ec000000-1111-4111-8111-000000000003', 'ec-admin@test.invalid',    '{"full_name": "Ada Admin",  "dob": "1975-03-03"}'::jsonb),
  ('ec000000-1111-4111-8111-000000000004', 'ec-coach@test.invalid',    '{"full_name": "Colin Coach","dob": "1978-04-04"}'::jsonb),
  ('ec000000-1111-4111-8111-000000000005', 'ec-solo@test.invalid',     '{"full_name": "Sam Solo",   "dob": "1990-05-05"}'::jsonb);

select set_config('ec.mum',   (select person_id::text from public.profiles where id = 'ec000000-1111-4111-8111-000000000001'), true);
select set_config('ec.other', (select person_id::text from public.profiles where id = 'ec000000-1111-4111-8111-000000000002'), true);
select set_config('ec.admin', (select person_id::text from public.profiles where id = 'ec000000-1111-4111-8111-000000000003'), true);
select set_config('ec.coach', (select person_id::text from public.profiles where id = 'ec000000-1111-4111-8111-000000000004'), true);
select set_config('ec.solo',  (select person_id::text from public.profiles where id = 'ec000000-1111-4111-8111-000000000005'), true);

insert into public.person_roles (person_id, role) values
  (current_setting('ec.admin')::uuid, 'club_admin'),
  (current_setting('ec.coach')::uuid, 'coach');

insert into public.people (id, first_name, last_name, dob) values
  ('ec000000-1111-4111-8111-0000000000aa', 'Katie', 'Kid',   (current_date - interval '10 years')::date),
  ('ec000000-1111-4111-8111-0000000000bb', 'Eddie', 'Ended', (current_date - interval '11 years')::date),
  ('ec000000-1111-4111-8111-0000000000cc', 'Gemma', 'Grown', (current_date - interval '12 years')::date);
insert into public.guardianships (guardian_person_id, child_person_id, relationship) values
  (current_setting('ec.mum')::uuid, 'ec000000-1111-4111-8111-0000000000aa', 'parent'),
  (current_setting('ec.mum')::uuid, 'ec000000-1111-4111-8111-0000000000bb', 'parent'),
  (current_setting('ec.mum')::uuid, 'ec000000-1111-4111-8111-0000000000cc', 'parent');

-- Eddie's arrangement has ended; Gemma has since turned 18. Both links stay in
-- place and both stop conferring authority — can_act_for() is the whole rule.
update public.guardianships set ended_at = now()
 where child_person_id = 'ec000000-1111-4111-8111-0000000000bb';
update public.people set dob = (current_date - interval '20 years')::date
 where id = 'ec000000-1111-4111-8111-0000000000cc';


-- A / B / C / D / G / H. the guardian's own session ---------------------------
set local request.jwt.claims to '{"sub":"ec000000-1111-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;

-- 1
select lives_ok($$
  select public.set_emergency_contacts(
    'ec000000-1111-4111-8111-0000000000aa',
    '[{"name": "  Nana Nora  ", "phone": " 07700 900321 ", "relationship": " Grandmother "},
      {"name": "Uncle Umar",    "phone": "07700 900654",   "relationship": ""}]'::jsonb)
$$, 'a guardian records two emergency contacts for their minor child');

-- 2
select is((select count(*) from public.emergency_contacts
            where person_id = 'ec000000-1111-4111-8111-0000000000aa'),
  2::bigint, 'and reads both of them back through the self policy');

-- 3
select is((select name || '/' || phone || '/' || coalesce(relationship, '-')
             from public.emergency_contacts
            where person_id = 'ec000000-1111-4111-8111-0000000000aa'
              and "position" = 1),
  'Nana Nora/07700 900321/Grandmother',
  'every string is trimmed on the way in');

-- 4
select is((select relationship from public.emergency_contacts
            where person_id = 'ec000000-1111-4111-8111-0000000000aa'
              and "position" = 2),
  null::text, 'a blank relationship is stored as NULL, not as an empty string');

-- B. replace, not append ------------------------------------------------------
-- 5
select lives_ok($$
  select public.set_emergency_contacts(
    'ec000000-1111-4111-8111-0000000000aa',
    '[{"name": "Nana Nora", "phone": "07700 900321", "relationship": "Grandmother"}]'::jsonb)
$$, 'the parent takes the second contact off the form and posts it back');

-- 6
select is((select count(*) from public.emergency_contacts
            where person_id = 'ec000000-1111-4111-8111-0000000000aa'),
  1::bigint, 'the list is REPLACED - the removed contact is gone, not orphaned');

-- 7
select is((select "position"::int from public.emergency_contacts
            where person_id = 'ec000000-1111-4111-8111-0000000000aa'),
  1, 'and the one that remains is renumbered to first, never left at 2');

-- C / D. what the function will not store -------------------------------------
-- 8
select throws_like($$
  select public.set_emergency_contacts(
    'ec000000-1111-4111-8111-0000000000aa',
    '[{"name": "One", "phone": "1"}, {"name": "Two", "phone": "2"}, {"name": "Three", "phone": "3"}]'::jsonb)
$$, '%at most two%', 'a third emergency contact is refused - "up to 2" is a constraint, not a form rule');

-- 9
select throws_like($$
  select public.set_emergency_contacts(
    'ec000000-1111-4111-8111-0000000000aa',
    '[{"name": "No Number", "phone": "   "}]'::jsonb)
$$, '%needs a first name, a last name and a phone number%', 'a contact with a blank phone number is refused');

-- 10
select is((select count(*) from public.emergency_contacts
            where person_id = 'ec000000-1111-4111-8111-0000000000aa'),
  1::bigint, 'and a refused list leaves the stored one untouched - validation runs before the delete');

-- G / H. authority that has lapsed --------------------------------------------
-- 11
select throws_ok($$
  select public.set_emergency_contacts('ec000000-1111-4111-8111-0000000000cc',
    '[{"name": "Nana Nora", "phone": "07700 900321"}]'::jsonb)
$$, '42501', null, 'a child who has turned 18 keeps their own emergency contacts [SG-4]');

-- 12
select throws_ok($$
  select public.set_emergency_contacts('ec000000-1111-4111-8111-0000000000bb',
    '[{"name": "Nana Nora", "phone": "07700 900321"}]'::jsonb)
$$, '42501', null, 'an ended guardianship confers nothing');

reset role;


-- E. another adult, guardian of nobody here -----------------------------------
set local request.jwt.claims to '{"sub":"ec000000-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;

-- 13
select throws_ok($$
  select public.set_emergency_contacts('ec000000-1111-4111-8111-0000000000aa',
    '[{"name": "Stranger", "phone": "07700 900999"}]'::jsonb)
$$, '42501', null, 'another adult cannot set a child''s emergency contacts');

-- 14
select is((select count(*) from public.emergency_contacts
            where person_id = 'ec000000-1111-4111-8111-0000000000aa'),
  0::bigint, 'and cannot see them either');

reset role;


-- F. an adult records their own ------------------------------------------------
set local request.jwt.claims to '{"sub":"ec000000-1111-4111-8111-000000000005","role":"authenticated"}';
set local role authenticated;

-- 15
select lives_ok($$
  select public.set_emergency_contacts(
    (select current_setting('ec.solo')::uuid),
    '[{"name": "Partner Pat", "phone": "07700 900777", "relationship": "Partner"}]'::jsonb)
$$, 'an adult member records their own emergency contact - no registration involved');

-- 16
select is((select count(*) from public.emergency_contacts
            where person_id = current_setting('ec.solo')::uuid),
  1::bigint, 'and reads it back');

reset role;


-- I. the club administrator ------------------------------------------------------
set local request.jwt.claims to '{"sub":"ec000000-1111-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;

-- 17
select lives_ok($$
  select public.set_emergency_contacts('ec000000-1111-4111-8111-0000000000bb',
    '[{"name": "Office Olive", "phone": "0161 900 0000", "relationship": "Aunt"}]'::jsonb)
$$, 'a club administrator types in a contact for a child nobody is currently guardian of');

-- 18
select is((select count(*) from public.emergency_contacts
            where person_id = 'ec000000-1111-4111-8111-0000000000bb'),
  1::bigint, 'and reads it back');

-- 19
select is((select count(*) from public.emergency_contacts
            where person_id = 'ec000000-1111-4111-8111-0000000000aa'),
  1::bigint, 'the admin read policy reaches another family''s contacts too');

reset role;


-- J. a coach ---------------------------------------------------------------------
-- The open decision in the migration header, asserted so that widening it later
-- is a deliberate change to this test rather than an accident.
set local request.jwt.claims to '{"sub":"ec000000-1111-4111-8111-000000000004","role":"authenticated"}';
set local role authenticated;

-- 20
select is((select count(*) from public.emergency_contacts
            where person_id = 'ec000000-1111-4111-8111-0000000000aa'),
  0::bigint, 'a coach with no link to the child sees nothing - deliberately, for now');

reset role;


-- K. the audit trail ---------------------------------------------------------------
-- 21
select is((select count(*) from public.audit_log
            where action = 'people.emergency_contacts.updated'
              and entity_id = 'ec000000-1111-4111-8111-0000000000aa'),
  2::bigint, 'both edits to this child''s contacts are on the trail');

-- 22
select is((select detail ->> 'count' from public.audit_log
            where action = 'people.emergency_contacts.updated'
              and entity_id = 'ec000000-1111-4111-8111-0000000000aa'
            order by id desc limit 1),
  '1', 'the latest row records how many contacts were stored');

-- 23
select ok(not exists (
    select 1 from public.audit_log
     where action = 'people.emergency_contacts.updated'
       and (detail::text ilike '%nora%' or detail::text like '%900321%'
            or detail::text ilike '%olive%')),
  'and no audit row carries a contact''s name or number - audit_log is read more widely than this table');


-- L. the registration form no longer asks -----------------------------------------
-- 24
select is((select count(*) from public.registration_questions
            where qkey = 'emergency_contact'),
  0::bigint, 'the emergency contact question is off the registration form');


-- M. the table is readable and inert ------------------------------------------------
-- 25
select ok(has_table_privilege('authenticated', 'public.emergency_contacts', 'SELECT'),
  'authenticated may read the table (the policies decide which rows)');

-- 26
select ok(not has_table_privilege('authenticated', 'public.emergency_contacts', 'INSERT')
      and not has_table_privilege('authenticated', 'public.emergency_contacts', 'UPDATE')
      and not has_table_privilege('authenticated', 'public.emergency_contacts', 'DELETE'),
  'and may not write it at all - every change goes through set_emergency_contacts()');

select * from finish();
rollback;
