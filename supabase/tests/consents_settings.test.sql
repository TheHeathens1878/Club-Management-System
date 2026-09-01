-- =============================================================================
-- P1.7 — guardian_consents, consent_type, safeguarding settings, SG-10
-- =============================================================================
-- SAFEGUARDING.md §3 test convention: "Every test named below attempts the
-- prohibited action and asserts that it fails. A test that only asserts the
-- happy path does not satisfy the invariant."
--
-- SG-10's own test list is the specification for this file. Where a name below
-- differs from SG-10's, the SG-10 name is quoted in the comment above it.
--
-- What this suite covers, and where:
--   A  schema shape — enum, columns, partial unique index, triggers, policies,
--      and the "one dob trigger, never two" rule §4 lays down
--   B  privileges — the layer that binds service_role, which no policy can
--   C  the two settings: validation, the floor, the cross-key pair, the ceiling,
--      refusal to delete, settings.changed, and safeguarding_setting_int()'s
--      fail-closed defaults
--   D  the SG-0.1 / SG-0.2 truth tables, including unknown dob and the 13/14
--      boundaries to the day
--   E  the grant guard (SG-10's "Consent integrity" block)
--   F  the change guard — immutable identity, no un-revoke, revoke-only for
--      non-admins
--   G  SG-7 audit rows for grant and revoke, and the suppression GUC
--   H  SG-2 as extended to guardian_consents, at every layer including the owner
--   I  the SG-10 trigger on profiles, and the people.dob re-check
--   J  handle_new_user() — the invite flow and the four cases that fall through
--   K  the RLS matrix: guardian / child / club_admin / safeguarding_lead /
--      member / coach / anon
--
-- Impersonation follows roles.test.sql:
--     set local request.jwt.claims to '{"sub":"<uuid>","role":"authenticated"}';
--     set local role authenticated;
-- because every helper resolves current_person_id(), which resolves auth.uid(),
-- which reads `request.jwt.claims ->> 'sub'`.
--
-- EVERY COUNT ASSERTION IS DATA-INDEPENDENT: expected values are captured by the
-- table owner into transaction-local settings, never hard-coded, so this suite
-- passes unchanged on a prod-shaped preview branch.
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(165);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- Each auth.users insert fires on_auth_user_created -> handle_new_user(), which
-- creates a person (dob NULL) and a profile, and the profile insert fires
-- P1.4's sync trigger, granting `member`.

insert into auth.users (id, email, raw_user_meta_data) values
  ('c7c7c7c7-7777-4777-8777-000000000001', 'cadmin@test.invalid',     '{"full_name": "Cass Admin"}'::jsonb),
  ('c7c7c7c7-7777-4777-8777-000000000002', 'clead@test.invalid',      '{"full_name": "Lyn Lead"}'::jsonb),
  ('c7c7c7c7-7777-4777-8777-000000000003', 'cmember@test.invalid',    '{"full_name": "Ned Member"}'::jsonb),
  ('c7c7c7c7-7777-4777-8777-000000000004', 'cguardian@test.invalid',  '{"full_name": "Gwen Guardian"}'::jsonb),
  ('c7c7c7c7-7777-4777-8777-000000000005', 'ccoach@test.invalid',     '{"full_name": "Kit Coach"}'::jsonb),
  ('c7c7c7c7-7777-4777-8777-000000000007', 'cguardian2@test.invalid', '{"full_name": "Hal Guardian"}'::jsonb);

update public.profiles set role = 'committee'
 where id = 'c7c7c7c7-7777-4777-8777-000000000001';

insert into public.person_roles (person_id, role, notes)
select person_id, 'safeguarding_lead', 'test fixture: Club Welfare Officer'
  from public.profiles where id = 'c7c7c7c7-7777-4777-8777-000000000002';

insert into public.person_roles (person_id, role)
select person_id, 'coach'
  from public.profiles where id = 'c7c7c7c7-7777-4777-8777-000000000005';

select set_config('test.admin_user',   'c7c7c7c7-7777-4777-8777-000000000001', true);
select set_config('test.admin_person',
  (select person_id::text from public.profiles
    where id = 'c7c7c7c7-7777-4777-8777-000000000001'), true);
select set_config('test.lead_person',
  (select person_id::text from public.profiles
    where id = 'c7c7c7c7-7777-4777-8777-000000000002'), true);
select set_config('test.member_person',
  (select person_id::text from public.profiles
    where id = 'c7c7c7c7-7777-4777-8777-000000000003'), true);
select set_config('test.guardian_person',
  (select person_id::text from public.profiles
    where id = 'c7c7c7c7-7777-4777-8777-000000000004'), true);
select set_config('test.guardian2_person',
  (select person_id::text from public.profiles
    where id = 'c7c7c7c7-7777-4777-8777-000000000007'), true);

-- Both guardians need a known adult dob (SG-4, re-checked at grant time by
-- P1.7 §9a). handle_new_user() left them NULL, which is SG-0's "minor".
update public.people set dob = date '1980-03-03'
 where id = current_setting('test.guardian_person')::uuid;
update public.people set dob = date '1981-04-04'
 where id = current_setting('test.guardian2_person')::uuid;

-- The children and the edge cases. Ages are expressed relative to current_date
-- so the suite does not rot.
insert into public.people (id, first_name, last_name, dob) values
  ('d8d8d8d8-8888-4888-8888-000000000011', 'Cara',   'Fourteen',
   (current_date - interval '14 years')::date),
  ('d8d8d8d8-8888-4888-8888-000000000012', 'Tim',    'Ten',
   (current_date - interval '10 years')::date),
  ('d8d8d8d8-8888-4888-8888-000000000013', 'Ash',    'Seventeen',
   (current_date - interval '17 years')::date),
  ('d8d8d8d8-8888-4888-8888-000000000014', 'Unk',    'Nowndob',   null),
  ('d8d8d8d8-8888-4888-8888-000000000015', 'Otto',   'Otherchild',
   (current_date - interval '15 years')::date),
  ('d8d8d8d8-8888-4888-8888-000000000016', 'Mona',   'Wasadult',   date '1990-06-06'),
  ('d8d8d8d8-8888-4888-8888-000000000017', 'Norah',  'Haddob',     date '1991-07-07'),
  ('d8d8d8d8-8888-4888-8888-000000000018', 'Thea',   'Exactthirteen',
   (current_date - interval '13 years')::date),
  ('d8d8d8d8-8888-4888-8888-000000000019', 'Dana',   'Dayshort',
   (current_date - interval '13 years' + interval '1 day')::date),
  ('d8d8d8d8-8888-4888-8888-000000000021', 'Elle',   'Endedlink',
   (current_date - interval '14 years')::date),
  ('d8d8d8d8-8888-4888-8888-000000000022', 'Fred',   'Fourteenexact',
   (current_date - interval '14 years')::date),
  ('d8d8d8d8-8888-4888-8888-000000000023', 'Gita',   'Dayshortoffourteen',
   (current_date - interval '14 years' + interval '1 day')::date),
  ('d8d8d8d8-8888-4888-8888-000000000024', 'Xavi',   'Expiredconsent',
   (current_date - interval '14 years')::date),
  ('d8d8d8d8-8888-4888-8888-000000000025', 'Yara',   'Noconsentyet',
   (current_date - interval '14 years')::date),
  ('d8d8d8d8-8888-4888-8888-000000000026', 'Sam',    'Sharedemail',
   date '1975-05-05');

-- A person who is not a child and whose email a later signup will reuse:
-- P1.2's "never auto-link by email", which SG-10 calls "doubly important here,
-- since families share addresses".
update public.people set email = 'cshared@test.invalid'
 where id = 'd8d8d8d8-8888-4888-8888-000000000026';

-- Live guardianships from Gwen to her children.
insert into public.guardianships (guardian_person_id, child_person_id, relationship)
select current_setting('test.guardian_person')::uuid, c, 'parent'
  from unnest(array[
    'd8d8d8d8-8888-4888-8888-000000000011'::uuid,
    'd8d8d8d8-8888-4888-8888-000000000012'::uuid,
    'd8d8d8d8-8888-4888-8888-000000000013'::uuid,
    'd8d8d8d8-8888-4888-8888-000000000014'::uuid,
    'd8d8d8d8-8888-4888-8888-000000000018'::uuid,
    'd8d8d8d8-8888-4888-8888-000000000019'::uuid,
    'd8d8d8d8-8888-4888-8888-000000000021'::uuid,
    'd8d8d8d8-8888-4888-8888-000000000022'::uuid,
    'd8d8d8d8-8888-4888-8888-000000000023'::uuid,
    'd8d8d8d8-8888-4888-8888-000000000024'::uuid,
    'd8d8d8d8-8888-4888-8888-000000000025'::uuid
  ]) as c;

-- Hal is guardian of a different child entirely — the SG-1.4 / §1.3 boundary:
-- "A person holding `parent` for child A has no standing whatsoever in respect
-- of child B."
insert into public.guardianships (guardian_person_id, child_person_id, relationship)
values (current_setting('test.guardian2_person')::uuid,
        'd8d8d8d8-8888-4888-8888-000000000015', 'parent');

-- Two links made while the guardian was still valid, then invalidated by a dob
-- correction — the only way to reach "an existing link whose guardian is now a
-- minor / has no known dob", since guardianships_guard() refuses to create one.
insert into public.guardianships (guardian_person_id, child_person_id, relationship)
values ('d8d8d8d8-8888-4888-8888-000000000016',
        'd8d8d8d8-8888-4888-8888-000000000011', 'other'),
       ('d8d8d8d8-8888-4888-8888-000000000017',
        'd8d8d8d8-8888-4888-8888-000000000011', 'other');

update public.people set dob = (current_date - interval '16 years')::date
 where id = 'd8d8d8d8-8888-4888-8888-000000000016';
update public.people set dob = null
 where id = 'd8d8d8d8-8888-4888-8888-000000000017';

-- Ash turns 18 after the link was made. SG-4: "The link outlives the minority."
update public.people set dob = date '1985-08-08'
 where id = 'd8d8d8d8-8888-4888-8888-000000000013';

-- And one ended link.
update public.guardianships set ended_at = now()
 where guardian_person_id = current_setting('test.guardian_person')::uuid
   and child_person_id = 'd8d8d8d8-8888-4888-8888-000000000021';


-- ---------------------------------------------------------------------------
-- A. Schema shape  (as the owner; no impersonation yet)
-- ---------------------------------------------------------------------------

-- 1
select has_table('public', 'guardian_consents', 'public.guardian_consents exists');

-- 2 — SAFEGUARDING.md §4: "public.consent_type enum — app_account,
-- unsupervised_messaging; P2.2 adds the SG-5 photo-consent values".
select enum_has_labels(
  'public', 'consent_type',
  array['app_account', 'unsupervised_messaging', 'photo_team_album', 'photo_club_website', 'photo_social_media', 'photo_press'],
  'consent_type carries the two SG-10 purposes plus the four SG-5 photo values P2.2 added'
);

-- 3..9
select col_not_null('public', 'guardian_consents', 'child_person_id',    'child_person_id is NOT NULL');
select col_not_null('public', 'guardian_consents', 'guardian_person_id', 'guardian_person_id is NOT NULL');
select col_not_null('public', 'guardian_consents', 'consent_type',       'consent_type is NOT NULL');
select col_not_null('public', 'guardian_consents', 'granted_at',         'granted_at is NOT NULL');
select col_not_null('public', 'guardian_consents', 'notice_version',
  'notice_version is NOT NULL — SG-9 requires what they were told to be evidenceable');
select col_is_null('public', 'guardian_consents', 'revoked_at',
  'revoked_at is nullable — NULL means the consent is held now');
select col_is_null('public', 'guardian_consents', 'expires_at',
  'expires_at is nullable and stays NULL until D12 is settled');

-- 10
select col_type_is('public', 'guardian_consents', 'consent_type', 'consent_type',
  'consent_type is the enum, not text');

-- 11, 12, 13
select fk_ok('public', 'guardian_consents', 'child_person_id', 'public', 'people', 'id',
  'child_person_id references people.id');
select fk_ok('public', 'guardian_consents', 'guardian_person_id', 'public', 'people', 'id',
  'guardian_person_id references people.id');
select is(
  (select count(*)::int from pg_constraint c
    where c.conrelid = 'public.guardian_consents'::regclass
      and c.contype = 'f'
      and c.confrelid = 'public.people'::regclass
      and c.confdeltype::text <> 'r'),
  0,
  'both person foreign keys are ON DELETE RESTRICT, never CASCADE'
);

-- 14 — SG-10, in terms: "A partial unique index on (child_person_id,
-- consent_type) WHERE revoked_at IS NULL means one live consent per purpose at
-- a time."
select is(
  (select indexdef from pg_indexes
    where schemaname = 'public' and indexname = 'guardian_consents_active_idx'),
  'CREATE UNIQUE INDEX guardian_consents_active_idx ON public.guardian_consents '
  || 'USING btree (child_person_id, consent_type) WHERE (revoked_at IS NULL)',
  'one LIVE consent per (child, purpose); any number of revoked ones behind it'
);

