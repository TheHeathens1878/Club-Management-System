-- =============================================================================
-- P5.2 — messaging: SG-1 (all sub-cases), SG-1.9, SG-9, SG-2, RLS
-- =============================================================================
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(75);

insert into auth.users (id, email, raw_user_meta_data) values
  ('a9a9a9a9-2222-4111-8111-000000000001', 'g-admin@test.invalid',  '{"full_name": "Ada Admin"}'::jsonb),
  ('a9a9a9a9-2222-4111-8111-000000000002', 'g-lead@test.invalid',   '{"full_name": "Lee Lead"}'::jsonb),
  ('a9a9a9a9-2222-4111-8111-000000000003', 'g-coach@test.invalid',  '{"full_name": "Cy Coach"}'::jsonb),
  ('a9a9a9a9-2222-4111-8111-000000000004', 'g-parent@test.invalid', '{"full_name": "Pat Parent"}'::jsonb),
  ('a9a9a9a9-2222-4111-8111-000000000005', 'g-other@test.invalid',  '{"full_name": "Ollie Otherparent"}'::jsonb),
  ('a9a9a9a9-2222-4111-8111-000000000006', 'g-member@test.invalid', '{"full_name": "Mo Member"}'::jsonb);
update public.profiles set role = 'committee' where id = 'a9a9a9a9-2222-4111-8111-000000000001';
select set_config('g.admin',  (select person_id::text from public.profiles where id = 'a9a9a9a9-2222-4111-8111-000000000001'), true);
select set_config('g.lead',   (select person_id::text from public.profiles where id = 'a9a9a9a9-2222-4111-8111-000000000002'), true);
select set_config('g.coach',  (select person_id::text from public.profiles where id = 'a9a9a9a9-2222-4111-8111-000000000003'), true);
select set_config('g.parent', (select person_id::text from public.profiles where id = 'a9a9a9a9-2222-4111-8111-000000000004'), true);
select set_config('g.other',  (select person_id::text from public.profiles where id = 'a9a9a9a9-2222-4111-8111-000000000005'), true);
select set_config('g.member', (select person_id::text from public.profiles where id = 'a9a9a9a9-2222-4111-8111-000000000006'), true);
insert into public.person_roles (person_id, role) values (current_setting('g.lead')::uuid, 'safeguarding_lead');
update public.people set dob = '1980-01-01' where id in (current_setting('g.admin')::uuid, current_setting('g.lead')::uuid, current_setting('g.coach')::uuid,
  current_setting('g.parent')::uuid, current_setting('g.other')::uuid, current_setting('g.member')::uuid);
-- children: a 10-year-old, a 15-year-old referee, a 15-year-old without consent, and one who is 17 turning 18
insert into public.people (id, first_name, last_name, dob) values
  ('d9d9d9d9-2222-4111-8111-000000000001', 'Kid', 'Ten',     current_date - interval '10 years'),
  ('d9d9d9d9-2222-4111-8111-000000000002', 'Ref', 'Fifteen', current_date - interval '15 years'),
  ('d9d9d9d9-2222-4111-8111-000000000003', 'Kid', 'Fifteen', current_date - interval '15 years'),
  ('d9d9d9d9-2222-4111-8111-000000000004', 'Al',  'Most',    current_date - interval '18 years' + interval '1 day');
insert into public.guardianships (guardian_person_id, child_person_id, relationship) values
  (current_setting('g.parent')::uuid, 'd9d9d9d9-2222-4111-8111-000000000001', 'parent'),
  (current_setting('g.parent')::uuid, 'd9d9d9d9-2222-4111-8111-000000000002', 'parent'),
  (current_setting('g.parent')::uuid, 'd9d9d9d9-2222-4111-8111-000000000003', 'parent'),
  (current_setting('g.other')::uuid,  'd9d9d9d9-2222-4111-8111-000000000004', 'parent');
