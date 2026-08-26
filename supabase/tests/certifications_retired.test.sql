-- =============================================================================
-- 20260825440000 — SG-6's in-app tier is retired
-- =============================================================================
-- Adam, 2026-08-26: "remove all DBS, Safeguarding and Coaching qualifications
-- from the App. We use the FA's Club Portal for this."
--
-- What this suite states is the NEW truth, and it is deliberately two-sided:
--   A  the app can no longer WRITE a certification or an exemption — not as a
--      club_admin, not as the safeguarding lead, not by any route through
--      `authenticated`;
--   B  nothing was DESTROYED — both tables, their rows, their RLS, their
--      guards, the SG-6 evaluator and the tier-2 reporting functions are all
--      still there, and `authenticated` still reads exactly what it always
--      read. The club stopped using these records; it did not throw them away;
--   C  the tier-1 switch is off and stays off, which is what makes (A) safe:
--      a guard that demanded a certification the app cannot record would
--      refuse every child-facing team assignment with no way to satisfy it.
--
-- The tier-1 machinery's own tests still live in teams_seasons.test.sql, which
-- flips the switch on to exercise them. Nothing here re-proves those.
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(26);

-- ---------------------------------------------------------------------------
-- Fixtures: a club_admin and the safeguarding lead — the only two roles that
-- could ever write these tables from the app.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('cc000000-1111-4111-8111-000000000001', 'cr-admin@test.invalid', '{"full_name": "Ada Admin"}'::jsonb),
  ('cc000000-1111-4111-8111-000000000002', 'cr-lead@test.invalid',  '{"full_name": "Lee Lead"}'::jsonb);
update public.profiles set role = 'committee' where id = 'cc000000-1111-4111-8111-000000000001';

select set_config('cr.admin', (select person_id::text from public.profiles where id = 'cc000000-1111-4111-8111-000000000001'), true);
select set_config('cr.lead',  (select person_id::text from public.profiles where id = 'cc000000-1111-4111-8111-000000000002'), true);
update public.people set dob = '1980-01-01'
 where id in (current_setting('cr.admin')::uuid, current_setting('cr.lead')::uuid);
insert into public.person_roles (person_id, role) values (current_setting('cr.lead')::uuid, 'safeguarding_lead');

-- One historical certification, written as the owner — which is what a
-- back-office correction or a restore would be, and what every row already in
-- the table is.
insert into public.certifications (id, person_id, type, expires_on, verified_at)
  values ('cd000000-1111-4111-8111-000000000001', current_setting('cr.admin')::uuid, 'fa_dbs', current_date + 365, now());

-- ---------------------------------------------------------------------------
-- A. The app can no longer write
-- ---------------------------------------------------------------------------
select ok(not has_table_privilege('authenticated', 'public.certifications', 'INSERT'),
  'authenticated cannot INSERT certifications');
select ok(not has_table_privilege('authenticated', 'public.certifications', 'UPDATE'),
  'authenticated cannot UPDATE certifications');
select ok(not has_table_privilege('authenticated', 'public.certifications', 'DELETE'),
  'authenticated cannot DELETE certifications');
select ok(not has_table_privilege('authenticated', 'public.certification_exemptions', 'INSERT'),
  'authenticated cannot INSERT certification_exemptions');
select ok(not has_table_privilege('authenticated', 'public.certification_exemptions', 'UPDATE'),
  'authenticated cannot UPDATE certification_exemptions');
select ok(not has_table_privilege('authenticated', 'public.certification_exemptions', 'DELETE'),
  'authenticated cannot DELETE certification_exemptions');

-- and the refusal is real, not only a catalog fact. A club_admin holds every
-- policy these tables ever admitted; the grant is what stops them now.
set local request.jwt.claims to '{"sub":"cc000000-1111-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $q$insert into public.certifications (person_id, type, expires_on)
     values (current_setting('cr.admin')::uuid, 'fa_dbs', current_date + 365)$q$,
  '42501', null, 'club_admin: recording a certification is refused');
