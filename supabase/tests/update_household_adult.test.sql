-- =============================================================================
-- Correcting a connected adult's record (20260826120000)
-- =============================================================================
-- What this suite covers:
--   A  shape: the function, and my_household()'s new column
--   B  the member may correct somebody they connected who has no login
--   C  and may NOT touch somebody who holds a login — their email address is
--      where a password reset goes, so this is the account-takeover door
--   D  a stranger is refused; a child is sent to the other screen
--   E  an email already on another live member is refused by sentence, not by
--      constraint name
--   F  the audit row names the fields that moved and not their values
--
-- Assertion count, kept in step: A 2, B 4, C 2, D 2, E 1, F 2  =  13.
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(13);

insert into auth.users (id, email, raw_user_meta_data) values
  ('aa11bb22-2612-4111-8111-000000000001', 'hh-owner@test.invalid',    '{"full_name": "Olive Owner", "dob": "1980-01-01"}'::jsonb),
  ('aa11bb22-2612-4111-8111-000000000002', 'hh-stranger@test.invalid', '{"full_name": "Sam Stranger", "dob": "1981-02-02"}'::jsonb),
  ('aa11bb22-2612-4111-8111-000000000003', 'hh-haslogin@test.invalid', '{"full_name": "Lee Login", "dob": "1982-03-03"}'::jsonb);
select set_config('hh.owner',    (select person_id::text from public.profiles where id = 'aa11bb22-2612-4111-8111-000000000001'), true);
select set_config('hh.stranger', (select person_id::text from public.profiles where id = 'aa11bb22-2612-4111-8111-000000000002'), true);
select set_config('hh.haslogin', (select person_id::text from public.profiles where id = 'aa11bb22-2612-4111-8111-000000000003'), true);

-- The login-less adult the owner connected, and a child, both created by the
-- owner's auth user so `is_household_member_of()` admits them.
insert into public.people (id, first_name, last_name, dob, email, phone, created_by) values
  ('cc11bb22-2612-4111-8111-000000000001', 'Pat',  'Partner', '1979-05-05', 'pat.old@test.invalid', '0161 000 0001', 'aa11bb22-2612-4111-8111-000000000001'),
  ('cc11bb22-2612-4111-8111-000000000002', 'Kid',  'Partner', (current_date - interval '10 years')::date, null, null, 'aa11bb22-2612-4111-8111-000000000001');
-- Somebody else entirely, holding the email we will try to steal.
insert into public.people (id, first_name, last_name, dob, email)
  values ('cc11bb22-2612-4111-8111-000000000003', 'Otto', 'Other', '1975-06-06', 'taken@test.invalid');

-- The account-holder is put in the owner's household the honest way, so the
-- only thing standing between them is the has-a-login rule.
insert into public.household_links (person_id, owner_user_id, match_basis)
  values (current_setting('hh.haslogin')::uuid, 'aa11bb22-2612-4111-8111-000000000001', 'email');


-- ---------------------------------------------------------------------------
-- A. Shape                                                            (2)
-- ---------------------------------------------------------------------------
select has_function('public', 'update_household_adult_details',
  array['uuid', 'text', 'text', 'text', 'text', 'text', 'jsonb'], 'update_household_adult_details(...)');
select ok(
  pg_get_function_result('public.my_household()'::regprocedure) like '%preferred_name%',
  'my_household() returns preferred_name, so the form can pre-fill it');


-- ---------------------------------------------------------------------------
-- B. The member corrects the record they typed                        (4)
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"aa11bb22-2612-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$ select public.update_household_adult_details(
       'cc11bb22-2612-4111-8111-000000000001', 'Patricia', 'Partner', 'Pat',
       'pat.new@test.invalid', '0161 000 9999') $$,
  'the member corrects the adult they connected');

reset role;
set local request.jwt.claims to '{}';

select is((select first_name from public.people where id = 'cc11bb22-2612-4111-8111-000000000001'),
  'Patricia', 'the first name is corrected');
select is((select email from public.people where id = 'cc11bb22-2612-4111-8111-000000000001'),
  'pat.new@test.invalid', 'and the email, which is what lets them be matched to a login later');
select is((select preferred_name from public.people where id = 'cc11bb22-2612-4111-8111-000000000001'),
  'Pat', 'and what they are known as');


-- ---------------------------------------------------------------------------
-- C. Not somebody who holds a login                                   (2)
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"aa11bb22-2612-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;

select throws_like(
  $$ select public.update_household_adult_details(
       current_setting('hh.haslogin')::uuid,
       'Lee', 'Login', null, 'attacker@test.invalid', null) $$,
  '%their own login%',
  'an adult with their own login keeps their own details — this is the takeover door');

reset role;
set local request.jwt.claims to '{}';

select is((select email from public.people where id = current_setting('hh.haslogin')::uuid),
  'hh-haslogin@test.invalid',
  'and their email address is untouched, which is the point of the rule');


-- ---------------------------------------------------------------------------
-- D. A stranger, and a child                                          (2)
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"aa11bb22-2612-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_like(
  $$ select public.update_household_adult_details(
       'cc11bb22-2612-4111-8111-000000000001', 'Nosy', 'Neighbour', null, null, null) $$,
  '%not show%',
  'somebody with no connection to them is refused');
reset role;
set local request.jwt.claims to '{}';

set local request.jwt.claims to '{"sub":"aa11bb22-2612-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select throws_like(
  $$ select public.update_household_adult_details(
       'cc11bb22-2612-4111-8111-000000000002', 'Kid', 'Partner', null, 'kid@test.invalid', null) $$,
  '%under 18%',
  'a child is sent to Connect Children, where guardianship is what is asked about');
reset role;
set local request.jwt.claims to '{}';


-- ---------------------------------------------------------------------------
-- E. An email already on somebody else                                (1)
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"aa11bb22-2612-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select throws_like(
  $$ select public.update_household_adult_details(
       'cc11bb22-2612-4111-8111-000000000001', 'Patricia', 'Partner', null,
       'taken@test.invalid', null) $$,
  '%already on another member%',
  'an email already on another live member is refused in words');
reset role;
set local request.jwt.claims to '{}';


-- ---------------------------------------------------------------------------
-- F. The audit row                                                    (2)
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public.audit_log
            where action = 'people.updated_by_household'
              and entity_id = 'cc11bb22-2612-4111-8111-000000000001'), 1,
  'one audit row for the one change that went through');

select ok((select detail->'fields' from public.audit_log
            where action = 'people.updated_by_household'
              and entity_id = 'cc11bb22-2612-4111-8111-000000000001' limit 1) @> '["email"]'::jsonb,
  'naming the fields that moved — and it holds no values, because this is contact data');

select * from finish();
rollback;
