-- =============================================================================
-- "This player has left" is a request; End stays club_admin-only (20260825270000)
-- =============================================================================
-- Adam, 2026-08-25: "Parents and coaches should not be able to click on End to
-- remove a squad member (in Squad in team page). Coaches should be able to
-- click 'This player has left' and it will go to approval for admin."
--
--   A  shape: the table, its RLS, the RPC and the three triggers
--   B  who may end a membership directly — a coach's and a parent's UPDATE
--      touch NOTHING (the admin-only UPDATE policy filters the row out, so it
--      is a silent no-op, not an error); an administrator's works
--   C  a coach files a request, and the request is derived from the
--      membership — a forged person_id / team_id / status is overwritten
--   D  a parent cannot file one; a stranger cannot read one
--   E  the request reaches every live club_admin in-app, once, with no email,
--      and never the person who asked
--   F  a coach cannot decide; only a club_admin can (42501)
--   G  an approval ends the membership, writes the audit row, and tells the
--      coach; a rejection leaves the membership alone
--   H  a decided request cannot be decided twice, and nobody can UPDATE the
--      request row directly
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(50);

-- Fixtures ---------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('a9a9a9a9-9999-4111-8111-000000000001', 'lr-admin@test.invalid',  '{"full_name": "Ada Admin"}'::jsonb),
  ('a9a9a9a9-9999-4111-8111-000000000002', 'lr-coach@test.invalid',  '{"full_name": "Cy Coach"}'::jsonb),
  ('a9a9a9a9-9999-4111-8111-000000000003', 'lr-parent@test.invalid', '{"full_name": "Pat Parent"}'::jsonb),
  ('a9a9a9a9-9999-4111-8111-000000000004', 'lr-other@test.invalid',  '{"full_name": "Ollie Other"}'::jsonb),
  ('a9a9a9a9-9999-4111-8111-000000000005', 'lr-admin2@test.invalid', '{"full_name": "Bea Admin"}'::jsonb);
update public.profiles set role = 'committee'
 where id in ('a9a9a9a9-9999-4111-8111-000000000001', 'a9a9a9a9-9999-4111-8111-000000000005');
select set_config('lr.admin',  (select person_id::text from public.profiles where id = 'a9a9a9a9-9999-4111-8111-000000000001'), true);
select set_config('lr.coach',  (select person_id::text from public.profiles where id = 'a9a9a9a9-9999-4111-8111-000000000002'), true);
select set_config('lr.parent', (select person_id::text from public.profiles where id = 'a9a9a9a9-9999-4111-8111-000000000003'), true);
select set_config('lr.other',  (select person_id::text from public.profiles where id = 'a9a9a9a9-9999-4111-8111-000000000004'), true);
select set_config('lr.admin2', (select person_id::text from public.profiles where id = 'a9a9a9a9-9999-4111-8111-000000000005'), true);
-- SG-0: an unknown date of birth counts as a minor, so every adult gets one.
update public.people set dob = '1985-05-05'
 where id in (current_setting('lr.admin')::uuid, current_setting('lr.coach')::uuid,
              current_setting('lr.parent')::uuid, current_setting('lr.other')::uuid,
              current_setting('lr.admin2')::uuid);
-- The coach's SG-6 paperwork, so the team may hold minors without the guard
-- refusing anything this test does.
insert into public.certifications (person_id, type, expires_on, verified_at) values
  (current_setting('lr.coach')::uuid, 'fa_dbs', current_date + 300, now()),
  (current_setting('lr.coach')::uuid, 'safeguarding_children', current_date + 300, now());

