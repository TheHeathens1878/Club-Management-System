-- =============================================================================
-- P1.2 — auth.users -> profiles -> people
-- =============================================================================
-- Covers the column and its constraints, the name split, the rewired
-- handle_new_user(), the profiles BEFORE INSERT guard that keeps apps/web's
-- upserts working, the no-auto-link-by-email rule, the people_self_read policy,
-- refusal to delete a referenced person, and the backfill function's
-- idempotence.
--
-- Auth users are created the way people_rls.test.sql does it — a plain insert
-- into auth.users, which fires the baseline's on_auth_user_created trigger —
-- with raw_user_meta_data supplied so the name split is exercised end to end.
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(44);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- Four logins, chosen to cover every branch of the split: two tokens, three
-- tokens, one token, and no full_name at all.

insert into auth.users (id, email, raw_user_meta_data) values
  ('66666666-6666-4666-8666-000000000001', 'alice@test.invalid',
   '{"full_name": "Alice Wonderland"}'::jsonb),
  ('66666666-6666-4666-8666-000000000002', 'mary@test.invalid',
   '{"full_name": "  Mary   Jane  Watson-Smith "}'::jsonb),
  ('66666666-6666-4666-8666-000000000003', 'prince@test.invalid',
   '{"full_name": "Prince"}'::jsonb),
  ('66666666-6666-4666-8666-000000000004', 'nameless@test.invalid', null);


-- ---------------------------------------------------------------------------
-- A. Schema shape
-- ---------------------------------------------------------------------------

select has_column(
  'public', 'profiles', 'person_id',
  'public.profiles has a person_id column'
);

select col_type_is(
  'public', 'profiles', 'person_id', 'uuid',
  'profiles.person_id is uuid'
);

-- NOT NULL was chosen over "nullable during the transition": the backfill in
-- the migration makes every row non-null and asserts it before this is set.
select col_not_null(
  'public', 'profiles', 'person_id',
  'profiles.person_id is NOT NULL'
);

-- One person, one login. A plain UNIQUE constraint rather than a partial unique
-- index, because with NOT NULL the `where person_id is not null` predicate is
-- tautological.
select col_is_unique(
  'public', 'profiles', array['person_id'],
  'profiles.person_id is unique — the link is one-to-one'
);

select fk_ok(
  'public', 'profiles', 'person_id',
  'public', 'people',   'id',
  'profiles.person_id references people.id'
);

-- RESTRICT, not CASCADE and not SET NULL. In practice the SG-2 delete guard on
-- public.people fires first (see section H), so this is the second line of
-- defence — the one that would still speak up if that trigger were ever
-- disabled.
select is(
  (select c.confdeltype
     from pg_constraint c
    where c.conrelid = 'public.profiles'::regclass
      and c.contype = 'f'
      and c.confrelid = 'public.people'::regclass),
  'r'::"char",
  'the person_id foreign key is ON DELETE RESTRICT'
);

-- The policy P1.1 deferred as a TODO in its §7.
select ok(
  exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'people'
       and policyname = 'people_self_read'
  ),
  'people_self_read exists on public.people'
);

-- Deliberately absent: a self-UPDATE. SG-0 derives minority from people.dob, so
-- a self-service dob edit would be a self-service exit from every child
-- protection rule in SAFEGUARDING.md.
select is_empty(
  $$select policyname from pg_policies
     where schemaname = 'public' and tablename = 'people'
       and cmd = 'UPDATE' and policyname like '%self%'$$,
  'there is no self-update policy on public.people (dob is never self-editable)'
);


-- ---------------------------------------------------------------------------
-- B. split_person_name()
-- ---------------------------------------------------------------------------
-- Last token is the surname, everything before it is the forename(s). A single
-- token cannot yield last_name = '' — people_last_name_not_blank forbids it —
-- so it gets the conspicuous '(unknown)' placeholder rather than a fabricated
-- surname.

select results_eq(
  $$select first_name, last_name from public.split_person_name('Alice Wonderland')$$,
  $$values ('Alice'::text, 'Wonderland'::text)$$,
  'two tokens split into forename and surname'
);

select results_eq(
  $$select first_name, last_name from public.split_person_name('  Mary   Jane  Watson-Smith ')$$,
  $$values ('Mary Jane'::text, 'Watson-Smith'::text)$$,
  'three tokens: last is the surname, the rest joins as the forename, whitespace collapsed'
);

select results_eq(
  $$select first_name, last_name from public.split_person_name('Prince')$$,
  $$values ('Prince'::text, '(unknown)'::text)$$,
  'a single token keeps the token as the forename and flags the surname unknown'
);

