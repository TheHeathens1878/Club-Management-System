-- =============================================================================
-- App access cannot be consented to before the birthday it starts on
-- (20260901150000)
-- =============================================================================
--   A  a guardian may not record app_account consent for a child under 13
--   B  the refusal names the date the birthday falls on
--   C  on the birthday itself it is allowed — the boundary, not the day after
--   D  other consent types are unaffected by the age rule
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(6);

insert into auth.users (id, email, raw_user_meta_data) values
  ('a11a11a1-3333-4111-8111-000000000001', 'aa-parent@test.invalid',
   '{"first_name": "Pat", "last_name": "Parent", "dob": "1980-05-05"}'::jsonb);
select set_config('aa.parent', (select person_id::text from public.profiles where id = 'a11a11a1-3333-4111-8111-000000000001'), true);

-- A nine-year-old and a child who turns 13 today.
insert into public.people (id, first_name, last_name, dob) values
  ('c11c11c1-3333-4111-8111-000000000001', 'Nina', 'Nine', (current_date - interval '9 years')::date),
  ('c11c11c1-3333-4111-8111-000000000002', 'Theo', 'Thirteen', (current_date - interval '13 years')::date),
  ('c11c11c1-3333-4111-8111-000000000003', 'Tomas', 'Tomorrow', (current_date - interval '13 years' + interval '1 day')::date);

insert into public.guardianships (guardian_person_id, child_person_id, relationship) values
  (current_setting('aa.parent')::uuid, 'c11c11c1-3333-4111-8111-000000000001', 'parent'),
  (current_setting('aa.parent')::uuid, 'c11c11c1-3333-4111-8111-000000000002', 'parent'),
  (current_setting('aa.parent')::uuid, 'c11c11c1-3333-4111-8111-000000000003', 'parent');

-- A. too young ------------------------------------------------------------------
select throws_like($$
  insert into public.guardian_consents (child_person_id, guardian_person_id, consent_type, notice_version)
  values ('c11c11c1-3333-4111-8111-000000000001', current_setting('aa.parent')::uuid, 'app_account', 'v1')
$$, '%may not have an app account until%', 'consent for a nine-year-old is refused');

-- B. and it says when ------------------------------------------------------------
select throws_like($$
  insert into public.guardian_consents (child_person_id, guardian_person_id, consent_type, notice_version)
  values ('c11c11c1-3333-4111-8111-000000000001', current_setting('aa.parent')::uuid, 'app_account', 'v1')
$$, '%13th birthday%', 'the refusal names the birthday it waits for');

-- C. the boundary is the birthday itself -----------------------------------------
select lives_ok($$
  insert into public.guardian_consents (child_person_id, guardian_person_id, consent_type, notice_version)
  values ('c11c11c1-3333-4111-8111-000000000002', current_setting('aa.parent')::uuid, 'app_account', 'v1')
$$, 'a child who turns 13 today may be consented for today');

select throws_like($$
  insert into public.guardian_consents (child_person_id, guardian_person_id, consent_type, notice_version)
  values ('c11c11c1-3333-4111-8111-000000000003', current_setting('aa.parent')::uuid, 'app_account', 'v1')
$$, '%may not have an app account until%', 'and one whose birthday is tomorrow may not — the boundary is the day, not the year');

-- D. the rule is about app accounts, not about consent ----------------------------
select lives_ok($$
  insert into public.guardian_consents (child_person_id, guardian_person_id, consent_type, notice_version)
  values ('c11c11c1-3333-4111-8111-000000000001', current_setting('aa.parent')::uuid, 'photo_team_album', 'v1')
$$, 'a photo_team_album consent for the same nine-year-old is untouched by the age rule');

select is(
  (select count(*)::int from public.guardian_consents
    where child_person_id = 'c11c11c1-3333-4111-8111-000000000001' and consent_type = 'app_account'),
  0,
  'and no app_account consent was recorded for them');

select * from finish();
rollback;
