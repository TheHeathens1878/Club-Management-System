-- =============================================================================
-- P4.3 — safeguarding_concerns (SG-3 / SG-7 / SG-2 / SG-8), SG-6 tier 2, audit_read
-- =============================================================================
-- Every SG-3 test SAFEGUARDING.md names is here under its name.
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(60);

-- SG-6 tier-1 enforcement is OFF in production (FA Clubs Portal is the record;
-- see the 2026-08-23 amendment in SAFEGUARDING.md). These tests exercise the
-- machinery, so they run with the switch on.
update public.site_settings set value = '1' where key = 'safeguarding.sg6_enforcement';

insert into auth.users (id, email, raw_user_meta_data) values
  ('a8a8a8a8-1111-4111-8111-000000000001', 'c-admin@test.invalid',  '{"full_name": "Ada Admin"}'::jsonb),
  ('a8a8a8a8-1111-4111-8111-000000000002', 'c-lead@test.invalid',   '{"full_name": "Lee Lead"}'::jsonb),
  ('a8a8a8a8-1111-4111-8111-000000000003', 'c-coach@test.invalid',  '{"full_name": "Cy Coach"}'::jsonb),
  ('a8a8a8a8-1111-4111-8111-000000000004', 'c-report@test.invalid', '{"full_name": "Rae Reporter"}'::jsonb),
  ('a8a8a8a8-1111-4111-8111-000000000005', 'c-admin2@test.invalid', '{"full_name": "Sub Jectadmin"}'::jsonb);
update public.profiles set role = 'committee' where id in ('a8a8a8a8-1111-4111-8111-000000000001', 'a8a8a8a8-1111-4111-8111-000000000005');
select set_config('c.admin',  (select person_id::text from public.profiles where id = 'a8a8a8a8-1111-4111-8111-000000000001'), true);
select set_config('c.lead',   (select person_id::text from public.profiles where id = 'a8a8a8a8-1111-4111-8111-000000000002'), true);
select set_config('c.coach',  (select person_id::text from public.profiles where id = 'a8a8a8a8-1111-4111-8111-000000000003'), true);
select set_config('c.report', (select person_id::text from public.profiles where id = 'a8a8a8a8-1111-4111-8111-000000000004'), true);
select set_config('c.admin2', (select person_id::text from public.profiles where id = 'a8a8a8a8-1111-4111-8111-000000000005'), true);
insert into public.person_roles (person_id, role) values (current_setting('c.lead')::uuid, 'safeguarding_lead');
update public.people set dob = '1980-01-01' where id in (current_setting('c.admin')::uuid, current_setting('c.lead')::uuid, current_setting('c.coach')::uuid, current_setting('c.report')::uuid, current_setting('c.admin2')::uuid);
insert into public.people (id, first_name, last_name, dob) values ('c8c8c8c8-1111-4111-8111-000000000001', 'Kid', 'Concern', current_date - interval '9 years');
-- P5.3 puts a minor's guardians in the team room; a guardian-less child on a one-coach team is refused by SG-1 (by design).
insert into public.guardianships (guardian_person_id, child_person_id, relationship) values (current_setting('c.report')::uuid, 'c8c8c8c8-1111-4111-8111-000000000001', 'parent');

-- ---------------------------------------------------------------------------
-- A. Privilege layer (the part RLS tests cannot reach)
-- ---------------------------------------------------------------------------
-- no_table_grant_on_concerns_for_api_roles
select ok(not bool_or(has_table_privilege(r, t, p)), 'no_table_grant_on_concerns_for_api_roles')
from unnest(array['anon', 'authenticated', 'service_role']) r,
     unnest(array['public.safeguarding_concerns', 'public.safeguarding_concern_notes']) t,
     unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p;
