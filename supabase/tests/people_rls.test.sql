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

select plan(33);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- Inserting into auth.users fires the baseline's on_auth_user_created trigger,
-- which creates the matching public.profiles row as 'member'; the role is then
-- corrected.
--
-- Since P1.4 that correction ALSO reaches public.person_roles: the
-- trg_profiles_sync_person_roles trigger maps 'committee' -> club_admin and
-- 'staff' -> staff, which is what the policies below now key off. `profiles`
-- remains the thing the test writes; it is no longer the thing the policy
-- reads, and the fact that these assertions are unchanged is the P1.4
-- regression check.
--
-- Since P1.2 that trigger also creates one public.people row per login, so the
-- three inserts below produce three people before the two explicit fixtures —
-- five in total. Each actor can therefore see their own person row via
-- people_self_read, which is what the read counts below reflect.

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

-- The committee read assertion below compares against the owner's view of the
-- table, captured here, rather than a hard-coded count: on a prod-shaped
-- database (preview branch, prod itself) people already holds the P1.2
-- backfill rows, and the test must pass there too. A transaction-local
-- setting is used rather than a temp table because the impersonated role
-- could not read a table owned by the test runner.
select set_config('test.people_total', (select count(*)::text from public.people), true);

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
  array['people_admin_read', 'people_admin_insert', 'people_admin_update',
        'people_self_read', 'people_guardian_read', 'people_staff_read',
        'people_finance_read'],
  'public.people has exactly the three P1.4 admin-role policies, the P1.2 self-read, the P1.3 guardian read, the team-staff read (20260825280000) and the finance read (20260904180000), and no others'
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
-- An ordinary member — has the grant, and since P1.2 has exactly one policy
-- that matches: people_self_read.
-- ---------------------------------------------------------------------------

set local request.jwt.claims to '{"sub":"33333333-3333-4333-8333-000000000003","role":"authenticated"}';
set local role authenticated;

select results_eq(
  $$select count(*)::int from public.people$$,
  array[1],
  'an ordinary member sees exactly one person row (P1.2 people_self_read)'
);

select results_eq(
  $$select id from public.people$$,
  $$select person_id from public.profiles where id = '33333333-3333-4333-8333-000000000003'$$,
  'and it is their own person, not anyone else''s'
);

reset role;

-- ---------------------------------------------------------------------------
-- Operational staff — SAFEGUARDING.md §1.3: "no inherent access to member or
-- child data". There is deliberately no people_staff_read policy.
-- ---------------------------------------------------------------------------

set local request.jwt.claims to '{"sub":"33333333-3333-4333-8333-000000000002","role":"authenticated"}';
set local role authenticated;

-- Their own row and no more: SAFEGUARDING.md §1.3 denies staff access to
-- *member and child* data, which their own record is not.
select results_eq(
  $$select id from public.people$$,
  $$select person_id from public.profiles where id = '33333333-3333-4333-8333-000000000002'$$,
  'bar/clubhouse staff read only their own person record (SAFEGUARDING.md §1.3)'
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
  $$select current_setting('test.people_total')::int$$,
  'committee reads every person row (all pre-existing rows + 2 fixtures + 1 per login created by handle_new_user)'
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

-- Two answers since P1.2, and both are refusals.
--
-- A bare TRUNCATE no longer reaches the trigger at all: public.profiles.person_id
-- references public.people, and Postgres rejects truncating a table referenced by
-- a foreign key before any BEFORE TRUNCATE trigger fires (0A000). That is an
-- extra layer, not a lost one — but the SG-2 guard must still be shown to be the
-- thing doing the work, so the CASCADE form (which satisfies the FK objection by
-- offering to truncate profiles too) is asserted as well, and that one is stopped
-- by the trigger.
select throws_ok(
  $$truncate public.people$$,
  '0A000',
  null,
  'the table owner cannot truncate public.people — it is referenced by profiles.person_id'
);

select throws_ok(
  $$truncate public.people cascade$$,
  'P0001',
  null,
  'and TRUNCATE ... CASCADE, which gets past the foreign key, is stopped by trg_people_deny_truncate'
);

-- Since P1.3 the cascade also reaches public.guardianships, which carries its
-- own trg_guardianships_deny_truncate (SG-2, applied to that table for the
-- truncate half only). Either guard raising P0001 satisfies the assertion
-- above, and both firing is the intended belt-and-braces.

select * from finish();

rollback;
