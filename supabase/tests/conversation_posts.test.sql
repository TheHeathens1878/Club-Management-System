-- =============================================================================
-- Important information for groups (20260904120000)
-- =============================================================================
--   A participant posts to the group's board; the room hears it as a chat
--   message and everyone else gets the bell. Outsiders cannot post, read,
--   pin or delete; a DM keeps no board at all.
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(12);

insert into auth.users (id, email, raw_user_meta_data) values
  ('c3c3c3c3-4444-4111-8111-000000000001', 'cp-author@test.invalid', '{"full_name": "Cal Coach"}'::jsonb),
  ('c3c3c3c3-4444-4111-8111-000000000002', 'cp-fellow@test.invalid', '{"full_name": "Fay Fellow"}'::jsonb),
  ('c3c3c3c3-4444-4111-8111-000000000003', 'cp-outside@test.invalid', '{"full_name": "Odi Outside"}'::jsonb);
select set_config('cp.author',  (select person_id::text from public.profiles where id = 'c3c3c3c3-4444-4111-8111-000000000001'), true);
select set_config('cp.fellow',  (select person_id::text from public.profiles where id = 'c3c3c3c3-4444-4111-8111-000000000002'), true);
select set_config('cp.outside', (select person_id::text from public.profiles where id = 'c3c3c3c3-4444-4111-8111-000000000003'), true);
update public.people set dob = '1980-01-01'
 where id in (current_setting('cp.author')::uuid, current_setting('cp.fellow')::uuid, current_setting('cp.outside')::uuid);

insert into public.conversations (id, type, title, created_by_person_id) values
  ('cc0c0c0c-4444-4111-8111-000000000001', 'group', 'CP Coaches', current_setting('cp.author')::uuid),
  ('cc0c0c0c-4444-4111-8111-000000000002', 'dm',    null,         current_setting('cp.author')::uuid);
insert into public.conversation_participants (conversation_id, person_id, basis) values
  ('cc0c0c0c-4444-4111-8111-000000000001', current_setting('cp.author')::uuid, 'member'),
  ('cc0c0c0c-4444-4111-8111-000000000001', current_setting('cp.fellow')::uuid, 'member'),
  ('cc0c0c0c-4444-4111-8111-000000000002', current_setting('cp.author')::uuid, 'member'),
  ('cc0c0c0c-4444-4111-8111-000000000002', current_setting('cp.fellow')::uuid, 'member');

select has_table('public', 'conversation_posts', 'conversation_posts');

-- The author posts --------------------------------------------------------------
set local request.jwt.claims to '{"sub":"c3c3c3c3-4444-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select set_config('cp.post',
  public.create_conversation_post('cc0c0c0c-4444-4111-8111-000000000001',
    'Winter training times', 'From November we train at 18:00, not 18:30.')::text, true);
select is((select (title, pinned, deleted_at is null) from public.conversation_posts
           where id = current_setting('cp.post')::uuid),
  ('Winter training times'::text, false, true), 'the post is on the board');
select throws_ok(
  $$select public.create_conversation_post('cc0c0c0c-4444-4111-8111-000000000002', 'A DM board?', 'No.')$$,
  'P0001', null, 'a DM keeps no board');
reset role;

-- The room hears it --------------------------------------------------------------
select is((select count(*) from public.messages
           where conversation_id = 'cc0c0c0c-4444-4111-8111-000000000001'
             and sender_person_id = current_setting('cp.author')::uuid
             and body like '📌 Important information: Winter training times%'), 1::bigint,
  'the post announces itself in the chat, from its author');
select is((select count(*) from public.outbound_messages
           where entity = 'conversation_posts' and entity_id = current_setting('cp.post')
             and channel = 'in_app' and person_id = current_setting('cp.fellow')::uuid), 1::bigint,
  'the other participant gets the bell, with the tab as the link');
select is((select count(*) from public.outbound_messages
           where entity = 'conversation_posts' and entity_id = current_setting('cp.post')
             and person_id = current_setting('cp.author')::uuid), 0::bigint,
  'the author is not notified about their own post');
select is((select link from public.outbound_messages
           where entity = 'conversation_posts' and entity_id = current_setting('cp.post') limit 1),
  '/messages/cc0c0c0c-4444-4111-8111-000000000001?tab=info', 'the bell rings on the board tab');

-- Outsiders ----------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"c3c3c3c3-4444-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select public.create_conversation_post('cc0c0c0c-4444-4111-8111-000000000001', 'Gatecrash', 'Hello')$$,
  '42501', null, 'a non-participant cannot post');
select is((select count(*) from public.conversation_posts
           where conversation_id = 'cc0c0c0c-4444-4111-8111-000000000001'), 0::bigint,
  'a non-participant cannot even see the board');
reset role;

-- Pin and delete -----------------------------------------------------------------
set local request.jwt.claims to '{"sub":"c3c3c3c3-4444-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select public.set_conversation_post_pinned(current_setting('cp.post')::uuid, true)$$,
  '42501', null, 'a fellow participant is not the author: no pin');
reset role;
set local request.jwt.claims to '{"sub":"c3c3c3c3-4444-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$select public.set_conversation_post_pinned(current_setting('cp.post')::uuid, true)$$,
  'the author pins');
reset role;
select is((select pinned from public.conversation_posts where id = current_setting('cp.post')::uuid),
  true, 'pinned it is');

select * from finish();
rollback;
