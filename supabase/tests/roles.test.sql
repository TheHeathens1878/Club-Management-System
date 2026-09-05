-- =============================================================================
-- P1.4 — public.person_roles, public.app_role, has_role()
-- =============================================================================
-- SAFEGUARDING.md §3 test convention: "Every test named below attempts the
-- prohibited action and asserts that it fails. A test that only asserts the
-- happy path does not satisfy the invariant."
--
-- What this suite covers, and where:
--   A  schema shape — enum, columns, partial unique index, triggers, policies
--   B  privileges — the layer that binds service_role, which no policy can
--   C  has_role / has_any_role / person_has_role / is_club_admin /
--      is_safeguarding_lead, including revoked -> false and anon
--   D  the legacy mapping, applied by the profiles -> person_roles sync trigger
--      (all six user_role values), including grant, revoke and no-churn
--   E  backfill_person_roles(): mapping, idempotence, one summary audit row,
--      and the suppression of the per-grant SG-7 rows during it
--   F  RLS on person_roles
--   G  SG-2: no hard delete, no truncate, at every layer including the owner
--   H  the P1.4 rewrite of the P1.1 / P1.3 policies — a club_admin behaves
--      exactly as a committee member did (regression), and a safeguarding_lead
--      reads people but cannot write them
--
-- Impersonation follows people_rls.test.sql and guardianships.test.sql:
--     set local request.jwt.claims to '{"sub":"<uuid>","role":"authenticated"}';
--     set local role authenticated;
-- because has_role() resolves current_person_id(), which resolves auth.uid(),
-- which reads `request.jwt.claims ->> 'sub'`.
--
-- EVERY COUNT ASSERTION IS DATA-INDEPENDENT: expected values are captured by
-- the table owner into transaction-local settings, never hard-coded, so this
-- suite passes unchanged on a prod-shaped preview branch where person_roles
-- already holds the 39 backfilled grants.
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(115);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- Each auth.users insert fires on_auth_user_created -> handle_new_user(), which
-- since P1.2 creates a profile AND a person, and since P1.4 the profile insert
-- fires trg_profiles_sync_person_roles and grants `member`.

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1a1a1a1-1111-4111-8111-000000000001', 'radmin@test.invalid',   '{"full_name": "Ada Admin"}'::jsonb),
  ('a1a1a1a1-1111-4111-8111-000000000002', 'rlead@test.invalid',    '{"full_name": "Lee Lead"}'::jsonb),
  ('a1a1a1a1-1111-4111-8111-000000000003', 'rmember@test.invalid',  '{"full_name": "Mo Member"}'::jsonb),
  ('a1a1a1a1-1111-4111-8111-000000000010', 'rpromote@test.invalid', '{"full_name": "Pat Promotable"}'::jsonb);

-- The six legacy values, one login each, for the mapping table.
insert into auth.users (id, email, raw_user_meta_data) values
  ('a1a1a1a1-1111-4111-8111-000000000004', 'rcommittee@test.invalid',  '{"full_name": "Cy Committee"}'::jsonb),
  ('a1a1a1a1-1111-4111-8111-000000000005', 'rsuper@test.invalid',      '{"full_name": "Sue Super"}'::jsonb),
  ('a1a1a1a1-1111-4111-8111-000000000006', 'rbar@test.invalid',        '{"full_name": "Bay Bar"}'::jsonb),
  ('a1a1a1a1-1111-4111-8111-000000000007', 'rbarmanager@test.invalid', '{"full_name": "Bea Barmanager"}'::jsonb),
  ('a1a1a1a1-1111-4111-8111-000000000008', 'rstaff@test.invalid',      '{"full_name": "Stu Staff"}'::jsonb),
  ('a1a1a1a1-1111-4111-8111-000000000009', 'rplainmember@test.invalid','{"full_name": "Ali Member"}'::jsonb);

update public.profiles set role = 'committee'
 where id = 'a1a1a1a1-1111-4111-8111-000000000001';

-- Ada is the club_admin; Lee is an ordinary member who additionally holds
-- safeguarding_lead. D9 says nobody is granted it automatically, so it is
-- granted here by hand, exactly as Adam will have to.
insert into public.person_roles (person_id, role, notes)
select person_id, 'safeguarding_lead', 'test fixture: Club Welfare Officer'
  from public.profiles where id = 'a1a1a1a1-1111-4111-8111-000000000002';

-- People with no login, for person_has_role() and for the guardianships
-- regression in section H.
insert into public.people (id, first_name, last_name, dob) values
  ('b2b2b2b2-2222-4222-8222-000000000001', 'Roleless', 'Person', date '1990-01-01'),
  ('b2b2b2b2-2222-4222-8222-000000000002', 'Coachy', 'Person',   date '1988-02-02'),
  ('b2b2b2b2-2222-4222-8222-000000000003', 'Guarded', 'Child',
   (current_date - interval '9 years')::date),
  ('b2b2b2b2-2222-4222-8222-000000000004', 'Adult', 'Guardian',  date '1980-05-05');

insert into public.person_roles (person_id, role) values
  ('b2b2b2b2-2222-4222-8222-000000000002', 'coach');

select set_config('test.admin_person',
  (select person_id::text from public.profiles
    where id = 'a1a1a1a1-1111-4111-8111-000000000001'), true);
select set_config('test.lead_person',
  (select person_id::text from public.profiles
    where id = 'a1a1a1a1-1111-4111-8111-000000000002'), true);
select set_config('test.member_person',
  (select person_id::text from public.profiles
    where id = 'a1a1a1a1-1111-4111-8111-000000000003'), true);


-- ---------------------------------------------------------------------------
-- A. Schema shape  (as the owner; no impersonation yet)
-- ---------------------------------------------------------------------------

-- 1
select has_table('public', 'person_roles', 'public.person_roles exists');

