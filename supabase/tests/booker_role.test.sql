-- =============================================================================
-- A hirer has a role of their own (20260905120000)
-- =============================================================================
--   A  `booker` is a user_role and maps to the `hirer` app role
--   B  a booker profile is synced to a hirer person_role, and is not a club
--      person — the members list keeps skipping them
--   C  auth_user_id_for_email() finds a login by address, service_role only
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(11);

-- A. the value and the mapping
select enum_has_labels('public', 'user_role',
  array['committee', 'bar', 'bar_manager', 'member', 'super_user', 'staff', 'booker'],
  'user_role carries booker (2026-09-05)');
select is(public.map_user_role_to_app_role('booker'::public.user_role), 'hirer'::public.app_role,
  'booker maps to the hirer app role');
select lives_ok($$select public.map_user_role_to_app_role_strict('booker'::public.user_role)$$,
  'and the strict wrapper no longer raises for it');

-- B. the booking flow's account: created, then re-roled
insert into auth.users (id, email, raw_user_meta_data) values
  ('7f7f7f7f-7777-4111-8111-000000000001', 'br-hirer@test.invalid',
     '{"full_name": "Hattie Hirer", "needs_password": true}'::jsonb);
select set_config('br.hirer', (select person_id::text from public.profiles where id = '7f7f7f7f-7777-4111-8111-000000000001'), true);

select lives_ok($$
  update public.profiles set role = 'booker' where id = '7f7f7f7f-7777-4111-8111-000000000001'
$$, 'the profile the booking flow upserts can now say booker');
select is((select role::text from public.profiles where id = '7f7f7f7f-7777-4111-8111-000000000001'),
  'booker', 'and it does');
select is((select count(*) from public.person_roles
            where person_id = current_setting('br.hirer')::uuid and role = 'hirer' and revoked_at is null),
  1::bigint, 'the sync trigger grants hirer');
select is((select count(*) from public.person_roles
            where person_id = current_setting('br.hirer')::uuid and role = 'member' and revoked_at is null),
  0::bigint, 'and revokes the member role the sign-up trigger had given');
select is(public.is_club_person(current_setting('br.hirer')::uuid), false,
  'a hirer is not a club person — the members list keeps skipping them');

-- C. the lookup
select is(public.auth_user_id_for_email('  BR-Hirer@test.invalid '), '7f7f7f7f-7777-4111-8111-000000000001'::uuid,
  'auth_user_id_for_email finds the login, whatever the case and spacing');
select is(public.auth_user_id_for_email('nobody-here@test.invalid'), null,
  'and answers null for an address with no login');
select ok(
  not has_function_privilege('anon', 'public.auth_user_id_for_email(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.auth_user_id_for_email(text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.auth_user_id_for_email(text)', 'EXECUTE'),
  'service_role only');

select * from finish();
rollback;