-- 15
select is(
  (select relrowsecurity from pg_class where oid = 'public.guardian_consents'::regclass),
  true,
  'row level security is enabled on public.guardian_consents'
);

-- 16 — an exact-set assertion, so an accidentally added policy — a FOR DELETE
-- one above all — fails the build rather than passing unnoticed.
select policies_are(
  'public',
  'guardian_consents',
  array['guardian_consents_guardian_read', 'guardian_consents_guardian_insert',
        'guardian_consents_guardian_update', 'guardian_consents_child_read',
        'guardian_consents_admin_read', 'guardian_consents_admin_update'],
  'guardian_consents has exactly the three guardian policies, the child read and the two admin policies'
);

-- 17
select is_empty(
  $$select policyname from pg_policies
     where schemaname = 'public' and tablename = 'guardian_consents' and cmd = 'DELETE'$$,
  'there is no FOR DELETE policy on guardian_consents (SG-2 as extended by SG-10)'
);

-- 18..23
select has_trigger('public', 'guardian_consents', 'trg_guardian_consents_grant_guard',
  'the SG-10 grant guard is attached');
select has_trigger('public', 'guardian_consents', 'trg_guardian_consents_change_guard',
  'the change guard is attached');
select has_trigger('public', 'guardian_consents', 'trg_guardian_consents_audit',
  'the SG-7 grant/revoke audit trigger is attached');
select has_trigger('public', 'guardian_consents', 'trg_guardian_consents_updated',
  'set_updated_at is attached (the table has updated_at)');
select has_trigger('public', 'guardian_consents', 'trg_guardian_consents_deny_hard_delete',
  'the SG-2 row-level delete guard is attached');
select has_trigger('public', 'guardian_consents', 'trg_guardian_consents_deny_truncate',
  'the SG-2 statement-level truncate guard is attached');

-- 24 — the SG-10 layer that binds the auth admin path, which RLS cannot reach.
select has_trigger('public', 'profiles', 'trg_profiles_sg10_account_eligibility',
  'the SG-10 eligibility guard exists on public.profiles');

-- 25 — BEFORE (bit 2 = 2), ROW (1), INSERT (4), UPDATE (16).
select is(
  (select (t.tgtype & 2 = 2) and (t.tgtype & 1 = 1)
      and (t.tgtype & 4 = 4) and (t.tgtype & 16 = 16)
     from pg_trigger t
    where t.tgrelid = 'public.profiles'::regclass
      and t.tgname = 'trg_profiles_sg10_account_eligibility'),
  true,
  'it is BEFORE INSERT OR UPDATE, FOR EACH ROW'
);

-- 26 — and its UPDATE arm watches person_id only.
select results_eq(
  $$select (a.attname::text) collate "default"
      from pg_trigger t
      join unnest(t.tgattr::smallint[]) as col(attnum) on true
      join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = col.attnum
     where t.tgrelid = 'public.profiles'::regclass
       and t.tgname = 'trg_profiles_sg10_account_eligibility'
     order by 1$$,
  $$values ('person_id'::text)$$,
  'the profiles guard watches person_id and nothing else'
);

-- 27 — it must sort AFTER trg_profiles_ensure_person, which supplies person_id.
-- Postgres fires BEFORE ROW triggers in name order; the wrong order would let
-- the guard see a NULL person_id and wave the insert through.
select ok(
  'trg_profiles_ensure_person' < 'trg_profiles_sg10_account_eligibility',
  'the SG-10 guard sorts after trg_profiles_ensure_person, so person_id is populated when it runs'
);

-- 28 — SAFEGUARDING.md §4: "One `people` UPDATE OF dob trigger, carrying
-- SG-1.2, SG-6 tier 1(c) AND SG-10's re-check — not several triggers on the
-- same column." P1.7 extended the function; it did not add a trigger.
select is(
  (select count(*)::int
     from pg_trigger t
     join unnest(t.tgattr::smallint[]) as col(attnum) on true
     join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = col.attnum
    where t.tgrelid = 'public.people'::regclass
      and not t.tgisinternal
      and a.attname = 'dob'),
  1,
  'there is exactly ONE trigger on public.people watching dob'
);

-- 29 — and it is still the P1.1 one, now carrying SG-10.
select is(
  (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'people_dob_guard') ~ 'SG-10',
  true,
  'people_dob_guard() carries the SG-10 re-check'
);

-- 30..32 — the three site_settings triggers, all scoped to safeguarding.% keys.
select has_trigger('public', 'site_settings', 'trg_site_settings_safeguarding_guard',
  'the settings validation trigger is attached');
select has_trigger('public', 'site_settings', 'trg_site_settings_safeguarding_no_delete',
  'the settings delete refusal is attached');
select has_trigger('public', 'site_settings', 'trg_site_settings_safeguarding_audit',
  'the settings.changed audit trigger is attached');

-- 33 — the baseline's two site_settings policies are untouched, names and all
-- (they contain spaces because they were made through the dashboard).
select policies_are(
  'public',
  'site_settings',
  array['Anyone can read site_settings', 'Committee can manage site_settings'],
  'P1.7 did not touch the baseline site_settings policies'
);


-- ---------------------------------------------------------------------------
-- B. Privileges — the layer that binds service_role (SAFEGUARDING.md §1.2)
-- ---------------------------------------------------------------------------

-- 34, 35, 36
select table_privs_are(
  'public', 'guardian_consents', 'anon', array[]::text[],
  'anon holds no privilege at all on public.guardian_consents'
);
select table_privs_are(
  'public', 'guardian_consents', 'authenticated', array['SELECT', 'INSERT', 'UPDATE'],
  'authenticated holds exactly select/insert/update'
);
select table_privs_are(
  'public', 'guardian_consents', 'service_role', array['SELECT', 'INSERT', 'UPDATE'],
  'service_role holds exactly select/insert/update'
);