-- 2 — the closed set, in the order PLAN.md P1.4 lists them, plus referee
-- (20260825020000 — Adam's referee programme).
select enum_has_labels(
  'public', 'app_role',
  array['club_admin', 'safeguarding_lead', 'coach', 'staff', 'member',
        'parent', 'hirer', 'referee', 'finance'],
  'app_role carries the seven §1.3 roles plus the 2026-08-25 referee hat and the 2026-09-04 finance hat'
);

-- 3 — a SEPARATE type from the baseline's user_role, which is untouched.
select enum_has_labels(
  'public', 'user_role',
  array['committee', 'bar', 'bar_manager', 'member', 'super_user', 'staff', 'booker'],
  'the legacy public.user_role enum is P1.4''s six plus booker (20260905120000) — P1.4 adds a type, it does not alter one'
);

-- 4, 5, 6, 7
select col_not_null('public', 'person_roles', 'person_id', 'person_id is NOT NULL');
select col_not_null('public', 'person_roles', 'role', 'role is NOT NULL');
select col_not_null('public', 'person_roles', 'granted_at', 'granted_at is NOT NULL');
select col_is_null('public', 'person_roles', 'revoked_at',
  'revoked_at is nullable — NULL means the role is held now');

-- 8
select col_type_is('public', 'person_roles', 'role', 'app_role',
  'role is the enum, not text — an invalid role is a type error');

-- 9, 10
select fk_ok('public', 'person_roles', 'person_id', 'public', 'people', 'id',
  'person_id references people.id');
select is(
  (select c.confdeltype::text from pg_constraint c
    where c.conrelid = 'public.person_roles'::regclass
      and c.contype = 'f' and c.confrelid = 'public.people'::regclass),
  'r',
  'the person foreign key is ON DELETE RESTRICT, never CASCADE'
);

-- 11 — the partial unique index: one LIVE grant per (person, role), and any
-- number of revoked ones behind it.
select is(
  (select indexdef from pg_indexes
    where schemaname = 'public' and indexname = 'person_roles_active_idx'),
  'CREATE UNIQUE INDEX person_roles_active_idx ON public.person_roles '
  || 'USING btree (person_id, role) WHERE (revoked_at IS NULL)',
  'the (person_id, role) pair is unique among LIVE grants only'
);

-- 12
select is(
  (select relrowsecurity from pg_class where oid = 'public.person_roles'::regclass),
  true,
  'row level security is enabled on public.person_roles'
);

-- 13 — an exact-set assertion, so an accidentally added policy — a FOR DELETE
-- one above all — fails the build rather than passing unnoticed.
select policies_are(
  'public',
  'person_roles',
  array['person_roles_self_read', 'person_roles_admin_read',
        'person_roles_admin_insert', 'person_roles_admin_update'],
  'person_roles has exactly the self read, the admin read and the two club_admin writes'
);

-- 14
select is_empty(
  $$select policyname from pg_policies
     where schemaname = 'public' and tablename = 'person_roles' and cmd = 'DELETE'$$,
  'there is no FOR DELETE policy on public.person_roles (SG-2: soft revoke only)'
);

-- 15, 16, 17, 18
select has_trigger('public', 'person_roles', 'trg_person_roles_deny_hard_delete',
  'the SG-2 row-level delete guard is attached');
select has_trigger('public', 'person_roles', 'trg_person_roles_deny_truncate',
  'the SG-2 statement-level truncate guard is attached');
select has_trigger('public', 'person_roles', 'trg_person_roles_updated',
  'set_updated_at is attached (the table has updated_at)');
select has_trigger('public', 'person_roles', 'trg_person_roles_audit',
  'the SG-7 grant/revoke audit trigger is attached');

-- 19 — the legacy bridge lives on profiles, not here.
select has_trigger('public', 'profiles', 'trg_profiles_sync_person_roles',
  'the profiles -> person_roles sync trigger exists on public.profiles');

-- 20 — AFTER (0 in bit 2), ROW (1), INSERT (4), UPDATE (16). AFTER INSERT is
-- what makes handle_new_user() need no change: a profile inserted BY A TRIGGER
-- fires this trigger like any other insert.
select is(
  (select (t.tgtype & 2 = 0) and (t.tgtype & 1 = 1)
      and (t.tgtype & 4 = 4) and (t.tgtype & 16 = 16)
     from pg_trigger t
    where t.tgrelid = 'public.profiles'::regclass
      and t.tgname = 'trg_profiles_sync_person_roles'),
  true,
  'the sync trigger is AFTER INSERT OR UPDATE, FOR EACH ROW'
);

-- 21 — and it watches `role` only: a full_name edit must not churn role history.
select results_eq(
  $$select (a.attname::text) collate "default"
      from pg_trigger t
      join unnest(t.tgattr::smallint[]) as col(attnum) on true
      join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = col.attnum
     where t.tgrelid = 'public.profiles'::regclass
       and t.tgname = 'trg_profiles_sync_person_roles'
     order by 1$$,
  $$values ('role'::text)$$,
  'the sync trigger watches profiles.role and nothing else'
);

-- 22, 23, 24 — the three baseline helpers are UNCHANGED in behaviour. P1.4 is
-- additive: the ~38 baseline policies that call them still read profiles.role.
select is(
  (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'is_committee') ~ 'profiles',
  true,
  'is_committee() still reads public.profiles — P1.4 did not rewrite it'
);
select is(
  (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'is_staff') ~ 'profiles',
  true,
  'is_staff() still reads public.profiles'
);
select is(
  (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'is_bar_manager') ~ 'profiles',
  true,
  'is_bar_manager() still reads public.profiles'
);


-- ---------------------------------------------------------------------------
-- B. Privileges — the layer that binds service_role (SAFEGUARDING.md §1.2)
-- ---------------------------------------------------------------------------

-- 25, 26, 27
select table_privs_are(
  'public', 'person_roles', 'anon', array[]::text[],
  'anon holds no privilege at all on public.person_roles'
);
select table_privs_are(
  'public', 'person_roles', 'authenticated', array['SELECT', 'INSERT', 'UPDATE'],
  'authenticated holds exactly select/insert/update'
);
select table_privs_are(
  'public', 'person_roles', 'service_role', array['SELECT', 'INSERT', 'UPDATE'],
  'service_role holds exactly select/insert/update'
);

-- 28..33 — spelled out individually: this is what catches a later
-- `grant all on all tables in schema public` restoring the ability to destroy
-- role history.
select ok(not has_table_privilege('anon', 'public.person_roles', 'DELETE'),
  'anon cannot DELETE from person_roles');
select ok(not has_table_privilege('anon', 'public.person_roles', 'TRUNCATE'),
  'anon cannot TRUNCATE person_roles');
select ok(not has_table_privilege('authenticated', 'public.person_roles', 'DELETE'),
  'authenticated cannot DELETE from person_roles');
select ok(not has_table_privilege('authenticated', 'public.person_roles', 'TRUNCATE'),
  'authenticated cannot TRUNCATE person_roles');
select ok(not has_table_privilege('service_role', 'public.person_roles', 'DELETE'),
  'service_role cannot DELETE from person_roles, BYPASSRLS notwithstanding');
select ok(not has_table_privilege('service_role', 'public.person_roles', 'TRUNCATE'),
  'service_role cannot TRUNCATE person_roles');

-- 34..38 — the helpers. anon is excluded by name: person_has_role() is a
-- SECURITY DEFINER lookup on somebody else's roles, so granting it to an
-- unauthenticated caller would make it a probe for "who is the safeguarding
-- lead?".
select ok(
  not has_function_privilege('anon', 'public.has_role(public.app_role)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.has_any_role(public.app_role[])', 'EXECUTE')
  and not has_function_privilege('anon', 'public.person_has_role(uuid, public.app_role)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.is_club_admin()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.is_safeguarding_lead()', 'EXECUTE'),
  'anon can execute none of the five role helpers'
);
select ok(
  has_function_privilege('authenticated', 'public.has_role(public.app_role)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.has_any_role(public.app_role[])', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.person_has_role(uuid, public.app_role)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.is_club_admin()', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.is_safeguarding_lead()', 'EXECUTE'),
  'authenticated can execute all five role helpers'
);
select ok(
  has_function_privilege('service_role', 'public.has_role(public.app_role)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.has_any_role(public.app_role[])', 'EXECUTE')
  and has_function_privilege('service_role', 'public.person_has_role(uuid, public.app_role)', 'EXECUTE'),
  'service_role can execute the role helpers'
);
select ok(
  not has_function_privilege('anon', 'public.backfill_person_roles()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.backfill_person_roles()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.backfill_person_roles()', 'EXECUTE'),
  'no API role can execute public.backfill_person_roles() — it is a migration tool'
);
select ok(
  not has_function_privilege('anon', 'public.person_roles_audit()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.person_roles_audit()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.person_roles_audit()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.profiles_sync_person_roles()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.profiles_sync_person_roles()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.profiles_sync_person_roles()', 'EXECUTE'),
  'no API role can execute either trigger function'
);

-- 39
select ok(
  not has_function_privilege('anon', 'public.map_user_role_to_app_role(public.user_role)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.map_user_role_to_app_role(public.user_role)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.map_user_role_to_app_role(public.user_role)', 'EXECUTE'),
  'no API role can execute the legacy mapping function'
);


-- ---------------------------------------------------------------------------
-- C. The helpers
-- ---------------------------------------------------------------------------

-- 40 — no JWT: current_person_id() is NULL, so nothing matches and the helper
-- returns FALSE, not NULL. A policy reading NULL as "no" would be correct but
-- would rely on the reader knowing it.
set local role authenticated;

select is(
  (select public.has_role('club_admin'::public.app_role)),
  false,
  'has_role() is FALSE (not null) when there is no JWT subject'
);

reset role;

-- 41, 42 — anon cannot call them at all.
set local role anon;

select throws_ok(
  $$select public.has_role('member'::public.app_role)$$,
  '42501',
  null,
  'anon is denied EXECUTE on has_role()'
);
select throws_ok(
  $$select public.person_has_role('b2b2b2b2-2222-4222-8222-000000000002', 'coach'::public.app_role)$$,
  '42501',
  null,
  'anon is denied EXECUTE on person_has_role() — it would otherwise be a "who is the lead?" probe'
);

reset role;

-- --- the club_admin ---------------------------------------------------------
set local request.jwt.claims to '{"sub":"a1a1a1a1-1111-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;

-- 43, 44, 45, 46
select ok((select public.has_role('club_admin'::public.app_role)),
  'a committee profile holds club_admin (via the P1.4 mapping)');
select ok(not (select public.has_role('safeguarding_lead'::public.app_role)),
  'and does NOT hold safeguarding_lead — nobody is granted it automatically (D9)');
select ok((select public.is_club_admin()),
  'is_club_admin() agrees');
select ok(not (select public.is_safeguarding_lead()),
  'is_safeguarding_lead() agrees');

-- 47, 48
select ok(
  (select public.has_any_role(array['club_admin', 'safeguarding_lead']::public.app_role[])),
  'has_any_role() is true when one of the listed roles is held');
select ok(
  not (select public.has_any_role(array['coach', 'hirer']::public.app_role[])),
  'and false when none is');

-- 49, 50 — the third-person form. It answers about somebody else and takes no
-- account of the caller; SG-6 tier 1(b) is the consumer (P2.1).
select ok(
  (select public.person_has_role('b2b2b2b2-2222-4222-8222-000000000002', 'coach'::public.app_role)),
  'person_has_role() sees a role held by another person entirely');
select ok(
  not (select public.person_has_role('b2b2b2b2-2222-4222-8222-000000000001', 'coach'::public.app_role)),
  'and is false for a person who holds nothing');

reset role;

-- --- the safeguarding_lead --------------------------------------------------
set local request.jwt.claims to '{"sub":"a1a1a1a1-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;

-- 51, 52, 53
select ok((select public.is_safeguarding_lead()),
  'the hand-granted safeguarding_lead holds it');
select ok(not (select public.is_club_admin()),
  'and does not thereby hold club_admin — the two roles are separate (SG-3)');
select ok((select public.has_role('member'::public.app_role)),
  'a person holds several roles at once: Lee is a member as well as the lead');

reset role;

-- --- a revoked role ---------------------------------------------------------
-- Revoked as the owner, so that the assertion is about has_role() and not about
-- the RLS write path (section F covers that).
update public.person_roles
   set revoked_at = now()
 where person_id = current_setting('test.member_person')::uuid
   and role = 'member'
   and revoked_at is null;

set local request.jwt.claims to '{"sub":"a1a1a1a1-1111-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;

-- 54, 55
select ok(not (select public.has_role('member'::public.app_role)),
  'a REVOKED role is not held — has_role() reads revoked_at, not mere existence');
select ok(
  not (select public.has_any_role(array['member', 'club_admin']::public.app_role[])),
  'and has_any_role() agrees');

reset role;

-- 56 — but the row survives. This is the whole of the soft-revoke decision: the
-- history of who could read what, when, is what SG-7 makes answerable.
select is(
  (select count(*)::int from public.person_roles
    where person_id = current_setting('test.member_person')::uuid
      and role = 'member'),
  1,
  'the revoked grant row is still there — a revoke is not a delete'
);

-- Put it back for the sections that follow. Re-granting is a NEW row; the
-- revoked one stays.
insert into public.person_roles (person_id, role, notes)
values (current_setting('test.member_person')::uuid, 'member', 'restored by test');

-- 57
select is(
  (select count(*)::int from public.person_roles
    where person_id = current_setting('test.member_person')::uuid
      and role = 'member'),
  2,
  'a re-grant is a second row, so the gap between the two is preserved'
);


-- ---------------------------------------------------------------------------
-- D. The legacy mapping, applied by the sync trigger
-- ---------------------------------------------------------------------------
-- The six user_role values, one profile each. Setting profiles.role is exactly
-- what apps/web does today (super-users/actions.ts:24, settings/actions.ts:124,
-- 167, 225), so this is the real path, not a simulation of one.

update public.profiles set role = 'committee'
 where id = 'a1a1a1a1-1111-4111-8111-000000000004';
update public.profiles set role = 'super_user'
 where id = 'a1a1a1a1-1111-4111-8111-000000000005';
update public.profiles set role = 'bar'
 where id = 'a1a1a1a1-1111-4111-8111-000000000006';
update public.profiles set role = 'bar_manager'
 where id = 'a1a1a1a1-1111-4111-8111-000000000007';
update public.profiles set role = 'staff'
 where id = 'a1a1a1a1-1111-4111-8111-000000000008';
-- ...000009 keeps the default 'member' from handle_new_user().

-- 58 — the whole mapping table in one assertion, so a change to any row of it
-- is a visible test change.
select results_eq(
  $$select p.role::text, pr.role::text
      from public.profiles p
      join public.person_roles pr
        on pr.person_id = p.person_id and pr.revoked_at is null
     where p.id in ('a1a1a1a1-1111-4111-8111-000000000004',
                    'a1a1a1a1-1111-4111-8111-000000000005',
                    'a1a1a1a1-1111-4111-8111-000000000006',
                    'a1a1a1a1-1111-4111-8111-000000000007',
                    'a1a1a1a1-1111-4111-8111-000000000008',
                    'a1a1a1a1-1111-4111-8111-000000000009')
     order by 1, 2$$,
  $$values ('bar'::text,         'staff'::text),
           ('bar_manager'::text, 'staff'::text),
           ('committee'::text,   'club_admin'::text),
           ('member'::text,      'member'::text),
           ('staff'::text,       'staff'::text),
           ('super_user'::text,  'club_admin'::text)$$,
  'the legacy mapping: super_user/committee -> club_admin, bar/bar_manager/staff -> staff, member -> member'
);

-- 59 — exactly one live role each. The promotions above revoked the `member`
-- grant handle_new_user() had made; nothing accumulated.
select results_eq(
  $$select count(*)::int from public.person_roles pr
     join public.profiles p on p.person_id = pr.person_id
    where p.id in ('a1a1a1a1-1111-4111-8111-000000000004',
                   'a1a1a1a1-1111-4111-8111-000000000005',
                   'a1a1a1a1-1111-4111-8111-000000000006',
                   'a1a1a1a1-1111-4111-8111-000000000007',
                   'a1a1a1a1-1111-4111-8111-000000000008')
      and pr.revoked_at is null$$,
  array[5],
  'each promoted profile holds exactly one live role — the old one was revoked, not left standing'
);

-- 60 — and NOBODY got safeguarding_lead, coach, parent or hirer out of the
-- mapping. D9: "Adam assigns it by hand."
select is(
  (select count(*)::int from public.person_roles pr
    where pr.role in ('safeguarding_lead', 'coach', 'parent', 'hirer')
      and pr.notes like 'synced from profiles.role%'),
  0,
  'no role outside {club_admin, staff, member} is ever produced by the mapping'
);

-- --- promotion and demotion in the old UI -----------------------------------

-- 61
select is(
  (select pr.role::text from public.person_roles pr
    where pr.person_id = (select person_id from public.profiles
                           where id = 'a1a1a1a1-1111-4111-8111-000000000010')
      and pr.revoked_at is null),
  'member',
  'Pat starts as a member (granted by the AFTER INSERT arm on signup)'
);

update public.profiles set role = 'committee'
 where id = 'a1a1a1a1-1111-4111-8111-000000000010';

-- 62 — a profile promoted to committee in the old UI GAINS club_admin.
select results_eq(
  $$select pr.role::text from public.person_roles pr
     where pr.person_id = (select person_id from public.profiles
                            where id = 'a1a1a1a1-1111-4111-8111-000000000010')
       and pr.revoked_at is null$$,
  $$values ('club_admin'::text)$$,
  'promoting a profile to committee grants club_admin'
);

-- 63 — ...and LOSES member, by revocation rather than deletion.
select is(
  (select revoked_at is not null from public.person_roles pr
    where pr.person_id = (select person_id from public.profiles
                           where id = 'a1a1a1a1-1111-4111-8111-000000000010')
      and pr.role = 'member'),
  true,
  'and revokes the member grant it replaces (soft, so the history survives)'
);

update public.profiles set role = 'member'
 where id = 'a1a1a1a1-1111-4111-8111-000000000010';

-- 64 — demotion is the mirror image.
select results_eq(
  $$select pr.role::text from public.person_roles pr
     where pr.person_id = (select person_id from public.profiles
                            where id = 'a1a1a1a1-1111-4111-8111-000000000010')
       and pr.revoked_at is null$$,
  $$values ('member'::text)$$,
  'demoting the profile back to member revokes club_admin and re-grants member'
);

-- 65 — three rows now: the original member grant, the club_admin grant, the new
-- member grant. Two revoked, one live. The record reads as the sequence of
-- administrative acts that actually happened.
select is(
  (select count(*)::int from public.person_roles pr
    where pr.person_id = (select person_id from public.profiles
                           where id = 'a1a1a1a1-1111-4111-8111-000000000010')),
  3,
  'promotion and demotion leave three rows: nothing is overwritten'
);

-- --- no churn where the mapping does not change -----------------------------
-- 'bar' and 'bar_manager' both map to `staff`. A bar promotion must not revoke
-- and re-grant the same role: that would reset granted_at and write two audit
-- rows for a change that did not alter the person's standing.

select set_config('test.bar_grant_id',
  (select pr.id::text from public.person_roles pr
     join public.profiles p on p.person_id = pr.person_id
    where p.id = 'a1a1a1a1-1111-4111-8111-000000000006'
      and pr.revoked_at is null), true);

update public.profiles set role = 'bar_manager'
 where id = 'a1a1a1a1-1111-4111-8111-000000000006';

-- 66
select is(
  (select pr.id::text from public.person_roles pr
     join public.profiles p on p.person_id = pr.person_id
    where p.id = 'a1a1a1a1-1111-4111-8111-000000000006'
      and pr.revoked_at is null),
  current_setting('test.bar_grant_id'),
  'bar -> bar_manager both map to staff, so the SAME grant row survives untouched'
);

-- 67 — and no revoked duplicate was created behind it.
select is(
  (select count(*)::int from public.person_roles pr
     join public.profiles p on p.person_id = pr.person_id
    where p.id = 'a1a1a1a1-1111-4111-8111-000000000006'),
  2,
  'the person still has exactly their two rows (revoked member + live staff)'
);

-- --- a brand-new signup, i.e. a profile inserted BY A TRIGGER ---------------
-- handle_new_user() is deliberately NOT taught about person_roles: an AFTER
-- INSERT trigger on profiles fires for a trigger-issued insert like any other.
-- This asserts that rather than assuming it.

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1a1a1a1-1111-4111-8111-000000000011', 'rfresh@test.invalid',
   '{"full_name": "Fred Fresh"}'::jsonb);

