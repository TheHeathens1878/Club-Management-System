-- =============================================================================
-- P1.3 — public.guardianships
-- =============================================================================
-- SAFEGUARDING.md §3 test convention: "Every test named below attempts the
-- prohibited action and asserts that it fails. A test that only asserts the
-- happy path does not satisfy the invariant."
--
-- SG-4's named tests and where they are below:
--   guardianship_of_adult_child_throws                     -> D
--   guardianship_by_minor_guardian_throws                  -> D
--   self_guardianship_throws                               -> D
--   guardianship_with_unknown_guardian_dob_throws          -> D
--   duplicate_guardianship_throws                          -> E
--   guardian_sees_only_own_children                        -> H
--   guardianship_survives_child_turning_18_but_access_lapses -> I
--
-- SG-1.8's four tests (guardianship_delete_blocked_when_it_creates_1to1 and
-- friends) belong to P5.2 and cannot exist yet — `public.conversations` does
-- not exist. Section G asserts the scaffold instead: the trigger is present,
-- with the right timing and the right column list, and is currently permissive
-- for exactly the reason the migration says it is.
--
-- Impersonation follows people_rls.test.sql:
--     set local request.jwt.claims to '{"sub":"<uuid>","role":"authenticated"}';
--     set local role authenticated;
-- because is_committee() and current_person_id() resolve auth.uid(), which
-- reads `request.jwt.claims ->> 'sub'`.
--
-- Every count assertion compares against a value captured by the table owner
-- into a transaction-local setting, never a literal: this suite must also pass
-- on a prod-shaped preview branch where `people` already holds the P1.2
-- backfill rows.
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(80);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- Three logins. Each fires the baseline's on_auth_user_created trigger, which
-- since P1.2 creates a profile AND a person — with dob null, i.e. a minor
-- (SG-0). The guardian's person therefore has to be given a real dob before it
-- can hold a link, which is itself the SG-4 asymmetry in action.

insert into auth.users (id, email, raw_user_meta_data) values
  ('88888888-8888-4888-8888-000000000001', 'gcommittee@test.invalid',
   '{"full_name": "Cora Committee"}'::jsonb),
  ('88888888-8888-4888-8888-000000000002', 'gguardian@test.invalid',
   '{"full_name": "Gina Guardian"}'::jsonb),
  ('88888888-8888-4888-8888-000000000003', 'gnolinks@test.invalid',
   '{"full_name": "Norman Nolinks"}'::jsonb);

update public.profiles set role = 'committee'
 where id = '88888888-8888-4888-8888-000000000001';

update public.people
   set dob = date '1985-06-01'
 where id = (select person_id from public.profiles
              where id = '88888888-8888-4888-8888-000000000002');

-- People with no login. Ages are expressed relative to current_date so the
-- fixtures cannot rot into adulthood as the suite ages.
insert into public.people (id, first_name, last_name, dob) values
  ('99999999-9999-4999-8999-000000000001', 'Child', 'One',
   (current_date - interval '10 years')::date),
  ('99999999-9999-4999-8999-000000000002', 'Child', 'Two',
   (current_date - interval '8 years')::date),
  ('99999999-9999-4999-8999-000000000003', 'Unknowndob', 'Child', null),
  ('99999999-9999-4999-8999-000000000004', 'Adult', 'Person', date '1990-03-03'),
  ('99999999-9999-4999-8999-000000000005', 'Minor', 'Wouldbeguardian',
   (current_date - interval '12 years')::date),
  ('99999999-9999-4999-8999-000000000006', 'Unknowndob', 'Wouldbeguardian', null),
  ('99999999-9999-4999-8999-000000000007', 'Second', 'Guardian', date '1980-01-01');

select set_config(
  'test.guardian_person',
  (select person_id::text from public.profiles
    where id = '88888888-8888-4888-8888-000000000002'),
  true
);


-- ---------------------------------------------------------------------------
-- A. Schema shape  (as the owner; no impersonation yet)
-- ---------------------------------------------------------------------------