-- 37..42 — spelled out individually: this is what catches a later
-- `grant all on all tables in schema public` restoring the ability to destroy
-- the evidence that a consent was given or withdrawn.
select ok(not has_table_privilege('anon', 'public.guardian_consents', 'DELETE'),
  'anon cannot DELETE from guardian_consents');
select ok(not has_table_privilege('anon', 'public.guardian_consents', 'TRUNCATE'),
  'anon cannot TRUNCATE guardian_consents');
select ok(not has_table_privilege('authenticated', 'public.guardian_consents', 'DELETE'),
  'authenticated cannot DELETE from guardian_consents');
select ok(not has_table_privilege('authenticated', 'public.guardian_consents', 'TRUNCATE'),
  'authenticated cannot TRUNCATE guardian_consents');
select ok(not has_table_privilege('service_role', 'public.guardian_consents', 'DELETE'),
  'service_role cannot DELETE from guardian_consents, BYPASSRLS notwithstanding');
select ok(not has_table_privilege('service_role', 'public.guardian_consents', 'TRUNCATE'),
  'service_role cannot TRUNCATE guardian_consents');

-- 43, 44, 45 — the four public helpers. anon is excluded BY NAME: each of them
-- takes somebody else's person id and returns a fact about that person's age and
-- their family's decisions, so granting them to an unauthenticated caller makes
-- them a probe.
select ok(
  not has_function_privilege('anon', 'public.safeguarding_setting_int(text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.has_active_consent(uuid, public.consent_type)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.is_account_eligible(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.is_supervision_exempt(uuid)', 'EXECUTE'),
  'anon can execute none of the four P1.7 helpers'
);
select ok(
  has_function_privilege('authenticated', 'public.safeguarding_setting_int(text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.has_active_consent(uuid, public.consent_type)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.is_account_eligible(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.is_supervision_exempt(uuid)', 'EXECUTE'),
  'authenticated can execute all four'
);
select ok(
  has_function_privilege('service_role', 'public.safeguarding_setting_int(text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.has_active_consent(uuid, public.consent_type)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.is_account_eligible(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.is_supervision_exempt(uuid)', 'EXECUTE'),
  'service_role can execute all four'
);

-- 46 — the trigger functions and the internal date helper are nobody's API.
select ok(
  not has_function_privilege('anon',          'public.guardian_consents_grant_guard()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.guardian_consents_grant_guard()', 'EXECUTE')
  and not has_function_privilege('service_role',  'public.guardian_consents_grant_guard()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.guardian_consents_change_guard()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.guardian_consents_audit()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.site_settings_safeguarding_guard()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.site_settings_deny_safeguarding_delete()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.site_settings_safeguarding_audit()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.profiles_account_eligibility_guard()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.is_at_least_age(date, integer)', 'EXECUTE'),
  'no API role can execute any P1.7 trigger function or the internal age helper'
);

-- 47 — §11 made people_dob_guard() SECURITY DEFINER, so its default grants go.
select ok(
  not has_function_privilege('anon', 'public.people_dob_guard()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.people_dob_guard()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.people_dob_guard()', 'EXECUTE'),
  'people_dob_guard() is no longer executable by any API role — it became SECURITY DEFINER'
);

-- 48 — all four helpers are SECURITY DEFINER and STABLE with a pinned
-- search_path, the house style of is_committee()/is_minor()/has_role().
select is(
  (select count(*)::int from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('safeguarding_setting_int', 'has_active_consent',
                        'is_account_eligible', 'is_supervision_exempt')
      and p.prosecdef
      and p.provolatile = 's'
      and p.proconfig @> array['search_path=public']),
  4,
  'all four helpers are STABLE, SECURITY DEFINER, search_path = public'
);


-- ---------------------------------------------------------------------------
-- C. The two settings
-- ---------------------------------------------------------------------------

-- 49, 50 — SG-10's table: min_account_age 13, unsupervised_messaging_min_age 14.
select results_eq(
  $$select value from public.site_settings where key = 'safeguarding.min_account_age'$$,
  $$values ('13'::text)$$,
  'safeguarding.min_account_age is seeded at 13'
);
select results_eq(
  $$select value from public.site_settings
     where key = 'safeguarding.unsupervised_messaging_min_age'$$,
  $$values ('14'::text)$$,
  'safeguarding.unsupervised_messaging_min_age is seeded at 14'
);

-- 51, 52
select is(public.safeguarding_setting_int('safeguarding.min_account_age'), 13,
  'safeguarding_setting_int reads the min account age');
select is(public.safeguarding_setting_int('safeguarding.unsupervised_messaging_min_age'), 14,
  'safeguarding_setting_int reads the unsupervised messaging age');

-- 53 — an unknown key has no documented default, so it raises rather than
-- inventing one.
select throws_ok(
  $$select public.safeguarding_setting_int('safeguarding.invented')$$,
  'P0001',
  null,
  'safeguarding_setting_int raises for a key it has no documented default for'
);

-- 54 — `non_integer_safeguarding_setting_throws`
select throws_ok(
  $$update public.site_settings set value = 'fourteen'
     where key = 'safeguarding.min_account_age'$$,
  'P0001',
  null,
  'a non-integer safeguarding setting is refused'
);

-- 55 — "'14 ' must not become a silently-failing comparison" (SG-10).
select throws_ok(
  $$update public.site_settings set value = '14 '
     where key = 'safeguarding.unsupervised_messaging_min_age'$$,
  'P0001',
  null,
  'a padded integer is refused — the value must be a plain integer'
);

-- 56 — `min_account_age_below_floor_throws` (D11, C9: the UK age of digital
-- consent).
select throws_ok(
  $$update public.site_settings set value = '12'
     where key = 'safeguarding.min_account_age'$$,
  'P0001',
  null,
  'min_account_age below the floor of 13 is refused'
);

-- 57 — `min_account_age_above_unsupervised_age_throws`. §1.5:
-- "Supervision-exemption presupposes account-eligibility."
select throws_ok(
  $$update public.site_settings set value = '15'
     where key = 'safeguarding.min_account_age'$$,
  'P0001',
  null,
  'min_account_age above unsupervised_messaging_min_age is refused'
);

-- 58 — `unsupervised_age_of_18_or_more_throws`. At 18 nobody is a minor, so the
-- threshold would describe nobody.
select throws_ok(
  $$update public.site_settings set value = '18'
     where key = 'safeguarding.unsupervised_messaging_min_age'$$,
  'P0001',
  null,
  'unsupervised_messaging_min_age of 18 or more is refused'
);

-- 59 — the other editing order is covered too: lowering the unsupervised age
-- below the account age is refused, so neither order can pass through an
-- invalid pair.
select throws_ok(
  $$update public.site_settings set value = '12'
     where key = 'safeguarding.unsupervised_messaging_min_age'$$,
  'P0001',
  null,
  'lowering unsupervised_messaging_min_age below min_account_age is refused'
);

-- 60 — a new safeguarding.* key must still be an integer.
select throws_ok(
  $$insert into public.site_settings (key, value)
    values ('safeguarding.some_future_flag', 'yes')$$,
  'P0001',
  null,
  'any safeguarding.% key must be an integer, not only the two age keys'
);

-- 61 — and a non-safeguarding key is completely unaffected: the imported
-- function-room app writes 27 of them on every settings save.
select lives_ok(
  $$insert into public.site_settings (key, value)
    values ('club_tagline', 'Function Room Hire')
    on conflict (key) do update set value = excluded.value$$,
  'a non-safeguarding key is untouched by the validation trigger'
);

-- 62 — `settings_change_writes_audit_row`. SG-7:
-- { "key": …, "old": 13, "new": 14 }
set local request.jwt.claims to '{"sub":"c7c7c7c7-7777-4777-8777-000000000001","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$update public.site_settings set value = '14'
     where key = 'safeguarding.min_account_age'$$,
  'a committee member may raise min_account_age to a valid value'
);

reset role;

-- 63
select results_eq(
  $$select actor_id, actor_email, entity, entity_id,
           detail ->> 'key', detail -> 'old', detail -> 'new'
      from public.audit_log
     where action = 'settings.changed'
       and entity_id = 'safeguarding.min_account_age'$$,
  $$values ('c7c7c7c7-7777-4777-8777-000000000001'::uuid,
            'cadmin@test.invalid'::text,
            'site_settings'::text,
            'safeguarding.min_account_age'::text,
            'safeguarding.min_account_age'::text,
            '13'::jsonb,
            '14'::jsonb)$$,
  'the change wrote a settings.changed audit row carrying the key and both values as numbers'
);

-- 64 — a rewrite of the same value is not an event. apps/web upserts every key
-- in a section on every save, so logging no-ops would fill the table.
select set_config('test.settings_audit',
  (select count(*)::text from public.audit_log where action = 'settings.changed'), true);

update public.site_settings set value = '14'
 where key = 'safeguarding.min_account_age';

select results_eq(
  $$select count(*)::int from public.audit_log where action = 'settings.changed'$$,
  $$select current_setting('test.settings_audit')::int$$,
  'rewriting the same value writes no audit row'
);

-- Put it back; the D section depends on 13/14.
update public.site_settings set value = '13'
 where key = 'safeguarding.min_account_age';

-- 65 — deletion of a safeguarding key is refused, for every role including the
-- owner: it is a trigger, not a privilege.
select throws_ok(
  $$delete from public.site_settings where key = 'safeguarding.min_account_age'$$,
  'P0001',
  null,
  'a safeguarding setting may not be deleted — set its value instead'
);

-- 66 — but every other key stays deletable exactly as it was. P1.7 has no
-- business changing the imported app's behaviour.
select lives_ok(
  $$delete from public.site_settings where key = 'club_tagline'$$,
  'a non-safeguarding key is still deletable'
);