-- 68
select results_eq(
  $$select pr.role::text from public.person_roles pr
     where pr.person_id = (select person_id from public.profiles
                            where id = 'a1a1a1a1-1111-4111-8111-000000000011')
       and pr.revoked_at is null$$,
  $$values ('member'::text)$$,
  'a brand-new signup gets `member` — the profiles AFTER INSERT trigger fires for handle_new_user()''s own insert'
);

-- 69 — the apps/web upsert shape (insert ... on conflict do update), which is
-- how super-users/actions.ts and settings/actions.ts change a role.
select lives_ok(
  $$insert into public.profiles (id, role, full_name)
    values ('a1a1a1a1-1111-4111-8111-000000000011', 'staff', 'Fred Fresh')
    on conflict (id) do update
       set role = excluded.role, full_name = excluded.full_name$$,
  'the apps/web upsert shape still works with the sync trigger attached'
);

-- 70
select results_eq(
  $$select pr.role::text from public.person_roles pr
     where pr.person_id = (select person_id from public.profiles
                            where id = 'a1a1a1a1-1111-4111-8111-000000000011')
       and pr.revoked_at is null$$,
  $$values ('staff'::text)$$,
  'and the upsert''s UPDATE branch syncs the role through'
);


-- ---------------------------------------------------------------------------
-- E. backfill_person_roles()
-- ---------------------------------------------------------------------------
-- The migration ran it once: 39 grants on prod, 0 locally (no profiles). Both
-- are correct, and every assertion here is about the invariant rather than the
-- number.

