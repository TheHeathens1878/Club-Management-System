-- =============================================================================
-- P1.1 — public.people RLS, grants and the SG-2 delete/truncate guards
-- =============================================================================
-- Three actors are built inside the transaction: a committee member, an
-- operational staff member and an ordinary member. Each is impersonated with
-- the standard Supabase pattern —
--
--     set local request.jwt.claims to '{"sub":"<uuid>","role":"authenticated"}';
--     set local role authenticated;
--
-- because public.is_committee() / is_staff() resolve auth.uid(), which reads
-- `request.jwt.claims ->> 'sub'`.
--
-- The delete and truncate assertions run as `authenticated`, as `service_role`
-- AND as the table owner, per SAFEGUARDING.md §3 SG-2: the owner run is the one
-- that proves the trigger rather than the grant is doing the work.
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(31);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- Inserting into auth.users fires the baseline's on_auth_user_created trigger,
-- which creates the matching public.profiles row as 'member'; the role is then
-- corrected. profiles is the only role source until P1.4.

insert into auth.users (id, email) values
  ('33333333-3333-4333-8333-000000000001', 'committee@test.invalid'),
  ('33333333-3333-4333-8333-000000000002', 'barstaff@test.invalid'),
  ('33333333-3333-4333-8333-000000000003', 'member@test.invalid');

update public.profiles set role = 'committee'
 where id = '33333333-3333-4333-8333-000000000001';
update public.profiles set role = 'staff'
 where id = '33333333-3333-4333-8333-000000000002';

insert into public.people (id, first_name, last_name, dob) values
  ('44444444-4444-4444-8444-000000000001', 'Seed', 'Person', date '1990-01-01'),
  ('44444444-4444-4444-8444-000000000002', 'Second', 'Person', null);

-- ---------------------------------------------------------------------------
-- Schema-level assertions (as the owner; no impersonation yet)
-- ---------------------------------------------------------------------------

select is(
  (select relrowsecurity from pg_class where oid = 'public.people'::regclass),
  true,
  'row level security is enabled on public.people'
);

-- An exact-set assertion, so an accidentally added policy — a FOR DELETE one
-- above all — fails the build rather than passing unnoticed.
select policies_are(
  'public',
  'people',
  array['people_committee_read', 'people_committee_insert', 'people_committee_update'],
  'public.people has exactly the three committee policies and no others'
);

select is_empty(
  $$select policyname from pg_policies
     where schemaname = 'public' and tablename = 'people' and cmd = 'DELETE'$$,
  'there is no FOR DELETE policy on public.people (SG-2: soft delete only)'
);

-- ---------------------------------------------------------------------------
-- Privileges — the layer that binds service_role, which no policy can
-- (SAFEGUARDING.md §1.2)
-- ---------------------------------------------------------------------------

select table_privs_are(
  'public', 'people', 'anon', array[]::text[],
  'anon holds no privilege at all on public.people'
);

select table_privs_are(
  'public', 'people', 'authenticated', array['SELECT', 'INSERT', 'UPDATE'],
  'authenticated holds exactly select/insert/update on public.people'
);

select table_privs_are(
  'public', 'people', 'service_role', array['SELECT', 'INSERT', 'UPDATE'],
  'service_role holds exactly select/insert/update on public.people'
);

-- Spelled out individually as well: this pair is what catches a later
-- `grant all on all tables in schema public` quietly restoring the ability to
-- destroy person records.
select ok(
  not has_table_privilege('anon', 'public.people', 'DELETE'),
  'anon cannot DELETE from public.people'
);
select ok(
  not has_table_privilege('anon', 'public.people', 'TRUNCATE'),
  'anon cannot TRUNCATE public.people'
);
select ok(
  not has_table_privilege('authenticated', 'public.people', 'DELETE'),
  'authenticated cannot DELETE from public.people'
);
select ok(
  not has_table_privilege('authenticated', 'public.people', 'TRUNCATE'),
  'authenticated cannot TRUNCATE public.people'
);
select ok(
  not has_table_privilege('service_role', 'public.people', 'DELETE'),
  'service_role cannot DELETE from public.people'
);
select ok(
  not has_table_privilege('service_role', 'public.people', 'TRUNCATE'),
  'service_role cannot TRUNCATE public.people'
);