select results_eq(
  $$select first_name, last_name from public.split_person_name(null)$$,
  $$values ('(unknown)'::text, '(unknown)'::text)$$,
  'a null name yields two placeholders, never a blank that the CHECK would reject'
);

select results_eq(
  $$select first_name, last_name from public.split_person_name('   ')$$,
  $$values ('(unknown)'::text, '(unknown)'::text)$$,
  'a whitespace-only name is treated as no name'
);


-- ---------------------------------------------------------------------------
-- C. handle_new_user() — a new auth user arrives with a person
-- ---------------------------------------------------------------------------

select results_eq(
  $$select count(*)::int from public.profiles
     where id::text like '66666666-%' and person_id is not null$$,
  array[4],
  'inserting an auth.users row creates a profile already linked to a person'
);

select results_eq(
  $$select pe.first_name, pe.last_name
      from public.profiles p
      join public.people pe on pe.id = p.person_id
     where p.id::text like '66666666-%'
     order by p.id$$,
  $$values ('Alice'::text,     'Wonderland'::text),
          ('Mary Jane'::text, 'Watson-Smith'::text),
          ('Prince'::text,    '(unknown)'::text),
          ('(unknown)'::text, '(unknown)'::text)$$,
  'names are split from raw_user_meta_data->>full_name, single-token and absent names included'
);

select is(
  (select pe.email from public.profiles p
     join public.people pe on pe.id = p.person_id
    where p.id = '66666666-6666-4666-8666-000000000001'),
  'alice@test.invalid',
  'the person carries the auth user email'
);

-- SG-0: nobody is presumed an adult on the strength of having had a login.
select is(
  (select count(*)::int from public.profiles p
     join public.people pe on pe.id = p.person_id
    where p.id::text like '66666666-%' and pe.dob is null),
  4,
  'every person created for a login has a null dob — unknown, therefore a minor (SG-0)'
);

select ok(
  (select bool_and(pe.created_at = p.created_at)
     from public.profiles p
     join public.people pe on pe.id = p.person_id
    where p.id::text like '66666666-%'),
  'people.created_at matches the profile it was created for'
);

select is(
  (select count(distinct person_id)::int from public.profiles
    where id::text like '66666666-%'),
  4,
  'each login got its own person — none are shared'
);


-- ---------------------------------------------------------------------------
-- D. Uniqueness and NOT NULL
-- ---------------------------------------------------------------------------

select throws_ok(
  $$update public.profiles
       set person_id = (select person_id from public.profiles
                         where id = '66666666-6666-4666-8666-000000000001')
     where id = '66666666-6666-4666-8666-000000000002'$$,
  '23505',
  null,
  'two profiles cannot point at the same person'
);

select throws_ok(
  $$update public.profiles set person_id = null
     where id = '66666666-6666-4666-8666-000000000001'$$,
  '23502',
  null,
  'person_id cannot be cleared once set'
);

-- A profile inserted with no person_id does not fail: trg_profiles_ensure_person
-- manufactures one. That is what makes NOT NULL compatible with apps/web (see
-- section E) — the constraint is made satisfiable rather than the app changed.
insert into auth.users (id, email) values
  ('66666666-6666-4666-8666-000000000009', 'orphanless@test.invalid');
delete from public.profiles where id = '66666666-6666-4666-8666-000000000009';

select lives_ok(
  $$insert into public.profiles (id, role, full_name)
    values ('66666666-6666-4666-8666-000000000009', 'member', 'Solo Insert')$$,
  'a profile inserted without person_id is accepted — the guard trigger supplies one'
);

select results_eq(
  $$select pe.first_name, pe.last_name
      from public.profiles p join public.people pe on pe.id = p.person_id
     where p.id = '66666666-6666-4666-8666-000000000009'$$,
  $$values ('Solo'::text, 'Insert'::text)$$,
  'the manufactured person is named from profiles.full_name'
);


-- ---------------------------------------------------------------------------
-- E. apps/web compatibility — the upsert regression test
-- ---------------------------------------------------------------------------
-- book/actions.ts, super-users/actions.ts and settings/actions.ts all upsert
-- { id, role, full_name } onto a profile that auth.admin.createUser() has
-- already caused to exist. PostgREST renders that as
-- `insert ... on conflict (id) do update`, and Postgres checks NOT NULL against
-- the proposed tuple BEFORE it arbitrates the conflict — so without the guard
-- trigger every one of those flows would fail 23502.
--
-- The second assertion is the one that stops the fix being worse than the
-- problem: the guard must adopt the profile's existing person, not mint a new
-- one, or every upsert leaks an orphan person row.

