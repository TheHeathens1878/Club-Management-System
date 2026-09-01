-- =============================================================================
-- P5.6 — report_message(), retention (dry-run), export completeness
-- =============================================================================
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(19);

insert into auth.users (id, email, raw_user_meta_data) values
  ('b4b4b4b4-2222-4111-8111-000000000001', 'r6-lead@test.invalid',   '{"full_name": "Lee Lead"}'::jsonb),
  ('b4b4b4b4-2222-4111-8111-000000000002', 'r6-coach@test.invalid',  '{"full_name": "Cy Coach"}'::jsonb),
  ('b4b4b4b4-2222-4111-8111-000000000003', 'r6-parent@test.invalid', '{"full_name": "Pat Parent"}'::jsonb),
  ('b4b4b4b4-2222-4111-8111-000000000004', 'r6-other@test.invalid',  '{"full_name": "Ollie Other"}'::jsonb);
select set_config('r6.lead',   (select person_id::text from public.profiles where id = 'b4b4b4b4-2222-4111-8111-000000000001'), true);
select set_config('r6.coach',  (select person_id::text from public.profiles where id = 'b4b4b4b4-2222-4111-8111-000000000002'), true);
select set_config('r6.parent', (select person_id::text from public.profiles where id = 'b4b4b4b4-2222-4111-8111-000000000003'), true);
select set_config('r6.other',  (select person_id::text from public.profiles where id = 'b4b4b4b4-2222-4111-8111-000000000004'), true);
insert into public.person_roles (person_id, role) values (current_setting('r6.lead')::uuid, 'safeguarding_lead');
update public.people set dob = '1980-01-01' where id in (current_setting('r6.lead')::uuid, current_setting('r6.coach')::uuid, current_setting('r6.parent')::uuid, current_setting('r6.other')::uuid);
insert into public.people (id, first_name, last_name, dob) values ('d4d4d4d4-2222-4111-8111-000000000001', 'Kid', 'Report', current_date - interval '11 years');
insert into public.guardianships (guardian_person_id, child_person_id, relationship) values (current_setting('r6.parent')::uuid, 'd4d4d4d4-2222-4111-8111-000000000001', 'parent');

-- group: coach + child + parent
insert into public.conversations (id, type, created_by_person_id) values ('e6e6e6e6-2222-4111-8111-000000000001', 'group', current_setting('r6.coach')::uuid);
insert into public.conversation_participants (conversation_id, person_id, basis) values
  ('e6e6e6e6-2222-4111-8111-000000000001', current_setting('r6.coach')::uuid, 'creator'),
  ('e6e6e6e6-2222-4111-8111-000000000001', current_setting('r6.parent')::uuid, 'guardian'),
  ('e6e6e6e6-2222-4111-8111-000000000001', 'd4d4d4d4-2222-4111-8111-000000000001', 'member');
insert into public.messages (id, conversation_id, sender_person_id, body, created_at) values
  ('f6f6f6f6-2222-4111-8111-000000000001', 'e6e6e6e6-2222-4111-8111-000000000001', current_setting('r6.coach')::uuid, 'Old message', now() - interval '30 months'),
  ('f6f6f6f6-2222-4111-8111-000000000002', 'e6e6e6e6-2222-4111-8111-000000000001', current_setting('r6.coach')::uuid, 'Recent message', now() - interval '1 day'),
  ('f6f6f6f6-2222-4111-8111-000000000003', 'e6e6e6e6-2222-4111-8111-000000000001', current_setting('r6.parent')::uuid, 'Something inappropriate', now() - interval '1 hour');
update public.messages set deleted_at = now() where id = 'f6f6f6f6-2222-4111-8111-000000000002';