insert into public.guardian_consents (child_person_id, guardian_person_id, consent_type, notice_version) values
  ('d9d9d9d9-2222-4111-8111-000000000002', current_setting('g.parent')::uuid, 'app_account', 'v1'),
  ('d9d9d9d9-2222-4111-8111-000000000002', current_setting('g.parent')::uuid, 'unsupervised_messaging', 'sg9-notice-v1');

-- helper to build a conversation with participants as the owner
create or replace function pg_temp.conv(p_type public.conversation_type, p_id uuid, variadic p_people uuid[]) returns uuid language plpgsql as $$
begin
  insert into public.conversations (id, type, created_by_person_id) values (p_id, p_type, p_people[1]);
  insert into public.conversation_participants (conversation_id, person_id, basis)
  select p_id, unnest(p_people), 'member';
  return p_id;
end $$;

-- A. shape + SG-2 + privileges
select has_table('public', 'conversations', 'conversations');
select has_table('public', 'conversation_participants', 'participants');
select has_table('public', 'messages', 'messages');
select has_table('public', 'message_attachments', 'attachments');
select ok(not bool_or(has_table_privilege(r, t, p)), 'delete_and_truncate_privileges_revoked_for_api_roles')
from unnest(array['anon', 'authenticated', 'service_role']) r,
     unnest(array['public.messages', 'public.conversation_participants', 'public.message_attachments']) t,
     unnest(array['DELETE', 'TRUNCATE']) p;
select ok(not has_function_privilege('anon', 'public.read_conversation_as_lead(uuid, text)', 'EXECUTE'), 'conversation_accessor_execute_revoked_from_public');
select ok((select not public from storage.buckets where id = 'attachments'), 'attachments bucket is private');

-- B. SG-1 core
-- adult + adult
select lives_ok($$select pg_temp.conv('dm', 'e1e1e1e1-2222-4111-8111-000000000001', current_setting('g.coach')::uuid, current_setting('g.member')::uuid)$$, 'two adults may dm');
-- coach + ten-year-old: refused
select throws_ok($$select pg_temp.conv('dm', 'e1e1e1e1-2222-4111-8111-000000000002', current_setting('g.coach')::uuid, 'd9d9d9d9-2222-4111-8111-000000000001')$$,
  'P0001', null, 'adult_and_minor_1to1_throws');
-- guardian_can_dm_own_child
select lives_ok($$select pg_temp.conv('dm', 'e1e1e1e1-2222-4111-8111-000000000003', current_setting('g.parent')::uuid, 'd9d9d9d9-2222-4111-8111-000000000001')$$, 'guardian_can_dm_own_child');
-- parent_of_other_child_cannot_dm_this_child
select throws_ok($$select pg_temp.conv('dm', 'e1e1e1e1-2222-4111-8111-000000000004', current_setting('g.other')::uuid, 'd9d9d9d9-2222-4111-8111-000000000001')$$,
  'P0001', null, 'parent_of_other_child_cannot_dm_this_child');
-- group: coach + child + parent allowed
select lives_ok($$select pg_temp.conv('group', 'e1e1e1e1-2222-4111-8111-000000000005', current_setting('g.coach')::uuid, 'd9d9d9d9-2222-4111-8111-000000000001', current_setting('g.parent')::uuid)$$,
  'coach + child + parent group allowed');
-- SG-1.1 guardian_cannot_leave_leaving_1to1
select throws_ok($$update public.conversation_participants set left_at = now() where conversation_id = 'e1e1e1e1-2222-4111-8111-000000000005' and person_id = current_setting('g.parent')::uuid$$,
  'P0001', null, 'guardian_cannot_leave_leaving_1to1');
-- but the coach may leave (child + parent remain)
select lives_ok($$update public.conversation_participants set left_at = now() where conversation_id = 'e1e1e1e1-2222-4111-8111-000000000005' and person_id = current_setting('g.coach')::uuid$$,
  'the coach may leave (guardian + child remain)');
