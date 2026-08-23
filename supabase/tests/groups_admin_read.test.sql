-- =============================================================================
-- Group inventory for administrators (20260824260000)
-- =============================================================================
begin;
select plan(7);

insert into auth.users (id, email, raw_user_meta_data) values
  ('a4a4a4a4-1111-4111-8111-000000000001', 'gr-admin@test.invalid', '{"full_name": "Ada Admin", "dob": "1980-01-01"}'::jsonb),
  ('a4a4a4a4-1111-4111-8111-000000000002', 'gr-coach@test.invalid', '{"full_name": "Cy Coach", "dob": "1980-01-01"}'::jsonb),
  ('a4a4a4a4-1111-4111-8111-000000000003', 'gr-other@test.invalid', '{"full_name": "Ol Other", "dob": "1980-01-01"}'::jsonb);
update public.profiles set role = 'committee' where id = 'a4a4a4a4-1111-4111-8111-000000000001';
select set_config('gr.coach', (select person_id::text from public.profiles where id = 'a4a4a4a4-1111-4111-8111-000000000002'), true);

-- a group the admin is NOT in, and a dm the admin is not in
set local request.jwt.claims to '{"sub":"a4a4a4a4-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
insert into public.conversations (id, type, title, created_by_person_id, scope_label)
values ('dddddddd-0000-4000-8000-000000000001', 'group', 'Coaches corner', public.current_person_id(), 'Coaching');
insert into public.conversation_participants (conversation_id, person_id, basis)
values ('dddddddd-0000-4000-8000-000000000001', public.current_person_id(), 'creator');
insert into public.conversations (id, type, created_by_person_id)
values ('dddddddd-0000-4000-8000-000000000002', 'dm', public.current_person_id());
insert into public.conversation_participants (conversation_id, person_id, basis)
values ('dddddddd-0000-4000-8000-000000000002', public.current_person_id(), 'creator');
reset role;

set local request.jwt.claims to '{"sub":"a4a4a4a4-1111-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.conversations where id = 'dddddddd-0000-4000-8000-000000000001'), 1::bigint,
  'admin sees a group they are not in');
select is((select count(*) from public.conversations where id = 'dddddddd-0000-4000-8000-000000000002'), 0::bigint,
  'admin does NOT see a dm they are not in');
select is((select count(*) from public.conversation_participants where conversation_id = 'dddddddd-0000-4000-8000-000000000001'), 0::bigint,
  'admin does not see the participant rows');
select is((select members from public.group_member_counts() where conversation_id = 'dddddddd-0000-4000-8000-000000000001'), 1,
  'the aggregate count is available');
select is((select count(*) from public.messages where conversation_id = 'dddddddd-0000-4000-8000-000000000001'), 0::bigint,
  'no message content leaks');
reset role;

set local request.jwt.claims to '{"sub":"a4a4a4a4-1111-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.conversations where id = 'dddddddd-0000-4000-8000-000000000001'), 0::bigint,
  'a non-admin still sees nothing');
select is((select count(*) from public.group_member_counts()), 0::bigint, 'counts are admin-only');
reset role;

select * from finish();
rollback;
