-- =============================================================================
-- Connect an adult player — matching, linking and the refusals (20260825430000)
-- =============================================================================
--   A  an EMAIL match links the club's existing record: no second people row,
--      a household_links row, an audit row saying it was linked, the person on
--      my_household(), and usable on a family membership.
--   B  a NAME-only match never links: it refuses, creates nothing, and only an
--      explicit "this is a different person" creates the second record.
--   C  somebody who already has their own LOGIN is refused outright.
--   D  the other email-match refusals: a club role, a disagreeing date of
--      birth, a record already held by another member.
--   E  a fresh person is created exactly as before, and the audit row says
--      which of the two things happened.
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(22);

insert into auth.users (id, email, raw_user_meta_data) values
  ('cacacaca-1111-4111-8111-000000000001', 'cap-me@test.invalid',
   '{"full_name": "Jo Caller", "dob": "1985-05-05"}'::jsonb),
  ('cacacaca-1111-4111-8111-000000000002', 'cap-other@test.invalid',
   '{"full_name": "Ora Other", "dob": "1984-04-04"}'::jsonb),
  ('cacacaca-1111-4111-8111-000000000003', 'cap-third@test.invalid',
   '{"full_name": "Thi Rd", "dob": "1983-03-03"}'::jsonb);
select set_config('cap.me',    (select person_id::text from public.profiles where id = 'cacacaca-1111-4111-8111-000000000001'), true);
select set_config('cap.other', (select person_id::text from public.profiles where id = 'cacacaca-1111-4111-8111-000000000002'), true);

insert into public.seasons (id, name, starts_on, ends_on, is_current)
  values ('cacacaca-2222-4111-8111-000000000001', 'CAP 2060/61', current_date - 30, current_date + 300, true);

-- The club's existing records. None of these has a login.
--   sam       an ordinary member the club already holds, nobody's household
--   pat       the same, with NO email at all — the name-only case
--   coach     holds a club role
--   dobmm     a date of birth on file that will disagree
--   claimed   created by ANOTHER member's login: already their household
insert into public.people (id, first_name, last_name, dob, email, created_by) values
  ('cacacaca-3333-4111-8111-000000000001', 'Sam', 'Linker',  '1986-06-06', 'cap-sam@test.invalid',   null),
  ('cacacaca-3333-4111-8111-000000000002', 'Pat', 'Namely',  '1987-07-07', null,                     null),
  ('cacacaca-3333-4111-8111-000000000003', 'Coa', 'Chy',     '1979-09-09', 'cap-coach@test.invalid', null),
  ('cacacaca-3333-4111-8111-000000000004', 'Dob', 'Mismatch','1980-01-01', 'cap-dobmm@test.invalid', null),
  ('cacacaca-3333-4111-8111-000000000005', 'Cla', 'Imed',    '1981-02-02', 'cap-claimed@test.invalid',
   'cacacaca-1111-4111-8111-000000000003');
insert into public.person_roles (person_id, role)
  values ('cacacaca-3333-4111-8111-000000000003', 'coach');


-- A. an email match LINKS -----------------------------------------------------
set local request.jwt.claims to '{"sub":"cacacaca-1111-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is(
  public.add_household_adult('Sam', 'Linker', '1986-06-06', 'cap-sam@test.invalid'),
  'cacacaca-3333-4111-8111-000000000001'::uuid,
  'an email match returns the club''s existing record, not a new one');
select is((select count(*) from public.my_household()
            where person_id = 'cacacaca-3333-4111-8111-000000000001'::uuid),
  1::bigint, 'and the linked adult is on my household');
-- Exactly as a freshly created one: registerable, and allowed on the membership.
select lives_ok($$ select public.create_membership(array['cacacaca-3333-4111-8111-000000000001'::uuid]) $$,
  'a linked adult may go on the family membership, like a created one');
reset role;

select is((select count(*) from public.people where lower(email) = 'cap-sam@test.invalid'),
  1::bigint, 'no second people row was created for that email address');
select is((select count(*) from public.household_links
            where person_id = 'cacacaca-3333-4111-8111-000000000001'::uuid
              and owner_user_id = 'cacacaca-1111-4111-8111-000000000001'::uuid
              and match_basis = 'email'),
  1::bigint, 'the link records that it was an email match');