-- 67, 68 — `safeguarding_setting_int_returns_default_when_row_absent`.
-- Reaching the absent case means getting past the delete guard, so the trigger
-- is disabled for exactly two statements and restored. This is a test, not a
-- migration: SG-2's prohibition on `ALTER TABLE ... DISABLE TRIGGER` is about
-- migrations against the four protected tables.
alter table public.site_settings disable trigger trg_site_settings_safeguarding_no_delete;
alter table public.site_settings disable trigger trg_site_settings_safeguarding_guard;

delete from public.site_settings where key = 'safeguarding.min_account_age';

select is(public.safeguarding_setting_int('safeguarding.min_account_age'), 13,
  'an absent row falls back to the documented default of 13, never to "no limit"');

update public.site_settings set value = 'not a number'
 where key = 'safeguarding.unsupervised_messaging_min_age';

select is(public.safeguarding_setting_int('safeguarding.unsupervised_messaging_min_age'), 14,
  'so does a value the validation trigger could not have allowed — fail closed twice over');

update public.site_settings set value = '14'
 where key = 'safeguarding.unsupervised_messaging_min_age';
insert into public.site_settings (key, value) values ('safeguarding.min_account_age', '13');

alter table public.site_settings enable trigger trg_site_settings_safeguarding_guard;
alter table public.site_settings enable trigger trg_site_settings_safeguarding_no_delete;


-- ---------------------------------------------------------------------------
-- D. SG-0.1 / SG-0.2 truth tables
-- ---------------------------------------------------------------------------
-- Consents are granted here as the owner, which bypasses RLS but NOT the §9a
-- trigger — the layer SAFEGUARDING.md §1.2 says is the one that binds.

insert into public.guardian_consents
  (id, child_person_id, guardian_person_id, consent_type, notice_version)
values
  ('e9e9e9e9-9999-4999-8999-000000000011',
   'd8d8d8d8-8888-4888-8888-000000000011',
   current_setting('test.guardian_person')::uuid, 'app_account', 'notice-2026-08-v1'),
  ('e9e9e9e9-9999-4999-8999-000000000012',
   'd8d8d8d8-8888-4888-8888-000000000011',
   current_setting('test.guardian_person')::uuid, 'unsupervised_messaging', 'notice-2026-08-v1'),
  ('e9e9e9e9-9999-4999-8999-000000000018',
   'd8d8d8d8-8888-4888-8888-000000000018',
   current_setting('test.guardian_person')::uuid, 'app_account', 'notice-2026-08-v1'),
  ('e9e9e9e9-9999-4999-8999-000000000019',
   'd8d8d8d8-8888-4888-8888-000000000019',
   current_setting('test.guardian_person')::uuid, 'app_account', 'notice-2026-08-v1'),
  ('e9e9e9e9-9999-4999-8999-00000000012a',
   'd8d8d8d8-8888-4888-8888-000000000012',
   current_setting('test.guardian_person')::uuid, 'app_account', 'notice-2026-08-v1'),
  ('e9e9e9e9-9999-4999-8999-000000000014',
   'd8d8d8d8-8888-4888-8888-000000000014',
   current_setting('test.guardian_person')::uuid, 'app_account', 'notice-2026-08-v1'),
  ('e9e9e9e9-9999-4999-8999-000000000022',
   'd8d8d8d8-8888-4888-8888-000000000022',
   current_setting('test.guardian_person')::uuid, 'app_account', 'notice-2026-08-v1'),
  ('e9e9e9e9-9999-4999-8999-000000000023',
   'd8d8d8d8-8888-4888-8888-000000000023',
   current_setting('test.guardian_person')::uuid, 'app_account', 'notice-2026-08-v1');

-- Fred (exactly 14) and Gita (a day short of 14) also need the messaging
-- consent, so that only the AGE differs between them.
insert into public.guardian_consents
  (child_person_id, guardian_person_id, consent_type, notice_version)
values
  ('d8d8d8d8-8888-4888-8888-000000000022',
   current_setting('test.guardian_person')::uuid, 'unsupervised_messaging', 'notice-2026-08-v1'),
  ('d8d8d8d8-8888-4888-8888-000000000023',
   current_setting('test.guardian_person')::uuid, 'unsupervised_messaging', 'notice-2026-08-v1');

-- An already-expired consent, for a child with no other live one. Granted and
-- expired in the past, so no UPDATE is needed to reach the state.
insert into public.guardian_consents
  (child_person_id, guardian_person_id, consent_type, notice_version,
   granted_at, expires_at)
values
  ('d8d8d8d8-8888-4888-8888-000000000024',
   current_setting('test.guardian_person')::uuid, 'app_account', 'notice-2025-08-v0',
   now() - interval '2 years', now() - interval '1 year');

-- 69, 70
select ok(public.has_active_consent('d8d8d8d8-8888-4888-8888-000000000011',
                                    'app_account'::public.consent_type),
  'has_active_consent is true for a live consent');
select ok(not public.has_active_consent('d8d8d8d8-8888-4888-8888-000000000015',
                                        'app_account'::public.consent_type),
  'and false for a child with no consent row at all — absence is refusal');

-- 71 — `expired consent is not active`. SG-10: "has_active_consent() treats a
-- past expires_at as inactive from the day it exists".
select ok(not public.has_active_consent('d8d8d8d8-8888-4888-8888-000000000024',
                                        'app_account'::public.consent_type),
  'an expired consent is not active, even though revoked_at is NULL');

-- 72 — the two purposes are independent (§1.5).
select ok(not public.has_active_consent('d8d8d8d8-8888-4888-8888-000000000018',
                                        'unsupervised_messaging'::public.consent_type),
  'holding app_account says nothing about unsupervised_messaging');

-- 73..78 — is_account_eligible (SG-0.1)
select ok(public.is_account_eligible('d8d8d8d8-8888-4888-8888-000000000011'),
  'a 14-year-old with a live app_account consent is account-eligible');
select ok(not public.is_account_eligible('d8d8d8d8-8888-4888-8888-000000000012'),
  'a 10-year-old is not, consent or no consent — the age limb fails');
select ok(not public.is_account_eligible('d8d8d8d8-8888-4888-8888-000000000015'),
  'a 15-year-old with no consent is not — the consent limb fails');
select ok(not public.is_account_eligible('d8d8d8d8-8888-4888-8888-000000000014'),
  'unknown dob is never account-eligible (SAFEGUARDING.md §1.5)');
select ok(not public.is_account_eligible('00000000-0000-4000-8000-00000000dead'),
  'an unknown person id is never account-eligible — fail closed');
select ok(not public.is_account_eligible(null),
  'a NULL person id is never account-eligible');

-- 79, 80 — the 13 boundary, to the day.
select ok(public.is_account_eligible('d8d8d8d8-8888-4888-8888-000000000018'),
  'a child who is exactly 13 today is account-eligible');
select ok(not public.is_account_eligible('d8d8d8d8-8888-4888-8888-000000000019'),
  'and one who is 13 tomorrow is not');

-- 81..85 — is_supervision_exempt (SG-0.2)
select ok(public.is_supervision_exempt('d8d8d8d8-8888-4888-8888-000000000011'),
  'a 14-year-old with both consents is supervision-exempt');
select ok(not public.is_supervision_exempt('d8d8d8d8-8888-4888-8888-000000000018'),
  'a 13-year-old is not, even with an account — the messaging age is 14');
select ok(not public.is_supervision_exempt('d8d8d8d8-8888-4888-8888-000000000014'),
  'unknown dob is never supervision-exempt (SAFEGUARDING.md §1.5)');
select ok(public.is_supervision_exempt('d8d8d8d8-8888-4888-8888-000000000022'),
  'the 14 boundary: exactly 14 today is exempt');
select ok(not public.is_supervision_exempt('d8d8d8d8-8888-4888-8888-000000000023'),
  'and 14 tomorrow is not');

-- 86 — §1.5: "Supervision-exemption presupposes account-eligibility... a minor
-- with no app account has no conversation to be exempt in." Revoke the account
-- consent and the exemption goes with it, even though the messaging consent
-- stands.
update public.guardian_consents set revoked_at = now()
 where id = 'e9e9e9e9-9999-4999-8999-000000000022';

select ok(not public.is_supervision_exempt('d8d8d8d8-8888-4888-8888-000000000022'),
  'revoking app_account removes supervision-exemption even with unsupervised_messaging live');

-- 87 — and the SG-0.1 answer follows immediately: no nightly job, no cache.
select ok(not public.is_account_eligible('d8d8d8d8-8888-4888-8888-000000000022'),
  'a revoked consent stops being active the moment it is revoked');


-- ---------------------------------------------------------------------------
-- E. The grant guard  (SG-10, "Consent integrity")
-- ---------------------------------------------------------------------------

-- 88 — `consent_granted_by_non_guardian_throws`. The link, never the role.
select throws_ok(
  $$insert into public.guardian_consents
      (child_person_id, guardian_person_id, consent_type, notice_version)
    values ('d8d8d8d8-8888-4888-8888-000000000015',
            current_setting('test.guardian_person')::uuid, 'app_account', 'v1')$$,
  'P0001',
  null,
  'an adult with no guardianship to this child cannot grant consent for them'
);

-- 89 — `consent_granted_by_ended_guardianship_throws`
select throws_ok(
  $$insert into public.guardian_consents
      (child_person_id, guardian_person_id, consent_type, notice_version)
    values ('d8d8d8d8-8888-4888-8888-000000000021',
            current_setting('test.guardian_person')::uuid,
            'unsupervised_messaging', 'v1')$$,
  'P0001',
  null,
  'an ENDED guardianship is not an active one — a retired link cannot consent'
);

