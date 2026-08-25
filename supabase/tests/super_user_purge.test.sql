-- =============================================================================
-- Super-user purge (20260825380000) — the one audited door through SG-2
-- =============================================================================
-- What is asserted:
--   A  shape and privileges: the three functions exist, anon holds no key
--   B  is_super_user() is the super user and nobody else — a committee/
--      club_admin sign-in is NOT one
--   C  a club_admin is refused both purges (42501)
--   D  purge_message refuses, by name: a message cited by a safeguarding
--      concern, a message cited in a concern NOTE, a conversation under a
--      legal hold, an author under a legal hold. The cited concern names the
--      SUPER USER as its subject, so `concern_names_caller` hides it from the
--      caller's own reads — the refusal proves the check does not depend on
--      what the caller may see
--   E  a super user purges an ordinary message: the row and everything hanging
--      off it are gone, other people's messages are untouched, and the audit
--      row carries the reason and NOT the body
--   F  purge_person refuses a person under a legal hold, a concern subject, a
--      concern reporter, someone in a conversation under a legal hold, and the
--      caller themselves
--   G  a super user purges an ordinary person: their memberships,
--      registrations, roles and messages go; the other member's rows are
--      exactly as they were; the summary says what went; the audit rows for
--      both purges survive the purge
--   H  the SG-2 guard is otherwise untouched: a plain hard delete still throws
--      for the table owner, a forged ticket buys nothing, and `audit_log`
--      cannot be reached by a ticket at all
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(50);

-- Fixtures ---------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('5b5b5b5b-3535-4111-8111-000000000001', 'sp-super@test.invalid', '{"full_name": "Sue Super"}'::jsonb),
  ('5b5b5b5b-3535-4111-8111-000000000002', 'sp-admin@test.invalid', '{"full_name": "Ada Admin"}'::jsonb),
  ('5b5b5b5b-3535-4111-8111-000000000003', 'sp-lead@test.invalid',  '{"full_name": "Lee Lead"}'::jsonb),
  ('5b5b5b5b-3535-4111-8111-000000000004', 'sp-alf@test.invalid',   '{"full_name": "Alf Ordinary"}'::jsonb),
  ('5b5b5b5b-3535-4111-8111-000000000005', 'sp-bea@test.invalid',   '{"full_name": "Bea Bystander"}'::jsonb),
  ('5b5b5b5b-3535-4111-8111-000000000006', 'sp-holly@test.invalid', '{"full_name": "Holly Hold"}'::jsonb);
update public.profiles set role = 'super_user' where id = '5b5b5b5b-3535-4111-8111-000000000001';
update public.profiles set role = 'committee'  where id = '5b5b5b5b-3535-4111-8111-000000000002';

select set_config('sp.super', (select person_id::text from public.profiles where id = '5b5b5b5b-3535-4111-8111-000000000001'), true);
select set_config('sp.admin', (select person_id::text from public.profiles where id = '5b5b5b5b-3535-4111-8111-000000000002'), true);
select set_config('sp.lead',  (select person_id::text from public.profiles where id = '5b5b5b5b-3535-4111-8111-000000000003'), true);
select set_config('sp.alf',   (select person_id::text from public.profiles where id = '5b5b5b5b-3535-4111-8111-000000000004'), true);
select set_config('sp.bea',   (select person_id::text from public.profiles where id = '5b5b5b5b-3535-4111-8111-000000000005'), true);
select set_config('sp.holly', (select person_id::text from public.profiles where id = '5b5b5b5b-3535-4111-8111-000000000006'), true);

insert into public.person_roles (person_id, role) values (current_setting('sp.lead')::uuid, 'safeguarding_lead');

-- SG-0: an unknown date of birth counts as a minor. Everyone here is an adult,
-- so SG-1 has nothing to say about any of these rooms.
update public.people set dob = '1980-01-01'
 where id in (current_setting('sp.super')::uuid, current_setting('sp.admin')::uuid,
              current_setting('sp.lead')::uuid,  current_setting('sp.alf')::uuid,
              current_setting('sp.bea')::uuid,   current_setting('sp.holly')::uuid);

-- Two people nobody has a login for: the subject of a concern, and someone
-- whose only distinction is being in a room that is under a legal hold.
insert into public.people (id, first_name, last_name, dob) values
  ('5c5c5c5c-3535-4111-8111-000000000001', 'Sam',  'Subject', '1979-09-09'),
  ('5c5c5c5c-3535-4111-8111-000000000002', 'Hank', 'Held',    '1978-08-08');