-- SG-1.3 one_adult_two_minors_allowed (D2 boundary)
select lives_ok($$select pg_temp.conv('group', 'e1e1e1e1-2222-4111-8111-000000000006', current_setting('g.coach')::uuid, 'd9d9d9d9-2222-4111-8111-000000000001', 'd9d9d9d9-2222-4111-8111-000000000003')$$,
  'one_adult_two_minors_allowed (D2 boundary)');
-- ...but one of them leaving would create a 1:1
select throws_ok($$update public.conversation_participants set left_at = now() where conversation_id = 'e1e1e1e1-2222-4111-8111-000000000006' and person_id = 'd9d9d9d9-2222-4111-8111-000000000003'$$,
  'P0001', null, 'a minor leaving a 1 adult + 2 minors group is refused (it would become a 1:1)');
-- SG-1.6 announcement_to_single_minor_allowed
insert into public.conversations (id, type, created_by_person_id) values ('e1e1e1e1-2222-4111-8111-000000000007', 'announcement', current_setting('g.coach')::uuid);
insert into public.conversation_participants (conversation_id, person_id, basis) values
  ('e1e1e1e1-2222-4111-8111-000000000007', current_setting('g.coach')::uuid, 'staff');
select lives_ok($$insert into public.conversation_participants (conversation_id, person_id, basis) values ('e1e1e1e1-2222-4111-8111-000000000007', 'd9d9d9d9-2222-4111-8111-000000000001', 'member')$$,
  'announcement_to_single_minor_allowed');
select lives_ok($$insert into public.messages (conversation_id, sender_person_id, body) values ('e1e1e1e1-2222-4111-8111-000000000007', current_setting('g.coach')::uuid, 'Training is cancelled')$$,
  'staff may post to an announcement');
select throws_ok($$insert into public.messages (conversation_id, sender_person_id, body) values ('e1e1e1e1-2222-4111-8111-000000000007', 'd9d9d9d9-2222-4111-8111-000000000001', 'ok')$$,
  'P0001', null, 'a recipient cannot post to an announcement');
-- SG-1.5 lead_as_third_party_does_not_satisfy_guardian_requirement: coach + child + lead(genuine) = 3 → allowed (not 1:1) — documents SG-1.5b counts normally
select lives_ok($$select pg_temp.conv('group', 'e1e1e1e1-2222-4111-8111-000000000008', current_setting('g.coach')::uuid, 'd9d9d9d9-2222-4111-8111-000000000001', current_setting('g.lead')::uuid)$$,
  'lead as a genuine third participant counts normally (3 people, not a 1:1)');
select throws_ok($$update public.conversation_participants set left_at = now() where conversation_id = 'e1e1e1e1-2222-4111-8111-000000000008' and person_id = current_setting('g.lead')::uuid$$,
  'P0001', null, 'lead_as_third_party_does_not_satisfy_guardian_requirement (lead leaving leaves coach+child, refused)');
select throws_ok($$insert into public.conversation_participants (conversation_id, person_id, basis) values ('e1e1e1e1-2222-4111-8111-000000000001', current_setting('g.lead')::uuid, 'oversight')$$,
  '23514', null, 'oversight participant rows cannot exist');

-- SG-1.7 cannot_post_into_noncompliant_conversation (force the state with triggers off, as the owner)
alter table public.conversation_participants disable trigger trg_conversation_participants_sg1_check;
insert into public.conversations (id, type, created_by_person_id) values ('e1e1e1e1-2222-4111-8111-000000000009', 'dm', current_setting('g.coach')::uuid);
insert into public.conversation_participants (conversation_id, person_id) values
  ('e1e1e1e1-2222-4111-8111-000000000009', current_setting('g.coach')::uuid), ('e1e1e1e1-2222-4111-8111-000000000009', 'd9d9d9d9-2222-4111-8111-000000000001');
alter table public.conversation_participants enable trigger trg_conversation_participants_sg1_check;
select throws_ok($$insert into public.messages (conversation_id, sender_person_id, body) values ('e1e1e1e1-2222-4111-8111-000000000009', current_setting('g.coach')::uuid, 'hi')$$,
  'P0001', null, 'cannot_post_into_noncompliant_conversation');