-- A. report_message
set local request.jwt.claims to '{"sub":"b4b4b4b4-2222-4111-8111-000000000004","role":"authenticated"}';
set local role authenticated;
select throws_ok($$select public.report_message('f6f6f6f6-2222-4111-8111-000000000003', 'rude')$$, '42501', null, 'a non-participant cannot report');
reset role;
set local request.jwt.claims to '{"sub":"b4b4b4b4-2222-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_ok($$select public.report_message('f6f6f6f6-2222-4111-8111-000000000003', ' ')$$, '22023', null, 'a reason is required');
select set_config('r6.ref', public.report_message('f6f6f6f6-2222-4111-8111-000000000003', 'This message worries me'), true);
select matches(current_setting('r6.ref'), '^SC-', 'report_message returns a concern reference');
select is((select count(*) from public.my_concern_receipts() where ref = current_setting('r6.ref')), 1::bigint, 'the reporter holds the receipt');
reset role;
select ok(exists (select 1 from public.audit_log where action = 'messaging.message.reported' and entity_id = 'f6f6f6f6-2222-4111-8111-000000000003'), 'report audited');
select ok(not exists (select 1 from public.audit_log where action = 'messaging.message.reported' and detail::text like '%inappropriate%'), 'audit carries no message text');
set local request.jwt.claims to '{"sub":"b4b4b4b4-2222-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select alike((select narrative from public.read_concerns(null, current_setting('r6.ref'))), '[message:f6f6f6f6-2222-4111-8111-000000000003 conversation:e6e6e6e6-2222-4111-8111-000000000001]%',
  'the concern narrative carries the structured message/conversation prefix for the lead');
select is((select reported_person_id from public.read_concerns(null, current_setting('r6.ref'))), current_setting('r6.parent')::uuid, 'the sender is the reported person');

-- B. export completeness (incl. soft-deleted)
select is(jsonb_array_length((public.export_conversation_as_lead('e6e6e6e6-2222-4111-8111-000000000001', 'Case review'))->'messages'), 3, 'export includes every message incl. soft-deleted');
select ok(((public.export_conversation_as_lead('e6e6e6e6-2222-4111-8111-000000000001', 'Case review'))->'messages')::text like '%"deleted_at": "20%', 'export marks soft-deleted messages');
reset role;

-- C. retention: candidates, dry-run, legal hold, open concern
select set_config('r6.claims', '{}', true);
set local request.jwt.claims to '{}';
-- the conversation is attached to an OPEN concern (via the report) → nothing is a candidate
select is((select count(*) from public.message_retention_candidates()), 0::bigint, 'retention_skips_conversation_with_open_concern');
-- close the concern → the 30-month-old message becomes a candidate
set local request.jwt.claims to '{"sub":"b4b4b4b4-2222-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select public.update_concern(current_setting('r6.ref'), 'closed');
reset role;
set local request.jwt.claims to '{}';
select is((select array_agg(message_id) from public.message_retention_candidates()), array['f6f6f6f6-2222-4111-8111-000000000001']::uuid[], 'only the message older than the period is a candidate');
-- dry run changes nothing (and is forced while retention.enabled = false).
-- 20260825060000 ships retention ENABLED, so the disabled state is arranged
-- here rather than assumed from the seed.
update public.site_settings set value = 'false' where key = 'retention.enabled';
select set_config('r6.audit0', (select count(*)::text from public.audit_log where action = 'retention.dry_run'), true);
select is((select mode from public.retention_run(false)), 'dry_run', 'retention.enabled=false forces dry-run even when asked to run');
select is((select redacted_at from public.messages where id = 'f6f6f6f6-2222-4111-8111-000000000001'), null, 'retention_job_dry_run_changes_nothing');
select is((select detail->>'would_redact' from public.audit_log where action = 'retention.dry_run' order by id desc limit 1), '1', 'dry run logs what it would redact');
-- legal hold on the conversation removes the candidate
update public.conversations set legal_hold = true where id = 'e6e6e6e6-2222-4111-8111-000000000001';
select is((select count(*) from public.message_retention_candidates()), 0::bigint, 'retention_skips_legal_held_conversation');
update public.conversations set legal_hold = false where id = 'e6e6e6e6-2222-4111-8111-000000000001';
-- enabled + real run redacts body, keeps row, never touches audit_log
update public.site_settings set value = 'true' where key = 'retention.enabled';
select set_config('r6.alog', (select count(*)::text from public.audit_log), true);
select is((select redacted from public.retention_run(false)), 1, 'a real run redacts one message');
select is((select (body, redacted_at is not null, redaction_reason) from public.messages where id = 'f6f6f6f6-2222-4111-8111-000000000001'),
  ('[redacted]'::text, true, 'retention'::text), 'retention_redacts_body_but_keeps_row');
select is((select count(*) from public.audit_log), current_setting('r6.alog')::bigint + 1, 'retention_never_touches_audit_log_content (only adds its own row)');

select * from finish();

rollback;
