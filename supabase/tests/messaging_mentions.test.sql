-- =============================================================================
-- @mentions (20260825300000) — the table, its read policy, and the one door
-- =============================================================================
-- What is asserted: a live participant can be mentioned; someone who has left
-- and someone who was never in the room cannot; only the SENDER may record a
-- message's mentions; no client may write the table directly; and a reader
-- outside the conversation sees nothing at all.
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(18);

insert into auth.users (id, email, raw_user_meta_data) values
  ('b1b1b1b1-4444-4111-8111-000000000001', 'm-one@test.invalid',  '{"full_name": "Mia One"}'::jsonb),
  ('b1b1b1b1-4444-4111-8111-000000000002', 'm-two@test.invalid',  '{"full_name": "Tom Two"}'::jsonb),
  ('b1b1b1b1-4444-4111-8111-000000000003', 'm-gone@test.invalid', '{"full_name": "Gus Gone"}'::jsonb),
  ('b1b1b1b1-4444-4111-8111-000000000004', 'm-out@test.invalid',  '{"full_name": "Ora Outside"}'::jsonb);
select set_config('m.one',  (select person_id::text from public.profiles where id = 'b1b1b1b1-4444-4111-8111-000000000001'), true);
select set_config('m.two',  (select person_id::text from public.profiles where id = 'b1b1b1b1-4444-4111-8111-000000000002'), true);
select set_config('m.gone', (select person_id::text from public.profiles where id = 'b1b1b1b1-4444-4111-8111-000000000003'), true);
select set_config('m.out',  (select person_id::text from public.profiles where id = 'b1b1b1b1-4444-4111-8111-000000000004'), true);
-- Adults all round: SG-1 is not what this test is about.
update public.people set dob = '1980-01-01'
 where id in (current_setting('m.one')::uuid, current_setting('m.two')::uuid,
              current_setting('m.gone')::uuid, current_setting('m.out')::uuid);

insert into public.conversations (id, type, title, created_by_person_id) values
  ('c1c1c1c1-4444-4111-8111-000000000001', 'group', 'Under 12s', current_setting('m.one')::uuid);
insert into public.conversation_participants (conversation_id, person_id, basis) values
  ('c1c1c1c1-4444-4111-8111-000000000001', current_setting('m.one')::uuid,  'creator'),
  ('c1c1c1c1-4444-4111-8111-000000000001', current_setting('m.two')::uuid,  'member'),
  ('c1c1c1c1-4444-4111-8111-000000000001', current_setting('m.gone')::uuid, 'member');
-- Gus has left the group; the history keeps him, a new message may not name him.
update public.conversation_participants set left_at = now()
 where conversation_id = 'c1c1c1c1-4444-4111-8111-000000000001'
   and person_id = current_setting('m.gone')::uuid;

insert into public.messages (id, conversation_id, sender_person_id, body) values
  ('d1d1d1d1-4444-4111-8111-000000000001', 'c1c1c1c1-4444-4111-8111-000000000001',
   current_setting('m.one')::uuid, '@Tom Two can you bring the kit?');

select has_table('public', 'message_mentions', 'message_mentions exists');
select ok(
  not has_function_privilege('anon', 'public.mention_people(uuid, uuid[])', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.mention_people(uuid, uuid[])', 'EXECUTE'),
  'mention_people() is a signed-in caller''s door; anon has no key');
select ok((select relrowsecurity from pg_class where oid = 'public.message_mentions'::regclass),
  'RLS is on');
select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'message_mentions' and cmd <> 'SELECT'),
  0::bigint,
  'there is no INSERT/UPDATE/DELETE policy — the RPC is the only door');


-- The sender records a mention -------------------------------------------------
set local request.jwt.claims to '{"sub":"b1b1b1b1-4444-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;

select is(
  (select public.mention_people('d1d1d1d1-4444-4111-8111-000000000001',
                                array[current_setting('m.two')::uuid])),
  1,
  'a live participant can be mentioned');
select is((select count(*) from public.message_mentions), 1::bigint, 'the mention row is there');
select is(
  (select public.mention_people('d1d1d1d1-4444-4111-8111-000000000001',
                                array[current_setting('m.two')::uuid,
                                      current_setting('m.two')::uuid])),
  0,
  'the same person mentioned again is still one row');
select throws_ok(
  $$select public.mention_people('d1d1d1d1-4444-4111-8111-000000000001',
                                 array[current_setting('m.gone')::uuid])$$,
  'P0001', null, 'someone who has left the conversation cannot be mentioned');
select throws_ok(
  $$select public.mention_people('d1d1d1d1-4444-4111-8111-000000000001',
                                 array[current_setting('m.out')::uuid])$$,
  'P0001', null, 'someone who was never in the conversation cannot be mentioned');
select is(
  (select public.mention_people('d1d1d1d1-4444-4111-8111-000000000001',
                                array[current_setting('m.one')::uuid])),
  0,
  'mentioning yourself records nothing — you cannot notify yourself');
select is((select count(*) from public.message_mentions), 1::bigint, 'still exactly one mention');
select throws_ok(
  $$select public.mention_people('d1d1d1d1-4444-4111-8111-0000000000ff',
                                 array[current_setting('m.two')::uuid])$$,
  'P0001', null, 'an unknown message is refused');
select throws_ok(
  $$insert into public.message_mentions (message_id, person_id)
    values ('d1d1d1d1-4444-4111-8111-000000000001', current_setting('m.gone')::uuid)$$,
  '42501', null, 'even the sender cannot write the table directly');

reset role;
set local request.jwt.claims to '{}';


-- Another member of the same room ----------------------------------------------
set local request.jwt.claims to '{"sub":"b1b1b1b1-4444-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.mention_people('d1d1d1d1-4444-4111-8111-000000000001',
                                 array[current_setting('m.two')::uuid])$$,
  '42501', null, 'only the person who sent the message may record its mentions');
select is((select count(*) from public.message_mentions), 1::bigint,
  'a participant can read who the message named');
select throws_ok(
  $$delete from public.message_mentions$$,
  '42501', null, 'a participant cannot delete a mention row');

reset role;
set local request.jwt.claims to '{}';


-- A reader outside the conversation ---------------------------------------------
set local request.jwt.claims to '{"sub":"b1b1b1b1-4444-4111-8111-000000000004","role":"authenticated"}';
set local role authenticated;

select is((select count(*) from public.message_mentions), 0::bigint,
  'an outsider sees no mentions at all');
select throws_ok(
  $$select public.mention_people('d1d1d1d1-4444-4111-8111-000000000001',
                                 array[current_setting('m.two')::uuid])$$,
  '42501', null, 'an outsider cannot record mentions on someone else''s message');

reset role;
set local request.jwt.claims to '{}';

select * from finish();

rollback;