select is((select count(*) from public.sg1_nightly_check() where conversation_id = 'e1e1e1e1-2222-4111-8111-000000000009'), 1::bigint, 'nightly check reports the non-compliant conversation');
update public.conversations set closed_at = now() where id = 'e1e1e1e1-2222-4111-8111-000000000009';

-- SG-1.2 dob_correction_blocked_when_it_creates_1to1: adult+adult dm, then
-- correct one to 15 (2026-08-25: 16 is now self-account age, so a correction
-- to 16 leaves the 1:1 compliant under SG-1.10 — 15 still trips the guard).
select set_config('g.claims0', '{}', true);
select throws_ok($$update public.people set dob = current_date - interval '15 years' where id = current_setting('g.member')::uuid$$,
  'P0001', null, 'dob_correction_blocked_when_it_creates_1to1');
-- minor_turning_18_does_not_break_existing_conversation
select lives_ok($$select pg_temp.conv('dm', 'e1e1e1e1-2222-4111-8111-000000000010', current_setting('g.other')::uuid, 'd9d9d9d9-2222-4111-8111-000000000004')$$,
  'guardian + 17-year-old dm');
update public.people set dob = current_date - interval '18 years' where id = 'd9d9d9d9-2222-4111-8111-000000000004';
select lives_ok($$insert into public.messages (conversation_id, sender_person_id, body) values ('e1e1e1e1-2222-4111-8111-000000000010', current_setting('g.other')::uuid, 'happy birthday')$$,
  'minor_turning_18_does_not_break_existing_conversation');

-- SG-1.8 guardianship_delete_blocked_when_it_creates_1to1 (dm 3: parent + Kid Ten)
select throws_ok($$delete from public.guardianships where guardian_person_id = current_setting('g.parent')::uuid and child_person_id = 'd9d9d9d9-2222-4111-8111-000000000001'$$,
  'P0001', null, 'guardianship_delete_blocked_when_it_creates_1to1');
select throws_ok($$update public.guardianships set ended_at = now() where guardian_person_id = current_setting('g.parent')::uuid and child_person_id = 'd9d9d9d9-2222-4111-8111-000000000001'$$,
  'P0001', null, 'ending the guardianship is blocked the same way');
select throws_ok($$update public.guardianships set child_person_id = 'd9d9d9d9-2222-4111-8111-000000000003' where guardian_person_id = current_setting('g.parent')::uuid and child_person_id = 'd9d9d9d9-2222-4111-8111-000000000001'$$,
  'P0001', null, 'guardianship_retarget_blocked_when_it_creates_1to1');
-- guardianship_delete_allowed_when_no_affected_conversation
select lives_ok($$delete from public.guardianships where guardian_person_id = current_setting('g.other')::uuid and child_person_id = 'd9d9d9d9-2222-4111-8111-000000000004'$$,
  'guardianship_delete_allowed_when_no_affected_conversation (child is 18 now)');
-- guardianship_delete_allowed_after_conversation_closed
update public.conversations set closed_at = now() where id in ('e1e1e1e1-2222-4111-8111-000000000003', 'e1e1e1e1-2222-4111-8111-000000000005', 'e1e1e1e1-2222-4111-8111-000000000006');
select lives_ok($$update public.guardianships set ended_at = now() where guardian_person_id = current_setting('g.parent')::uuid and child_person_id = 'd9d9d9d9-2222-4111-8111-000000000001'$$,
  'guardianship_delete_allowed_after_conversation_closed (ended)');
update public.guardianships set ended_at = null where guardian_person_id = current_setting('g.parent')::uuid and child_person_id = 'd9d9d9d9-2222-4111-8111-000000000001';

-- C. SG-1.9
-- supervision_exempt_minor_can_dm_adult_without_guardian
select lives_ok($$select pg_temp.conv('dm', 'e1e1e1e1-2222-4111-8111-000000000011', current_setting('g.coach')::uuid, 'd9d9d9d9-2222-4111-8111-000000000002')$$,
  'supervision_exempt_minor_can_dm_adult_without_guardian');