-- 90 — `consent_for_adult_child_throws`. The link survived Ash turning 18
-- (SG-4); its power to consent did not.
select throws_ok(
  $$insert into public.guardian_consents
      (child_person_id, guardian_person_id, consent_type, notice_version)
    values ('d8d8d8d8-8888-4888-8888-000000000013',
            current_setting('test.guardian_person')::uuid, 'app_account', 'v1')$$,
  'P0001',
  null,
  'consent may only be recorded for a minor — the adult child is refused'
);

-- 91 — SG-4's deliberate asymmetry, restated at grant time: an unidentified
-- adult is not a safeguarding control.
select throws_ok(
  $$insert into public.guardian_consents
      (child_person_id, guardian_person_id, consent_type, notice_version)
    values ('d8d8d8d8-8888-4888-8888-000000000011',
            'd8d8d8d8-8888-4888-8888-000000000017', 'unsupervised_messaging', 'v1')$$,
  'P0001',
  null,
  'a guardian whose dob became unknown can no longer grant consent'
);

-- 92 — and a "guardian" a dob correction turned into a minor.
select throws_ok(
  $$insert into public.guardian_consents
      (child_person_id, guardian_person_id, consent_type, notice_version)
    values ('d8d8d8d8-8888-4888-8888-000000000011',
            'd8d8d8d8-8888-4888-8888-000000000016', 'unsupervised_messaging', 'v1')$$,
  'P0001',
  null,
  'a guardian who is now a minor can no longer grant consent'
);

-- 93, 94 — a person cannot consent on their own behalf. ORDER OF FIRING, as
-- P1.3 noted for guardianships_not_self: a BEFORE ROW trigger runs before the
-- table's CHECK constraints, so in practice §9a's adult test raises P0001 first
-- and the constraint is never reached. The constraint is not therefore
-- redundant — it is the layer that still holds if the trigger is disabled, so
-- its existence is asserted separately.
select throws_ok(
  $$insert into public.guardian_consents
      (child_person_id, guardian_person_id, consent_type, notice_version)
    values ('d8d8d8d8-8888-4888-8888-000000000011',
            'd8d8d8d8-8888-4888-8888-000000000011', 'app_account', 'v1')$$,
  'P0001',
  null,
  'self-consent is refused — the guard reaches it before the CHECK does'
);
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.guardian_consents'::regclass
      and conname = 'guardian_consents_not_self'
      and contype = 'c'),
  1,
  'and the CHECK constraint exists underneath it, for the trigger-disabled case'
);

-- 95 — `duplicate_active_consent_throws`
select throws_ok(
  $$insert into public.guardian_consents
      (child_person_id, guardian_person_id, consent_type, notice_version)
    values ('d8d8d8d8-8888-4888-8888-000000000011',
            current_setting('test.guardian_person')::uuid, 'app_account', 'v2')$$,
  '23505',
  null,
  'a second LIVE consent for the same (child, purpose) is refused'
);

-- 96 — notice_version is mandatory and may not be blank (SG-9).
select throws_ok(
  $$insert into public.guardian_consents
      (child_person_id, guardian_person_id, consent_type, notice_version)
    values ('d8d8d8d8-8888-4888-8888-000000000012',
            current_setting('test.guardian_person')::uuid,
            'unsupervised_messaging', '   ')$$,
  '23514',
  null,
  'a blank notice_version is refused — a consent whose terms cannot be reconstructed is not evidence'
);

-- 97, 98 — `consent_after_revocation_can_be_granted_again`, as a NEW ROW, which
-- is what the partial unique index is for.
select lives_ok(
  $$insert into public.guardian_consents
      (child_person_id, guardian_person_id, consent_type, notice_version)
    values ('d8d8d8d8-8888-4888-8888-000000000022',
            current_setting('test.guardian_person')::uuid, 'app_account', 'notice-2026-08-v1')$$,
  'once revoked, the same consent can be granted again'
);
select is(
  (select count(*)::int from public.guardian_consents
    where child_person_id = 'd8d8d8d8-8888-4888-8888-000000000022'
      and consent_type = 'app_account'),
  2,
  'and it is a second row: the gap between the two survives as history'
);

-- 99 — granted_by must be the guardian or a club_admin. A plain member typing
-- somebody else's consent in is refused.
select throws_ok(
  $$insert into public.guardian_consents
      (child_person_id, guardian_person_id, consent_type, notice_version, granted_by)
    values ('d8d8d8d8-8888-4888-8888-000000000012',
            current_setting('test.guardian_person')::uuid, 'unsupervised_messaging', 'v1',
            'c7c7c7c7-7777-4777-8777-000000000003')$$,
  'P0001',
  null,
  'granted_by must be the guardian on the row or a club_admin — a member is refused'
);

-- 100 — and a safeguarding_lead is refused too: the role whose purpose is
-- oversight must not be able to manufacture the permission it oversees.
select throws_ok(
  $$insert into public.guardian_consents
      (child_person_id, guardian_person_id, consent_type, notice_version, granted_by)
    values ('d8d8d8d8-8888-4888-8888-000000000012',
            current_setting('test.guardian_person')::uuid, 'unsupervised_messaging', 'v1',
            'c7c7c7c7-7777-4777-8777-000000000002')$$,
  'P0001',
  null,
  'a safeguarding_lead may not be the grantor of a consent'
);

-- 101 — the paper-form case: a club_admin records a consent the guardian gave.
select lives_ok(
  $$insert into public.guardian_consents
      (child_person_id, guardian_person_id, consent_type, notice_version, granted_by, notes)
    values ('d8d8d8d8-8888-4888-8888-000000000012',
            current_setting('test.guardian_person')::uuid, 'unsupervised_messaging', 'v1',
            'c7c7c7c7-7777-4777-8777-000000000001',
            'signed paper form filed 2026-08-22')$$,
  'a club_admin may record a consent given by a real guardian on paper'
);

-- 102 — the guardian themselves, which is the ordinary case.
select lives_ok(
  $$insert into public.guardian_consents
      (child_person_id, guardian_person_id, consent_type, notice_version, granted_by)
    values ('d8d8d8d8-8888-4888-8888-000000000025',
            current_setting('test.guardian_person')::uuid, 'app_account', 'v1',
            'c7c7c7c7-7777-4777-8777-000000000004')$$,
  'the guardian may be their own granted_by'
);


-- ---------------------------------------------------------------------------
-- F. The change guard
-- ---------------------------------------------------------------------------

-- 103 — the identity columns are evidence, not fields.
select throws_ok(
  $$update public.guardian_consents
       set child_person_id = 'd8d8d8d8-8888-4888-8888-000000000018'
     where id = 'e9e9e9e9-9999-4999-8999-000000000011'$$,
  'P0001',
  null,
  'a consent cannot be retargeted at another child — revoke it and grant a new one'
);

-- 104
select throws_ok(
  $$update public.guardian_consents set notice_version = 'rewritten'
     where id = 'e9e9e9e9-9999-4999-8999-000000000011'$$,
  'P0001',
  null,
  'notice_version cannot be rewritten — SG-9 relies on it saying what they were told'
);

-- 105 — a revocation cannot be undone in place; a fresh consent is a new row.
select throws_ok(
  $$update public.guardian_consents set revoked_at = null
     where id = 'e9e9e9e9-9999-4999-8999-000000000022'$$,
  'P0001',
  null,
  'a revocation cannot be cleared — that would erase the gap the record exists to hold'
);

-- 106 — a caller with no JWT resolves to no person, so has_any_role() is false
-- and the caller is treated as a non-admin: revoke-only. Deliberate and
-- fail-closed — an Edge Function has no legitimate reason to rewrite a
-- consent's notes. Note that `reset role` does NOT clear `request.jwt.claims`,
-- so the claims left behind by test 62 must be cleared explicitly.
set local request.jwt.claims to '';
set local role service_role;

select throws_ok(
  $$update public.guardian_consents set notes = 'edited with no JWT'
     where id = 'e9e9e9e9-9999-4999-8999-000000000011'$$,
  'P0001',
  null,
  'service_role, holding no role of its own, may only revoke — never edit notes'
);

reset role;

-- 107 — a club_admin may.
set local request.jwt.claims to '{"sub":"c7c7c7c7-7777-4777-8777-000000000001","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$update public.guardian_consents set notes = 'reviewed at committee'
     where id = 'e9e9e9e9-9999-4999-8999-000000000011'$$,
  'a club_admin may edit the administrative fields'
);

reset role;


-- ---------------------------------------------------------------------------
-- G. SG-7 audit rows
-- ---------------------------------------------------------------------------

set local request.jwt.claims to '{"sub":"c7c7c7c7-7777-4777-8777-000000000004","role":"authenticated"}';
set local role authenticated;

-- 108 — `consent_grant_writes_audit_row`, as the guardian, through RLS.
select lives_ok(
  $$insert into public.guardian_consents
      (id, child_person_id, guardian_person_id, consent_type, notice_version, notes)
    values ('e9e9e9e9-9999-4999-8999-00000000aaaa',
            'd8d8d8d8-8888-4888-8888-000000000018',
            current_setting('test.guardian_person')::uuid,
            'unsupervised_messaging', 'notice-2026-08-v1',
            'private note that must not reach audit_log')$$,
  'a guardian grants a consent for their own child'
);

reset role;