-- Two players: one the coach reports as having left, one for the reject path.
-- SG-1: a team conversation may not hold exactly one adult and one minor with
-- no guardian in it, and `team_memberships_sync_conversations` puts every new
-- member into one. So each team gets a SECOND ADULT before any minor joins —
-- the same shape `match_stats.test.sql` uses, and the reason team 2's player
-- is an adult rather than another child.
insert into public.people (id, first_name, last_name, dob) values
  ('c9c9c9c9-9999-4111-8111-000000000001', 'Kid',   'Leaver',    current_date - interval '12 years'),
  ('c9c9c9c9-9999-4111-8111-000000000002', 'Kid',   'Stayer',    current_date - interval '12 years'),
  ('c9c9c9c9-9999-4111-8111-000000000003', 'Alex',  'Elsewhere', '1990-03-03'),
  ('c9c9c9c9-9999-4111-8111-000000000004', 'Sam',   'Senior',    '1991-04-04');
insert into public.guardianships (guardian_person_id, child_person_id, relationship) values
  (current_setting('lr.parent')::uuid, 'c9c9c9c9-9999-4111-8111-000000000001', 'parent'),
  (current_setting('lr.parent')::uuid, 'c9c9c9c9-9999-4111-8111-000000000002', 'parent');

insert into public.seasons (id, name, starts_on, ends_on) values
  ('5a5a5a5a-9999-4111-8111-000000000001', 'LR 2035/36', '2035-08-01', '2036-05-31');
insert into public.teams (id, name, age_group) values
  ('7a7a7a7a-9999-4111-8111-000000000001', 'LR U13s',  'U13'),
  ('7a7a7a7a-9999-4111-8111-000000000002', 'LR Other', 'U13');
insert into public.team_memberships (id, person_id, team_id, season_id, role) values
  ('b9b9b9b9-9999-4111-8111-000000000001', current_setting('lr.coach')::uuid,
   '7a7a7a7a-9999-4111-8111-000000000001', '5a5a5a5a-9999-4111-8111-000000000001', 'coach'),
  -- The second adult on team 1, ahead of the two children (SG-1, above).
  ('b9b9b9b9-9999-4111-8111-000000000006', 'c9c9c9c9-9999-4111-8111-000000000004',
   '7a7a7a7a-9999-4111-8111-000000000001', '5a5a5a5a-9999-4111-8111-000000000001', 'player'),
  ('b9b9b9b9-9999-4111-8111-000000000002', 'c9c9c9c9-9999-4111-8111-000000000001',
   '7a7a7a7a-9999-4111-8111-000000000001', '5a5a5a5a-9999-4111-8111-000000000001', 'player'),
  ('b9b9b9b9-9999-4111-8111-000000000003', 'c9c9c9c9-9999-4111-8111-000000000002',
   '7a7a7a7a-9999-4111-8111-000000000001', '5a5a5a5a-9999-4111-8111-000000000001', 'player'),
  ('b9b9b9b9-9999-4111-8111-000000000004', current_setting('lr.other')::uuid,
   '7a7a7a7a-9999-4111-8111-000000000002', '5a5a5a5a-9999-4111-8111-000000000001', 'player'),
  -- Still live, on the team the coach does NOT staff: the row section C uses
  -- to prove that "not my team" is refused by the POLICY (42501) rather than
  -- by the trigger's already-ended check.
  ('b9b9b9b9-9999-4111-8111-000000000005', 'c9c9c9c9-9999-4111-8111-000000000003',
   '7a7a7a7a-9999-4111-8111-000000000002', '5a5a5a5a-9999-4111-8111-000000000001', 'player');


-- =============================================================================
-- A. shape
-- =============================================================================
select has_table('public', 'team_membership_leave_requests', 'team_membership_leave_requests');
select has_function('public', 'decide_leave_request', 'decide_leave_request()');
select is((select relrowsecurity from pg_class
            where oid = 'public.team_membership_leave_requests'::regclass), true,
  'RLS is on the new table (PLAN.md §2.2)');
select trigger_is('public', 'team_membership_leave_requests', 'trg_leave_request_fill',
  'public', 'leave_request_fill', 'the request is derived before it is stored');
select trigger_is('public', 'team_membership_leave_requests', 'trg_leave_request_notify',
  'public', 'leave_request_notify', 'a new request runs the notifier');
select trigger_is('public', 'team_memberships', 'trg_leave_requests_guard',
  'public', 'leave_requests_guard', 'the left_at guard stands behind the policy');