select ok(not has_sequence_privilege('service_role', 'public.safeguarding_concern_ref_seq', 'USAGE'), 'sequence not granted to service_role');
-- concern_accessor_execute_revoked_from_public
select ok(not has_function_privilege('anon', 'public.read_concerns(public.concern_status, text)', 'EXECUTE'), 'concern_accessor_execute_revoked_from_public (anon)');
select ok(has_function_privilege('authenticated', 'public.read_concerns(public.concern_status, text)', 'EXECUTE'), 'authenticated may execute read_concerns');
select ok((select relforcerowsecurity from pg_class where oid = 'public.safeguarding_concerns'::regclass), 'FORCE RLS on concerns');
select ok((select relforcerowsecurity from pg_class where oid = 'public.safeguarding_concern_notes'::regclass), 'FORCE RLS on notes');
-- direct_select_on_concerns_throws_for_service_role
set local request.jwt.claims to '{"role":"service_role"}';
set local role service_role;
select throws_ok($$select count(*) from public.safeguarding_concerns$$, '42501', null, 'direct_select_on_concerns_throws_for_service_role');
select throws_ok($$select count(*) from public.safeguarding_concern_notes$$, '42501', null, 'direct select on notes throws for service_role');
reset role;
-- anon_reads_zero_concerns (and cannot even try)
set local request.jwt.claims to '{"role":"anon"}';
set local role anon;
select throws_ok($$select count(*) from public.safeguarding_concerns$$, '42501', null, 'anon_reads_zero_concerns (permission denied)');
select throws_ok($$select * from public.read_concerns()$$, '42501', null, 'anon cannot execute the accessor');
reset role;

-- ---------------------------------------------------------------------------
-- B. Reporting and the receipt
-- ---------------------------------------------------------------------------
select set_config('c.audit0', (select count(*)::text from public.audit_log where action like 'safeguarding.concern.%'), true);
set local request.jwt.claims to '{"sub":"a8a8a8a8-1111-4111-8111-000000000004","role":"authenticated"}';
set local role authenticated;
select set_config('c.ref1', public.report_concern('I saw something worrying at training.', 'c8c8c8c8-1111-4111-8111-000000000001', current_setting('c.coach')::uuid), true);
select matches(current_setting('c.ref1'), '^SC-\d{4}-\d{4}$', 'report_concern returns a reference');
select set_config('c.ref2', public.report_concern('Second concern, names an admin.', null, current_setting('c.admin2')::uuid), true);
-- reporter_sees_only_own_receipt_view
select is((select count(*) from public.my_concern_receipts()), 2::bigint, 'reporter_sees_only_own_receipt_view (two of their own)');
select is((select narrative from public.my_concern_receipts() where ref = current_setting('c.ref1')), 'I saw something worrying at training.', 'receipt carries own narrative');
-- reporter_cannot_read_case_notes / concerns
select is((select count(*) from public.read_concerns()), 0::bigint, 'reporter cannot read concerns');
select throws_ok($$select * from public.read_concern_notes(current_setting('c.ref1'))$$, '42501', null, 'reporter_cannot_read_case_notes');
select throws_ok($$select public.add_concern_note(current_setting('c.ref1'), 'x')$$, '42501', null, 'reporter cannot add notes');
reset role;
select is((select count(*) from public.audit_log where action = 'safeguarding.concern.create'), current_setting('c.audit0')::bigint + 0 + 2, 'two create audit rows');
select ok(not exists (select 1 from public.audit_log where action like 'safeguarding.concern.%' and (detail ? 'narrative' or detail::text like '%worrying%')),
  'audit_detail_contains_no_concern_narrative');
select throws_ok(
  $$insert into public.audit_log (action, entity, detail) values ('safeguarding.concern.read', 'safeguarding_concerns', '{"narrative": "leak"}'::jsonb)$$,
  'P0001', null, 'audit_log refuses concern content in detail (SG-7 guard)');

-- ---------------------------------------------------------------------------
-- C. coach_cannot_read_concerns / club_admin_can_read_concerns
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"a8a8a8a8-1111-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.read_concerns()), 0::bigint, 'coach_cannot_read_concerns (zero rows, and the attempt is logged)');
select is((select count(*) from public.my_concern_receipts()), 0::bigint, 'coach has no receipts (and the empty read is audited)');
reset role;
select is((select count(*) from public.audit_log where action = 'safeguarding.concern.read' and detail->>'refused' = 'true'), 2::bigint,
  'audit_row_written_even_when_read_returns_zero_rows (the reporter''s and the coach''s refused attempts are logged)');

set local request.jwt.claims to '{"sub":"a8a8a8a8-1111-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.read_concerns()), 2::bigint, 'club_admin_can_read_concerns');
select throws_ok($$select * from public.read_concern_notes(current_setting('c.ref1'))$$, '42501', null, 'club_admin cannot read case notes');
select throws_ok($$select public.update_concern(current_setting('c.ref1'), 'under_review')$$, '42501', null, 'club_admin cannot change status');
select throws_ok($$select public.add_concern_note(current_setting('c.ref1'), 'x')$$, '42501', null, 'club_admin cannot add a note');
-- RLS backstop: even a direct select would be policy-filtered (but the grant is gone)
select throws_ok($$select count(*) from public.safeguarding_concerns$$, '42501', null, 'club_admin has no direct table grant either');
reset role;
select is((select detail->>'row_count' from public.audit_log where action = 'safeguarding.concern.read' and actor_id = 'a8a8a8a8-1111-4111-8111-000000000001' order by id desc limit 1),
  '2', 'the admin read is audited with its row count');