-- 109 — SG-7's shape, with the actor resolved from the JWT.
select results_eq(
  $$select actor_id, actor_email, entity, entity_id,
           detail ->> 'child_person_id', detail ->> 'guardian_person_id',
           detail ->> 'consent_type', detail ->> 'notice_version'
      from public.audit_log
     where action = 'safeguarding.consent.granted'
       and entity_id = 'e9e9e9e9-9999-4999-8999-00000000aaaa'$$,
  $$values ('c7c7c7c7-7777-4777-8777-000000000004'::uuid,
            'cguardian@test.invalid'::text,
            'guardian_consents'::text,
            'e9e9e9e9-9999-4999-8999-00000000aaaa'::text,
            'd8d8d8d8-8888-4888-8888-000000000018'::text,
            (select current_setting('test.guardian_person')),
            'unsupervised_messaging'::text,
            'notice-2026-08-v1'::text)$$,
  'the grant wrote a safeguarding.consent.granted row naming actor, child, guardian, type and notice'
);

-- 110 — `notes` IS NOT COPIED IN. SG-7: "detail must never contain the content
-- it is logging access to", and audit_read is is_committee(), which is wider
-- than this table's own policies.
select is(
  (select detail ? 'notes' from public.audit_log
    where action = 'safeguarding.consent.granted'
      and entity_id = 'e9e9e9e9-9999-4999-8999-00000000aaaa'),
  false,
  'no notes text reaches audit_log (SG-7)'
);

-- 111 — `consent_revoke_writes_audit_row`
set local request.jwt.claims to '{"sub":"c7c7c7c7-7777-4777-8777-000000000004","role":"authenticated"}';
set local role authenticated;

update public.guardian_consents
   set revoked_at = now(), revoked_by = 'c7c7c7c7-7777-4777-8777-000000000004'
 where id = 'e9e9e9e9-9999-4999-8999-00000000aaaa';

reset role;

select results_eq(
  $$select actor_id, detail ->> 'consent_type'
      from public.audit_log
     where action = 'safeguarding.consent.revoked'
       and entity_id = 'e9e9e9e9-9999-4999-8999-00000000aaaa'$$,
  $$values ('c7c7c7c7-7777-4777-8777-000000000004'::uuid,
            'unsupervised_messaging'::text)$$,
  'the revocation wrote a safeguarding.consent.revoked row'
);

-- 112 — a cosmetic edit writes nothing. An audit log that records typo fixes is
-- one nobody reads.
select set_config('test.consent_audit',
  (select count(*)::text from public.audit_log where entity = 'guardian_consents'), true);

set local request.jwt.claims to '{"sub":"c7c7c7c7-7777-4777-8777-000000000001","role":"authenticated"}';
set local role authenticated;

update public.guardian_consents set notes = 'typo fixed'
 where id = 'e9e9e9e9-9999-4999-8999-000000000011';

reset role;

select results_eq(
  $$select count(*)::int from public.audit_log where entity = 'guardian_consents'$$,
  $$select current_setting('test.consent_audit')::int$$,
  'editing notes writes no audit row — only grants and revocations are events'
);

