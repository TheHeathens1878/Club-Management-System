-- =============================================================================
-- Signing up with an address the club already knows (20260902100000)
-- =============================================================================
--   A  THE BUG: a child with app access granted signs up and is refused
--      (this is what production did on 2026-09-02) — now they are LINKED,
--      one person, not two
--   B  an adult the club holds with no login claims their own record, and the
--      blanks the club was missing are filled from the sign-up
--   C  what the club already holds is never overwritten
--   D  a date of birth that disagrees is two people, and is refused
--   E  a child with no app access is refused, and says so
--   F  somebody who already has a login is left alone — a second person is
--      created rather than a second door into the first
--   G  an address the club has never seen still creates a person
--   H  signup_email_check() answers the same four questions in advance
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(29);

-- -----------------------------------------------------------------------------
-- The club's records, before anybody signs up
-- -----------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('4c4c4c4c-4444-4111-8111-000000000001', 'sl-parent@test.invalid',
     '{"full_name": "Pia Parent", "dob": "1982-02-02"}'::jsonb);
select set_config('sl.parent', (select person_id::text from public.profiles where id = '4c4c4c4c-4444-4111-8111-000000000001'), true);

-- A child the club has deliberately given app access to: this is Benjamin and
-- Matthew on production, and adam.wareing+11 in the bug report.
insert into public.people (id, first_name, last_name, email, dob) values
  ('c4c4c4c4-4444-4111-8111-000000000001', 'Cass', 'Consented', 'sl-child-yes@test.invalid',
     (current_date - interval '14 years')::date),
  ('c4c4c4c4-4444-4111-8111-000000000002', 'Nate', 'Noaccess',  'sl-child-no@test.invalid',
     (current_date - interval '14 years')::date),
  -- An adult the club knows and who has never signed in: one of the coaching
  -- staff imported without a date of birth.
  ('c4c4c4c4-4444-4111-8111-000000000003', 'Cora', 'Coach', 'sl-coach@test.invalid', null),
  -- An adult whose date of birth the club DOES hold.
  ('c4c4c4c4-4444-4111-8111-000000000004', 'Dora', 'Dated', 'sl-dated@test.invalid', '1975-05-05');

insert into public.guardianships (guardian_person_id, child_person_id, relationship) values
  (current_setting('sl.parent')::uuid, 'c4c4c4c4-4444-4111-8111-000000000001', 'parent'),
  (current_setting('sl.parent')::uuid, 'c4c4c4c4-4444-4111-8111-000000000002', 'parent');
insert into public.guardian_consents (child_person_id, guardian_person_id, consent_type, notice_version) values
  ('c4c4c4c4-4444-4111-8111-000000000001', current_setting('sl.parent')::uuid, 'app_account', 'v1');

-- Cora is a coach with no date of birth, exactly as the import left her.
insert into public.person_roles (person_id, role) values ('c4c4c4c4-4444-4111-8111-000000000003', 'coach');

select is((select count(*) from public.people where email like 'sl-c%' or email like 'sl-dated%'), 4::bigint,
  'four records, no logins between them');


-- =============================================================================
-- A. the bug: a consented child signs up
-- =============================================================================
select lives_ok($$
  insert into auth.users (id, email, raw_user_meta_data) values
    ('4c4c4c4c-4444-4111-8111-000000000010', 'sl-child-yes@test.invalid',
     jsonb_build_object('first_name','Cass','last_name','Consented','full_name','Cass Consented',
                        'dob', (current_date - interval '14 years')::date::text))
$$, 'a child with app access can create their account — this is the sign-up production refused');

select is((select person_id from public.profiles where id = '4c4c4c4c-4444-4111-8111-000000000010'),
  'c4c4c4c4-4444-4111-8111-000000000001'::uuid,
  'and it is joined to the record the club already had');
select is((select count(*) from public.people where lower(email) = 'sl-child-yes@test.invalid'),
  1::bigint, 'one person, not two');


-- =============================================================================
-- B. an adult claims their own record, and fills its blanks
-- =============================================================================
select lives_ok($$
  insert into auth.users (id, email, raw_user_meta_data) values
    ('4c4c4c4c-4444-4111-8111-000000000011', 'sl-coach@test.invalid',
     '{"first_name":"Cora","last_name":"Coach","full_name":"Cora Coach","dob":"1979-03-03","phone":"07700 900111","sex":"female"}'::jsonb)
$$, 'the coach the club imported without a date of birth signs up');

select is((select person_id from public.profiles where id = '4c4c4c4c-4444-4111-8111-000000000011'),
  'c4c4c4c4-4444-4111-8111-000000000003'::uuid, 'joined to her existing record');
select is((select dob::text from public.people where id = 'c4c4c4c4-4444-4111-8111-000000000003'),
  '1979-03-03', 'the blank date of birth is filled from the sign-up');
select is((select phone from public.people where id = 'c4c4c4c4-4444-4111-8111-000000000003'),
  '07700 900111', 'and so is the blank phone');
select is((select sex from public.people where id = 'c4c4c4c4-4444-4111-8111-000000000003'),
  'female', 'and the blank sex');
select is((select count(*) from public.person_roles
            where person_id = 'c4c4c4c4-4444-4111-8111-000000000003'
              and role = 'coach' and revoked_at is null),
  1::bigint, 'her coach role is still hers — nothing about the record was reset');


-- =============================================================================
-- C. what the club holds is never overwritten
-- =============================================================================
select lives_ok($$
  insert into auth.users (id, email, raw_user_meta_data) values
    ('4c4c4c4c-4444-4111-8111-000000000012', 'sl-dated@test.invalid',
     '{"first_name":"Dora","last_name":"Dated","full_name":"Dora Dated","phone":"07700 900222"}'::jsonb)
$$, 'an adult whose date of birth the club holds signs up without giving one');
select is((select dob::text from public.people where id = 'c4c4c4c4-4444-4111-8111-000000000004'),
  '1975-05-05', 'the club''s date of birth stands');