select is((select detail ->> 'created_new' from public.audit_log
            where action = 'family.adult_linked'
              and entity_id = 'cacacaca-3333-4111-8111-000000000001'),
  'false', 'the audit row says an existing record was LINKED, not created');


-- B. a name-only match never links --------------------------------------------
set local request.jwt.claims to '{"sub":"cacacaca-1111-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select throws_like($$ select public.add_household_adult('Pat', 'Namely', '1987-07-07') $$,
  '%already has a record for someone called%',
  'a name-only match refuses rather than linking somebody by a guessed name');
-- The typed email belongs to nobody, and the name matches: still no silent link.
select throws_like($$ select public.add_household_adult('Pat', 'Namely', '1987-07-07', 'someone-else@test.invalid') $$,
  '%already has a record for someone called%',
  'a name match whose email is different does not link either');
reset role;
select is((select count(*) from public.people where first_name = 'Pat' and last_name = 'Namely'),
  1::bigint, 'and the refusal created nothing');

set local request.jwt.claims to '{"sub":"cacacaca-1111-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select set_config('cap.pat2',
  public.add_household_adult('Pat', 'Namely', '1987-07-07', null, null, true)::text, true);
reset role;
select is((select count(*) from public.people where first_name = 'Pat' and last_name = 'Namely'),
  2::bigint, 'confirming "a different person" creates the second record, deliberately');
select is((select detail ->> 'matched_on' from public.audit_log
            where action = 'family.adult_added' and entity_id = current_setting('cap.pat2')),
  'name_confirmed_different',
  'and the audit row records that it was a confirmed near-duplicate');


-- C. a person with their own login is never absorbed ---------------------------
set local request.jwt.claims to '{"sub":"cacacaca-1111-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select throws_like($$ select public.add_household_adult('Ora', 'Other', '1984-04-04', 'cap-other@test.invalid') $$,
  '%already has their own account%',
  'somebody who holds a login is refused with a readable message [SG-4]');
-- Even confirming "add them anyway" must not make a duplicate of a login-holder.
select throws_like($$ select public.add_household_adult('Ora', 'Other', '1984-04-04', 'cap-other@test.invalid', null, true) $$,
  '%already has their own account%',
  'and confirmation does not get past it');
reset role;
select is((select count(*) from public.household_links
            where person_id = current_setting('cap.other')::uuid),
  0::bigint, 'no link was made to the login-holder');


-- D. the other email-match refusals -------------------------------------------
set local request.jwt.claims to '{"sub":"cacacaca-1111-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select throws_like($$ select public.add_household_adult('Coa', 'Chy', '1979-09-09', 'cap-coach@test.invalid') $$,
  '%holds a role at the club%', 'a club officer is not a household member');
select throws_like($$ select public.add_household_adult('Dob', 'Mismatch', '1981-01-01', 'cap-dobmm@test.invalid') $$,
  '%different date of birth%', 'an email match whose date of birth disagrees stops');
select throws_like($$ select public.add_household_adult('Cla', 'Imed', '1981-02-02', 'cap-claimed@test.invalid') $$,
  '%another member%', 'a record another member already holds is not transferred');


-- E. a fresh person is created exactly as before -------------------------------
select set_config('cap.fresh',
  public.add_household_adult('New', 'Person', '1990-01-01', 'cap-fresh@test.invalid')::text, true);
-- Adding the same household adult twice returns the one already there.
select is(public.add_household_adult('New', 'Person', '1990-01-01', 'cap-fresh@test.invalid'),
  current_setting('cap.fresh')::uuid,
  'adding the same person twice returns the record already in the household');
reset role;
select is((select detail ->> 'created_new' from public.audit_log
            where action = 'family.adult_added' and entity_id = current_setting('cap.fresh')),
  'true', 'the audit row says a new record was CREATED');
select is((select count(*) from public.people where lower(email) = 'cap-fresh@test.invalid'),
  1::bigint, 'and exactly one row exists for them');


-- F. the link table is read-only through the API -------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.household_links'::regclass),
  'RLS is on household_links');
select ok(not has_table_privilege('authenticated', 'public.household_links', 'INSERT'),
  'and nobody writes it through PostgREST — add_household_adult() is the only door');

select * from finish();
rollback;