select throws_ok(
  $q$update public.certifications set verified_at = now() where id = 'cd000000-1111-4111-8111-000000000001'$q$,
  '42501', null, 'club_admin: verifying a certification is refused');
select throws_ok(
  $q$update public.certifications set revoked_at = now() where id = 'cd000000-1111-4111-8111-000000000001'$q$,
  '42501', null, 'club_admin: revoking a certification is refused');
reset role;

set local request.jwt.claims to '{"sub":"cc000000-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $q$insert into public.certifications (person_id, type, expires_on)
     values (current_setting('cr.lead')::uuid, 'safeguarding_children', current_date + 365)$q$,
  '42501', null, 'safeguarding_lead: recording a certification is refused');
select throws_ok(
  $q$insert into public.certification_exemptions (person_id, team_id, reason, granted_by_person_id, expires_on)
     values (current_setting('cr.lead')::uuid, gen_random_uuid(), 'paperwork pending', current_setting('cr.lead')::uuid, current_date + 7)$q$,
  '42501', null, 'safeguarding_lead: granting an exemption is refused');
reset role;

-- ---------------------------------------------------------------------------
-- B. Nothing was destroyed
-- ---------------------------------------------------------------------------
-- `reset role` above leaves the previous jwt claims in place, so anything
-- asking what the TABLE holds is asked here, as the owner, with the claims
-- explicitly cleared.
set local request.jwt.claims to '{}';

select has_table('public', 'certifications', 'certifications is kept, not dropped');
select has_table('public', 'certification_exemptions', 'certification_exemptions is kept, not dropped');
select has_table('public', 'child_facing_roles', 'child_facing_roles is kept, not dropped');
select is((select count(*) from public.certifications where id = 'cd000000-1111-4111-8111-000000000001'),
  1::bigint, 'the historical row is still there');

select ok(has_table_privilege('authenticated', 'public.certifications', 'SELECT'),
  'authenticated still READS certifications — the history is not hidden');
select ok(has_table_privilege('authenticated', 'public.certification_exemptions', 'SELECT'),
  'authenticated still READS certification_exemptions');
select ok(has_table_privilege('service_role', 'public.certifications', 'INSERT'),
  'service_role can still write: a back-office correction, or re-enabling, needs no migration');
select ok(not has_table_privilege('service_role', 'public.certifications', 'DELETE'),
  'SG-2 stands: not even service_role may DELETE a certification');

-- The RLS policies are left in place. A policy with no grant behind it is
-- inert, and keeping them means re-enabling is a GRANT, not a rewrite.
select ok((select count(*) from pg_policies
            where schemaname = 'public' and tablename = 'certifications') >= 4,
  'the certifications policies are left intact for a future re-enablement');

-- The evaluator and the tier-2 reporting functions still exist; nothing calls
-- them from the app any more.
select has_function('public', 'is_child_facing_compliant', array['uuid', 'uuid'],
  'the shared SG-6 evaluator still exists');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'compliance_report'),
  1::bigint, 'compliance_report() still exists (nothing in the app calls it)');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'due_certification_nudges'),
  1::bigint, 'due_certification_nudges() still exists (nothing in the app calls it)');

-- ---------------------------------------------------------------------------
-- C. The switch is off, and the guard therefore lets a team be staffed
-- ---------------------------------------------------------------------------
select is((select value from public.site_settings where key = 'safeguarding.sg6_enforcement'),
  '0', 'safeguarding.sg6_enforcement is 0 on production');
select is(public.sg6_enforcement_enabled(), false, 'SG-6 tier-1 enforcement is off');
-- The lead holds no certification at all, and with the tier off that is fine:
-- this is the state every coach is now in, and it must not block anything.
select is(public.is_child_facing_compliant(current_setting('cr.lead')::uuid, gen_random_uuid()), true,
  'with the tier off, someone with no certification is not blocked from a child-facing role');

select * from finish();

rollback;