-- The decision has no policy to go round: there is no UPDATE or DELETE policy
-- on the table at all, so `decide_leave_request()` is the only way in.
select is((select count(*) from pg_policies
            where schemaname = 'public' and tablename = 'team_membership_leave_requests'
              and cmd in ('UPDATE', 'DELETE')), 0::bigint,
  'no UPDATE or DELETE policy exists — a decision is the RPC and nothing else');


-- =============================================================================
-- B. ending a membership directly is a club administrator's alone
-- =============================================================================
-- This is what was already true before this migration, asserted so it stays
-- true: the coach's UPDATE matches no row of `team_memberships_admin_update`,
-- so it is filtered out during the scan. Postgres raises nothing — it simply
-- changes nothing, which is why the screen had to stop claiming it worked.
set local request.jwt.claims to '{"sub":"a9a9a9a9-9999-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;

select lives_ok($$
  update public.team_memberships set left_at = now()
   where id = 'b9b9b9b9-9999-4111-8111-000000000002'
$$, 'a coach''s "end this membership" raises nothing');
select is((select left_at from public.team_memberships
            where id = 'b9b9b9b9-9999-4111-8111-000000000002'), null,
  'and it changed nothing — the coach cannot end a membership');
reset role;

set local request.jwt.claims to '{"sub":"a9a9a9a9-9999-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select lives_ok($$
  update public.team_memberships set left_at = now()
   where id = 'b9b9b9b9-9999-4111-8111-000000000002'
$$, 'a parent''s attempt raises nothing either');
select is((select left_at from public.team_memberships
            where id = 'b9b9b9b9-9999-4111-8111-000000000002'), null,
  'and a parent cannot end their child''s membership');
reset role;

-- An administrator can, and on a membership this test does not need again.
set local request.jwt.claims to '{"sub":"a9a9a9a9-9999-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok($$
  update public.team_memberships set left_at = now()
   where id = 'b9b9b9b9-9999-4111-8111-000000000004' and left_at is null
$$, 'a club administrator ends a membership directly, as before');
select isnt((select left_at from public.team_memberships
              where id = 'b9b9b9b9-9999-4111-8111-000000000004'), null,
  'and the membership is ended — this migration takes nothing away from an admin');
reset role;


-- =============================================================================
-- C. the coach asks, and the request is derived from the membership
-- =============================================================================
set local request.jwt.claims to '{"sub":"a9a9a9a9-9999-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;

-- Deliberately forged: the wrong person, the wrong team, and a status the
-- client would love to post. All three are overwritten by the BEFORE trigger.
select lives_ok($$
  insert into public.team_membership_leave_requests
    (id, team_membership_id, person_id, team_id, status, note)
  values ('e9e9e9e9-9999-4111-8111-000000000001', 'b9b9b9b9-9999-4111-8111-000000000002',
          'c9c9c9c9-9999-4111-8111-000000000002', '7a7a7a7a-9999-4111-8111-000000000002',
          'approved', '  Moved to another club  ')
$$, 'a coach of the team files "this player has left"');

select is((select status from public.team_membership_leave_requests
            where id = 'e9e9e9e9-9999-4111-8111-000000000001'), 'pending',
  'a posted "approved" is stored pending — the client cannot approve its own request');
select is((select person_id from public.team_membership_leave_requests
            where id = 'e9e9e9e9-9999-4111-8111-000000000001'),
  'c9c9c9c9-9999-4111-8111-000000000001'::uuid,
  'the person comes from the membership, not from the client');
select is((select team_id from public.team_membership_leave_requests
            where id = 'e9e9e9e9-9999-4111-8111-000000000001'),
  '7a7a7a7a-9999-4111-8111-000000000001'::uuid,
  'and so does the team — a forged team_id cannot dodge the insert policy');
select is((select requested_by_person_id from public.team_membership_leave_requests
            where id = 'e9e9e9e9-9999-4111-8111-000000000001'),
  current_setting('lr.coach')::uuid, 'the requester is stamped from the session');