-- 71 — exactly one summary audit row, not one per grant. Scoped by entity
-- because P1.2's backfill uses the same action for `profiles`.
select is(
  (select count(*)::int from public.audit_log
    where action = 'migration.backfill' and entity = 'person_roles'),
  1,
  'the migration wrote exactly ONE migration.backfill audit row for person_roles'
);

-- 72
select results_eq(
  $$select actor_id, actor_email, detail ->> 'migration'
      from public.audit_log
     where action = 'migration.backfill' and entity = 'person_roles'$$,
  $$values (null::uuid, 'migration'::text, '20260822130000_roles'::text)$$,
  'and it follows the baseline audit_log conventions (actor_id null, actor_email migration)'
);

-- 73 — the mapping is recorded in the audit row itself, so the 39 grants stay
-- explained by one row a year from now.
select is(
  (select detail -> 'mapping' ->> 'committee' from public.audit_log
    where action = 'migration.backfill' and entity = 'person_roles'),
  'club_admin',
  'the audit row carries the mapping it applied'
);

-- Reconstruct the pre-migration state for a handful of people: revoke every
-- live grant the six mapping profiles hold, then re-run the backfill. Revoking
-- (rather than deleting) is the only way to do this, which is itself the point
-- of section G.
update public.person_roles
   set revoked_at = now()
 where revoked_at is null
   and person_id in (
     select person_id from public.profiles
      where id in ('a1a1a1a1-1111-4111-8111-000000000004',
                   'a1a1a1a1-1111-4111-8111-000000000005',
                   'a1a1a1a1-1111-4111-8111-000000000006',
                   'a1a1a1a1-1111-4111-8111-000000000007',
                   'a1a1a1a1-1111-4111-8111-000000000008',
                   'a1a1a1a1-1111-4111-8111-000000000009')
   );

