-- =============================================================================
-- What needs my attention (20260905130000): my_unread_message_count()
-- =============================================================================
--   A  counts the other side's messages since the last one read
--   B  reading moves the mark; one's own messages never count
--   C  a muted room and a room one has left count nothing
--   D  anon has no door; an unlinked sign-in gets zero, not an error
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(9);

insert into auth.users (id, email, raw_user_meta_data) values
  ('8a8a8a8a-8888-4111-8111-000000000001', 'um-ann@test.invalid', '{"full_name": "Ann Adult", "dob": "1980-01-01"}'::jsonb),
  ('8a8a8a8a-8888-4111-8111-000000000002', 'um-bob@test.invalid', '{"full_name": "Bob Adult", "dob": "1981-02-02"}'::jsonb);
select set_config('um.ann', (select person_id::text from public.profiles where id = '8a8a8a8a-8888-4111-8111-000000000001'), true);
select set_config('um.bob', (select person_id::text from public.profiles where id = '8a8a8a8a-8888-4111-8111-000000000002'), true);

-- Two rooms Ann and Bob share.
insert into public.conversations (id, type, created_by_person_id) values
  ('c8c8c8c8-8888-4111-8111-000000000001', 'dm', current_setting('um.ann')::uuid),
  ('c8c8c8c8-8888-4111-8111-000000000002', 'dm', current_setting('um.ann')::uuid);
insert into public.conversation_participants (conversation_id, person_id, basis) values
  ('c8c8c8c8-8888-4111-8111-000000000001', current_setting('um.ann')::uuid, 'member'),
  ('c8c8c8c8-8888-4111-8111-000000000001', current_setting('um.bob')::uuid, 'member'),
  ('c8c8c8c8-8888-4111-8111-000000000002', current_setting('um.ann')::uuid, 'member'),
  ('c8c8c8c8-8888-4111-8111-000000000002', current_setting('um.bob')::uuid, 'member');

insert into public.messages (id, conversation_id, sender_person_id, body, created_at) values
  ('d8d8d8d8-8888-4111-8111-000000000001', 'c8c8c8c8-8888-4111-8111-000000000001', current_setting('um.bob')::uuid, 'first',  now() - interval '3 minutes'),
  ('d8d8d8d8-8888-4111-8111-000000000002', 'c8c8c8c8-8888-4111-8111-000000000001', current_setting('um.bob')::uuid, 'second', now() - interval '2 minutes'),
  ('d8d8d8d8-8888-4111-8111-000000000003', 'c8c8c8c8-8888-4111-8111-000000000002', current_setting('um.bob')::uuid, 'other room', now() - interval '1 minute'),
  ('d8d8d8d8-8888-4111-8111-000000000004', 'c8c8c8c8-8888-4111-8111-000000000002', current_setting('um.ann')::uuid, 'my own', now());

-- A. as Ann
set local request.jwt.claims to '{"sub":"8a8a8a8a-8888-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is(public.my_unread_message_count(), 3, 'three of Bob''s messages are unread across two rooms');
reset role;

-- B. reading moves the mark; own messages never count
update public.conversation_participants set last_read_message_id = 'd8d8d8d8-8888-4111-8111-000000000001'
 where conversation_id = 'c8c8c8c8-8888-4111-8111-000000000001' and person_id = current_setting('um.ann')::uuid;
set local request.jwt.claims to '{"sub":"8a8a8a8a-8888-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is(public.my_unread_message_count(), 2, 'reading the first leaves the second, plus the other room');
reset role;
set local request.jwt.claims to '{"sub":"8a8a8a8a-8888-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select is(public.my_unread_message_count(), 1, 'Bob has read nothing but his own do not count — only Ann''s one');
reset role;

-- A deleted message stops counting.
update public.messages set deleted_at = now() where id = 'd8d8d8d8-8888-4111-8111-000000000002';
set local request.jwt.claims to '{"sub":"8a8a8a8a-8888-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is(public.my_unread_message_count(), 1, 'a deleted message is not unread');
reset role;

-- C. muted and left
update public.conversation_participants set muted_until = now() + interval '1 day'
 where conversation_id = 'c8c8c8c8-8888-4111-8111-000000000002' and person_id = current_setting('um.ann')::uuid;
set local request.jwt.claims to '{"sub":"8a8a8a8a-8888-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is(public.my_unread_message_count(), 0, 'a muted room counts nothing');
reset role;
update public.conversation_participants set muted_until = null, left_at = now()
 where conversation_id = 'c8c8c8c8-8888-4111-8111-000000000002' and person_id = current_setting('um.ann')::uuid;
set local request.jwt.claims to '{"sub":"8a8a8a8a-8888-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is(public.my_unread_message_count(), 0, 'nor a room one has left');
reset role;

-- D. doors
select ok(not has_function_privilege('anon', 'public.my_unread_message_count()', 'EXECUTE'),
  'anon cannot ask');
select ok(has_function_privilege('authenticated', 'public.my_unread_message_count()', 'EXECUTE'),
  'a signed-in person can');
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000000000","role":"authenticated"}';
set local role authenticated;
select is(public.my_unread_message_count(), 0, 'a sign-in with no person record gets zero, not an error');
reset role;

select * from finish();
rollback;