-- 1
select has_table('public', 'guardianships', 'public.guardianships exists');

-- 2 — the closed set, and the order the enum was declared in.
select enum_has_labels(
  'public', 'guardian_relationship',
  array['parent', 'step_parent', 'grandparent', 'foster_carer',
        'legal_guardian', 'other'],
  'guardian_relationship carries exactly the six declared labels'
);

-- 3, 4, 5
select col_not_null('public', 'guardianships', 'guardian_person_id',
  'guardian_person_id is NOT NULL');
select col_not_null('public', 'guardianships', 'child_person_id',
  'child_person_id is NOT NULL');
select col_not_null('public', 'guardianships', 'relationship',
  'relationship is NOT NULL');

-- 6
select col_type_is('public', 'guardianships', 'relationship',
  'guardian_relationship',
  'relationship is the enum, not text — an invalid value is a type error');

-- 7, 8
select fk_ok('public', 'guardianships', 'guardian_person_id',
             'public', 'people', 'id',
  'guardian_person_id references people.id');
select fk_ok('public', 'guardianships', 'child_person_id',
             'public', 'people', 'id',
  'child_person_id references people.id');

-- 9 — RESTRICT on both, never CASCADE. A guardian link disappearing as a side
-- effect of anything is exactly the silent transition SG-1.8 exists to stop.
select results_eq(
  $$select c.confdeltype::text
      from pg_constraint c
     where c.conrelid = 'public.guardianships'::regclass
       and c.contype = 'f'
       and c.confrelid = 'public.people'::regclass
     order by c.conname$$,
  $$values ('r'::text), ('r'::text)$$,
  'both person foreign keys are ON DELETE RESTRICT'
);

-- 10 — SG-4 asks for UNIQUE (guardian, child); this is the live-rows-only
-- refinement the migration documents at §4.
select is(
  (select indexdef from pg_indexes
    where schemaname = 'public' and indexname = 'guardianships_active_pair_idx'),
  'CREATE UNIQUE INDEX guardianships_active_pair_idx ON public.guardianships '
  || 'USING btree (guardian_person_id, child_person_id) WHERE (ended_at IS NULL)',
  'the pair is unique among LIVE links only (SG-4 refinement, see migration §4)'
);

-- 11
select is(
  (select relrowsecurity from pg_class where oid = 'public.guardianships'::regclass),
  true,
  'row level security is enabled on public.guardianships'
);

-- 12 — an exact-set assertion, so an accidentally added policy fails the build.
select policies_are(
  'public',
  'guardianships',
  array['guardianships_guardian_read', 'guardianships_committee_read',
        'guardianships_committee_insert', 'guardianships_committee_update',
        'guardianships_committee_delete'],
  'guardianships has exactly the guardian read plus the four committee policies'
);

-- 13, 14, 15, 16
select has_trigger('public', 'guardianships', 'trg_guardianships_guard',
  'the SG-4 guard trigger exists');
select has_trigger('public', 'guardianships', 'trg_guardianships_conversation_guard',
  'the SG-1.8 guard trigger exists (scaffolded in P1.3, completed in P5.2)');
select has_trigger('public', 'guardianships', 'trg_guardianships_updated',
  'set_updated_at is attached');
select has_trigger('public', 'guardianships', 'trg_guardianships_deny_truncate',
  'the SG-2 truncate guard is attached');

-- 17 — deliberately absent. SG-1.8: "a flat reject makes a mistyped or
-- genuinely-ended guardianship permanently unremovable, which is itself a
-- data-protection problem." deny_hard_delete() here would be that flat reject.
select is_empty(
  $$select t.tgname from pg_trigger t
     join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'public.guardianships'::regclass
      and p.proname = 'deny_hard_delete'$$,
  'there is NO deny_hard_delete trigger on guardianships — SG-1.8 requires the delete to stay reachable'
);