select set_config('test.granted_audit_before',
  (select count(*)::text from public.audit_log where action = 'role.granted'), true);

-- 74 — six profiles hold nothing; every other profile in the database already
-- holds its mapped role, so the count is data-independent.
select results_eq(
  $$select roles_created from public.backfill_person_roles()$$,
  $$values (6)$$,
  'the backfill grants exactly the roles that are missing, and nothing else'
);

-- 75 — with the mapping applied, and the provenance recorded in notes.
select results_eq(
  $$select p.role::text, pr.role::text
      from public.profiles p
      join public.person_roles pr
        on pr.person_id = p.person_id and pr.revoked_at is null
     where p.id in ('a1a1a1a1-1111-4111-8111-000000000004',
                    'a1a1a1a1-1111-4111-8111-000000000005',
                    'a1a1a1a1-1111-4111-8111-000000000006',
                    'a1a1a1a1-1111-4111-8111-000000000007',
                    'a1a1a1a1-1111-4111-8111-000000000008',
                    'a1a1a1a1-1111-4111-8111-000000000009')
       and pr.notes like 'backfilled from profiles.role%'
     order by 1, 2$$,
  $$values ('bar_manager'::text, 'staff'::text),
           ('bar_manager'::text, 'staff'::text),
           ('committee'::text,   'club_admin'::text),
           ('member'::text,      'member'::text),
           ('staff'::text,       'staff'::text),
           ('super_user'::text,  'club_admin'::text)$$,
  'the backfill applies the same mapping as the trigger — one shared function, no drift'
);