select is((select supervised_by_lead from public.conversations where id = 'e1e1e1e1-2222-4111-8111-000000000011'), true, 'exempt_dm_is_flagged_supervised_by_lead');
select throws_ok($$update public.conversations set supervised_by_lead = false where id = 'e1e1e1e1-2222-4111-8111-000000000011'$$,
  'P0001', null, 'clearing_supervised_by_lead_with_active_minor_throws');
-- minor_without_unsupervised_consent_cannot_dm_adult_without_guardian
select throws_ok($$select pg_temp.conv('dm', 'e1e1e1e1-2222-4111-8111-000000000012', current_setting('g.coach')::uuid, 'd9d9d9d9-2222-4111-8111-000000000003')$$,
  'P0001', null, 'minor_without_unsupervised_consent_cannot_dm_adult_without_guardian');
-- minor_below_unsupervised_age_cannot_dm_adult_without_guardian (Kid Ten, even with a consent row the age fails)
select throws_ok($$select pg_temp.conv('dm', 'e1e1e1e1-2222-4111-8111-000000000013', current_setting('g.coach')::uuid, 'd9d9d9d9-2222-4111-8111-000000000001')$$,
  'P0001', null, 'minor_below_unsupervised_age_cannot_dm_adult_without_guardian');
-- exempt_and_non_exempt_minor_with_one_adult_throws → that is 3 people (not a 1:1) so permitted by SG-1's form; documented boundary
select lives_ok($$select pg_temp.conv('group', 'e1e1e1e1-2222-4111-8111-000000000014', current_setting('g.coach')::uuid, 'd9d9d9d9-2222-4111-8111-000000000002', 'd9d9d9d9-2222-4111-8111-000000000003')$$,
  'adult + exempt minor + non-exempt minor is 3 people (SG-1.3 boundary)');
select throws_ok($$update public.conversation_participants set left_at = now() where conversation_id = 'e1e1e1e1-2222-4111-8111-000000000014' and person_id = 'd9d9d9d9-2222-4111-8111-000000000002'$$,
  'P0001', null, 'exempt_and_non_exempt_minor_with_one_adult_throws (exempt one leaving leaves adult + non-exempt)');
-- consent_revocation_blocked_while_dependent_conversation_open
select throws_ok($$update public.guardian_consents set revoked_at = now() where child_person_id = 'd9d9d9d9-2222-4111-8111-000000000002' and consent_type = 'unsupervised_messaging'$$,
  'P0001', null, 'consent_revocation_blocked_while_dependent_conversation_open');
-- raising_unsupervised_age_blocked_while_dependent_conversation_open
select throws_ok($$update public.site_settings set value = '16' where key = 'safeguarding.unsupervised_messaging_min_age'$$,
  'P0001', null, 'raising_unsupervised_age_blocked_while_dependent_conversation_open');
-- lowering_unsupervised_age_allowed (13 = min_account_age floor)
select lives_ok($$update public.site_settings set value = '13' where key = 'safeguarding.unsupervised_messaging_min_age'$$, 'lowering_unsupervised_age_allowed');
update public.site_settings set value = '14' where key = 'safeguarding.unsupervised_messaging_min_age';
-- after closing: revocation and raise allowed
update public.conversations set closed_at = now() where id = 'e1e1e1e1-2222-4111-8111-000000000011';
select lives_ok($$update public.site_settings set value = '16' where key = 'safeguarding.unsupervised_messaging_min_age'$$, 'raising_unsupervised_age_allowed_after_conversation_closed');
update public.site_settings set value = '14' where key = 'safeguarding.unsupervised_messaging_min_age';
select lives_ok($$update public.guardian_consents set revoked_at = now() where child_person_id = 'd9d9d9d9-2222-4111-8111-000000000002' and consent_type = 'unsupervised_messaging'$$,
  'consent_revocation_allowed_after_conversation_closed');
