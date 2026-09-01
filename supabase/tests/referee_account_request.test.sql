-- =============================================================================
-- Registering as a referee (20260901130000)
-- =============================================================================
--   A  'referee' is a role somebody may ask for, and it needs no team
--   B  a coaching role still needs one
--   C  the sign-up itself opens the request when ?as=referee sent it
--   D  and only for 'referee' — anything else in the metadata is ignored
--   E  approving grants person_roles.referee; only a club admin may approve
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(9);

insert into auth.users (id, email, raw_user_meta_data) values
  ('4e4e4e4e-1111-4111-8111-000000000001', 'rf-admin@test.invalid',
   '{"first_name": "Ada", "last_name": "Admin", "dob": "1970-01-01"}'::jsonb),
  ('4e4e4e4e-1111-4111-8111-000000000002', 'rf-ref@test.invalid',
   '{"first_name": "Rita", "last_name": "Ref", "dob": "1990-06-06"}'::jsonb);
update public.profiles set role = 'committee' where id = '4e4e4e4e-1111-4111-8111-000000000001';
select set_config('rf.admin', (select person_id::text from public.profiles where id = '4e4e4e4e-1111-4111-8111-000000000001'), true);
select set_config('rf.ref',   (select person_id::text from public.profiles where id = '4e4e4e4e-1111-4111-8111-000000000002'), true);
insert into public.person_roles (person_id, role, granted_by)
  values (current_setting('rf.admin')::uuid, 'club_admin', '4e4e4e4e-1111-4111-8111-000000000001');

-- A / B. what may be asked for, and what needs a team -------------------------
select lives_ok($$
  insert into public.account_requests (id, person_id, requested_role)
  values ('4a4a4a4a-1111-4111-8111-000000000001', current_setting('rf.ref')::uuid, 'referee')
$$, 'referee is a role somebody may ask for, with no team');

select throws_ok($$
  insert into public.account_requests (person_id, requested_role)
  values (current_setting('rf.ref')::uuid, 'coach')
$$, '23514', null, 'a coaching role still has to name a team');

-- C. the sign-up opens it ------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('4e4e4e4e-1111-4111-8111-000000000003', 'rf-door@test.invalid',
   '{"first_name": "Ronnie", "last_name": "Door", "dob": "1986-04-04", "requested_role": "referee"}'::jsonb);

select is(
  (select count(*)::int from public.account_requests ar
     join public.profiles pr on pr.person_id = ar.person_id
    where pr.id = '4e4e4e4e-1111-4111-8111-000000000003'
      and ar.requested_role = 'referee' and ar.status = 'pending'),
  1,
  'signing up through the referee door opens the request with the account');

-- D. and nothing else ----------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('4e4e4e4e-1111-4111-8111-000000000004', 'rf-chancer@test.invalid',
   '{"first_name": "Chance", "last_name": "Er", "dob": "1986-04-04", "requested_role": "club_admin"}'::jsonb);

select is(
  (select count(*)::int from public.account_requests ar
     join public.profiles pr on pr.person_id = ar.person_id
    where pr.id = '4e4e4e4e-1111-4111-8111-000000000004'),
  0,
  'any other role in the sign-up metadata is ignored, not queued');

-- E. approving -----------------------------------------------------------------
set local request.jwt.claims to '{"sub":"4e4e4e4e-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_ok($$
  select public.approve_account_request('4a4a4a4a-1111-4111-8111-000000000001')
$$, '42501', null, 'a referee cannot approve their own request');
reset role;
set local request.jwt.claims to '{}';

set local request.jwt.claims to '{"sub":"4e4e4e4e-1111-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is(
  (select outcome from public.approve_account_request('4a4a4a4a-1111-4111-8111-000000000001')),
  'approved',
  'a club administrator approves it');
reset role;
set local request.jwt.claims to '{}';

select is(
  (select count(*)::int from public.person_roles
    where person_id = current_setting('rf.ref')::uuid and role = 'referee' and revoked_at is null),
  1,
  'and the referee hat is granted');

select is(
  (select status::text from public.account_requests where id = '4a4a4a4a-1111-4111-8111-000000000001'),
  'approved',
  'the request is marked approved');

select is(
  (select count(*)::int from public.audit_log
    where action = 'account_request.approve' and entity_id = '4a4a4a4a-1111-4111-8111-000000000001'),
  1,
  'and the decision is audited');

select * from finish();
rollback;