select is((select note from public.team_membership_leave_requests
            where id = 'e9e9e9e9-9999-4111-8111-000000000001'), 'Moved to another club',
  'the note is kept, trimmed');

-- A coach of ANOTHER team is not this team's staff.
select throws_ok($$
  insert into public.team_membership_leave_requests (team_membership_id)
  values ('b9b9b9b9-9999-4111-8111-000000000005')
$$, '42501', null, 'a coach cannot file a request against a team they do not staff');

-- One open request per membership; asking twice is the same ask.
select throws_ok($$
  insert into public.team_membership_leave_requests (team_membership_id)
  values ('b9b9b9b9-9999-4111-8111-000000000002')
$$, '23505', null, 'a second pending request for the same membership is refused');
reset role;


-- =============================================================================
-- D. a parent cannot ask, and a stranger cannot look
-- =============================================================================
set local request.jwt.claims to '{"sub":"a9a9a9a9-9999-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select throws_ok($$
  insert into public.team_membership_leave_requests (team_membership_id)
  values ('b9b9b9b9-9999-4111-8111-000000000003')
$$, '42501', null, 'a parent cannot report that a player has left');
select is((select count(*) from public.team_membership_leave_requests), 0::bigint,
  'and a parent sees no leave requests at all');
reset role;

set local request.jwt.claims to '{"sub":"a9a9a9a9-9999-4111-8111-000000000004","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.team_membership_leave_requests), 0::bigint,
  'a stranger reads nothing');
reset role;

set local request.jwt.claims to '{"sub":"a9a9a9a9-9999-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.team_membership_leave_requests), 1::bigint,
  'the coach who asked sees their own request');
reset role;

set local request.jwt.claims to '{"sub":"a9a9a9a9-9999-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.team_membership_leave_requests), 1::bigint,
  'a club administrator sees it on the queue');
reset role;


-- =============================================================================
-- E. the desk is told, in-app, once, and never the person who asked
-- =============================================================================
select is((select (subject, link, channel::text, entity) from public.outbound_messages
            where entity = 'leave_requests'
              and person_id = current_setting('lr.admin')::uuid),
  ('Squad change: LR U13s'::text, '/approvals'::text, 'in_app'::text, 'leave_requests'::text),
  'the request reaches a club administrator in-app, pointing at Approvals');

select is((select count(*) from public.outbound_messages
            where entity = 'leave_requests' and person_id = current_setting('lr.admin2')::uuid),
  1::bigint, 'every live club_admin is told, once');

select is((select count(*) from public.outbound_messages
            where entity = 'leave_requests' and channel <> 'in_app'), 0::bigint,
  'no email and no SMS — a leave request is in-app only (Adam''s rule)');

select is((select count(*) from public.outbound_messages
            where entity = 'leave_requests' and person_id = current_setting('lr.coach')::uuid),
  0::bigint, 'the coach is not notified of their own request');

select ok((select body like '%Kid Leaver%' from public.outbound_messages
            where entity = 'leave_requests' and person_id = current_setting('lr.admin')::uuid),
  'and the message names the player');


-- =============================================================================
-- F. only a club administrator decides
-- =============================================================================
set local request.jwt.claims to '{"sub":"a9a9a9a9-9999-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_ok($$
  select public.decide_leave_request('e9e9e9e9-9999-4111-8111-000000000001', true, null)
$$, '42501', null, 'a coach cannot approve their own request');
select is((select left_at from public.team_memberships
            where id = 'b9b9b9b9-9999-4111-8111-000000000002'), null,
  'and the membership is untouched by the attempt');
reset role;

set local request.jwt.claims to '{"sub":"a9a9a9a9-9999-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select throws_ok($$
  select public.decide_leave_request('e9e9e9e9-9999-4111-8111-000000000001', true, null)
$$, '42501', null, 'nor can a parent');
reset role;


-- =============================================================================
-- G. the administrator's decision
-- =============================================================================
set local request.jwt.claims to '{"sub":"a9a9a9a9-9999-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;