select is((select notice_version from public.guardian_consents where child_person_id = 'd9d9d9d9-2222-4111-8111-000000000002' and consent_type = 'unsupervised_messaging'),
  'sg9-notice-v1', 'consent_row_records_notice_version');

-- D. SG-9 accessors (conversation 11: coach + referee, has messages? add one while open) — reopen briefly
insert into public.guardian_consents (child_person_id, guardian_person_id, consent_type, notice_version) values
  ('d9d9d9d9-2222-4111-8111-000000000002', current_setting('g.parent')::uuid, 'unsupervised_messaging', 'sg9-notice-v2');
update public.conversations set closed_at = null where id = 'e1e1e1e1-2222-4111-8111-000000000011';
insert into public.messages (conversation_id, sender_person_id, body) values ('e1e1e1e1-2222-4111-8111-000000000011', current_setting('g.coach')::uuid, 'Kick-off moved to 2pm');
set local request.jwt.claims to '{"sub":"a9a9a9a9-2222-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.read_conversation_as_lead('e1e1e1e1-2222-4111-8111-000000000011', 'Routine review of supervised DMs')), 1::bigint, 'lead_can_read_conversation_with_minor');
select throws_ok($$select * from public.read_conversation_as_lead('e1e1e1e1-2222-4111-8111-000000000011', '   ')$$, '22023', null, 'accessor_with_blank_reason_throws');
select throws_ok($$select * from public.read_conversation_as_lead('e1e1e1e1-2222-4111-8111-000000000001', 'curious')$$, '42501', null, 'accessor_on_conversation_without_any_minor_throws');
select is((select count(*) from public.messages where conversation_id = 'e1e1e1e1-2222-4111-8111-000000000011'), 0::bigint,
  'no_admin_read_policy_on_messages_for_api_roles (lead reads zero rows directly)');
select is(((select public.export_conversation_as_lead('e1e1e1e1-2222-4111-8111-000000000011', 'Export for case SC-1'))->>'message_count')::int, 1, 'export returns the history');
reset role;
select is((select detail->>'reason' from public.audit_log where action = 'messaging.conversation.admin_read' order by id desc limit 1), 'Routine review of supervised DMs', 'accessor_read_writes_audit_row');
select is((select (detail->>'message_count', detail->>'includes_minor') from public.audit_log where action = 'messaging.conversation.export' order by id desc limit 1), ('1'::text, 'true'::text),
  'accessor_export_writes_audit_row_with_message_count');
select ok(not exists (select 1 from public.audit_log where action like 'messaging.%' and detail::text like '%Kick-off moved%'), 'accessor_audit_detail_contains_no_message_body');
select is((select count(*) from public.conversation_participants where conversation_id = 'e1e1e1e1-2222-4111-8111-000000000011'), 2::bigint, 'accessor_read_does_not_create_participant_row');
set local request.jwt.claims to '{"sub":"a9a9a9a9-2222-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.read_conversation_as_lead('e1e1e1e1-2222-4111-8111-000000000003', 'Check')), 0::bigint, 'club_admin_can_read_conversation_with_minor (closed, empty)');
reset role;
select is((select detail->>'message_count' from public.audit_log where action = 'messaging.conversation.admin_read' order by id desc limit 1), '0', 'audit_row_written_even_when_conversation_has_no_messages');
set local request.jwt.claims to '{"sub":"a9a9a9a9-2222-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select throws_ok($$select * from public.read_conversation_as_lead('e1e1e1e1-2222-4111-8111-000000000011', 'x')$$, '42501', null, 'coach_calling_accessor_throws');
reset role;
set local request.jwt.claims to '{"sub":"a9a9a9a9-2222-4111-8111-000000000006","role":"authenticated"}';
set local role authenticated;
select throws_ok($$select * from public.read_conversation_as_lead('e1e1e1e1-2222-4111-8111-000000000011', 'x')$$, '42501', null, 'member_calling_accessor_throws');
reset role;

