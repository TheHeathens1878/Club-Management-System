-- =============================================================================
-- A notification reaches the phone in the pocket (20260904110000)
-- =============================================================================
--   notify() writes the in_app row as ever, and now a push twin — but only
--   for a person with a registered device who has not turned push off. The
--   chat doorbell trigger exists on messages.
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(7);

insert into auth.users (id, email, raw_user_meta_data) values
  ('d2d2d2d2-9999-4111-8111-000000000001', 'pt-device@test.invalid', '{"full_name": "Dee Device", "dob": "1980-01-01"}'::jsonb),
  ('d2d2d2d2-9999-4111-8111-000000000002', 'pt-nodevice@test.invalid', '{"full_name": "Nia NoDevice", "dob": "1981-01-01"}'::jsonb),
  ('d2d2d2d2-9999-4111-8111-000000000003', 'pt-optout@test.invalid', '{"full_name": "Ollie OptOut", "dob": "1982-01-01"}'::jsonb);
select set_config('pt.device',   (select person_id::text from public.profiles where id = 'd2d2d2d2-9999-4111-8111-000000000001'), true);
select set_config('pt.nodevice', (select person_id::text from public.profiles where id = 'd2d2d2d2-9999-4111-8111-000000000002'), true);
select set_config('pt.optout',   (select person_id::text from public.profiles where id = 'd2d2d2d2-9999-4111-8111-000000000003'), true);

insert into public.push_tokens (token, person_id, platform) values
  ('ExponentPushToken[pt-test-1]', current_setting('pt.device')::uuid, 'ios'),
  ('ExponentPushToken[pt-test-2]', current_setting('pt.optout')::uuid, 'ios');
insert into public.comms_preferences (person_id, channel, enabled)
  values (current_setting('pt.optout')::uuid, 'push', false);

select set_config('pt.n1', public.notify(current_setting('pt.device')::uuid,
  'Test: a subject', 'A body for the lock screen', '/notifications', 'tests', 'pt-1')::text, true);
select public.notify(current_setting('pt.nodevice')::uuid,
  'Test: a subject', 'A body', '/notifications', 'tests', 'pt-2');
select public.notify(current_setting('pt.optout')::uuid,
  'Test: a subject', 'A body', '/notifications', 'tests', 'pt-3');

select is((select count(*) from public.outbound_messages
           where person_id = current_setting('pt.device')::uuid and channel = 'in_app' and entity_id = 'pt-1'),
  1::bigint, 'the in_app row is written as ever');
select is((select count(*) from public.outbound_messages
           where person_id = current_setting('pt.device')::uuid and channel = 'push' and entity_id = 'pt-1'),
  1::bigint, 'a registered device earns a push twin');
select is((select (status::text, subject, link) from public.outbound_messages
           where person_id = current_setting('pt.device')::uuid and channel = 'push' and entity_id = 'pt-1'),
  ('queued'::text, 'Test: a subject'::text, '/notifications'::text),
  'the twin is queued for comms-dispatch with the same headline and link');
select is((select count(*) from public.outbound_messages
           where person_id = current_setting('pt.nodevice')::uuid and channel = 'push'),
  0::bigint, 'no device, no push row — the in_app row stands alone');
select is((select count(*) from public.outbound_messages
           where person_id = current_setting('pt.optout')::uuid and channel = 'push'),
  0::bigint, 'push turned off is push turned off, transactional or not');
select is((select count(*) from public.outbound_messages
           where person_id = current_setting('pt.optout')::uuid and channel = 'in_app'),
  1::bigint, 'the opt-out still gets the in-app notification itself');

select has_trigger('public', 'messages', 'trg_messages_push_fanout',
  'a new chat message rings push-fanout');

select * from finish();
rollback;