select lives_ok(
  $$insert into public.profiles (id, role, full_name)
    values ('66666666-6666-4666-8666-000000000001', 'committee', 'Alice Wonderland')
    on conflict (id) do update
       set role = excluded.role, full_name = excluded.full_name$$,
  'the apps/web upsert shape still works with person_id NOT NULL'
);

select is(
  (select count(*)::int from public.people
    where first_name = 'Alice' and last_name = 'Wonderland'),
  1,
  'an upsert that resolves to UPDATE creates no second person row'
);

-- That upsert promoted Alice to 'committee', which would make is_committee()
-- true and let the committee read policy — not people_self_read — answer
-- section G. Put her back.
update public.profiles set role = 'member'
 where id = '66666666-6666-4666-8666-000000000001';


-- ---------------------------------------------------------------------------
-- F. No auto-link by email
-- ---------------------------------------------------------------------------
-- A new login NEVER adopts an existing person that happens to share its email.
-- Families share an email address; a child's record may legitimately carry a
-- parent's contact address; matching on it would hand a brand-new account
-- somebody else's identity along with every guardianship, role and conversation
-- attached to it. See DECISIONS.md 2026-08-22.

insert into public.people (id, first_name, last_name, email) values
  ('77777777-7777-4777-8777-000000000001', 'Existing', 'Parent', 'shared@test.invalid');

insert into auth.users (id, email, raw_user_meta_data) values
  ('66666666-6666-4666-8666-000000000005', 'shared@test.invalid',
   '{"full_name": "Child Sharesemail"}'::jsonb);

select isnt(
  (select person_id from public.profiles
    where id = '66666666-6666-4666-8666-000000000005'),
  '77777777-7777-4777-8777-000000000001'::uuid,
  'a login sharing an email with an existing person gets its OWN person, never that one'
);

select results_eq(
  $$select pe.first_name, pe.last_name
      from public.profiles p join public.people pe on pe.id = p.person_id
     where p.id = '66666666-6666-4666-8666-000000000005'$$,
  $$values ('Child'::text, 'Sharesemail'::text)$$,
  'the new person is named from the signup metadata, not copied from the match'
);

-- people_email_unique_live_idx would reject the duplicate address, and an
-- exception here would mean a signup that cannot complete. The email is dropped
-- instead; the person and the login are still created.
select is(
  (select pe.email from public.profiles p join public.people pe on pe.id = p.person_id
    where p.id = '66666666-6666-4666-8666-000000000005'),
  null,
  'a colliding email is left null rather than aborting the signup'
);


-- ---------------------------------------------------------------------------
-- G. people_self_read
-- ---------------------------------------------------------------------------
-- Alice is an ordinary member (role defaults to 'member'), so is_committee() is
-- false and the self-read policy is the only thing that can show her anything.

set local request.jwt.claims to '{"sub":"66666666-6666-4666-8666-000000000001","role":"authenticated"}';
set local role authenticated;

select results_eq(
  $$select count(*)::int from public.people$$,
  array[1],
  'an authenticated member reads exactly one person row'
);

select results_eq(
  $$select id from public.people$$,
  $$select person_id from public.profiles where id = '66666666-6666-4666-8666-000000000001'$$,
  'and the row they read is their own person'
);

select is_empty(
  $$select id from public.people
     where id = (select person_id from public.profiles
                  where id = '66666666-6666-4666-8666-000000000002')$$,
  'a member cannot read another member''s person row'
);

reset role;

set local request.jwt.claims to '{"sub":"66666666-6666-4666-8666-000000000002","role":"authenticated"}';
set local role authenticated;

select results_eq(
  $$select id from public.people$$,
  $$select person_id from public.profiles where id = '66666666-6666-4666-8666-000000000002'$$,
  'a second member likewise reads exactly their own person and nothing else'
);

reset role;


-- ---------------------------------------------------------------------------
-- H. A person referenced by a profile cannot be deleted
-- ---------------------------------------------------------------------------
-- Two answers, both correct, because two different layers stop it. As an API
-- role the DELETE privilege is revoked (P1.1 §8), so it never reaches the row:
-- 42501. As the table owner the privilege is irrelevant and P1.1's
-- trg_people_deny_hard_delete raises: P0001. The ON DELETE RESTRICT asserted in
-- section A is behind both and is never reached in practice.

set local role service_role;

select throws_ok(
  $$delete from public.people
     where id = (select person_id from public.profiles
                  where id = '66666666-6666-4666-8666-000000000001')$$,
  '42501',
  null,
  'service_role cannot delete a person a profile points at (privilege revoked)'
);

reset role;