-- 18 — BEFORE (2), ROW (1), DELETE (8), UPDATE (16). The timing and the events
-- are the half of SG-1.8 that P1.3 owns; P5.2 replaces only the function body.
select is(
  (select (t.tgtype & 2 = 2) and (t.tgtype & 1 = 1)
      and (t.tgtype & 8 = 8) and (t.tgtype & 16 = 16)
     from pg_trigger t
    where t.tgrelid = 'public.guardianships'::regclass
      and t.tgname = 'trg_guardianships_conversation_guard'),
  true,
  'the SG-1.8 guard is BEFORE DELETE OR UPDATE, FOR EACH ROW'
);

-- 19 — the watched column list. SG-1.8 names guardian_person_id and
-- child_person_id; ended_at is P1.3's documented strengthening (ending a link
-- is indistinguishable from deleting it for SG-1 purposes). P5.2 must not
-- drop it.
select results_eq(
  $$select (a.attname::text) collate "default"
      from pg_trigger t
      join unnest(t.tgattr::smallint[]) as col(attnum) on true
      join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = col.attnum
     where t.tgrelid = 'public.guardianships'::regclass
       and t.tgname = 'trg_guardianships_conversation_guard'
     order by 1$$,
  $$values ('child_person_id'::text), ('ended_at'::text), ('guardian_person_id'::text)$$,
  'the SG-1.8 guard watches guardian_person_id, child_person_id AND ended_at'
);

-- 20 — SG-4: "CHECK (guardian_person_id <> child_person_id) — a plain
-- constraint, always true, no self-guardianship." The trigger raises first
-- (BEFORE ROW triggers run before constraints are evaluated), so this is the
-- backstop that would still hold if the trigger were ever disabled.
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.guardianships'::regclass
      and conname = 'guardianships_not_self' and contype = 'c'),
  1,
  'the guardianships_not_self CHECK constraint exists behind the trigger'
);


-- ---------------------------------------------------------------------------
-- B. Privileges — the layer that binds service_role, which no policy can
--    (SAFEGUARDING.md §1.2)
-- ---------------------------------------------------------------------------