-- 76 — SUPPRESSION. The backfill just created six grants and wrote no
-- role.granted rows: 39 identical rows attributed to nobody would bury the
-- grants a human actually made.
select results_eq(
  $$select count(*)::int from public.audit_log where action = 'role.granted'$$,
  $$select current_setting('test.granted_audit_before')::int$$,
  'the backfill wrote NO per-grant audit rows — the summary row is the record (SG-7)'
);

-- 77 — and the GUC did not leak: it is set with is_local => true and cleared by
-- the function, so an ordinary grant right afterwards is logged normally.
select is(
  (select current_setting('app.person_roles_audit_suppressed', true)),
  'off',
  'the suppression GUC is cleared when the backfill returns'
);

-- 78 — idempotence.
select results_eq(
  $$select roles_created from public.backfill_person_roles()$$,
  $$values (0)$$,
  're-running the backfill grants nothing'
);

-- 79
select is(
  (select count(*)::int from public.audit_log
    where action = 'migration.backfill' and entity = 'person_roles'),
  1,
  'and writes no further summary row — that row belongs to the migration, not the function'
);


-- ---------------------------------------------------------------------------
-- E2. SG-7 — an ordinary grant and revoke ARE logged
-- ---------------------------------------------------------------------------

set local request.jwt.claims to '{"sub":"a1a1a1a1-1111-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;

-- 80
select lives_ok(
  $$insert into public.person_roles (person_id, role)
    values ('b2b2b2b2-2222-4222-8222-000000000001', 'coach')$$,
  'a club_admin grants a role'
);

reset role;

-- 81 — the SG-7 row, with the actor resolved from the JWT and the email from
-- auth.users. `detail` carries the person and the role and nothing else.
select results_eq(
  $$select actor_id, actor_email, entity,
           detail ->> 'person_id', detail ->> 'role'
      from public.audit_log
     where action = 'role.granted'
       and detail ->> 'person_id' = 'b2b2b2b2-2222-4222-8222-000000000001'$$,
  $$values ('a1a1a1a1-1111-4111-8111-000000000001'::uuid,
            'radmin@test.invalid'::text,
            'person_roles'::text,
            'b2b2b2b2-2222-4222-8222-000000000001'::text,
            'coach'::text)$$,
  'the grant wrote a role.granted audit row naming the actor, the person and the role'
);

-- 82 — entity_id is the grant row, so the log points at the record it describes.
select is(
  (select a.entity_id = pr.id::text
     from public.audit_log a, public.person_roles pr
    where a.action = 'role.granted'
      and a.detail ->> 'person_id' = 'b2b2b2b2-2222-4222-8222-000000000001'
      and pr.person_id = 'b2b2b2b2-2222-4222-8222-000000000001'
      and pr.role = 'coach'),
  true,
  'and its entity_id is the person_roles row id'
);

-- 83 — `notes` is NOT copied into detail. SG-7: "detail must never contain the
-- content it is logging access to", and audit_read is is_committee(), which is
-- wider than this table's own read policies.
select is(
  (select detail ? 'notes' from public.audit_log
    where action = 'role.granted'
      and detail ->> 'person_id' = 'b2b2b2b2-2222-4222-8222-000000000001'),
  false,
  'detail carries no notes text (SG-7)'
);

set local request.jwt.claims to '{"sub":"a1a1a1a1-1111-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;

update public.person_roles
   set revoked_at = now()
 where person_id = 'b2b2b2b2-2222-4222-8222-000000000001'
   and role = 'coach'
   and revoked_at is null;

reset role;

-- 84
select results_eq(
  $$select actor_id, detail ->> 'role'
      from public.audit_log
     where action = 'role.revoked'
       and detail ->> 'person_id' = 'b2b2b2b2-2222-4222-8222-000000000001'$$,
  $$values ('a1a1a1a1-1111-4111-8111-000000000001'::uuid, 'coach'::text)$$,
  'the revoke wrote a role.revoked audit row'
);