-- The legal hold goes on with no `auth.uid()`, which the SG-8 guard allows
-- (it is lead-only for a signed-in caller).
update public.people set legal_hold = true where id = current_setting('sp.holly')::uuid;

-- A season, a team and two memberships: Alf's goes, Bea's stays.
insert into public.seasons (id, name, starts_on, ends_on)
values ('5a5a5a5a-3535-4111-8111-000000000001', 'SP 2035/36', '2035-08-01', '2036-05-31');
insert into public.teams (id, name, age_group)
values ('7a7a7a7a-3535-4111-8111-000000000001', 'SP Vets', 'Open');
insert into public.team_memberships (person_id, team_id, season_id, role) values
  (current_setting('sp.alf')::uuid, '7a7a7a7a-3535-4111-8111-000000000001', '5a5a5a5a-3535-4111-8111-000000000001', 'player'),
  (current_setting('sp.bea')::uuid, '7a7a7a7a-3535-4111-8111-000000000001', '5a5a5a5a-3535-4111-8111-000000000001', 'player');
insert into public.registrations (person_id, season_id, status) values
  (current_setting('sp.alf')::uuid, '5a5a5a5a-3535-4111-8111-000000000001', 'approved'),
  (current_setting('sp.bea')::uuid, '5a5a5a5a-3535-4111-8111-000000000001', 'approved');
insert into public.emergency_contacts (person_id, "position", name, phone) values
  (current_setting('sp.alf')::uuid, 1, 'Alf Next Of Kin', '07700900001'),
  (current_setting('sp.bea')::uuid, 1, 'Bea Next Of Kin', '07700900002');

-- One ordinary room, and one under a legal hold.
insert into public.conversations (id, type, title, created_by_person_id) values
  ('c5c5c5c5-3535-4111-8111-000000000001', 'group', 'Kit run', current_setting('sp.alf')::uuid),
  ('c5c5c5c5-3535-4111-8111-000000000002', 'group', 'Held room', current_setting('sp.bea')::uuid);
insert into public.conversation_participants (conversation_id, person_id, basis) values
  ('c5c5c5c5-3535-4111-8111-000000000001', current_setting('sp.alf')::uuid,   'creator'),
  ('c5c5c5c5-3535-4111-8111-000000000001', current_setting('sp.bea')::uuid,   'member'),
  ('c5c5c5c5-3535-4111-8111-000000000001', current_setting('sp.super')::uuid, 'member'),
  ('c5c5c5c5-3535-4111-8111-000000000001', current_setting('sp.holly')::uuid, 'member'),
  ('c5c5c5c5-3535-4111-8111-000000000002', current_setting('sp.bea')::uuid,   'creator'),
  ('c5c5c5c5-3535-4111-8111-000000000002', '5c5c5c5c-3535-4111-8111-000000000002', 'member');

insert into public.messages (id, conversation_id, sender_person_id, body) values
  ('d5d5d5d5-3535-4111-8111-000000000001', 'c5c5c5c5-3535-4111-8111-000000000001', current_setting('sp.alf')::uuid,   'ALF-PURGEABLE-BODY duplicate account, ignore me'),
  ('d5d5d5d5-3535-4111-8111-000000000002', 'c5c5c5c5-3535-4111-8111-000000000001', current_setting('sp.bea')::uuid,   'the one that becomes evidence'),
  ('d5d5d5d5-3535-4111-8111-000000000003', 'c5c5c5c5-3535-4111-8111-000000000001', current_setting('sp.alf')::uuid,   'second message from the same account'),
  ('d5d5d5d5-3535-4111-8111-000000000004', 'c5c5c5c5-3535-4111-8111-000000000002', current_setting('sp.bea')::uuid,   'inside the held room'),
  ('d5d5d5d5-3535-4111-8111-000000000005', 'c5c5c5c5-3535-4111-8111-000000000001', current_setting('sp.holly')::uuid, 'from a person under a legal hold'),
  ('d5d5d5d5-3535-4111-8111-000000000006', 'c5c5c5c5-3535-4111-8111-000000000001', current_setting('sp.bea')::uuid,   'cited in a note, not in the narrative');