select is((select outcome from public.decide_leave_request(
            'e9e9e9e9-9999-4111-8111-000000000001', true, 'Confirmed with the family')),
  'approved', 'a club administrator approves it');

select isnt((select left_at from public.team_memberships
              where id = 'b9b9b9b9-9999-4111-8111-000000000002'), null,
  'and THE MEMBERSHIP ENDS — left_at is set, the row is kept as history');

select is((select status from public.team_membership_leave_requests
            where id = 'e9e9e9e9-9999-4111-8111-000000000001'), 'approved',
  'the request is marked approved');
select isnt((select decided_at from public.team_membership_leave_requests
              where id = 'e9e9e9e9-9999-4111-8111-000000000001'), null,
  'with the moment it was decided');
select is((select decision_note from public.team_membership_leave_requests
            where id = 'e9e9e9e9-9999-4111-8111-000000000001'), 'Confirmed with the family',
  'and the administrator''s note');

-- Deciding twice is not a second decision.
select is((select outcome from public.decide_leave_request(
            'e9e9e9e9-9999-4111-8111-000000000001', false, null)),
  'already_decided', 'a decided request cannot be decided again');
select is((select status from public.team_membership_leave_requests
            where id = 'e9e9e9e9-9999-4111-8111-000000000001'), 'approved',
  'and the first decision stands');

-- Not even an administrator writes the row by hand: `authenticated` holds no
-- UPDATE privilege on the table and there is no UPDATE policy behind it.
select throws_ok($$
  update public.team_membership_leave_requests set status = 'rejected'
   where id = 'e9e9e9e9-9999-4111-8111-000000000001'
$$, '42501', null, 'a direct UPDATE is refused outright, even to an administrator');
select is((select status from public.team_membership_leave_requests
            where id = 'e9e9e9e9-9999-4111-8111-000000000001'), 'approved',
  'and the status is untouched — the RPC is the only way it moves');
reset role;

select is((select count(*) from public.audit_log
            where action = 'team_membership_leave_request.approve'
              and entity = 'team_membership_leave_requests'
              and entity_id = 'e9e9e9e9-9999-4111-8111-000000000001'), 1::bigint,
  'the approval is in the audit log');

select is((select count(*) from public.outbound_messages
            where entity = 'leave_requests' and person_id = current_setting('lr.coach')::uuid
              and subject = 'Squad change approved'), 1::bigint,
  'and the coach who asked is told the answer');


-- =============================================================================
-- H. the reject path leaves the squad alone
-- =============================================================================
set local request.jwt.claims to '{"sub":"a9a9a9a9-9999-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select lives_ok($$
  insert into public.team_membership_leave_requests (id, team_membership_id, note)
  values ('e9e9e9e9-9999-4111-8111-000000000002', 'b9b9b9b9-9999-4111-8111-000000000003',
          'Think they have stopped coming')
$$, 'the coach reports a second player');
reset role;

set local request.jwt.claims to '{"sub":"a9a9a9a9-9999-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select outcome from public.decide_leave_request(
            'e9e9e9e9-9999-4111-8111-000000000002', false, 'Spoke to them — still playing')),
  'rejected', 'the administrator rejects it');
select is((select left_at from public.team_memberships
            where id = 'b9b9b9b9-9999-4111-8111-000000000003'), null,
  'and the player is STILL IN THE SQUAD — a rejection changes no membership');
reset role;

select is((select count(*) from public.audit_log
            where action = 'team_membership_leave_request.reject'
              and entity_id = 'e9e9e9e9-9999-4111-8111-000000000002'), 1::bigint,
  'the rejection is audited too');

-- A membership that has already ended cannot be reported as having left.
set local request.jwt.claims to '{"sub":"a9a9a9a9-9999-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_ok($$
  insert into public.team_membership_leave_requests (team_membership_id)
  values ('b9b9b9b9-9999-4111-8111-000000000002')
$$, 'P0001', null, 'a membership that has already ended cannot be reported again');
reset role;

select * from finish();
rollback;