-- 85 — a cosmetic edit writes nothing. An audit log that records typo fixes is
-- one nobody reads.
select set_config('test.audit_total',
  (select count(*)::text from public.audit_log where entity = 'person_roles'), true);

update public.person_roles
   set notes = 'typo fixed'
 where person_id = 'b2b2b2b2-2222-4222-8222-000000000001'
   and role = 'coach';

select results_eq(
  $$select count(*)::int from public.audit_log where entity = 'person_roles'$$,
  $$select current_setting('test.audit_total')::int$$,
  'editing notes writes no audit row — only grants and revocations are events'
);


-- ---------------------------------------------------------------------------
-- F. RLS on person_roles
-- ---------------------------------------------------------------------------

select set_config('test.roles_total',
  (select count(*)::text from public.person_roles), true);
select set_config('test.member_live_roles',
  (select count(*)::text from public.person_roles
    where person_id = current_setting('test.member_person')::uuid
      and revoked_at is null), true);
select set_config('test.member_all_roles',
  (select count(*)::text from public.person_roles
    where person_id = current_setting('test.member_person')::uuid), true);

-- --- an ordinary member -----------------------------------------------------
set local request.jwt.claims to '{"sub":"a1a1a1a1-1111-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;

-- 86
select results_eq(
  $$select count(*)::int from public.person_roles$$,
  $$select current_setting('test.member_live_roles')::int$$,
  'a member reads their own LIVE roles and nothing else'
);

-- 87 — including not their own revoked ones: "you used to be a coach" is a
-- conversation for a human, not a discovery in a role list.
select ok(
  current_setting('test.member_all_roles')::int > current_setting('test.member_live_roles')::int,
  'the member has revoked rows that the count above deliberately excludes'
);

-- 88
select is_empty(
  $$select id from public.person_roles
     where person_id <> current_setting('test.member_person')::uuid$$,
  'and nothing belonging to anybody else'
);

-- 89 — a member cannot grant themselves anything.
select throws_ok(
  $$insert into public.person_roles (person_id, role)
    values (current_setting('test.member_person')::uuid, 'club_admin')$$,
  '42501',
  null,
  'a member cannot grant themselves club_admin'
);

reset role;

-- --- the club_admin ---------------------------------------------------------
set local request.jwt.claims to '{"sub":"a1a1a1a1-1111-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;

-- 90
select results_eq(
  $$select count(*)::int from public.person_roles$$,
  $$select current_setting('test.roles_total')::int$$,
  'a club_admin reads every grant, revoked ones included'
);

reset role;

-- --- the safeguarding_lead --------------------------------------------------
set local request.jwt.claims to '{"sub":"a1a1a1a1-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;

-- 91
select results_eq(
  $$select count(*)::int from public.person_roles$$,
  $$select current_setting('test.roles_total')::int$$,
  'a safeguarding_lead reads every grant too (SG-6 needs to know who holds coach; D9 needs to know who else holds the lead)'
);

-- 92 — but cannot write. A lead who could grant roles could grant themselves
-- club_admin, or appoint a second lead, which is D9's decision and not theirs.
select throws_ok(
  $$insert into public.person_roles (person_id, role)
    values ('b2b2b2b2-2222-4222-8222-000000000001', 'club_admin')$$,
  '42501',
  null,
  'a safeguarding_lead cannot grant a role — write is club_admin only'
);

-- 93 — nor revoke one. An UPDATE with no matching policy is not an error; it
-- simply matches no rows, so the assertion is that nothing changed.
update public.person_roles
   set revoked_at = now()
 where person_id = current_setting('test.admin_person')::uuid
   and revoked_at is null;

reset role;

select ok(
  (select public.person_has_role(current_setting('test.admin_person')::uuid,
                                 'club_admin'::public.app_role)),
  'a safeguarding_lead''s revoke of the club_admin''s role silently affects no rows'
);

-- --- anon -------------------------------------------------------------------
set local role anon;

-- 94, 95
select throws_ok(
  $$select id from public.person_roles$$,
  '42501',
  null,
  'anon reading person_roles is denied at the privilege layer'
);
select throws_ok(
  $$insert into public.person_roles (person_id, role)
    values ('b2b2b2b2-2222-4222-8222-000000000001', 'club_admin')$$,
  '42501',
  null,
  'anon cannot grant a role'
);

reset role;

-- --- staff, who must see nothing --------------------------------------------
set local request.jwt.claims to '{"sub":"a1a1a1a1-1111-4111-8111-000000000008","role":"authenticated"}';
set local role authenticated;

-- 96
select is_empty(
  $$select id from public.person_roles
     where person_id <> (select person_id from public.profiles
                          where id = 'a1a1a1a1-1111-4111-8111-000000000008')$$,
  'operational staff see no role but their own (SAFEGUARDING.md §1.3: no inherent access to member data)'
);

reset role;


-- ---------------------------------------------------------------------------
-- G. SG-2 — no hard delete, no truncate, at every layer
-- ---------------------------------------------------------------------------
-- P1.3 declined deny_hard_delete() on guardianships because SG-1.8 needs that
-- delete to stay reachable. There is no equivalent here: a role granted in
-- error is corrected by revoking it, which leaves an honest record instead of
-- an unremovable falsehood, and the grant is what authorises the safeguarding
-- access SG-7 logs — delete it and the log becomes unexplainable.

set local request.jwt.claims to '{"sub":"a1a1a1a1-1111-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;

-- 97
select throws_ok(
  $$delete from public.person_roles
     where person_id = 'b2b2b2b2-2222-4222-8222-000000000001'$$,
  '42501',
  null,
  'even a club_admin cannot hard-delete a grant (privilege revoked)'
);

-- 98
select throws_ok(
  $$truncate public.person_roles$$,
  '42501',
  null,
  'authenticated cannot truncate person_roles'
);

reset role;
set local role service_role;