-- E. SG-2 on messages, redaction, immutability
select set_config('g.msg', (select id::text from public.messages where conversation_id = 'e1e1e1e1-2222-4111-8111-000000000011' limit 1), true);
select throws_ok($$delete from public.messages where id = current_setting('g.msg')::uuid$$, 'P0001', null, 'hard_delete_message_throws (owner)');
select throws_ok($$truncate public.messages cascade$$, 'P0001', null, 'truncate_messages_throws');
select throws_ok($$truncate public.conversation_participants cascade$$, 'P0001', null, 'truncate_participants_throws');
select throws_ok($$update public.messages set body = 'edited' where id = current_setting('g.msg')::uuid$$, 'P0001', null, 'message body is immutable');
update public.messages set deleted_at = now() where id = current_setting('g.msg')::uuid;
select throws_ok($$update public.messages set deleted_at = null where id = current_setting('g.msg')::uuid$$, 'P0001', null, 'a deletion cannot be undone');
set local request.jwt.claims to '{"sub":"a9a9a9a9-2222-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select lives_ok($$select public.redact_message_as_lead(current_setting('g.msg')::uuid, 'contains a phone number')$$, 'lead redacts');
reset role;
select is((select (body, redacted_at is not null) from public.messages where id = current_setting('g.msg')::uuid), ('[redacted]'::text, true), 'retention_redacts_body_but_keeps_row');

-- F. RLS as participants
set local request.jwt.claims to '{"sub":"a9a9a9a9-2222-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.conversations where id = 'e1e1e1e1-2222-4111-8111-000000000011'), 1::bigint, 'coach sees their own conversation');
select is((select count(*) from public.conversations where id = 'e1e1e1e1-2222-4111-8111-000000000003'), 0::bigint, 'coach cannot see a conversation they are not in');
select lives_ok($$insert into public.messages (conversation_id, sender_person_id, body) values ('e1e1e1e1-2222-4111-8111-000000000011', current_setting('g.coach')::uuid, 'See you at 2')$$,
  'participant posts');
select throws_ok($$insert into public.messages (conversation_id, sender_person_id, body) values ('e1e1e1e1-2222-4111-8111-000000000011', current_setting('g.member')::uuid, 'spoof')$$,
  'P0001', null, 'cannot post as someone else');
select throws_ok($$insert into public.messages (conversation_id, sender_person_id, body) values ('e1e1e1e1-2222-4111-8111-000000000003', current_setting('g.coach')::uuid, 'intrude')$$,
  'P0001', null, 'cannot post into a conversation you are not in');
-- creating a dm as a member: creator row then the other person; SG-1 binds through RLS too
select lives_ok($$insert into public.conversations (id, type, created_by_person_id) values ('e1e1e1e1-2222-4111-8111-000000000020', 'dm', current_setting('g.coach')::uuid)$$, 'coach creates a dm');
select lives_ok($$insert into public.conversation_participants (conversation_id, person_id, basis) values ('e1e1e1e1-2222-4111-8111-000000000020', current_setting('g.coach')::uuid, 'creator')$$, 'creator joins');
select throws_ok($$insert into public.conversation_participants (conversation_id, person_id, basis) values ('e1e1e1e1-2222-4111-8111-000000000020', 'd9d9d9d9-2222-4111-8111-000000000001', 'member')$$,
  'P0001', null, 'adding a child to a coach''s dm is refused through RLS as well');
select lives_ok($$update public.conversation_participants set last_read_message_id = (select id from public.messages where conversation_id = 'e1e1e1e1-2222-4111-8111-000000000011' order by created_at desc limit 1)
  where conversation_id = 'e1e1e1e1-2222-4111-8111-000000000011' and person_id = current_setting('g.coach')::uuid$$, 'read receipt updated');
reset role;
set local role anon;
select throws_ok($$select count(*) from public.messages$$, '42501', null, 'anon cannot read messages');
reset role;

select * from finish();

rollback;
