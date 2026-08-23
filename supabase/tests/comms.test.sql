-- =============================================================================
-- P4.4 — comms preferences, suppressions, enqueue_message()
-- =============================================================================
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(33);

insert into auth.users (id, email, raw_user_meta_data) values
  ('b1b1b1b1-2222-4111-8111-000000000001', 'k-admin@test.invalid',  '{"full_name": "Ada Admin"}'::jsonb),
  ('b1b1b1b1-2222-4111-8111-000000000002', 'k-member@test.invalid', '{"full_name": "Mo Member"}'::jsonb),
  ('b1b1b1b1-2222-4111-8111-000000000003', 'k-parent@test.invalid', '{"full_name": "Pat Parent"}'::jsonb);
update public.profiles set role = 'committee' where id = 'b1b1b1b1-2222-4111-8111-000000000001';
select set_config('k.admin',  (select person_id::text from public.profiles where id = 'b1b1b1b1-2222-4111-8111-000000000001'), true);
select set_config('k.member', (select person_id::text from public.profiles where id = 'b1b1b1b1-2222-4111-8111-000000000002'), true);
select set_config('k.parent', (select person_id::text from public.profiles where id = 'b1b1b1b1-2222-4111-8111-000000000003'), true);
update public.people set dob = '1990-01-01', phone = '07700 900123' where id in (current_setting('k.member')::uuid, current_setting('k.parent')::uuid, current_setting('k.admin')::uuid);
insert into public.people (id, first_name, last_name, dob) values ('c1c1c1c1-2222-4111-8111-000000000001', 'Kid', 'Comms', current_date - interval '8 years');
insert into public.guardianships (guardian_person_id, child_person_id, relationship) values (current_setting('k.parent')::uuid, 'c1c1c1c1-2222-4111-8111-000000000001', 'parent');

select has_table('public', 'outbound_messages', 'outbound_messages');
select has_table('public', 'comms_preferences', 'comms_preferences');
select has_table('public', 'comms_suppressions', 'comms_suppressions');
select is((select value from public.site_settings where key = 'comms.dry_run'), 'false', 'dry run off by default');
select ok(not has_table_privilege('authenticated', 'public.outbound_messages', 'INSERT'), 'authenticated cannot insert messages directly');
select ok(not has_function_privilege('anon', 'public.enqueue_message(public.comms_channel, public.comms_category, uuid, text, text, text, text, text, text)', 'EXECUTE'),
  'anon cannot enqueue');

-- defaults: email on, sms off
select is(public.comms_channel_enabled(current_setting('k.member')::uuid, 'email'), true, 'email enabled by default');
select is(public.comms_channel_enabled(current_setting('k.member')::uuid, 'push'), true, 'push enabled by default');
select is(public.comms_channel_enabled(current_setting('k.member')::uuid, 'sms'), false, 'sms is opt-in');

-- service_role enqueues
set local request.jwt.claims to '{"role":"service_role"}';
set local role service_role;
select is((select (status::text, decision) from public.enqueue_message('email', 'transactional', current_setting('k.member')::uuid, null, 'Booking confirmed', 'Hi')),
  ('queued'::text, 'ok'::text), 'transactional email queued, address resolved from people');
select is((select to_address from public.outbound_messages order by created_at desc limit 1), 'k-member@test.invalid', 'address resolved and lower-cased');
select is((select status::text from public.enqueue_message('sms', 'reminder', current_setting('k.member')::uuid, null, null, 'Subs due')),
  'skipped_preference', 'reminder SMS skipped: sms is opt-in');
select is((select status::text from public.enqueue_message('sms', 'transactional', current_setting('k.member')::uuid, null, null, 'Code 1234')),
  'queued', 'transactional SMS ignores the preference (number resolved from people)');
select is((select to_address from public.outbound_messages where channel = 'sms' and status = 'queued' order by created_at desc limit 1), '07700900123', 'phone whitespace stripped');
select throws_ok($$select * from public.enqueue_message('email', 'marketing')$$, '22023', null, 'email needs a person or an address');
select is((select (status::text, decision) from public.enqueue_message('email', 'marketing', 'c1c1c1c1-2222-4111-8111-000000000001')),
  ('failed'::text, 'no_address'::text), 'a person with no email fails loudly, not silently');
