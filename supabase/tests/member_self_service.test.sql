-- =============================================================================
-- Member self-service (20260824470000 + 20260824490000)
-- =============================================================================
--   my_household(): the caller's connected ADULTS — the login-less adults they
--   created, the adults on a membership they hold as lead contact (with or
--   without a login of their own), and, from the other side, the lead contact
--   whose membership covers the caller. Never children, never the caller,
--   never someone else's people.
--   my_registrations(): self + guarded child + household adult, status only.
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(11);

insert into auth.users (id, email, raw_user_meta_data) values
  ('d3d3d3d3-bbbb-4111-8111-000000000001', 'ms-me@test.invalid',    '{"full_name": "Mel Me", "dob": "1988-01-01"}'::jsonb),
  ('d3d3d3d3-bbbb-4111-8111-000000000002', 'ms-other@test.invalid', '{"full_name": "Ora Other", "dob": "1987-02-02"}'::jsonb);
select set_config('ms.me', (select person_id::text from public.profiles where id = 'd3d3d3d3-bbbb-4111-8111-000000000001'), true);

insert into public.seasons (id, name, starts_on, ends_on, is_current)
  values ('5b5b5b5b-bbbb-4111-8111-000000000001', 'MS 2050/51', current_date - 30, current_date + 300, true);
insert into public.teams (id, name, age_group) values ('9e9e9e9e-bbbb-4111-8111-000000000001', 'MS Town', 'U10');

-- Mel builds the family at the desk: a spouse with no login, a child, the
-- child's registration, and the family membership Mel holds as lead contact.
set local request.jwt.claims to '{"sub":"d3d3d3d3-bbbb-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select set_config('ms.spouse', public.add_household_adult('Sam', 'Me', '1989-03-03', 'sam-me@test.invalid')::text, true);
select set_config('ms.child',  public.add_child('Kit', 'Me', (current_date - interval '9 years')::date)::text, true);
insert into public.registrations (person_id, season_id, team_id, form)
values (current_setting('ms.child')::uuid, '5b5b5b5b-bbbb-4111-8111-000000000001',
        '9e9e9e9e-bbbb-4111-8111-000000000001',
        '{"emergency": {"name": "Mel Me", "phone": "07700 900001"}, "medical": {"conditions": "asthma"}}'::jsonb);
select public.create_membership(array[current_setting('ms.spouse')::uuid, current_setting('ms.child')::uuid]);

select is((select count(*) from public.my_household()), 1::bigint,
  'the household lists the one connected adult — the child stays on My Children');
select is((select has_login from public.my_household()), false, 'no login of their own yet');
select is((select on_my_membership from public.my_household()), true, 'and they sit on the lead''s membership');
select is((select count(*) from public.my_registrations()), 1::bigint, 'the registration list carries the child''s');
select is((select person_name from public.my_registrations()), 'Kit Me', 'named');
select is((select to_jsonb(r) ? 'form' from public.my_registrations() r limit 1), false,
  'and the medical form stays out of the status list');
reset role;

-- Sam later gets their own login, linked to the same person row (the invite
-- path: adult, matching email). The membership — and the connection — stand.
insert into auth.users (id, email, raw_user_meta_data) values
  ('d3d3d3d3-bbbb-4111-8111-000000000003', 'sam-me@test.invalid',
   jsonb_build_object('full_name', 'Sam Me', 'person_id', current_setting('ms.spouse')));

set local request.jwt.claims to '{"sub":"d3d3d3d3-bbbb-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.my_household()), 1::bigint,
  'a connected adult with their own login is still connected — the membership is the tie');
select is((select has_login from public.my_household()), true, 'and now shows as holding a login');
reset role;

-- From Sam's side, the lead contact who pays appears, flagged.
set local request.jwt.claims to '{"sub":"d3d3d3d3-bbbb-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select is((select my_lead from public.my_household() where first_name = 'Mel'), true,
  'the covered adult sees their lead contact');
reset role;

-- Someone else sees none of it.
set local request.jwt.claims to '{"sub":"d3d3d3d3-bbbb-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.my_household()), 0::bigint, 'another account has an empty household');
select is((select count(*) from public.my_registrations()), 0::bigint, 'and no registrations that are not theirs');
reset role;

select * from finish();
rollback;