insert into public.message_attachments (message_id, storage_path)
values ('d5d5d5d5-3535-4111-8111-000000000001', 'c5c5c5c5-3535-4111-8111-000000000001/d5d5d5d5-3535-4111-8111-000000000001/kit.jpg');
insert into public.message_reactions (message_id, person_id, emoji)
values ('d5d5d5d5-3535-4111-8111-000000000001', current_setting('sp.bea')::uuid, '👍');
insert into public.message_mentions (message_id, person_id)
values ('d5d5d5d5-3535-4111-8111-000000000001', current_setting('sp.bea')::uuid);

-- The concern that cites Bea's message. Its SUBJECT is the super user, so the
-- concerns read policy (`concern_names_caller`) hides it from her — which is
-- the point of section D.
select set_config('sp.ref_msg', public.report_concern(
  '[message:d5d5d5d5-3535-4111-8111-000000000002 conversation:c5c5c5c5-3535-4111-8111-000000000001] this needs looking at',
  current_setting('sp.super')::uuid, null, 'import', null), true);
-- A concern whose SUBJECT is Sam, and whose REPORTER is Bea.
select set_config('sp.ref_sam', public.report_concern(
  'About Sam.', '5c5c5c5c-3535-4111-8111-000000000001', null, 'import', current_setting('sp.bea')::uuid), true);
-- A note that cites a different message, written the way a note is really
-- written: by the safeguarding lead, through the accessor.
set local request.jwt.claims to '{"sub":"5b5b5b5b-3535-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select public.add_concern_note(current_setting('sp.ref_sam'),
  'see [message:d5d5d5d5-3535-4111-8111-000000000006] as well');
reset role;

-- The held room, held.
update public.conversations set legal_hold = true where id = 'c5c5c5c5-3535-4111-8111-000000000002';


-- =============================================================================
-- A. Shape and privileges
-- =============================================================================
select has_function('public', 'is_super_user', 'is_super_user() exists');
select has_function('public', 'purge_message', array['uuid', 'text'], 'purge_message(uuid, text) exists');
select has_function('public', 'purge_person',  array['uuid', 'text'], 'purge_person(uuid, text) exists');
select ok(
  not has_function_privilege('anon', 'public.purge_person(uuid, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.purge_message(uuid, text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.purge_person(uuid, text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.purge_message(uuid, text)', 'EXECUTE'),
  'anon holds no key; a signed-in caller does, and the function''s own check is the gate');
-- SG-2's privilege layer is exactly as it was: nothing here relaxed a grant.
select ok(not bool_or(has_table_privilege(r, t, 'DELETE')), 'DELETE is still revoked from every API role on the guarded tables')
from unnest(array['anon', 'authenticated', 'service_role']) r,
     unnest(array['public.messages', 'public.people', 'public.conversation_participants',
                  'public.message_attachments', 'public.audit_log']) t;


-- =============================================================================
-- B. is_super_user()
-- =============================================================================
set local request.jwt.claims to '{"sub":"5b5b5b5b-3535-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select ok(public.is_super_user(), 'the super user is one');
reset role;

set local request.jwt.claims to '{"sub":"5b5b5b5b-3535-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select ok(not public.is_super_user(), 'a committee / club_admin sign-in is NOT a super user');


-- =============================================================================
-- C. A club_admin is refused both doors
-- =============================================================================
-- (still Ada Admin, from B)
select throws_ok(
  $$select public.purge_message('d5d5d5d5-3535-4111-8111-000000000003', 'tidying up')$$,
  '42501', null, 'a club_admin cannot purge a message');
select throws_ok(
  $$select public.purge_person(current_setting('sp.alf')::uuid, 'tidying up')$$,
  '42501', null, 'a club_admin cannot purge a person');
reset role;


-- =============================================================================
-- D. purge_message refuses, by name
-- =============================================================================
set local request.jwt.claims to '{"sub":"5b5b5b5b-3535-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;

select is((select count(*) from public.read_concerns(null, current_setting('sp.ref_msg'))), 0::bigint,
  'the concern citing the message is invisible to this caller''s own reads (SG-3)');
select throws_ok(
  $$select public.purge_message('d5d5d5d5-3535-4111-8111-000000000002', 'clearing out a mistake')$$,
  'P0001', null, 'a message cited by a safeguarding concern is refused even so');
select throws_ok(
  $$select public.purge_message('d5d5d5d5-3535-4111-8111-000000000006', 'clearing out a mistake')$$,
  'P0001', null, 'a message cited in a note on a concern is refused');
