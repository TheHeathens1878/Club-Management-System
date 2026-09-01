-- =============================================================================
-- Gap 4 — self-registration + approval queue (20260824150000)
-- =============================================================================
--   A  sign-up metadata: dob/phone land on people; an under-age sign-up is
--      refused by SG-10 (the profile insert aborts the auth.users insert)
--   B  a signed-in person can open a request for themselves, not for others;
--      one open request per (person, role, team)
--   C  approve: coach → team membership + coach app role; parent → parent
--      role; SG-6 refusal leaves the request pending with the reason; reject
--   D  only club_admin decides; audit rows written
--   E  data fix: imported training rows carry kind training
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(21);

-- SG-6 tier-1 enforcement is OFF in production (FA Clubs Portal is the record;
-- see the 2026-08-23 amendment in SAFEGUARDING.md). These tests exercise the
-- machinery, so they run with the switch on.
update public.site_settings set value = '1' where key = 'safeguarding.sg6_enforcement';

-- A. sign-up ----------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('c9c9c9c9-1111-4111-8111-000000000001', 'ar-admin@test.invalid', '{"full_name": "Ada Admin"}'::jsonb),
  ('c9c9c9c9-1111-4111-8111-000000000002', 'ar-coach@test.invalid', '{"full_name": "Cy Coach", "dob": "1985-03-04", "phone": "07700 900000"}'::jsonb),
  ('c9c9c9c9-1111-4111-8111-000000000003', 'ar-parent@test.invalid', '{"full_name": "Pat Parent", "dob": "1979-12-31"}'::jsonb);
update public.profiles set role = 'committee' where id = 'c9c9c9c9-1111-4111-8111-000000000001';
select set_config('ar.admin',  (select person_id::text from public.profiles where id = 'c9c9c9c9-1111-4111-8111-000000000001'), true);
select set_config('ar.coach',  (select person_id::text from public.profiles where id = 'c9c9c9c9-1111-4111-8111-000000000002'), true);
select set_config('ar.parent', (select person_id::text from public.profiles where id = 'c9c9c9c9-1111-4111-8111-000000000003'), true);

select is((select (dob::text, phone) from public.people where id = current_setting('ar.coach')::uuid),
  ('1985-03-04'::text, '07700 900000'::text), 'sign-up dob and phone land on the person');

select throws_like($$
  insert into auth.users (id, email, raw_user_meta_data) values
    ('c9c9c9c9-1111-4111-8111-000000000009', 'ar-kid@test.invalid',
     jsonb_build_object('full_name', 'Kid Signup', 'dob', (current_date - interval '10 years')::date::text))
$$, '%SG-10%', 'an under-age self sign-up is refused by SG-10');

-- B. opening a request --------------------------------------------------------------
insert into public.seasons (id, name, starts_on, ends_on, is_current) values ('5d5d5d5d-1111-4111-8111-000000000001', 'AR 2034/35', '2034-08-01', '2035-05-31', true);
insert into public.teams (id, name) values ('7d7d7d7d-1111-4111-8111-000000000001', 'AR U12s'), ('7d7d7d7d-1111-4111-8111-000000000002', 'AR U13s');

set local request.jwt.claims to '{"sub":"c9c9c9c9-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select lives_ok($$
  insert into public.account_requests (id, person_id, requested_role, team_id, message)
  values ('a9a9a9a9-1111-4111-8111-000000000001', current_setting('ar.coach')::uuid, 'coach', '7d7d7d7d-1111-4111-8111-000000000001', 'I coach the U12s')
$$, 'a person opens a coach request for themselves');
select throws_ok($$
  insert into public.account_requests (person_id, requested_role, team_id)
  values (current_setting('ar.parent')::uuid, 'coach', '7d7d7d7d-1111-4111-8111-000000000001')
$$, '42501', null, 'cannot open a request for someone else');
select throws_ok($$
  insert into public.account_requests (person_id, requested_role, team_id)
  values (current_setting('ar.coach')::uuid, 'coach', '7d7d7d7d-1111-4111-8111-000000000001')
$$, '23505', null, 'one open request per person/role/team');
-- 'manager', not 'coach': 20260901200000 lets "I coach" be said on the joining
-- form before the club has placed anybody, so a team-less coach request is now
-- allowed and approving it grants the club-wide hat alone. Assistant coach and
-- manager are still said about a squad, and the CHECK still says so.
select throws_ok($$
  insert into public.account_requests (person_id, requested_role)
  values (current_setting('ar.coach')::uuid, 'manager')
$$, '23514', null, 'a team role needs a team');
select throws_ok($$ select public.approve_account_request('a9a9a9a9-1111-4111-8111-000000000001') $$,
  '42501', null, 'a non-admin cannot approve');