-- 21, 22, 23
select table_privs_are(
  'public', 'guardianships', 'anon', array[]::text[],
  'anon holds no privilege at all on public.guardianships'
);
select table_privs_are(
  'public', 'guardianships', 'authenticated',
  array['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  'authenticated holds exactly select/insert/update/delete'
);
select table_privs_are(
  'public', 'guardianships', 'service_role',
  array['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  'service_role holds exactly select/insert/update/delete'
);

-- 24, 25, 26 — TRUNCATE is the half of SG-2 that does apply here: a row-level
-- BEFORE DELETE trigger never fires on TRUNCATE, so one statement would strip
-- every guardian link in the club without the SG-1.8 guard being consulted.
select ok(not has_table_privilege('anon', 'public.guardianships', 'TRUNCATE'),
  'anon cannot TRUNCATE guardianships');
select ok(not has_table_privilege('authenticated', 'public.guardianships', 'TRUNCATE'),
  'authenticated cannot TRUNCATE guardianships');
select ok(not has_table_privilege('service_role', 'public.guardianships', 'TRUNCATE'),
  'service_role cannot TRUNCATE guardianships');

-- 27, 28 — the deliberate departure from public.people, asserted positively so
-- that removing it is a visible test change rather than a silent tightening
-- that would break SG-1.8's specified two-step remove-a-bad-link sequence.
select ok(has_table_privilege('authenticated', 'public.guardianships', 'DELETE'),
  'authenticated CAN delete a guardianship — SG-1.8 requires the delete to be reachable');
select ok(has_table_privilege('service_role', 'public.guardianships', 'DELETE'),
  'service_role CAN delete too — SG-1.8''s tests run as service_role, and the trigger, not the grant, is what must stop it');

-- 29, 30, 31
select ok(not has_function_privilege('anon', 'public.current_person_id()', 'EXECUTE'),
  'anon cannot execute public.current_person_id()');
select ok(has_function_privilege('authenticated', 'public.current_person_id()', 'EXECUTE'),
  'authenticated can execute public.current_person_id()');
select ok(has_function_privilege('service_role', 'public.current_person_id()', 'EXECUTE'),
  'service_role can execute public.current_person_id()');

-- 32, 33 — trigger functions are never called directly.
select ok(
  not has_function_privilege('anon', 'public.guardianships_guard()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.guardianships_guard()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.guardianships_guard()', 'EXECUTE'),
  'no API role can execute public.guardianships_guard()'
);
select ok(
  not has_function_privilege('anon', 'public.guardianships_conversation_guard()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.guardianships_conversation_guard()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.guardianships_conversation_guard()', 'EXECUTE'),
  'no API role can execute public.guardianships_conversation_guard()'
);


-- ---------------------------------------------------------------------------
-- C. current_person_id()
-- ---------------------------------------------------------------------------

-- 34 — no JWT at all: auth.uid() is null, no profile matches, NULL comes back.
-- Every policy that compares a NOT NULL column to it therefore yields NULL,
-- which RLS reads as "no". Fail closed.
set local role authenticated;

select is(
  (select public.current_person_id()),
  null,
  'current_person_id() is NULL when there is no JWT subject'
);

reset role;

-- 35 — and anon cannot call it at all.
set local role anon;

select throws_ok(
  $$select public.current_person_id()$$,
  '42501',
  null,
  'anon is denied EXECUTE on current_person_id()'
);

reset role;

-- 36
set local request.jwt.claims to '{"sub":"88888888-8888-4888-8888-000000000002","role":"authenticated"}';
set local role authenticated;

select is(
  (select public.current_person_id()),
  current_setting('test.guardian_person')::uuid,
  'current_person_id() resolves a logged-in user to their own people.id'
);

reset role;


-- ---------------------------------------------------------------------------
-- D. SG-4 violations — every one attempted, every one rejected
-- ---------------------------------------------------------------------------
-- Run as the committee member: the RLS write is granted (SG-4 gives club_admin
-- and safeguarding_lead write access) and the trigger is what refuses. That is
-- the arrangement SG-4 describes — "the write is granted by RLS but the guard
-- is a trigger" — so a failure here would mean the guard, not the policy.

set local request.jwt.claims to '{"sub":"88888888-8888-4888-8888-000000000001","role":"authenticated"}';
set local role authenticated;

-- 37, 38 — guardianship_of_adult_child_throws
select throws_ok(
  $$insert into public.guardianships (guardian_person_id, child_person_id, relationship)
    values (current_setting('test.guardian_person')::uuid,
            '99999999-9999-4999-8999-000000000004', 'parent')$$,
  'P0001',
  null,
  'a guardianship over an ADULT child is rejected (SG-4)'
);
select throws_like(
  $$insert into public.guardianships (guardian_person_id, child_person_id, relationship)
    values (current_setting('test.guardian_person')::uuid,
            '99999999-9999-4999-8999-000000000004', 'parent')$$,
  '%child must be a minor at creation%',
  'and the message says which half of SG-4 failed'
);

-- 39 — guardianship_with_unknown_guardian_dob_throws. SG-4's "Deliberate
-- asymmetry": an unknown-DOB guardian fails the adult test, because "a
-- guardianship record with an unidentified adult is not a safeguarding
-- control".
select throws_like(
  $$insert into public.guardianships (guardian_person_id, child_person_id, relationship)
    values ('99999999-9999-4999-8999-000000000006',
            '99999999-9999-4999-8999-000000000001', 'legal_guardian')$$,
  '%date of birth must be known%',
  'a guardian with an unknown date of birth is rejected (SG-4)'
);

-- 40 — guardianship_by_minor_guardian_throws
select throws_like(
  $$insert into public.guardianships (guardian_person_id, child_person_id, relationship)
    values ('99999999-9999-4999-8999-000000000005',
            '99999999-9999-4999-8999-000000000001', 'grandparent')$$,
  '%guardian must be an adult%',
  'a guardian who is themselves a minor is rejected (SG-4)'
);

-- 41, 42 — self_guardianship_throws. The BEFORE ROW trigger runs before the
-- CHECK constraint is evaluated, so P0001 is the code seen in practice;
-- assertion 20 covers the constraint sitting behind it.
select throws_ok(
  $$insert into public.guardianships (guardian_person_id, child_person_id, relationship)
    values ('99999999-9999-4999-8999-000000000007',
            '99999999-9999-4999-8999-000000000007', 'other')$$,
  'P0001',
  null,
  'a person cannot be their own guardian (SG-4)'
);
select throws_like(
  $$insert into public.guardianships (guardian_person_id, child_person_id, relationship)
    values ('99999999-9999-4999-8999-000000000007',
            '99999999-9999-4999-8999-000000000007', 'other')$$,
  '%cannot be their own guardian%',
  'and the self-guardianship message is distinct from the other three'
);

-- 43 — the fail-closed direction. SG-0 makes an unknown dob a minor, so a
-- child the club knows least about is exactly the one who most needs a
-- recorded guardian; the link is ACCEPTED.
select lives_ok(
  $$insert into public.guardianships (id, guardian_person_id, child_person_id, relationship)
    values ('55555555-5555-4555-8555-000000000002',
            current_setting('test.guardian_person')::uuid,
            '99999999-9999-4999-8999-000000000003', 'foster_carer')$$,
  'a child with an UNKNOWN dob is a minor (SG-0) and the link is accepted'
);


-- ---------------------------------------------------------------------------
-- E. A valid link; duplicates; end-then-recreate
-- ---------------------------------------------------------------------------

-- 44
select lives_ok(
  $$insert into public.guardianships (id, guardian_person_id, child_person_id, relationship, notes)
    values ('55555555-5555-4555-8555-000000000001',
            current_setting('test.guardian_person')::uuid,
            '99999999-9999-4999-8999-000000000001', 'parent', 'primary carer')$$,
  'an adult guardian with a known dob may be linked to a minor child'
);

-- 45
select results_eq(
  $$select relationship::text, ended_at, created_by
      from public.guardianships
     where id = '55555555-5555-4555-8555-000000000001'$$,
  $$values ('parent'::text, null::timestamptz, null::uuid)$$,
  'the relationship is stored, the link is live, created_by defaults to null'
);

-- 46 — duplicate_guardianship_throws. The unique index, reached after the
-- trigger has passed the row.
select throws_ok(
  $$insert into public.guardianships (guardian_person_id, child_person_id, relationship)
    values (current_setting('test.guardian_person')::uuid,
            '99999999-9999-4999-8999-000000000001', 'step_parent')$$,
  '23505',
  null,
  'a second LIVE link for the same (guardian, child) pair is rejected'
);

-- 47 — ending a link fires the SG-1.8 guard (ended_at is in its column list)
-- and is currently permitted; section G says why.
select lives_ok(
  $$update public.guardianships set ended_at = now()
     where id = '55555555-5555-4555-8555-000000000001'$$,
  'a link can be ended administratively (ended_at), which fires the SG-1.8 guard'
);

-- 48 — and the pair can then be re-established. This is the whole reason the
-- unique index is partial: a full UNIQUE would make an ended arrangement
-- permanently unrepeatable, and the only way to record a resumed one would be
-- to clear ended_at on the old row, erasing the gap.
select lives_ok(
  $$insert into public.guardianships (id, guardian_person_id, child_person_id, relationship)
    values ('55555555-5555-4555-8555-000000000003',
            current_setting('test.guardian_person')::uuid,
            '99999999-9999-4999-8999-000000000001', 'foster_carer')$$,
  'once ended, the same (guardian, child) pair can be linked again'
);

-- 49
select is(
  (select count(*)::int from public.guardianships
    where guardian_person_id = current_setting('test.guardian_person')::uuid
      and child_person_id = '99999999-9999-4999-8999-000000000001'),
  2,
  'both the ended link and its successor survive — the history is not overwritten'
);


-- ---------------------------------------------------------------------------
-- F. Retarget — SG-1.8: "the new pair must independently satisfy SG-4"
-- ---------------------------------------------------------------------------

-- 50
select throws_like(
  $$update public.guardianships
       set child_person_id = '99999999-9999-4999-8999-000000000004'
     where id = '55555555-5555-4555-8555-000000000003'$$,
  '%child must be a minor at creation%',
  'retargeting a link onto an adult child is rejected — the new pair is re-checked'
);

-- 51
select throws_like(
  $$update public.guardianships
       set guardian_person_id = '99999999-9999-4999-8999-000000000005'
     where id = '55555555-5555-4555-8555-000000000003'$$,
  '%guardian must be an adult%',
  'retargeting a link onto a minor guardian is rejected'
);

-- 52 — the other side of "the age tests apply at creation only": an ordinary
-- UPDATE that touches neither party does not re-run the guard.
select lives_ok(
  $$update public.guardianships set notes = 'reviewed 2026-08-22'
     where id = '55555555-5555-4555-8555-000000000003'$$,
  'an update that changes neither party does not re-run the SG-4 age tests'
);

reset role;


-- ---------------------------------------------------------------------------
-- G. The SG-1.8 scaffold
-- ---------------------------------------------------------------------------
-- SAFEGUARDING.md §3 SG-1 "Implemented by": "Where P1.3 lands before the
-- messaging tables exist, the SG-1.8 trigger is written in P1.3 as a
-- no-op-if-absent guard and completed in P5.2; the P5.2 PR is not complete
-- without its tests."

-- 53
select is(
  (select to_regclass('public.conversations')::text),
  null,
  'public.conversations does not exist yet — which is why the guard above was permissive'
);

-- 54
select has_function(
  'public', 'guardianships_conversation_guard',
  'public.guardianships_conversation_guard() exists — P5.2 replaces its BODY, not the trigger'
);


-- ---------------------------------------------------------------------------
-- H. RLS reads
-- ---------------------------------------------------------------------------
-- Expected counts are captured by the owner into transaction-local settings,
-- so the suite passes unchanged on a prod-shaped database.

select set_config('test.links_total',
  (select count(*)::text from public.guardianships), true);

select set_config('test.guardian_links',
  (select count(*)::text from public.guardianships
    where guardian_person_id = current_setting('test.guardian_person')::uuid), true);

-- The guardian's own person row (people_self_read, P1.2) plus one row per
-- LIVE link to a child who is still a minor (people_guardian_read, P1.3 §9).
select set_config('test.guardian_people',
  (select (1 + count(*))::text from public.guardianships g
    where g.guardian_person_id = current_setting('test.guardian_person')::uuid
      and g.ended_at is null
      and public.is_minor(g.child_person_id)), true);

-- --- the guardian -----------------------------------------------------------
set local request.jwt.claims to '{"sub":"88888888-8888-4888-8888-000000000002","role":"authenticated"}';
set local role authenticated;

-- 55
select results_eq(
  $$select count(*)::int from public.guardianships$$,
  $$select current_setting('test.guardian_links')::int$$,
  'a guardian reads exactly their own links — live and ended alike'
);

-- 56 — guardian_sees_only_own_children
select is_empty(
  $$select id from public.guardianships
     where guardian_person_id <> current_setting('test.guardian_person')::uuid$$,
  'and nothing belonging to any other guardian'
);

-- 57 — SG-4: "a guardian may SELECT their own links and their children's
-- linked records".
select results_eq(
  $$select count(*)::int from public.people
     where id = '99999999-9999-4999-8999-000000000001'$$,
  array[1],
  'a guardian can read the person row of a child they have a live link to'
);

-- 58
select is_empty(
  $$select id from public.people
     where id = '99999999-9999-4999-8999-000000000002'$$,
  'but not the person row of a child they have no link to (SAFEGUARDING.md §1.3: authority comes from the link, never the role)'
);

-- 59
select results_eq(
  $$select count(*)::int from public.people$$,
  $$select current_setting('test.guardian_people')::int$$,
  'a guardian sees their own person row plus their live minor children, and nothing else'
);

reset role;

-- --- the committee ----------------------------------------------------------
set local request.jwt.claims to '{"sub":"88888888-8888-4888-8888-000000000001","role":"authenticated"}';
set local role authenticated;

-- 60
select results_eq(
  $$select count(*)::int from public.guardianships$$,
  $$select current_setting('test.links_total')::int$$,
  'the committee reads every guardianship row'
);

reset role;

-- --- an ordinary member with no links ---------------------------------------
set local request.jwt.claims to '{"sub":"88888888-8888-4888-8888-000000000003","role":"authenticated"}';
set local role authenticated;

-- 61
select is_empty(
  $$select id from public.guardianships$$,
  'a member who is neither a guardian nor committee sees no guardianship at all'
);

-- 62
select results_eq(
  $$select id from public.people$$,
  $$select person_id from public.profiles
     where id = '88888888-8888-4888-8888-000000000003'$$,
  'and still sees only their own person row — people_guardian_read adds nothing'
);

reset role;

-- --- anon -------------------------------------------------------------------
set local role anon;

-- 63, 64
select throws_ok(
  $$select id from public.guardianships$$,
  '42501',
  null,
  'anon reading guardianships is denied at the privilege layer'
);
select throws_ok(
  $$insert into public.guardianships (guardian_person_id, child_person_id, relationship)
    values ('99999999-9999-4999-8999-000000000007',
            '99999999-9999-4999-8999-000000000002', 'parent')$$,
  '42501',
  null,
  'anon cannot create a guardianship'
);

reset role;


-- ---------------------------------------------------------------------------
-- I. guardianship_survives_child_turning_18_but_access_lapses
-- ---------------------------------------------------------------------------
-- SG-4: "When the child turns 18 the row is not invalidated or deleted — the
-- age tests apply at creation only. Its effects lapse: guardian access to the
-- young person's data ends at 18 (or at a transition age — Open Decision D5),
-- which is enforced in the reading policies, not by mutating the guardianship
-- row."
--
-- Simulated by moving the child's dob back 19 years. people_dob_guard() rejects
-- only FUTURE dates, so a past correction is an ordinary committee edit.

set local request.jwt.claims to '{"sub":"88888888-8888-4888-8888-000000000001","role":"authenticated"}';
set local role authenticated;

-- 65
select lives_ok(
  $$update public.people set dob = (current_date - interval '19 years')::date
     where id = '99999999-9999-4999-8999-000000000001'$$,
  'the committee ages the child past 18 (people_dob_guard allows past dates)'
);

reset role;

-- 66 — the row survives, untouched, still live.
select results_eq(
  $$select ended_at, public.is_minor(child_person_id)
      from public.guardianships
     where id = '55555555-5555-4555-8555-000000000003'$$,
  $$values (null::timestamptz, false)$$,
  'the guardianship row survives the child turning 18 and is not auto-ended'
);

set local request.jwt.claims to '{"sub":"88888888-8888-4888-8888-000000000002","role":"authenticated"}';
set local role authenticated;

-- 67
select results_eq(
  $$select count(*)::int from public.guardianships
     where id = '55555555-5555-4555-8555-000000000003'$$,
  array[1],
  'the guardian can still see the link itself — the record of the relationship does not vanish'
);

-- 68 — the access lapse. The D5 default: straight to zero at 18.
select is_empty(
  $$select id from public.people
     where id = '99999999-9999-4999-8999-000000000001'$$,
  'but people_guardian_read no longer returns the young person''s record (SG-4 effects lapse; Open Decision D5)'
);

reset role;

set local request.jwt.claims to '{"sub":"88888888-8888-4888-8888-000000000001","role":"authenticated"}';
set local role authenticated;

-- 69
select lives_ok(
  $$update public.guardianships set notes = 'child now 19'
     where id = '55555555-5555-4555-8555-000000000003'$$,
  'the link remains editable after the child turns 18 — SG-4''s age tests are creation-time only'
);

-- 70
select lives_ok(
  $$update public.guardianships set ended_at = now()
     where id = '55555555-5555-4555-8555-000000000003'$$,
  'and it can still be ended administratively, which a whole-row SG-4 re-check would have made impossible'
);

-- 71 — but a NEW link over the now-adult person is refused.
select throws_like(
  $$insert into public.guardianships (guardian_person_id, child_person_id, relationship)
    values ('99999999-9999-4999-8999-000000000007',
            '99999999-9999-4999-8999-000000000001', 'parent')$$,
  '%child must be a minor at creation%',
  'no new guardianship may be created over someone who is now an adult'
);

reset role;


-- ---------------------------------------------------------------------------
-- J. Delete and truncate — the deliberately asymmetric SG-2 position
-- ---------------------------------------------------------------------------
-- Hard DELETE is permitted and guarded conditionally (SG-1.8), because
-- SG-1.8 says so in terms: "a flat reject makes a mistyped or genuinely-ended
-- guardianship permanently unremovable, which is itself a data-protection
-- problem." TRUNCATE is refused outright, because it would bypass that guard
-- for every link in the club at once.

-- 72 — a member holds the DELETE grant but no FOR DELETE policy matches, so
-- the statement silently affects no rows.
set local request.jwt.claims to '{"sub":"88888888-8888-4888-8888-000000000003","role":"authenticated"}';
set local role authenticated;

delete from public.guardianships where id = '55555555-5555-4555-8555-000000000003';

reset role;

select is(
  (select count(*)::int from public.guardianships
    where id = '55555555-5555-4555-8555-000000000003'),
  1,
  'an ordinary member''s DELETE matches no row and destroys nothing'
);

-- 73, 74 — the committee can remove a link. This is the transition SG-1.8
-- calls "a reachable administrative transition, not a theoretical one".
set local request.jwt.claims to '{"sub":"88888888-8888-4888-8888-000000000001","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$delete from public.guardianships where id = '55555555-5555-4555-8555-000000000001'$$,
  'the committee can hard-delete a guardianship (SG-1.8 will gate this on closed conversations from P5.2)'
);

reset role;

select is(
  (select count(*)::int from public.guardianships
    where id = '55555555-5555-4555-8555-000000000001'),
  0,
  'and the row is really gone — no soft-delete column is being relied on here'
);

-- 75 — service_role too, deliberately: SG-1.8's four tests are specified to run
-- as service_role, which only means anything if the privilege is present and
-- the trigger is what refuses.
set local role service_role;

select lives_ok(
  $$delete from public.guardianships where id = '55555555-5555-4555-8555-000000000002'$$,
  'service_role can delete a guardianship — the SG-1.8 trigger, not the grant, is what will stop the dangerous case'
);

-- 76
select throws_ok(
  $$truncate public.guardianships$$,
  '42501',
  null,
  'service_role cannot truncate guardianships'
);

reset role;

-- 77
set local role authenticated;

select throws_ok(
  $$truncate public.guardianships$$,
  '42501',
  null,
  'authenticated cannot truncate guardianships'
);

reset role;

-- 78
set local role anon;

select throws_ok(
  $$truncate public.guardianships$$,
  '42501',
  null,
  'anon cannot truncate guardianships'
);

reset role;

-- 79 — the one that matters: the owner is not stopped by a revoked privilege,
-- only by the trigger.
select throws_ok(
  $$truncate public.guardianships$$,
  'P0001',
  null,
  'the table owner is stopped by trg_guardianships_deny_truncate (SG-2)'
);

-- 80 — and the owner CAN still delete a single row, which is the whole point of
-- not attaching deny_hard_delete() here.
select lives_ok(
  $$delete from public.guardianships where id = '55555555-5555-4555-8555-000000000003'$$,
  'the owner can delete one link — guardianships are not soft-delete-only, unlike people/messages'
);

select * from finish();

rollback;