select throws_ok(
  $$select public.purge_message('d5d5d5d5-3535-4111-8111-000000000004', 'clearing out a mistake')$$,
  'P0001', null, 'a message in a conversation under a legal hold is refused');
select throws_ok(
  $$select public.purge_message('d5d5d5d5-3535-4111-8111-000000000005', 'clearing out a mistake')$$,
  'P0001', null, 'a message whose author is under a legal hold is refused');
select throws_ok(
  $$select public.purge_message('d5d5d5d5-3535-4111-8111-000000000001', '   ')$$,
  '22023', null, 'a purge with no reason is refused: the reason is the audit row');
-- Counted as the OWNER, not as the caller: `messages` RLS is participant-scoped,
-- and the super user is deliberately not a participant of the held room, so her
-- own client cannot see the message she was just refused. The question here is
-- what the TABLE holds after five refusals, which is the owner's answer.
reset role;
select is(
  (select count(*) from public.messages
    where id between 'd5d5d5d5-3535-4111-8111-000000000001' and 'd5d5d5d5-3535-4111-8111-000000000006'),
  6::bigint, 'nothing has been destroyed yet — every refusal refused');


-- =============================================================================
-- E. A super user purges an ordinary message
-- =============================================================================
-- `reset role` above left the previous claims in place; set them again anyway,
-- because relying on that is how a test starts asserting the wrong caller.
set local request.jwt.claims to '{"sub":"5b5b5b5b-3535-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$select public.purge_message('d5d5d5d5-3535-4111-8111-000000000001', 'duplicate test account, cleared at the owner''s request')$$,
  'the super user purges an ordinary message');
reset role;

select is((select count(*) from public.messages where id = 'd5d5d5d5-3535-4111-8111-000000000001'), 0::bigint,
  'the message row is gone — a hard delete, not a tombstone');
select is((select count(*) from public.message_attachments where message_id = 'd5d5d5d5-3535-4111-8111-000000000001'), 0::bigint,
  'its attachment row went with it');
select is((select count(*) from public.message_reactions where message_id = 'd5d5d5d5-3535-4111-8111-000000000001'), 0::bigint,
  'its reactions went with it');
select is((select count(*) from public.message_mentions where message_id = 'd5d5d5d5-3535-4111-8111-000000000001'), 0::bigint,
  'its mentions went with it');
select is((select count(*) from public.messages where id = 'd5d5d5d5-3535-4111-8111-000000000002'), 1::bigint,
  'the other member''s message is exactly where it was');

select is(
  (select a.detail ->> 'reason' from public.audit_log a
    where a.action = 'messages.purged' and a.entity_id = 'd5d5d5d5-3535-4111-8111-000000000001'),
  'duplicate test account, cleared at the owner''s request',
  'the audit row carries the reason');
select is(
  (select a.actor_email from public.audit_log a
    where a.action = 'messages.purged' and a.entity_id = 'd5d5d5d5-3535-4111-8111-000000000001'),
  'sp-super@test.invalid',
  'the audit row names the actor');
select ok(
  not exists (select 1 from public.audit_log a
               where a.action = 'messages.purged' and a.detail::text like '%ALF-PURGEABLE-BODY%'),
  'the audit row does NOT carry the body (SG-7)');
select is(
  (select a.detail ->> 'conversation_id' from public.audit_log a
    where a.action = 'messages.purged' and a.entity_id = 'd5d5d5d5-3535-4111-8111-000000000001'),
  'c5c5c5c5-3535-4111-8111-000000000001',
  'the audit row names the conversation');


-- =============================================================================
-- F. purge_person refuses, by name
-- =============================================================================
set local request.jwt.claims to '{"sub":"5b5b5b5b-3535-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  $$select public.purge_person(current_setting('sp.holly')::uuid, 'clearing out a mistake')$$,
  'P0001', null, 'a person under a legal hold is refused');
select throws_ok(
  $$select public.purge_person('5c5c5c5c-3535-4111-8111-000000000001'::uuid, 'erasure request')$$,
  'P0001', null, 'the subject of a safeguarding concern is refused');
select throws_ok(
  $$select public.purge_person(current_setting('sp.bea')::uuid, 'erasure request')$$,
  'P0001', null, 'the person who reported a concern is refused');
select throws_ok(
  $$select public.purge_person('5c5c5c5c-3535-4111-8111-000000000002'::uuid, 'erasure request')$$,
  'P0001', null, 'someone in a conversation under a legal hold is refused');