select is((select first_name || ' ' || last_name from public.people where id = 'c4c4c4c4-4444-4111-8111-000000000004'),
  'Dora Dated', 'and so does the club''s name for her');


-- =============================================================================
-- D. two dates of birth are two people
-- =============================================================================
insert into public.people (id, first_name, last_name, email, dob)
  values ('c4c4c4c4-4444-4111-8111-000000000005', 'Milo', 'Mismatch', 'sl-mismatch@test.invalid', '1970-01-01');
select throws_like($$
  insert into auth.users (id, email, raw_user_meta_data) values
    ('4c4c4c4c-4444-4111-8111-000000000013', 'sl-mismatch@test.invalid',
     '{"first_name":"Milo","last_name":"Mismatch","full_name":"Milo Mismatch","dob":"1990-01-01"}'::jsonb)
$$, '%different date of birth%', 'a record with another date of birth is refused, not merged');
select is((select count(*) from public.people where lower(email) = 'sl-mismatch@test.invalid'),
  1::bigint, 'and no second person is left behind');


-- =============================================================================
-- E. a child with no app access
-- =============================================================================
select throws_like($$
  insert into auth.users (id, email, raw_user_meta_data) values
    ('4c4c4c4c-4444-4111-8111-000000000014', 'sl-child-no@test.invalid',
     jsonb_build_object('first_name','Nate','last_name','Noaccess','full_name','Nate Noaccess',
                        'dob', (current_date - interval '14 years')::date::text))
$$, '%app_account consent%', 'a child with no app access is refused by the guard that decides it');


-- =============================================================================
-- F. somebody who already has a login keeps it to themselves
-- =============================================================================
-- Two auth users cannot share an address (auth.users has its own unique index)
-- so the case that actually reaches this branch is a person whose login was
-- made under a DIFFERENT address — an invite, or an admin. Their club record
-- is not a second door.
insert into public.people (id, first_name, last_name, email, dob)
  values ('c4c4c4c4-4444-4111-8111-000000000006', 'Ivy', 'Invited', 'sl-other@test.invalid', '1980-01-01');
insert into auth.users (id, email, raw_user_meta_data) values
  ('4c4c4c4c-4444-4111-8111-000000000020', 'sl-otherlogin@test.invalid',
   '{"full_name": "Ivy Invited", "dob": "1980-01-01"}'::jsonb);
update public.profiles set person_id = 'c4c4c4c4-4444-4111-8111-000000000006'
 where id = '4c4c4c4c-4444-4111-8111-000000000020';
select is((select person_id from public.profiles where id = '4c4c4c4c-4444-4111-8111-000000000020'),
  'c4c4c4c4-4444-4111-8111-000000000006'::uuid, 'Ivy holds a login under another address');

select lives_ok($$
  insert into auth.users (id, email, raw_user_meta_data) values
    ('4c4c4c4c-4444-4111-8111-000000000015', 'sl-other@test.invalid',
     '{"first_name":"Someone","last_name":"Else","full_name":"Someone Else","dob":"1990-01-01"}'::jsonb)
$$, 'a sign-up on an address whose person already has a login still creates an account');
select isnt((select person_id from public.profiles where id = '4c4c4c4c-4444-4111-8111-000000000015'),
  'c4c4c4c4-4444-4111-8111-000000000006'::uuid,
  'but not one attached to the person who holds that address');
select is((select p.email from public.people p
            join public.profiles pr on pr.person_id = p.id
           where pr.id = '4c4c4c4c-4444-4111-8111-000000000015'),
  null, 'and the new person carries no email, so the club''s one stays unique');


-- =============================================================================
-- G. a stranger
-- =============================================================================
select lives_ok($$
  insert into auth.users (id, email, raw_user_meta_data) values
    ('4c4c4c4c-4444-4111-8111-000000000016', 'sl-stranger@test.invalid',
     '{"first_name":"Sam","last_name":"Stranger","full_name":"Sam Stranger","dob":"1988-08-08"}'::jsonb)
$$, 'an address the club has never seen creates a person, as it always did');
select is((select p.dob::text from public.people p
            join public.profiles pr on pr.person_id = p.id
           where pr.id = '4c4c4c4c-4444-4111-8111-000000000016'),
  '1988-08-08', 'with the details they gave');


-- =============================================================================
-- H. the question asked in advance
-- =============================================================================
select is(public.signup_email_check('sl-stranger2@test.invalid', '1990-01-01'), null,
  'an unknown address: go ahead');
select is(public.signup_email_check('sl-child-no@test.invalid', (current_date - interval '14 years')::date),
  'child_no_access', 'a child with no app access is named before the sign-up is attempted');
select is(public.signup_email_check('sl-nobody-knows-me@test.invalid', (current_date - interval '11 years')::date),
  'child_no_access', 'and so is a child the club has never heard of — the commonest case of all');
select is(public.signup_email_check('sl-nobody-knows-me@test.invalid', '1990-01-01'), null,
  'an adult the club has never heard of is simply told to go ahead');
select is(public.signup_email_check('sl-mismatch@test.invalid', '1990-01-01'),
  'dob_mismatch', 'so is a date of birth that disagrees');
select is(public.signup_email_check('sl-child-yes@test.invalid', null),
  'has_login', 'and an address that already has an account');
select is(public.signup_email_check('sl-coach@test.invalid', '1979-03-03'), 'has_login',
  'the coach who has now signed up is told to sign in, not to sign up again');

select * from finish();
rollback;