reset role;

-- member turns email marketing off
set local request.jwt.claims to '{"sub":"b1b1b1b1-2222-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select lives_ok($$insert into public.comms_preferences (person_id, channel, enabled) values (current_setting('k.member')::uuid, 'email', false)$$,
  'member sets own preference');
select throws_ok($$insert into public.comms_preferences (person_id, channel, enabled) values (current_setting('k.parent')::uuid, 'email', false)$$,
  '42501', null, 'member cannot set someone else''s preference');
select throws_ok($$select * from public.enqueue_message('email', 'marketing', current_setting('k.member')::uuid)$$, '42501', null,
  'a member cannot enqueue');
reset role;
set local request.jwt.claims to '{"role":"service_role"}';
set local role service_role;
select is((select status::text from public.enqueue_message('email', 'marketing', current_setting('k.member')::uuid, null, 'News', 'x')),
  'skipped_preference', 'opt-out honoured for marketing');
select is((select status::text from public.enqueue_message('email', 'reminder', current_setting('k.member')::uuid, null, 'Subs', 'x')),
  'skipped_preference', 'opt-out honoured for reminders');
select is((select status::text from public.enqueue_message('email', 'transactional', current_setting('k.member')::uuid, null, 'Receipt', 'x')),
  'queued', 'transactional still goes');
reset role;

-- parent manages the child's preferences
set local request.jwt.claims to '{"sub":"b1b1b1b1-2222-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select lives_ok($$insert into public.comms_preferences (person_id, channel, enabled) values ('c1c1c1c1-2222-4111-8111-000000000001', 'push', false)$$,
  'guardian sets the child''s preference');
reset role;

-- suppression beats everything
set local request.jwt.claims to '{"sub":"b1b1b1b1-2222-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok($$insert into public.comms_suppressions (channel, address, reason) values ('email', 'k-member@test.invalid', 'hard bounce 2026-08-01')$$,
  'club_admin suppresses an address');
select throws_ok($$insert into public.comms_suppressions (channel, address, reason) values ('email', 'Mixed@Case.invalid', 'x')$$,
  '23514', null, 'addresses are stored lower-cased (check)');
reset role;
set local request.jwt.claims to '{"role":"service_role"}';
set local role service_role;
select is((select status::text from public.enqueue_message('email', 'transactional', current_setting('k.member')::uuid, null, 'Receipt', 'x')),
  'suppressed', 'suppression beats transactional');
select is((select status::text from public.enqueue_message('email', 'transactional', null, 'K-Member@test.invalid', 'Receipt', 'x')),
  'suppressed', 'suppression matches case-insensitively on an explicit address');

-- dispatcher lifecycle + dry run
select set_config('k.q', (select count(*)::text from public.queued_messages()), true);
select ok(current_setting('k.q')::int >= 3, 'queued_messages lists the queue');
select set_config('k.m1', (select message_id::text from public.enqueue_message('email', 'transactional', current_setting('k.admin')::uuid, null, 'Test', 'x')), true);
select public.mark_message_sent(current_setting('k.m1')::uuid, 'resend', 'msg_123');
select is((select (status::text, provider, provider_ref, sent_at is not null) from public.outbound_messages where id = current_setting('k.m1')::uuid),
  ('sent'::text, 'resend'::text, 'msg_123'::text, true), 'mark_message_sent');
update public.site_settings set value = 'true' where key = 'comms.dry_run';
select is((select status::text from public.enqueue_message('email', 'transactional', current_setting('k.admin')::uuid, null, 'Test', 'x')),
  'dry_run', 'dry-run mode stops delivery platform-wide');
reset role;

-- RLS reads
set local request.jwt.claims to '{"sub":"b1b1b1b1-2222-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.outbound_messages where person_id <> current_setting('k.member')::uuid), 0::bigint, 'member sees only own messages');
select ok((select count(*) from public.outbound_messages where person_id = current_setting('k.member')::uuid) >= 5, 'member sees own messages');
select is((select count(*) from public.comms_suppressions), 0::bigint, 'member cannot see the suppression list');
reset role;

select * from finish();

rollback;