select throws_ok(
  $$delete from public.people
     where id = (select person_id from public.profiles
                  where id = '66666666-6666-4666-8666-000000000001')$$,
  'P0001',
  null,
  'the table owner is stopped by trg_people_deny_hard_delete (SG-2), before RESTRICT is reached'
);


-- ---------------------------------------------------------------------------
-- I. backfill_profiles_people()
-- ---------------------------------------------------------------------------
-- The migration calls it once. Locally there are 0 profiles at that point, so
-- it links 0 and creates 0 — and still writes its audit row, because "the
-- backfill ran and found nothing" is exactly the fact worth having when
-- reconciling prod against a fresh environment. On prod the same row carries
-- 38 / 38 and the 38 ids.

-- Scoped by `entity` since P1.4: that migration writes its own single
-- `migration.backfill` row for public.person_roles, following the same
-- convention. The action is shared; the entity is what distinguishes them.
select is(
  (select count(*)::int from public.audit_log
    where action = 'migration.backfill' and entity = 'profiles'),
  1,
  'the migration wrote exactly one migration.backfill audit row for profiles'
);

select results_eq(
  $$select actor_id, actor_email, entity, detail ->> 'migration'
      from public.audit_log
     where action = 'migration.backfill' and entity = 'profiles'$$,
  $$values (null::uuid, 'migration'::text, 'profiles'::text,
            '20260822110000_profiles_person_link'::text)$$,
  'the audit row follows the existing audit_log conventions (actor_id null, actor_email migration)'
);

-- Idempotence. Every profile is already linked, so a second run has nothing to
-- iterate: the driving query is `where person_id is null`.
select results_eq(
  $$select profiles_linked, people_created, people_ids
      from public.backfill_profiles_people()$$,
  $$values (0, 0, array[]::uuid[])$$,
  're-running the backfill links nothing and creates nothing'
);

select is(
  (select count(*)::int from public.audit_log
    where action = 'migration.backfill' and entity = 'profiles'),
  1,
  'and writes no further audit row — the audit row belongs to the migration, not the function'
);

-- The pre-migration state, reconstructed: a profile that exists with no person.
-- The NOT NULL is dropped and restored inside this transaction rather than
-- disabling any trigger — nothing here touches a safeguarding guard.
alter table public.profiles alter column person_id drop not null;

update public.profiles
   set person_id = null,
       full_name = 'Cher'
 where id = '66666666-6666-4666-8666-000000000003';

select results_eq(
  $$select profiles_linked, people_created from public.backfill_profiles_people()$$,
  $$values (1, 1)$$,
  'the backfill links an unlinked profile and creates exactly one person for it'
);

alter table public.profiles alter column person_id set not null;

select results_eq(
  $$select pe.first_name, pe.last_name, pe.dob, pe.created_by
      from public.profiles p join public.people pe on pe.id = p.person_id
     where p.id = '66666666-6666-4666-8666-000000000003'$$,
  $$values ('Cher'::text, '(unknown)'::text, null::date, null::uuid)$$,
  'the backfilled person is split from profiles.full_name, dob null, created_by null'
);

select ok(
  (select pe.created_at = p.created_at
     from public.profiles p join public.people pe on pe.id = p.person_id
    where p.id = '66666666-6666-4666-8666-000000000003'),
  'the backfilled person inherits the profile created_at'
);


-- ---------------------------------------------------------------------------
-- J. Function privileges
-- ---------------------------------------------------------------------------
-- All three are internal: reachable only from SECURITY DEFINER code owned by
-- postgres. anon is revoked by name as well as via PUBLIC, because hosted
-- Supabase's default privileges grant EXECUTE on every new function to all
-- three API roles explicitly — the lesson from the P1.1 preview rehearsal.

select ok(
  not has_function_privilege('anon',          'public.split_person_name(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.split_person_name(text)', 'EXECUTE')
  and not has_function_privilege('service_role',  'public.split_person_name(text)', 'EXECUTE'),
  'no API role can execute public.split_person_name()'
);

select ok(
  not has_function_privilege('anon',          'public.backfill_profiles_people()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.backfill_profiles_people()', 'EXECUTE')
  and not has_function_privilege('service_role',  'public.backfill_profiles_people()', 'EXECUTE'),
  'no API role can execute public.backfill_profiles_people()'
);

select ok(
  not has_function_privilege('anon',          'public.profiles_ensure_person()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.profiles_ensure_person()', 'EXECUTE')
  and not has_function_privilege('service_role',  'public.profiles_ensure_person()', 'EXECUTE'),
  'no API role can execute public.profiles_ensure_person()'
);

select * from finish();

rollback;
