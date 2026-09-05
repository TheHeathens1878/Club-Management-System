-- =============================================================================
-- An invite is proved by its address (20260905100000)
-- =============================================================================
--   A  a consented child's id, presented from a stranger's address, adopts
--      nobody — the stranger gets a person of their own
--   B  the same id from the child's own recorded address is the invite it
--      always was
--   C  an adult's id from a different address adopts nobody either
--   D  a record with no address cannot be claimed by id at all
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(10);

insert into auth.users (id, email, raw_user_meta_data) values
  ('5d5d5d5d-5555-4111-8111-000000000001', 'ib-parent@test.invalid',
     '{"full_name": "Pia Parent", "dob": "1982-02-02"}'::jsonb);
select set_config('ib.parent', (select person_id::text from public.profiles where id = '5d5d5d5d-5555-4111-8111-000000000001'), true);

insert into public.people (id, first_name, last_name, email, dob) values
  ('d5d5d5d5-5555-4111-8111-000000000001', 'Cass', 'Consented', 'ib-child@test.invalid',
     (current_date - interval '14 years')::date),
  ('d5d5d5d5-5555-4111-8111-000000000002', 'Ada', 'Adult', 'ib-adult@test.invalid', '1975-05-05'),
  ('d5d5d5d5-5555-4111-8111-000000000003', 'Noel', 'Noaddress', null, '1975-05-05');

insert into public.guardianships (guardian_person_id, child_person_id, relationship) values
  (current_setting('ib.parent')::uuid, 'd5d5d5d5-5555-4111-8111-000000000001', 'parent');
insert into public.guardian_consents (child_person_id, guardian_person_id, consent_type, notice_version) values
  ('d5d5d5d5-5555-4111-8111-000000000001', current_setting('ib.parent')::uuid, 'app_account', 'v1');

select set_config('ib.people_before', (select count(*)::text from public.people), true);

-- =============================================================================
-- A. the forged invite
-- =============================================================================
select lives_ok($$
  insert into auth.users (id, email, raw_user_meta_data) values
    ('5d5d5d5d-5555-4111-8111-000000000010', 'ib-stranger@test.invalid',
     jsonb_build_object('full_name', 'Sam Stranger', 'dob', '1988-08-08',
                        'person_id', 'd5d5d5d5-5555-4111-8111-000000000001'))
$$, 'a sign-up carrying a consented child''s id from another address is not refused');
select isnt((select person_id from public.profiles where id = '5d5d5d5d-5555-4111-8111-000000000010'),
  'd5d5d5d5-5555-4111-8111-000000000001'::uuid,
  'but it does NOT become the child''s account');
select is((select count(*) from public.people), current_setting('ib.people_before')::bigint + 1,
  'the stranger got a person of their own');
select ok(not exists (select 1 from public.profiles where person_id = 'd5d5d5d5-5555-4111-8111-000000000001'),
  'and the child still has no login — nobody took the space');

-- =============================================================================
-- B. the real invite
-- =============================================================================
select lives_ok($$
  insert into auth.users (id, email, raw_user_meta_data) values
    ('5d5d5d5d-5555-4111-8111-000000000011', 'ib-child@test.invalid',
     jsonb_build_object('full_name', 'Cass Consented',
                        'person_id', 'd5d5d5d5-5555-4111-8111-000000000001'))
$$, 'the same id from the child''s recorded address signs up');
select is((select person_id from public.profiles where id = '5d5d5d5d-5555-4111-8111-000000000011'),
  'd5d5d5d5-5555-4111-8111-000000000001'::uuid, 'and is the child''s account');

-- =============================================================================
-- C. an adult's id from a different address
-- =============================================================================
select lives_ok($$
  insert into auth.users (id, email, raw_user_meta_data) values
    ('5d5d5d5d-5555-4111-8111-000000000012', 'ib-other@test.invalid',
     jsonb_build_object('full_name', 'Ada Adult', 'dob', '1975-05-05',
                        'person_id', 'd5d5d5d5-5555-4111-8111-000000000002'))
$$, 'an adult''s id from an address the record does not hold is not refused');
select isnt((select person_id from public.profiles where id = '5d5d5d5d-5555-4111-8111-000000000012'),
  'd5d5d5d5-5555-4111-8111-000000000002'::uuid, 'and adopts nobody');

-- =============================================================================
-- D. no address on record, no claim by id
-- =============================================================================
select lives_ok($$
  insert into auth.users (id, email, raw_user_meta_data) values
    ('5d5d5d5d-5555-4111-8111-000000000013', 'ib-noel@test.invalid',
     jsonb_build_object('full_name', 'Noel Noaddress', 'dob', '1975-05-05',
                        'person_id', 'd5d5d5d5-5555-4111-8111-000000000003'))
$$, 'a record with no address is not refused');
select isnt((select person_id from public.profiles where id = '5d5d5d5d-5555-4111-8111-000000000013'),
  'd5d5d5d5-5555-4111-8111-000000000003'::uuid,
  'but cannot be claimed by id — the club puts the address on the record first');

select * from finish();
rollback;
