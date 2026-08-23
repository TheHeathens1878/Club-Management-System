-- =============================================================================
-- Emoji reactions (20260824270000) — RLS, guardrails, realtime membership
-- =============================================================================
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(16);

insert into auth.users (id, email, raw_user_meta_data) values
  ('a9a9a9a9-3333-4111-8111-000000000001', 'r-one@test.invalid', '{"full_name": "Ron One"}'::jsonb),
  ('a9a9a9a9-3333-4111-8111-000000000002', 'r-two@test.invalid', '{"full_name": "Tia Two"}'::jsonb),
  ('a9a9a9a9-3333-4111-8111-000000000003', 'r-out@test.invalid', '{"full_name": "Oz Outsider"}'::jsonb);
select set_config('r.one', (select person_id::text from public.profiles where id = 'a9a9a9a9-3333-4111-8111-000000000001'), true);
select set_config('r.two', (select person_id::text from public.profiles where id = 'a9a9a9a9-3333-4111-8111-000000000002'), true);
select set_config('r.out', (select person_id::text from public.profiles where id = 'a9a9a9a9-3333-4111-8111-000000000003'), true);
update public.people set dob = '1980-01-01'
 where id in (current_setting('r.one')::uuid, current_setting('r.two')::uuid, current_setting('r.out')::uuid);

-- a DM between one and two, and an announcement conversation
insert into public.conversations (id, type, created_by_person_id) values
  ('e0e0e0e0-3333-4111-8111-000000000001', 'dm', current_setting('r.one')::uuid),
  ('e0e0e0e0-3333-4111-8111-000000000002', 'announcement', current_setting('r.one')::uuid);
insert into public.conversation_participants (conversation_id, person_id, basis) values
  ('e0e0e0e0-3333-4111-8111-000000000001', current_setting('r.one')::uuid, 'member'),
  ('e0e0e0e0-3333-4111-8111-000000000001', current_setting('r.two')::uuid, 'member'),
  ('e0e0e0e0-3333-4111-8111-000000000002', current_setting('r.one')::uuid, 'staff'),
  ('e0e0e0e0-3333-4111-8111-000000000002', current_setting('r.two')::uuid, 'member');
insert into public.messages (id, conversation_id, sender_person_id, body) values
  ('f0f0f0f0-3333-4111-8111-000000000001', 'e0e0e0e0-3333-4111-8111-000000000001', current_setting('r.one')::uuid, 'hello'),
  ('f0f0f0f0-3333-4111-8111-000000000002', 'e0e0e0e0-3333-4111-8111-000000000002', current_setting('r.one')::uuid, 'club notice');

select has_table('public', 'message_reactions', 'message_reactions');
select ok((select relrowsecurity from pg_class where oid = 'public.message_reactions'::regclass), 'RLS on');
select ok(exists (select 1 from pg_publication_tables
  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_reactions'),
  'reactions are in the realtime publication');
select ok(exists (select 1 from pg_publication_tables
  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_attachments'),
  'attachments are in the realtime publication');

-- Participant two reacts to one's message.
set local request.jwt.claims to '{"sub":"a9a9a9a9-3333-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$insert into public.message_reactions (message_id, person_id, emoji)
    values ('f0f0f0f0-3333-4111-8111-000000000001', current_setting('r.two')::uuid, '👍')$$,
  'a participant reacts');
select throws_ok(
  $$insert into public.message_reactions (message_id, person_id, emoji)
    values ('f0f0f0f0-3333-4111-8111-000000000001', current_setting('r.two')::uuid, '👍')$$,
  '23505', null, 'the same emoji twice is one reaction');
select throws_ok(
  $$insert into public.message_reactions (message_id, person_id, emoji)
    values ('f0f0f0f0-3333-4111-8111-000000000001', current_setting('r.one')::uuid, '👍')$$,
  '42501', null, 'reacting as someone else is refused');
select throws_ok(
  $$insert into public.message_reactions (message_id, person_id, emoji)
    values ('f0f0f0f0-3333-4111-8111-000000000002', current_setting('r.two')::uuid, '👍')$$,
  '42501', null, 'announcements take no reactions (P5.1 §9.4)');
select is((select count(*) from public.message_reactions), 1::bigint, 'participant sees the reaction');
-- Un-react: a hard delete of one's own row (reactions are not evidence).
select lives_ok(
  $$delete from public.message_reactions where person_id = current_setting('r.two')::uuid$$,
  'un-react deletes one''s own reaction');
select is((select count(*) from public.message_reactions), 0::bigint, 'the reaction is gone');
insert into public.message_reactions (message_id, person_id, emoji)
  values ('f0f0f0f0-3333-4111-8111-000000000001', current_setting('r.two')::uuid, '❤️');
reset role;
set local request.jwt.claims to '{}';

-- A non-participant sees nothing and cannot react or delete.
set local request.jwt.claims to '{"sub":"a9a9a9a9-3333-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.message_reactions), 0::bigint, 'a non-participant sees no reactions');
select throws_ok(
  $$insert into public.message_reactions (message_id, person_id, emoji)
    values ('f0f0f0f0-3333-4111-8111-000000000001', current_setting('r.out')::uuid, '😀')$$,
  '42501', null, 'a non-participant cannot react');
select lives_ok(
  $$delete from public.message_reactions where message_id = 'f0f0f0f0-3333-4111-8111-000000000001'$$,
  'a non-participant''s delete matches no rows');
reset role;
set local request.jwt.claims to '{}';
select is((select count(*) from public.message_reactions), 1::bigint, 'the reaction survived the outsider');

-- Guardrails as the owner: no reactions on deleted messages or closed conversations.
update public.messages set deleted_at = now() where id = 'f0f0f0f0-3333-4111-8111-000000000001';
set local request.jwt.claims to '{"sub":"a9a9a9a9-3333-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$insert into public.message_reactions (message_id, person_id, emoji)
    values ('f0f0f0f0-3333-4111-8111-000000000001', current_setting('r.two')::uuid, '😀')$$,
  '42501', null, 'a deleted message takes no new reactions');
reset role;
set local request.jwt.claims to '{}';

select * from finish();

rollback;