-- 113, 114 — the suppression GUC (P1.4's pattern), which the Phase 3 import
-- will use. Nothing in the migration sets it.
select set_config('app.guardian_consents_audit_suppressed', 'on', true);

insert into public.guardian_consents
  (id, child_person_id, guardian_person_id, consent_type, notice_version)
values ('e9e9e9e9-9999-4999-8999-00000000bbbb',
        'd8d8d8d8-8888-4888-8888-000000000019',
        current_setting('test.guardian_person')::uuid,
        'unsupervised_messaging', 'imported');

select results_eq(
  $$select count(*)::int from public.audit_log where entity = 'guardian_consents'$$,
  $$select current_setting('test.consent_audit')::int$$,
  'a suppressed grant writes no per-grant audit row'
);

select set_config('app.guardian_consents_audit_suppressed', 'off', true);

insert into public.guardian_consents
  (id, child_person_id, guardian_person_id, consent_type, notice_version)
values ('e9e9e9e9-9999-4999-8999-00000000cccc',
        'd8d8d8d8-8888-4888-8888-000000000014',
        current_setting('test.guardian_person')::uuid,
        'unsupervised_messaging', 'notice-2026-08-v1');

select is(
  (select count(*)::int from public.audit_log
    where action = 'safeguarding.consent.granted'
      and entity_id = 'e9e9e9e9-9999-4999-8999-00000000cccc'),
  1,
  'and an ordinary grant immediately afterwards is logged normally'
);

-- 115 — a row inserted ALREADY revoked is a historical import, not a grant.
insert into public.guardian_consents
  (id, child_person_id, guardian_person_id, consent_type, notice_version,
   granted_at, revoked_at)
values ('e9e9e9e9-9999-4999-8999-00000000dddd',
        'd8d8d8d8-8888-4888-8888-000000000024',
        current_setting('test.guardian_person')::uuid,
        'unsupervised_messaging', 'historic',
        now() - interval '3 years', now() - interval '2 years');

select is(
  (select count(*)::int from public.audit_log
    where entity_id = 'e9e9e9e9-9999-4999-8999-00000000dddd'),
  0,
  'a row inserted already revoked writes no audit row — it is history, not an event'
);


-- ---------------------------------------------------------------------------
-- H. SG-2, extended to guardian_consents (SG-10, recorded as a §6.2
--    strengthening)
-- ---------------------------------------------------------------------------

set local request.jwt.claims to '{"sub":"c7c7c7c7-7777-4777-8777-000000000001","role":"authenticated"}';
set local role authenticated;

-- 116, 117 — `hard_delete_consent_throws`, `truncate_consents_throws`
select throws_ok(
  $$delete from public.guardian_consents
     where id = 'e9e9e9e9-9999-4999-8999-000000000011'$$,
  '42501',
  null,
  'even a club_admin cannot hard-delete a consent (privilege revoked)'
);
select throws_ok(
  $$truncate public.guardian_consents$$,
  '42501',
  null,
  'authenticated cannot truncate guardian_consents'
);

reset role;
set local role service_role;

-- 118, 119
select throws_ok(
  $$delete from public.guardian_consents
     where id = 'e9e9e9e9-9999-4999-8999-000000000011'$$,
  '42501',
  null,
  'service_role cannot hard-delete a consent, BYPASSRLS notwithstanding'
);
select throws_ok(
  $$truncate public.guardian_consents$$,
  '42501',
  null,
  'service_role cannot truncate guardian_consents'
);

reset role;
set local role anon;

-- 120
select throws_ok(
  $$truncate public.guardian_consents$$,
  '42501',
  null,
  'anon cannot truncate guardian_consents'
);

reset role;

-- 121, 122 — the two that matter: the owner is not stopped by a revoked
-- privilege, only by the triggers.
select throws_ok(
  $$delete from public.guardian_consents
     where id = 'e9e9e9e9-9999-4999-8999-000000000011'$$,
  'P0001',
  null,
  'the table owner is stopped by trg_guardian_consents_deny_hard_delete (SG-2)'
);
select throws_ok(
  $$truncate public.guardian_consents$$,
  'P0001',
  null,
  'and by trg_guardian_consents_deny_truncate — a row-level delete trigger never fires on TRUNCATE'
);


-- ---------------------------------------------------------------------------
-- I. SG-10 on public.profiles, and the people.dob re-check
-- ---------------------------------------------------------------------------
-- The INSERT arm is reached the way profiles_person_link.test.sql reaches it:
-- create the login, drop the profile handle_new_user() made, insert by hand.

insert into auth.users (id, email, raw_user_meta_data) values
  ('c7c7c7c7-7777-4777-8777-000000000031', 'cslot1@test.invalid', '{"full_name": "Slot One"}'::jsonb),
  ('c7c7c7c7-7777-4777-8777-000000000032', 'cslot2@test.invalid', '{"full_name": "Slot Two"}'::jsonb),
  ('c7c7c7c7-7777-4777-8777-000000000033', 'cslot3@test.invalid', '{"full_name": "Slot Three"}'::jsonb),
  ('c7c7c7c7-7777-4777-8777-000000000034', 'cslot4@test.invalid', '{"full_name": "Slot Four"}'::jsonb),
  ('c7c7c7c7-7777-4777-8777-000000000035', 'cslot5@test.invalid', '{"full_name": "Slot Five"}'::jsonb);

delete from public.profiles
 where id in ('c7c7c7c7-7777-4777-8777-000000000031',
              'c7c7c7c7-7777-4777-8777-000000000032',
              'c7c7c7c7-7777-4777-8777-000000000033',
              'c7c7c7c7-7777-4777-8777-000000000034',
              'c7c7c7c7-7777-4777-8777-000000000035');

-- 123 — `profile_for_minor_without_consent_throws`, run as the OWNER: the
-- trigger, not a grant or a policy, is what must refuse.
select throws_ok(
  $$insert into public.profiles (id, role, full_name, person_id)
    values ('c7c7c7c7-7777-4777-8777-000000000031', 'member', 'Otto Otherchild',
            'd8d8d8d8-8888-4888-8888-000000000015')$$,
  'P0001',
  null,
  'a profile for a 15-year-old with no consent is refused (owner)'
);

-- 124 — as service_role too.
set local role service_role;
select throws_ok(
  $$insert into public.profiles (id, role, full_name, person_id)
    values ('c7c7c7c7-7777-4777-8777-000000000031', 'member', 'Otto Otherchild',
            'd8d8d8d8-8888-4888-8888-000000000015')$$,
  'P0001',
  null,
  'and as service_role, whose BYPASSRLS buys it nothing against a trigger'
);
reset role;

-- 125 — `profile_for_minor_below_min_account_age_throws_even_with_consent`.
-- Tim is 10 and HAS a live app_account consent.
select throws_ok(
  $$insert into public.profiles (id, role, full_name, person_id)
    values ('c7c7c7c7-7777-4777-8777-000000000031', 'member', 'Tim Ten',
            'd8d8d8d8-8888-4888-8888-000000000012')$$,
  'P0001',
  null,
  'a 10-year-old is refused an account even with a guardian''s consent'
);

-- 126 — and the message names the limb that failed, as SG-10 requires.
select throws_like(
  $$insert into public.profiles (id, role, full_name, person_id)
    values ('c7c7c7c7-7777-4777-8777-000000000031', 'member', 'Tim Ten',
            'd8d8d8d8-8888-4888-8888-000000000012')$$,
  '%minimum account age%',
  'the error says WHICH limb failed — too young, not "no consent"'
);

-- 127 — `profile_for_minor_with_revoked_consent_throws`. Fred's first consent
-- was revoked at test 86 and re-granted at 96, so revoke the live one again.
update public.guardian_consents set revoked_at = now()
 where child_person_id = 'd8d8d8d8-8888-4888-8888-000000000022'
   and consent_type = 'app_account'
   and revoked_at is null;

select throws_like(
  $$insert into public.profiles (id, role, full_name, person_id)
    values ('c7c7c7c7-7777-4777-8777-000000000031', 'member', 'Fred Fourteenexact',
            'd8d8d8d8-8888-4888-8888-000000000022')$$,
  '%no active app_account consent%',
  'a revoked consent refuses the account, and the message says so'
);

-- 128 — `profile_for_eligible_minor_succeeds`
select lives_ok(
  $$insert into public.profiles (id, role, full_name, person_id)
    values ('c7c7c7c7-7777-4777-8777-000000000031', 'member', 'Thea Exactthirteen',
            'd8d8d8d8-8888-4888-8888-000000000018')$$,
  'an account-eligible 13-year-old may hold a profile'
);

-- 129 — `profile_for_unknown_dob_person_allowed`. SG-10's documented deviation
-- from §1.2, without which every adult self-signup would be refused. Flip this
-- test if Adam decides otherwise.
select lives_ok(
  $$insert into public.profiles (id, role, full_name, person_id)
    values ('c7c7c7c7-7777-4777-8777-000000000032', 'member', 'Unk Nowndob',
            'd8d8d8d8-8888-4888-8888-000000000014')$$,
  'a person with an unknown dob may hold a profile (SG-10''s deliberate carve-out)'
);

-- 130 — an adult is unaffected in every direction.
select lives_ok(
  $$insert into public.profiles (id, role, full_name, person_id)
    values ('c7c7c7c7-7777-4777-8777-000000000033', 'member', 'Ash Seventeen',
            'd8d8d8d8-8888-4888-8888-000000000013')$$,
  'an adult with a known dob and no consent row may hold a profile'
);

-- 131 — the UPDATE arm: repointing a profile at an ineligible minor reaches the
-- same prohibited state with nothing happening in people or guardian_consents.
select throws_ok(
  $$update public.profiles set person_id = 'd8d8d8d8-8888-4888-8888-000000000015'
     where id = 'c7c7c7c7-7777-4777-8777-000000000033'$$,
  'P0001',
  null,
  'a profile cannot be repointed at an ineligible minor either'
);

-- 132 — `revoking_app_account_consent_does_not_delete_existing_profile`.
-- SG-10: "it does not cascade into destroying an existing one."
update public.guardian_consents set revoked_at = now()
 where child_person_id = 'd8d8d8d8-8888-4888-8888-000000000018'
   and consent_type = 'app_account'
   and revoked_at is null;

select is(
  (select count(*)::int from public.profiles
    where person_id = 'd8d8d8d8-8888-4888-8888-000000000018'),
  1,
  'revoking app_account consent leaves the existing profile exactly where it was'
);

-- 133 — and the account is now ineligible, which is what the D10 nightly report
-- will pick up. Reporting is P5.x; the fact is true today.
select ok(not public.is_account_eligible('d8d8d8d8-8888-4888-8888-000000000018'),
  'the profile-holder is now ineligible — a paperwork gap for the nightly report (D10)');

-- Put Thea's consent back; §I's dob tests use her.
insert into public.guardian_consents
  (child_person_id, guardian_person_id, consent_type, notice_version)
values ('d8d8d8d8-8888-4888-8888-000000000018',
        current_setting('test.guardian_person')::uuid, 'app_account', 'notice-2026-08-v1');

-- 134 — `dob_correction_making_profile_holder_an_ineligible_minor_throws`.
-- SG-10: "as is a dob correction that turns an existing account holder into an
-- ineligible minor". Ash holds a profile and is an adult; make him 11.
select throws_ok(
  $$update public.people set dob = (current_date - interval '11 years')::date
     where id = 'd8d8d8d8-8888-4888-8888-000000000013'$$,
  'P0001',
  null,
  'a dob correction that makes an account holder an ineligible minor is rejected'
);

-- 135 — the same correction on a person with NO profile is fine: SG-10 is about
-- accounts, not about ages.
select lives_ok(
  $$update public.people set dob = (current_date - interval '11 years')::date
     where id = 'd8d8d8d8-8888-4888-8888-000000000015'$$,
  'the same dob change on a person with no account is allowed'
);

-- 136 — and a correction that leaves the holder ELIGIBLE is allowed: Thea is 13
-- with a live consent, so making her 14 is fine.
select lives_ok(
  $$update public.people set dob = (current_date - interval '14 years')::date
     where id = 'd8d8d8d8-8888-4888-8888-000000000018'$$,
  'a dob correction that keeps the holder eligible is allowed'
);

-- 137 — P1.1's original branch still works. The one dob trigger now carries two
-- rules and must not have lost the first.
select throws_ok(
  $$update public.people set dob = (current_date + interval '1 day')::date
     where id = 'd8d8d8d8-8888-4888-8888-000000000018'$$,
  'P0001',
  null,
  'people_dob_guard() still refuses a dob in the future (P1.1''s branch survives)'
);


-- ---------------------------------------------------------------------------
-- J. handle_new_user() — the invite flow
-- ---------------------------------------------------------------------------

select set_config('test.people_before',
  (select count(*)::text from public.people), true);

-- 138, 139, 140 — `invited_eligible_minor_signup_succeeds`. Cara is 14 with a
-- live app_account consent and no profile.
select lives_ok(
  $$insert into auth.users (id, email, raw_user_meta_data)
    values ('c7c7c7c7-7777-4777-8777-000000000041', 'ccara@test.invalid',
            ('{"full_name": "Cara Fourteen", "person_id": "d8d8d8d8-8888-4888-8888-000000000011"}')::jsonb)$$,
  'an invited, account-eligible minor can sign up'
);

select results_eq(
  $$select person_id from public.profiles
     where id = 'c7c7c7c7-7777-4777-8777-000000000041'$$,
  $$values ('d8d8d8d8-8888-4888-8888-000000000011'::uuid)$$,
  'and the profile is linked to the invited person, not to a new one'
);

select results_eq(
  $$select count(*)::int from public.people$$,
  $$select current_setting('test.people_before')::int$$,
  'no new person row was created — the invite adopted the existing child'
);

-- 141 — `underage_signup_without_consent_refused`, read as SG-10's enforcement
-- note reads it: "Triggers, because this must bind the auth admin path". The
-- reachable underage signup is the invited one — an id naming a consented child
-- who is nevertheless below min_account_age — and the whole auth.users insert
-- fails.
select throws_ok(
  $$insert into auth.users (id, email, raw_user_meta_data)
    values ('c7c7c7c7-7777-4777-8777-000000000042', 'ctim@test.invalid',
            ('{"full_name": "Tim Ten", "person_id": "d8d8d8d8-8888-4888-8888-000000000012"}')::jsonb)$$,
  'P0001',
  null,
  'an underage invited signup is refused outright — the login is never created'
);

-- 142
select is(
  (select count(*)::int from auth.users
    where id = 'c7c7c7c7-7777-4777-8777-000000000042'),
  0,
  'and the auth.users row was rolled back with it'
);

-- 143, 144, 145 — `handle_new_user_ignores_person_id_without_active_consent`.
-- SG-10: "in every other case it creates a new person exactly as it does
-- today." Otto is a known minor with no consent row at all, so the invite
-- branch declines him and the ordinary path runs. Note what this proves and
-- what it does not: the signup SUCCEEDS, because it adopts nobody and the fresh
-- person it creates has a NULL dob, which SG-10's carve-out permits. The
-- refusal case is test 141, where the invite branch DOES adopt and §10's guard
-- then refuses the account.
select set_config('test.people_before2',
  (select count(*)::text from public.people), true);

select lives_ok(
  $$insert into auth.users (id, email, raw_user_meta_data)
    values ('c7c7c7c7-7777-4777-8777-000000000043', 'cotto@test.invalid',
            ('{"full_name": "Otto Otherchild", "person_id": "d8d8d8d8-8888-4888-8888-000000000015"}')::jsonb)$$,
  'a person_id with no active consent does not fail the signup — it is ignored'
);

select is(
  (select person_id = 'd8d8d8d8-8888-4888-8888-000000000015'
     from public.profiles where id = 'c7c7c7c7-7777-4777-8777-000000000043'),
  false,
  'the named person was NOT adopted'
);

select results_eq(
  $$select count(*)::int from public.people$$,
  $$select (current_setting('test.people_before2')::int + 1)$$,
  'a fresh person was created instead, exactly as before P1.7'
);

-- 146, 147 — `handle_new_user_ignores_person_id_that_already_has_a_profile`.
-- Cara acquired one at test 137.
select lives_ok(
  $$insert into auth.users (id, email, raw_user_meta_data)
    values ('c7c7c7c7-7777-4777-8777-000000000044', 'ccara2@test.invalid',
            ('{"full_name": "Cara Fourteen", "person_id": "d8d8d8d8-8888-4888-8888-000000000011"}')::jsonb)$$,
  'a person_id that already has a profile does not fail the signup'
);

select is(
  (select person_id = 'd8d8d8d8-8888-4888-8888-000000000011'
     from public.profiles where id = 'c7c7c7c7-7777-4777-8777-000000000044'),
  false,
  'and it is not adopted a second time — the one-to-one link holds'
);

-- 148 — a malformed person_id is ignored rather than fatal: a tampered invite
-- link must not be able to break signup.
select lives_ok(
  $$insert into auth.users (id, email, raw_user_meta_data)
    values ('c7c7c7c7-7777-4777-8777-000000000045', 'cjunk@test.invalid',
            ('{"full_name": "Junk Meta", "person_id": "not-a-uuid"}')::jsonb)$$,
  'a malformed person_id in the metadata is ignored, not fatal'
);

-- 149, 150 — `adult_signup_unaffected`
select set_config('test.people_before3',
  (select count(*)::text from public.people), true);

select lives_ok(
  $$insert into auth.users (id, email, raw_user_meta_data)
    values ('c7c7c7c7-7777-4777-8777-000000000046', 'cordinary@test.invalid',
            '{"full_name": "Olive Ordinary"}'::jsonb)$$,
  'an ordinary signup with no person_id metadata is unaffected'
);

select results_eq(
  $$select pe.first_name, pe.last_name, (pe.dob is null)
      from public.profiles p join public.people pe on pe.id = p.person_id
     where p.id = 'c7c7c7c7-7777-4777-8777-000000000046'$$,
  $$values ('Olive'::text, 'Ordinary'::text, true)$$,
  'it still creates a person from full_name with a NULL dob, exactly as P1.2 wrote it'
);

-- 151 — STILL NO AUTO-LINK BY EMAIL (P1.2's decision, which SG-10 calls "doubly
-- important here, since families share addresses"). Sam's person row carries
-- this address; a brand-new login using it must adopt nothing.
select lives_ok(
  $$insert into auth.users (id, email, raw_user_meta_data)
    values ('c7c7c7c7-7777-4777-8777-000000000047', 'cshared@test.invalid',
            '{"full_name": "Sam Sharedemail"}'::jsonb)$$,
  'a signup reusing an existing person''s email address is accepted'
);

-- 152
select is(
  (select person_id = 'd8d8d8d8-8888-4888-8888-000000000026'
     from public.profiles where id = 'c7c7c7c7-7777-4777-8777-000000000047'),
  false,
  'and it adopts nobody: handle_new_user() never matches on email'
);


-- ---------------------------------------------------------------------------
-- K. The RLS matrix
-- ---------------------------------------------------------------------------

select set_config('test.consents_total',
  (select count(*)::text from public.guardian_consents), true);
select set_config('test.gwen_children_consents',
  (select count(*)::text from public.guardian_consents gc
    where exists (
      select 1 from public.guardianships g
       where g.child_person_id = gc.child_person_id
         and g.guardian_person_id = current_setting('test.guardian_person')::uuid
         and g.ended_at is null)), true);
select set_config('test.cara_consents',
  (select count(*)::text from public.guardian_consents
    where child_person_id = 'd8d8d8d8-8888-4888-8888-000000000011'), true);

-- --- the guardian -----------------------------------------------------------
set local request.jwt.claims to '{"sub":"c7c7c7c7-7777-4777-8777-000000000004","role":"authenticated"}';
set local role authenticated;

-- 153 — `guardian_sees_only_own_children_consents`
select results_eq(
  $$select count(*)::int from public.guardian_consents$$,
  $$select current_setting('test.gwen_children_consents')::int$$,
  'a guardian reads exactly the consents of the children they are LIVE-linked to'
);

-- 154 — §1.3: "A person holding `parent` for child A has no standing whatsoever
-- in respect of child B."
select is_empty(
  $$select id from public.guardian_consents
     where child_person_id = 'd8d8d8d8-8888-4888-8888-000000000015'$$,
  'and none belonging to another family''s child'
);

-- 155 — and cannot grant one for that child either. It is §9a's trigger that
-- refuses, not the policy: a BEFORE ROW trigger runs before RLS's WITH CHECK is
-- evaluated, and that ordering is the point — the trigger is the layer that also
-- binds service_role.
select throws_ok(
  $$insert into public.guardian_consents
      (child_person_id, guardian_person_id, consent_type, notice_version)
    values ('d8d8d8d8-8888-4888-8888-000000000015',
            current_setting('test.guardian_person')::uuid, 'app_account', 'v1')$$,
  'P0001',
  null,
  'a guardian cannot grant a consent for a child they have no live link to'
);

reset role;

-- --- the child --------------------------------------------------------------
-- SG-10: "the child reads their own".
set local request.jwt.claims to '{"sub":"c7c7c7c7-7777-4777-8777-000000000041","role":"authenticated"}';
set local role authenticated;

-- 156
select results_eq(
  $$select count(*)::int from public.guardian_consents$$,
  $$select current_setting('test.cara_consents')::int$$,
  'the child reads the consents held about them, and only those'
);

-- 157 — read only: the consent is not theirs to withdraw. An UPDATE with no
-- matching policy is not an error; it matches no rows.
select set_config('test.cara_live_before',
  (select count(*)::text from public.guardian_consents
    where child_person_id = 'd8d8d8d8-8888-4888-8888-000000000011'
      and revoked_at is null), true);

update public.guardian_consents set revoked_at = now()
 where child_person_id = 'd8d8d8d8-8888-4888-8888-000000000011'
   and revoked_at is null;

reset role;

select results_eq(
  $$select count(*)::int from public.guardian_consents
     where child_person_id = 'd8d8d8d8-8888-4888-8888-000000000011'
       and revoked_at is null$$,
  $$select current_setting('test.cara_live_before')::int$$,
  'the child''s attempt to revoke their own consent silently affected no rows'
);

-- --- the two admin roles ----------------------------------------------------
set local request.jwt.claims to '{"sub":"c7c7c7c7-7777-4777-8777-000000000001","role":"authenticated"}';
set local role authenticated;

-- 158
select results_eq(
  $$select count(*)::int from public.guardian_consents$$,
  $$select current_setting('test.consents_total')::int$$,
  'a club_admin reads every consent, revoked ones included'
);

reset role;
set local request.jwt.claims to '{"sub":"c7c7c7c7-7777-4777-8777-000000000002","role":"authenticated"}';
set local role authenticated;

-- 159
select results_eq(
  $$select count(*)::int from public.guardian_consents$$,
  $$select current_setting('test.consents_total')::int$$,
  'a safeguarding_lead reads every consent (SG-10: "club_admin and safeguarding_lead read all")'
);

-- 160 — "...and may revoke". SG-10 names both roles; SAFEGUARDING.md outranks a
-- task description (§1), and a Club Welfare Officer who learns a consent should
-- not stand must be able to withdraw it without finding a committee member.
select lives_ok(
  $$update public.guardian_consents
       set revoked_at = now(), revoked_by = 'c7c7c7c7-7777-4777-8777-000000000002'
     where id = 'e9e9e9e9-9999-4999-8999-000000000012'$$,
  'a safeguarding_lead may revoke a consent'
);

-- 161 — but may not GRANT one: the role whose purpose is oversight must not
-- manufacture the permission it oversees.
select throws_ok(
  $$insert into public.guardian_consents
      (child_person_id, guardian_person_id, consent_type, notice_version)
    values ('d8d8d8d8-8888-4888-8888-000000000019',
            current_setting('test.guardian_person')::uuid, 'app_account', 'v1')$$,
  '42501',
  null,
  'a safeguarding_lead cannot grant a consent — there is no admin insert policy'
);

reset role;

-- --- a plain member, a coach, and anon --------------------------------------
set local request.jwt.claims to '{"sub":"c7c7c7c7-7777-4777-8777-000000000003","role":"authenticated"}';
set local role authenticated;

-- 162
select is_empty(
  $$select id from public.guardian_consents$$,
  'a plain member sees no consent at all'
);

reset role;
set local request.jwt.claims to '{"sub":"c7c7c7c7-7777-4777-8777-000000000005","role":"authenticated"}';
set local role authenticated;

-- 163 — `coach_reads_zero_consents`. §1.3 gives coach no member-data access.
select is_empty(
  $$select id from public.guardian_consents$$,
  'a coach reads zero consents'
);

reset role;
set local role anon;

-- 164, 165
select throws_ok(
  $$select id from public.guardian_consents$$,
  '42501',
  null,
  'anon reading guardian_consents is denied at the privilege layer, before RLS is consulted'
);
select throws_ok(
  $$insert into public.guardian_consents
      (child_person_id, guardian_person_id, consent_type, notice_version)
    values ('d8d8d8d8-8888-4888-8888-000000000019',
            'd8d8d8d8-8888-4888-8888-000000000011', 'app_account', 'v1')$$,
  '42501',
  null,
  'anon cannot grant a consent'
);

reset role;

select * from finish();

rollback;