-- ---------------------------------------------------------------------------
-- D. subject_cannot_read_concern_about_self_even_as_admin
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"a8a8a8a8-1111-4111-8111-000000000005","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.read_concerns()), 1::bigint, 'subject_cannot_read_concern_about_self_even_as_admin (sees 1 of 2)');
select is((select count(*) from public.read_concerns(null, current_setting('c.ref2'))), 0::bigint, 'asking for it by ref returns nothing');
reset role;

-- ---------------------------------------------------------------------------
-- E. The lead: notes, status, legal hold; SG-2
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"a8a8a8a8-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.read_concerns()), 2::bigint, 'lead reads all');
select lives_ok($$select public.update_concern(current_setting('c.ref1'), 'under_review', 'high')$$, 'lead triages');
select set_config('c.note1', public.add_concern_note(current_setting('c.ref1'), 'Spoke to the coach; awaiting statement.')::text, true);
select is((select count(*) from public.read_concern_notes(current_setting('c.ref1'))), 1::bigint, 'lead reads the note');
select lives_ok($$select public.update_concern(current_setting('c.ref1'), null, null, true)$$, 'lead sets legal hold');
reset role;
select is((select (status::text, severity::text, legal_hold) from public.safeguarding_concerns where ref = current_setting('c.ref1')),
  ('under_review'::text, 'high'::text, true), 'triage and hold landed');
select ok(not exists (select 1 from public.audit_log where action = 'safeguarding.concern.note.create' and detail::text like '%statement%'),
  'note audit carries no note text');
-- immutability and SG-2 (as the owner)
select throws_ok($$update public.safeguarding_concerns set narrative = 'edited' where ref = current_setting('c.ref1')$$, 'P0001', null, 'narrative is immutable');
select throws_ok($$delete from public.safeguarding_concerns where ref = current_setting('c.ref1')$$, 'P0001', null, 'hard_delete_concern_throws (owner)');
select throws_ok($$truncate public.safeguarding_concerns cascade$$, 'P0001', null, 'truncate_concerns_throws (owner, cascade past the notes FK)');
select throws_ok($$delete from public.safeguarding_concern_notes where id = current_setting('c.note1')::uuid$$, 'P0001', null, 'hard delete of a note throws');
-- service_role_read_via_accessor_writes_audit_row
set local request.jwt.claims to '{"role":"service_role"}';
set local role service_role;
select set_config('c.audit1', (select count(*)::text from public.audit_log where action = 'safeguarding.concern.read'), true);
select is((select count(*) from public.read_concerns()), 2::bigint, 'service_role reads via the accessor');
select is((select count(*) from public.audit_log where action = 'safeguarding.concern.read'), current_setting('c.audit1')::bigint + 1,
  'service_role_read_via_accessor_writes_audit_row');
reset role;
-- closing stamps closed_at
set local request.jwt.claims to '{"sub":"a8a8a8a8-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select lives_ok($$select public.update_concern(current_setting('c.ref2'), 'closed')$$, 'lead closes');
reset role;
select ok((select closed_at is not null from public.safeguarding_concerns where ref = current_setting('c.ref2')), 'closed_at stamped');

-- ---------------------------------------------------------------------------
-- F. SG-8: legal hold on people, pseudonymise refusal
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"a8a8a8a8-1111-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select throws_ok($$update public.people set legal_hold = true where id = 'c8c8c8c8-1111-4111-8111-000000000001'$$, '42501', null,
  'club_admin cannot set people.legal_hold (lead only)');
reset role;
set local request.jwt.claims to '{}';
select throws_ok($$update public.people set pseudonymised_at = now() where id = 'c8c8c8c8-1111-4111-8111-000000000001'$$, 'P0001', null,
  'pseudonymise_person_with_open_concern_throws');
select throws_ok($$update public.people set pseudonymised_at = now() where id = current_setting('c.coach')::uuid$$, 'P0001', null,
  'the reported person cannot be pseudonymised while the concern is open either');