-- is_minor() is SECURITY DEFINER over public.people. Granting it to anon would
-- turn it into an existence-and-age oracle for anyone with a uuid.
select ok(
  not has_function_privilege('anon', 'public.is_minor(uuid)', 'EXECUTE'),
  'anon cannot execute public.is_minor()'
);
select ok(
  not has_function_privilege('anon', 'public.is_minor_dob(date)', 'EXECUTE'),
  'anon cannot execute public.is_minor_dob()'
);
select ok(
  has_function_privilege('authenticated', 'public.is_minor(uuid)', 'EXECUTE'),
  'authenticated can execute public.is_minor()'
);
select ok(
  has_function_privilege('service_role', 'public.is_minor(uuid)', 'EXECUTE'),
  'service_role can execute public.is_minor()'
);

-- ---------------------------------------------------------------------------
-- anon — no access of any kind
-- ---------------------------------------------------------------------------

set local role anon;

select throws_ok(
  $$select id from public.people$$,
  '42501',
  null,
  'anon reading public.people is denied at the privilege layer'
);

select throws_ok(
  $$insert into public.people (first_name, last_name) values ('An', 'On')$$,
  '42501',
  null,
  'anon cannot insert a person'
);

reset role;

-- ---------------------------------------------------------------------------
-- An ordinary member — has the grant, has no policy, so sees nothing
-- ---------------------------------------------------------------------------

set local request.jwt.claims to '{"sub":"33333333-3333-4333-8333-000000000003","role":"authenticated"}';
set local role authenticated;

select is_empty(
  $$select id from public.people$$,
  'an ordinary member sees no people (no self-read until P1.2 links profiles)'
);

reset role;

-- ---------------------------------------------------------------------------
-- Operational staff — SAFEGUARDING.md §1.3: "no inherent access to member or
-- child data". There is deliberately no people_staff_read policy.
-- ---------------------------------------------------------------------------

set local request.jwt.claims to '{"sub":"33333333-3333-4333-8333-000000000002","role":"authenticated"}';
set local role authenticated;

select is_empty(
  $$select id from public.people$$,
  'bar/clubhouse staff read no person records (SAFEGUARDING.md §1.3)'
);

select throws_ok(
  $$insert into public.people (first_name, last_name) values ('Bar', 'Staff')$$,
  '42501',
  null,
  'staff cannot insert a person'
);

-- An UPDATE with no matching policy is not an error; it simply matches no rows.
update public.people
   set notes = 'written by staff'
 where id = '44444444-4444-4444-8444-000000000001';

reset role;

select is(
  (select notes from public.people where id = '44444444-4444-4444-8444-000000000001'),
  null,
  'a staff UPDATE silently affects no rows'
);

-- ---------------------------------------------------------------------------
-- Committee — full read/write
-- ---------------------------------------------------------------------------

set local request.jwt.claims to '{"sub":"33333333-3333-4333-8333-000000000001","role":"authenticated"}';
set local role authenticated;

select results_eq(
  $$select count(*)::int from public.people$$,
  array[2],
  'committee reads every person row'
);

select lives_ok(
  $$insert into public.people (first_name, last_name, dob)
    values ('New', 'Recruit', date '2015-05-05')$$,
  'committee can insert a person'
);

update public.people
   set notes = 'written by committee'
 where id = '44444444-4444-4444-8444-000000000001';

select throws_ok(
  $$delete from public.people where id = '44444444-4444-4444-8444-000000000001'$$,
  '42501',
  null,
  'committee cannot hard-delete a person (privilege revoked)'
);

reset role;

select is(
  (select notes from public.people where id = '44444444-4444-4444-8444-000000000001'),
  'written by committee',
  'a committee UPDATE is applied'
);

-- ---------------------------------------------------------------------------
-- SG-2 guards — delete and truncate, at every layer
-- ---------------------------------------------------------------------------

set local role authenticated;

select throws_ok(
  $$truncate public.people$$,
  '42501',
  null,
  'authenticated cannot truncate public.people'
);

reset role;
set local role service_role;

select throws_ok(
  $$delete from public.people where id = '44444444-4444-4444-8444-000000000001'$$,
  '42501',
  null,
  'service_role cannot hard-delete a person, BYPASSRLS notwithstanding'
);

select throws_ok(
  $$truncate public.people$$,
  '42501',
  null,
  'service_role cannot truncate public.people'
);

reset role;

-- The two that matter most: the owner is not stopped by a revoked privilege,
-- only by the triggers.
select throws_ok(
  $$delete from public.people where id = '44444444-4444-4444-8444-000000000001'$$,
  'P0001',
  null,
  'the table owner is stopped by trg_people_deny_hard_delete'
);

select throws_ok(
  $$truncate public.people$$,
  'P0001',
  null,
  'the table owner is stopped by trg_people_deny_truncate'
);

select * from finish();

rollback;