-- 99, 100
select throws_ok(
  $$delete from public.person_roles
     where person_id = 'b2b2b2b2-2222-4222-8222-000000000001'$$,
  '42501',
  null,
  'service_role cannot hard-delete a grant, BYPASSRLS notwithstanding'
);
select throws_ok(
  $$truncate public.person_roles$$,
  '42501',
  null,
  'service_role cannot truncate person_roles'
);

reset role;
set local role anon;

-- 101
select throws_ok(
  $$truncate public.person_roles$$,
  '42501',
  null,
  'anon cannot truncate person_roles'
);

reset role;

-- 102, 103 — the two that matter: the owner is not stopped by a revoked
-- privilege, only by the triggers.
select throws_ok(
  $$delete from public.person_roles
     where person_id = 'b2b2b2b2-2222-4222-8222-000000000001'$$,
  'P0001',
  null,
  'the table owner is stopped by trg_person_roles_deny_hard_delete (SG-2)'
);
select throws_ok(
  $$truncate public.person_roles$$,
  'P0001',
  null,
  'and by trg_person_roles_deny_truncate — a row-level delete trigger never fires on TRUNCATE'
);


-- ---------------------------------------------------------------------------
-- H. The P1.1 / P1.3 policy rewrite
-- ---------------------------------------------------------------------------
-- REGRESSION: a club_admin must behave on public.people and public.guardianships
-- exactly as a committee member did before this migration. Every profile with
-- role 'committee' or 'super_user' — precisely the set is_committee() answers
-- true for — holds club_admin as of the backfill, and the sync trigger keeps
-- that true, so the rewrite is additive in effect even though it is a
-- drop-and-recreate.

select set_config('test.people_total',
  (select count(*)::text from public.people), true);

-- --- the club_admin, i.e. what the committee used to be ---------------------
set local request.jwt.claims to '{"sub":"a1a1a1a1-1111-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;

-- 104
select results_eq(
  $$select count(*)::int from public.people$$,
  $$select current_setting('test.people_total')::int$$,
  'a club_admin reads every person row — exactly what people_committee_read gave the committee'
);

-- 105
select lives_ok(
  $$insert into public.people (first_name, last_name, dob)
    values ('New', 'Recruit', date '2015-05-05')$$,
  'a club_admin can insert a person'
);

-- 106
select lives_ok(
  $$update public.people set notes = 'written by club_admin'
     where id = 'b2b2b2b2-2222-4222-8222-000000000001'$$,
  'and update one'
);

-- 107 — the guardianship write SG-4 gives both admin roles.
select lives_ok(
  $$insert into public.guardianships
      (id, guardian_person_id, child_person_id, relationship)
    values ('c3c3c3c3-3333-4333-8333-000000000001',
            'b2b2b2b2-2222-4222-8222-000000000004',
            'b2b2b2b2-2222-4222-8222-000000000003', 'parent')$$,
  'a club_admin can create a guardianship'
);

reset role;

-- 108
select is(
  (select notes from public.people
    where id = 'b2b2b2b2-2222-4222-8222-000000000001'),
  'written by club_admin',
  'the club_admin UPDATE was applied'
);

select set_config('test.links_total',
  (select count(*)::text from public.guardianships), true);

-- --- the safeguarding_lead --------------------------------------------------
-- §1.3: read people to do the job; write remit is safeguarding, not member
-- administration. SG-4, by contrast, gives BOTH admin roles write on
-- guardianships, in terms, and SAFEGUARDING.md outranks a task description
-- (§1), so that is what is implemented.

set local request.jwt.claims to '{"sub":"a1a1a1a1-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;

-- 109
select results_eq(
  $$select count(*)::int from public.people$$,
  $$select (current_setting('test.people_total')::int + 1)$$,
  'a safeguarding_lead reads every person row (+1 for the recruit the club_admin just added)'
);

-- 110
select throws_ok(
  $$insert into public.people (first_name, last_name)
    values ('Lead', 'Written')$$,
  '42501',
  null,
  'but a safeguarding_lead cannot INSERT a person — member administration is club_admin''s (§1.3)'
);

-- An UPDATE with no matching policy is not an error; it matches no rows. The
-- assertion is at 113, after the impersonation is dropped.
update public.people set notes = 'written by the lead'
 where id = 'b2b2b2b2-2222-4222-8222-000000000001';

-- 111
select results_eq(
  $$select count(*)::int from public.guardianships$$,
  $$select current_setting('test.links_total')::int$$,
  'a safeguarding_lead reads every guardianship (SG-4: "club_admin and safeguarding_lead may SELECT and write all")'
);

-- 112 — and writes them, which SG-4 makes load-bearing: SG-1.8 exists precisely
-- because "an administrator correcting a family record must not be able to
-- silently strip the guardian out of a conversation the child is in".
select lives_ok(
  $$update public.guardianships set notes = 'reviewed by the welfare officer'
     where id = 'c3c3c3c3-3333-4333-8333-000000000001'$$,
  'a safeguarding_lead can write guardianships (SG-4, in terms)'
);

reset role;

-- 113
select is(
  (select notes from public.people
    where id = 'b2b2b2b2-2222-4222-8222-000000000001'),
  'written by club_admin',
  'the safeguarding_lead''s people UPDATE silently affected no rows'
);

-- --- staff and a plain member, on people ------------------------------------
set local request.jwt.claims to '{"sub":"a1a1a1a1-1111-4111-8111-000000000008","role":"authenticated"}';
set local role authenticated;

-- 114
select results_eq(
  $$select id from public.people$$,
  $$select person_id from public.profiles
     where id = 'a1a1a1a1-1111-4111-8111-000000000008'$$,
  'operational staff still read only their own person row — the P1.1 refusal survives the rewrite'
);

reset role;

set local request.jwt.claims to '{"sub":"a1a1a1a1-1111-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;

-- 115
select is_empty(
  $$select id from public.guardianships$$,
  'a plain member sees no guardianship — the rewrite did not widen anything'
);

reset role;

select * from finish();

rollback;