select lives_ok($$update public.people set pseudonymised_at = now() where id = current_setting('c.admin2')::uuid$$,
  'a person named only in a closed concern can be pseudonymised');
update public.people set legal_hold = true where id = current_setting('c.report')::uuid;
select is((select action from public.audit_log where entity = 'people' and entity_id = current_setting('c.report') order by id desc limit 1),
  'safeguarding.legal_hold', 'legal hold change audited');
select throws_ok($$update public.people set pseudonymised_at = now() where id = current_setting('c.report')::uuid$$, 'P0001', null,
  'legal hold beats pseudonymisation');

-- ---------------------------------------------------------------------------
-- G. SG-6 tier 2: nudges and compliance report
-- ---------------------------------------------------------------------------
insert into public.certifications (id, person_id, type, expires_on, verified_at) values
  ('cf1cf1cf-1111-4111-8111-000000000001', current_setting('c.coach')::uuid, 'fa_dbs', current_date + 25, now()),
  ('cf1cf1cf-1111-4111-8111-000000000002', current_setting('c.coach')::uuid, 'safeguarding_children', current_date + 400, now()),
  ('cf1cf1cf-1111-4111-8111-000000000003', current_setting('c.admin')::uuid, 'fa_dbs', current_date - 5, now());
select is((select array_agg(days_before order by days_before desc) from public.due_certification_nudges() where certification_id = 'cf1cf1cf-1111-4111-8111-000000000001'),
  array[90, 30]::integer[], 'expiry_nudge_fires_at_90_30_7: a cert 25 days out is due its 90 and 30 nudges');
select is((select count(*) from public.due_certification_nudges() where certification_id = 'cf1cf1cf-1111-4111-8111-000000000003'), 0::bigint,
  'an already-expired cert gets no nudge');
select public.mark_certification_nudged('cf1cf1cf-1111-4111-8111-000000000001', 90);
select public.mark_certification_nudged('cf1cf1cf-1111-4111-8111-000000000001', 30);
select is((select count(*) from public.due_certification_nudges() where certification_id = 'cf1cf1cf-1111-4111-8111-000000000001'), 0::bigint,
  'nudges are not re-sent');
select is(public.person_compliance_status(current_setting('c.coach')::uuid, 'fa_dbs'), 'expiring', 'compliance_status expiring');
select is(public.person_compliance_status(current_setting('c.admin')::uuid, 'fa_dbs'), 'expired', 'compliance_status expired');
select is(public.person_compliance_status(current_setting('c.admin')::uuid, 'safeguarding_children'), 'missing', 'compliance_status missing');
-- expired_coach_appears_in_daily_compliance_report: a team with a minor and an expired coach (memberships inserted as the owner, bypassing the P2.1 guard? no — the guard binds the owner too, so build it legitimately then expire)
insert into public.seasons (id, name, starts_on, ends_on) values ('5e5e5e5e-2222-4111-8111-000000000001', 'Cmp 2037/38', '2037-08-01', '2038-05-31');
insert into public.teams (id, name) values ('7e7e7e7e-2222-4111-8111-000000000001', 'Cmp U10s');
insert into public.team_memberships (person_id, team_id, season_id, role) values
  (current_setting('c.coach')::uuid, '7e7e7e7e-2222-4111-8111-000000000001', '5e5e5e5e-2222-4111-8111-000000000001', 'coach'),
  ('c8c8c8c8-1111-4111-8111-000000000001', '7e7e7e7e-2222-4111-8111-000000000001', '5e5e5e5e-2222-4111-8111-000000000001', 'player');
select is((select count(*) from public.compliance_report()), 0::bigint, 'a compliant team is not reported');
update public.certifications set expires_on = current_date - 1 where id = 'cf1cf1cf-1111-4111-8111-000000000001';
select is((select (team_name, dbs_status) from public.compliance_report() where person_id = current_setting('c.coach')::uuid),
  ('Cmp U10s'::text, 'expired'::text), 'expired_coach_appears_in_daily_compliance_report');

-- ---------------------------------------------------------------------------
-- H. audit_read on the new model
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"a8a8a8a8-1111-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.audit_log), 0::bigint, 'a coach reads no audit rows');
reset role;
set local request.jwt.claims to '{"sub":"a8a8a8a8-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select ok((select count(*) from public.audit_log where action like 'safeguarding.%') > 0, 'the lead reads safeguarding audit rows');
reset role;

select * from finish();

rollback;