reset role;

set local request.jwt.claims to '{"sub":"c9c9c9c9-1111-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
insert into public.account_requests (id, person_id, requested_role)
values ('a9a9a9a9-1111-4111-8111-000000000002', current_setting('ar.parent')::uuid, 'parent');
select is((select count(*) from public.account_requests), 1::bigint, 'a person sees only their own requests');
reset role;

-- C. decisions ------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"c9c9c9c9-1111-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.account_requests), 2::bigint, 'admin sees every request');

select is((select outcome from public.approve_account_request('a9a9a9a9-1111-4111-8111-000000000001', 'welcome')),
  'approved', 'coach request approved (team has no minors, so no certificate needed)');
select is((select (status::text, decision_note) from public.account_requests where id = 'a9a9a9a9-1111-4111-8111-000000000001'),
  ('approved'::text, 'welcome'::text), 'request marked approved with the note');
select is((select count(*) from public.team_memberships
            where person_id = current_setting('ar.coach')::uuid and team_id = '7d7d7d7d-1111-4111-8111-000000000001'
              and role = 'coach' and left_at is null), 1::bigint, 'approval created the coach membership');
select is((select count(*) from public.person_roles
            where person_id = current_setting('ar.coach')::uuid and role = 'coach' and revoked_at is null), 1::bigint,
  'approval granted the coach app role');
select is((select outcome from public.approve_account_request('a9a9a9a9-1111-4111-8111-000000000001')),
  'already_decided', 'approving twice is a no-op');

select is((select outcome from public.approve_account_request('a9a9a9a9-1111-4111-8111-000000000002')),
  'approved', 'parent request approved');
select is((select count(*) from public.person_roles
            where person_id = current_setting('ar.parent')::uuid and role = 'parent' and revoked_at is null), 1::bigint,
  'approval granted the parent role');
reset role;

-- SG-6: a coach request on a team with a minor, no certificates → blocked, stays pending
insert into public.people (id, first_name, last_name, dob) values ('9d9d9d9d-1111-4111-8111-000000000001', 'Min', 'Or', '2024-01-01');
insert into public.team_memberships (person_id, team_id, season_id, role)
values ('9d9d9d9d-1111-4111-8111-000000000001', '7d7d7d7d-1111-4111-8111-000000000002', '5d5d5d5d-1111-4111-8111-000000000001', 'player');
insert into public.account_requests (id, person_id, requested_role, team_id)
values ('a9a9a9a9-1111-4111-8111-000000000003', current_setting('ar.parent')::uuid, 'coach', '7d7d7d7d-1111-4111-8111-000000000002');

set local request.jwt.claims to '{"sub":"c9c9c9c9-1111-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select outcome from public.approve_account_request('a9a9a9a9-1111-4111-8111-000000000003')),
  'blocked', 'SG-6 refusal is reported, not raised');
select is((select (status::text, decision_note like '%SG-6%') from public.account_requests where id = 'a9a9a9a9-1111-4111-8111-000000000003'),
  ('pending'::text, true), 'blocked request stays pending with the SG-6 reason recorded');
select lives_ok($$ select public.reject_account_request('a9a9a9a9-1111-4111-8111-000000000003', 'no DBS yet') $$, 'admin rejects');
select is((select status::text from public.account_requests where id = 'a9a9a9a9-1111-4111-8111-000000000003'), 'rejected', 'rejected');
reset role;

-- D. audit ------------------------------------------------------------------------------
select is((select count(*) from public.audit_log where action in ('account_request.approve', 'account_request.reject')
            and entity_id in ('a9a9a9a9-1111-4111-8111-000000000001', 'a9a9a9a9-1111-4111-8111-000000000002', 'a9a9a9a9-1111-4111-8111-000000000003')),
  3::bigint, 'every decision is audited');

select * from finish();
rollback;