select throws_ok(
  $$select public.purge_person(current_setting('sp.super')::uuid, 'erasure request')$$,
  'P0001', null, 'the caller cannot purge themselves');
select throws_ok(
  $$select public.purge_person(current_setting('sp.alf')::uuid, '')$$,
  '22023', null, 'a person purge with no reason is refused');


-- =============================================================================
-- G. A super user purges an ordinary person
-- =============================================================================
select set_config('sp.summary',
  (select public.purge_person(current_setting('sp.alf')::uuid, 'test account created by mistake')::text), true);
reset role;

select is((select count(*) from public.people where id = current_setting('sp.alf')::uuid), 0::bigint,
  'the person row is gone');
select is((select count(*) from public.profiles where person_id = current_setting('sp.alf')::uuid), 0::bigint,
  'their profile row is gone (the web layer then deletes the auth user)');
select is((select count(*) from public.team_memberships where person_id = current_setting('sp.alf')::uuid), 0::bigint,
  'their team membership is gone');
select is((select count(*) from public.registrations where person_id = current_setting('sp.alf')::uuid), 0::bigint,
  'their registration is gone');
select is((select count(*) from public.messages where sender_person_id = current_setting('sp.alf')::uuid), 0::bigint,
  'their remaining message is gone');
select is((select count(*) from public.emergency_contacts where person_id = current_setting('sp.alf')::uuid), 0::bigint,
  'their emergency contact is gone');

select is((select count(*) from public.team_memberships where person_id = current_setting('sp.bea')::uuid), 1::bigint,
  'the other member''s team membership is untouched');
select is((select count(*) from public.registrations where person_id = current_setting('sp.bea')::uuid), 1::bigint,
  'the other member''s registration is untouched');
select is((select count(*) from public.emergency_contacts where person_id = current_setting('sp.bea')::uuid), 1::bigint,
  'the other member''s emergency contact is untouched');
select is((select count(*) from public.messages where sender_person_id = current_setting('sp.bea')::uuid), 3::bigint,
  'the other member''s messages are all still there');

select ok(
  (current_setting('sp.summary')::jsonb -> 'deleted') ? 'team_memberships'
  and (current_setting('sp.summary')::jsonb -> 'deleted') ? 'registrations'
  and (current_setting('sp.summary')::jsonb -> 'deleted') ? 'messages',
  'the summary says what was removed, table by table');
select is(current_setting('sp.summary')::jsonb ->> 'reason', 'test account created by mistake',
  'the summary carries the reason back to the screen');

select is(
  (select a.detail ->> 'reason' from public.audit_log a
    where a.action = 'people.purged' and a.entity_id = current_setting('sp.alf')::text),
  'test account created by mistake',
  'the people.purged audit row carries the reason');
select is((select count(*) from public.audit_log a where a.action = 'messages.purged'), 1::bigint,
  'the earlier purge''s audit row survived the person purge — audit_log is never on the allowlist');


-- =============================================================================
-- H. The SG-2 guard is otherwise exactly as it was
-- =============================================================================
-- Run as the table OWNER, which is the run that matters: it proves the trigger,
-- not the grant, is doing the work.
select throws_ok(
  $$delete from public.messages where id = 'd5d5d5d5-3535-4111-8111-000000000002'$$,
  'P0001', null, 'a plain hard delete of a message still throws for the owner');
select throws_ok(
  $$delete from public.audit_log where action = 'messages.purged'$$,
  'P0001', null, 'audit rows still cannot be deleted by anybody');

-- A forged ticket buys nothing: it must be the id of an audit row written in
-- this transaction with a purge action.
select set_config('app.purge_ticket', '999999999', true);
select throws_ok(
  $$delete from public.messages where id = 'd5d5d5d5-3535-4111-8111-000000000002'$$,
  'P0001', null, 'a made-up ticket does not open the door');
-- Even a REAL purge ticket cannot reach audit_log: it is not on the allowlist.
select set_config('app.purge_ticket',
  (select a.id::text from public.audit_log a where a.action = 'people.purged' order by a.id desc limit 1), true);
select throws_ok(
  $$delete from public.audit_log where action = 'people.purged'$$,
  'P0001', null, 'a real ticket still cannot destroy the trail it wrote');
select set_config('app.purge_ticket', '', true);

select * from finish();
rollback;
