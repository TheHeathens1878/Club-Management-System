-- =============================================================================
-- P2.1 — seasons, teams, team_memberships, certifications, SG-6 tier 1
-- =============================================================================
-- What this suite covers, and where:
--   A  schema shape, RLS enabled, policy lists, privileges, SG-2 on the two
--      evidence tables
--   B  helpers: child-facing lookup (undesignated fails closed),
--      team_has_minors, has_current_certification (expired / unverified /
--      revoked), is_child_facing_compliant
--   C  SG-6 tier 1 — every test SAFEGUARDING.md names, as the owner and as
--      club_admin: staff side (a), composition side (b), DOB side (c), and the
--      exemption rules (lead only, ≤30 days, expiry, audit)
--   D  SG-7 audit rows for certifications
--   E  RLS: coaches see own teams; admins all; self; guardian; member nothing
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(75);

-- SG-6 tier-1 enforcement is OFF in production (FA Clubs Portal is the record;
-- see the 2026-08-23 amendment in SAFEGUARDING.md). These tests exercise the
-- machinery, so they run with the switch on.
update public.site_settings set value = '1' where key = 'safeguarding.sg6_enforcement';

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('a2a2a2a2-1111-4111-8111-000000000001', 't-admin@test.invalid',  '{"full_name": "Ada Admin"}'::jsonb),
  ('a2a2a2a2-1111-4111-8111-000000000002', 't-lead@test.invalid',   '{"full_name": "Lee Lead"}'::jsonb),
  ('a2a2a2a2-1111-4111-8111-000000000003', 't-coach@test.invalid',  '{"full_name": "Cy Coach"}'::jsonb),
  ('a2a2a2a2-1111-4111-8111-000000000004', 't-member@test.invalid', '{"full_name": "Mo Member"}'::jsonb),
  ('a2a2a2a2-1111-4111-8111-000000000005', 't-parent@test.invalid', '{"full_name": "Pat Parent"}'::jsonb),
  ('a2a2a2a2-1111-4111-8111-000000000006', 't-other@test.invalid',  '{"full_name": "Ollie Othercoach"}'::jsonb);
update public.profiles set role = 'committee' where id = 'a2a2a2a2-1111-4111-8111-000000000001';

-- persons by profile
select set_config('t.admin',  (select person_id::text from public.profiles where id = 'a2a2a2a2-1111-4111-8111-000000000001'), true);
select set_config('t.lead',   (select person_id::text from public.profiles where id = 'a2a2a2a2-1111-4111-8111-000000000002'), true);
select set_config('t.coach',  (select person_id::text from public.profiles where id = 'a2a2a2a2-1111-4111-8111-000000000003'), true);
select set_config('t.member', (select person_id::text from public.profiles where id = 'a2a2a2a2-1111-4111-8111-000000000004'), true);
select set_config('t.parent', (select person_id::text from public.profiles where id = 'a2a2a2a2-1111-4111-8111-000000000005'), true);
select set_config('t.other',  (select person_id::text from public.profiles where id = 'a2a2a2a2-1111-4111-8111-000000000006'), true);

-- everybody with a login is an adult with a known dob; the lead holds the role
update public.people set dob = '1980-01-01'
 where id in (current_setting('t.admin')::uuid, current_setting('t.lead')::uuid, current_setting('t.coach')::uuid,
              current_setting('t.member')::uuid, current_setting('t.parent')::uuid, current_setting('t.other')::uuid);
insert into public.person_roles (person_id, role) values (current_setting('t.lead')::uuid, 'safeguarding_lead');

-- children (no login): one known minor, one unknown dob (SG-0 ⇒ minor), one adult player
insert into public.people (id, first_name, last_name, dob) values
  ('c2c2c2c2-1111-4111-8111-000000000001', 'Kid', 'Known',   current_date - interval '10 years'),
  ('c2c2c2c2-1111-4111-8111-000000000002', 'Kid', 'Unknown', null),
  ('c2c2c2c2-1111-4111-8111-000000000003', 'Ad',  'Ult',     '1990-05-05'),
  ('c2c2c2c2-1111-4111-8111-000000000004', 'Teen', 'Soon',   '2000-01-01');  -- adult now; dob corrected later
insert into public.guardianships (guardian_person_id, child_person_id, relationship)
  values (current_setting('t.parent')::uuid, 'c2c2c2c2-1111-4111-8111-000000000001', 'parent');

insert into public.seasons (id, name, starts_on, ends_on, is_current)
  values ('5e5e5e5e-1111-4111-8111-000000000001', 'Test 2030/31', '2030-08-01', '2031-05-31', false);
insert into public.teams (id, name) values
  ('7e7e7e7e-1111-4111-8111-000000000001', 'Test U11s'),
  ('7e7e7e7e-1111-4111-8111-000000000002', 'Test Adults'),
  ('7e7e7e7e-1111-4111-8111-000000000003', 'Test Empty');

-- ---------------------------------------------------------------------------
-- A. Schema shape
-- ---------------------------------------------------------------------------
select has_table('public', 'seasons', 'seasons');
select has_table('public', 'teams', 'teams');
select has_table('public', 'child_facing_roles', 'child_facing_roles');
select has_table('public', 'team_memberships', 'team_memberships');
select has_table('public', 'certifications', 'certifications');
select has_table('public', 'certification_exemptions', 'certification_exemptions');
select enum_has_labels('public', 'team_role', array['player', 'coach', 'assistant_coach', 'manager'], 'team_role labels');
select enum_has_labels('public', 'certification_type',
  array['fa_dbs', 'safeguarding_children', 'first_aid', 'coaching_badge'], 'certification_type labels');
select ok((select bool_and(relrowsecurity) from pg_class where oid in
  ('public.seasons'::regclass, 'public.teams'::regclass, 'public.child_facing_roles'::regclass,
   'public.team_memberships'::regclass, 'public.certifications'::regclass, 'public.certification_exemptions'::regclass)),
  'RLS enabled on all six tables');
select trigger_is('public', 'team_memberships', 'trg_team_memberships_sg6_guard', 'public', 'team_memberships_sg6_guard',
  'SG-6 guard on team_memberships');
select is((select count(*) from pg_trigger where tgrelid = 'public.people'::regclass and tgname like '%dob%'),
  1::bigint, 'still exactly ONE dob trigger on people');
select ok(not has_table_privilege('service_role', 'public.certifications', 'DELETE'),           'service_role cannot DELETE certifications');
select ok(not has_table_privilege('service_role', 'public.certification_exemptions', 'TRUNCATE'), 'service_role cannot TRUNCATE exemptions');
select ok(not has_function_privilege('anon', 'public.team_has_minors(uuid)', 'EXECUTE'), 'anon cannot execute team_has_minors');
select throws_ok($$delete from public.child_facing_roles where role = 'player'$$, 'P0001', null,
  'child_facing_roles rows cannot be deleted');
select is((select child_facing from public.child_facing_roles where role = 'coach'), true, 'coach is child-facing');
select is((select child_facing from public.child_facing_roles where role = 'player'), false, 'player is not child-facing');

-- ---------------------------------------------------------------------------
-- B. Helpers
-- ---------------------------------------------------------------------------
select is(public.team_has_minors('7e7e7e7e-1111-4111-8111-000000000001'), false, 'empty team has no minors');
insert into public.team_memberships (person_id, team_id, season_id, role)
  values ('c2c2c2c2-1111-4111-8111-000000000001', '7e7e7e7e-1111-4111-8111-000000000001', '5e5e5e5e-1111-4111-8111-000000000001', 'player');
select is(public.team_has_minors('7e7e7e7e-1111-4111-8111-000000000001'), true, 'team with a known minor has minors');
insert into public.team_memberships (person_id, team_id, season_id, role)
  values ('c2c2c2c2-1111-4111-8111-000000000003', '7e7e7e7e-1111-4111-8111-000000000002', '5e5e5e5e-1111-4111-8111-000000000001', 'player');
select is(public.team_has_minors('7e7e7e7e-1111-4111-8111-000000000002'), false, 'adult-only team has no minors');

select is(public.has_current_certification(current_setting('t.coach')::uuid, 'fa_dbs'), false, 'no cert → false');
insert into public.certifications (id, person_id, type, expires_on)
  values ('ce1ce1ce-1111-4111-8111-000000000001', current_setting('t.coach')::uuid, 'fa_dbs', current_date + 365);
select is(public.has_current_certification(current_setting('t.coach')::uuid, 'fa_dbs'), false, 'unverified cert → false');
update public.certifications set verified_at = now(), verified_by = 'a2a2a2a2-1111-4111-8111-000000000001'
 where id = 'ce1ce1ce-1111-4111-8111-000000000001';
select is(public.has_current_certification(current_setting('t.coach')::uuid, 'fa_dbs'), true, 'verified in-date cert → true');
select is(public.is_child_facing_compliant(current_setting('t.coach')::uuid, '7e7e7e7e-1111-4111-8111-000000000001'), false,
  'DBS alone is not compliant (safeguarding qualification also required, C3)');
insert into public.certifications (id, person_id, type, expires_on, verified_at)
  values ('ce1ce1ce-1111-4111-8111-000000000002', current_setting('t.coach')::uuid, 'safeguarding_children', current_date + 365, now());
select is(public.is_child_facing_compliant(current_setting('t.coach')::uuid, '7e7e7e7e-1111-4111-8111-000000000001'), true,
  'DBS + safeguarding qualification → compliant');
select is(public.is_child_facing_role('coach'), true, 'is_child_facing_role(coach)');

-- ---------------------------------------------------------------------------
-- C. SG-6 tier 1
-- ---------------------------------------------------------------------------
-- Staff side
-- assign_coach_without_dbs_to_youth_team_throws
select throws_ok(
  $$insert into public.team_memberships (person_id, team_id, season_id, role)
    values (current_setting('t.other')::uuid, '7e7e7e7e-1111-4111-8111-000000000001', '5e5e5e5e-1111-4111-8111-000000000001', 'coach')$$,
  'P0001', null, 'assign_coach_without_dbs_to_youth_team_throws');
-- assign_coach_without_dbs_to_adult_team_allowed (the boundary case)
select lives_ok(
  $$insert into public.team_memberships (id, person_id, team_id, season_id, role)
    values ('ad1ad1ad-1111-4111-8111-000000000001', current_setting('t.other')::uuid, '7e7e7e7e-1111-4111-8111-000000000002', '5e5e5e5e-1111-4111-8111-000000000001', 'coach')$$,
  'assign_coach_without_dbs_to_adult_team_allowed');
-- certified coach onto the youth team: allowed
select lives_ok(
  $$insert into public.team_memberships (id, person_id, team_id, season_id, role)
    values ('ad1ad1ad-1111-4111-8111-000000000002', current_setting('t.coach')::uuid, '7e7e7e7e-1111-4111-8111-000000000001', '5e5e5e5e-1111-4111-8111-000000000001', 'coach')$$,
  'certified coach may join the youth team');
-- assign_coach_with_expired_dbs_throws
update public.certifications set expires_on = current_date - 1 where id = 'ce1ce1ce-1111-4111-8111-000000000001';
select throws_ok(
  $$insert into public.team_memberships (person_id, team_id, season_id, role)
    values (current_setting('t.coach')::uuid, '7e7e7e7e-1111-4111-8111-000000000001', '5e5e5e5e-1111-4111-8111-000000000001', 'manager')$$,
  'P0001', null, 'assign_coach_with_expired_dbs_throws');
update public.certifications set expires_on = current_date + 365 where id = 'ce1ce1ce-1111-4111-8111-000000000001';
-- retargeting a live membership onto a youth team is guarded like an insert
select throws_ok(
  $$update public.team_memberships set team_id = '7e7e7e7e-1111-4111-8111-000000000001' where id = 'ad1ad1ad-1111-4111-8111-000000000001'$$,
  'P0001', null, 'moving an uncertified coach onto a youth team throws');
-- promoting a player to coach on a youth team is guarded
insert into public.team_memberships (id, person_id, team_id, season_id, role)
  values ('ad1ad1ad-1111-4111-8111-000000000003', current_setting('t.member')::uuid, '7e7e7e7e-1111-4111-8111-000000000001', '5e5e5e5e-1111-4111-8111-000000000001', 'player');
select throws_ok(
  $$update public.team_memberships set role = 'assistant_coach' where id = 'ad1ad1ad-1111-4111-8111-000000000003'$$,
  'P0001', null, 'promoting an uncertified adult player to a child-facing role on a youth team throws');
-- an ended membership holds nothing
select lives_ok(
  $$insert into public.team_memberships (person_id, team_id, season_id, role, left_at)
    values (current_setting('t.other')::uuid, '7e7e7e7e-1111-4111-8111-000000000001', '5e5e5e5e-1111-4111-8111-000000000001', 'coach', now())$$,
  'a membership inserted already ended is history, not an assignment');

-- Composition side
-- add_minor_to_team_with_uncertified_coach_throws (Adults team has Ollie, uncertified)
select throws_ok(
  $$insert into public.team_memberships (person_id, team_id, season_id, role)
    values ('c2c2c2c2-1111-4111-8111-000000000001', '7e7e7e7e-1111-4111-8111-000000000002', '5e5e5e5e-1111-4111-8111-000000000001', 'player')$$,
  'P0001', null, 'add_minor_to_team_with_uncertified_coach_throws');
select throws_like(
  $$insert into public.team_memberships (person_id, team_id, season_id, role)
    values ('c2c2c2c2-1111-4111-8111-000000000001', '7e7e7e7e-1111-4111-8111-000000000002', '5e5e5e5e-1111-4111-8111-000000000001', 'player')$$,
  '%Ollie Othercoach (coach)%', 'the error names the non-compliant person');
-- unknown dob is a minor (SG-0)
select throws_ok(
  $$insert into public.team_memberships (person_id, team_id, season_id, role)
    values ('c2c2c2c2-1111-4111-8111-000000000002', '7e7e7e7e-1111-4111-8111-000000000002', '5e5e5e5e-1111-4111-8111-000000000001', 'player')$$,
  'P0001', null, 'unknown-dob player counts as a minor for the composition check');
-- add_adult_to_team_with_uncertified_coach_allowed
select lives_ok(
  $$insert into public.team_memberships (person_id, team_id, season_id, role)
    values (current_setting('t.member')::uuid, '7e7e7e7e-1111-4111-8111-000000000002', '5e5e5e5e-1111-4111-8111-000000000001', 'player')$$,
  'add_adult_to_team_with_uncertified_coach_allowed');
-- add_minor_to_team_with_certified_coach_allowed
select lives_ok(
  $$insert into public.team_memberships (id, person_id, team_id, season_id, role)
    values ('ad1ad1ad-1111-4111-8111-000000000004', 'c2c2c2c2-1111-4111-8111-000000000002', '7e7e7e7e-1111-4111-8111-000000000001', '5e5e5e5e-1111-4111-8111-000000000001', 'player')$$,
  'add_minor_to_team_with_certified_coach_allowed');
-- move_minor_into_team_with_expired_dbs_coach_throws
update public.certifications set expires_on = current_date - 1 where id = 'ce1ce1ce-1111-4111-8111-000000000001';
-- move the known minor (on U11s) onto the Empty team, which has an expired-DBS coach
-- first put an expired coach on Empty
insert into public.team_memberships (id, person_id, team_id, season_id, role)
  values ('ad1ad1ad-1111-4111-8111-000000000005', current_setting('t.coach')::uuid, '7e7e7e7e-1111-4111-8111-000000000003', '5e5e5e5e-1111-4111-8111-000000000001', 'coach');
select throws_ok(
  $$update public.team_memberships set team_id = '7e7e7e7e-1111-4111-8111-000000000003' where id = 'ad1ad1ad-1111-4111-8111-000000000004'$$,
  'P0001', null, 'move_minor_into_team_with_expired_dbs_coach_throws');
update public.certifications set expires_on = current_date + 365 where id = 'ce1ce1ce-1111-4111-8111-000000000001';

-- DOB side
-- dob_correction_making_member_a_minor_throws_when_team_coach_uncertified
insert into public.team_memberships (person_id, team_id, season_id, role)
  values ('c2c2c2c2-1111-4111-8111-000000000004', '7e7e7e7e-1111-4111-8111-000000000002', '5e5e5e5e-1111-4111-8111-000000000001', 'player');
select throws_ok(
  $$update public.people set dob = current_date - interval '15 years' where id = 'c2c2c2c2-1111-4111-8111-000000000004'$$,
  'P0001', null, 'dob_correction_making_member_a_minor_throws_when_team_coach_uncertified');
select throws_like(
  $$update public.people set dob = current_date - interval '15 years' where id = 'c2c2c2c2-1111-4111-8111-000000000004'$$,
  '%Ollie Othercoach%', 'the dob-side error names the non-compliant coach');
-- the same correction on a team whose coaches are certified is fine
update public.team_memberships set left_at = now()
 where person_id = 'c2c2c2c2-1111-4111-8111-000000000004';
insert into public.team_memberships (person_id, team_id, season_id, role)
  values ('c2c2c2c2-1111-4111-8111-000000000004', '7e7e7e7e-1111-4111-8111-000000000001', '5e5e5e5e-1111-4111-8111-000000000001', 'player');
select lives_ok(
  $$update public.people set dob = current_date - interval '15 years' where id = 'c2c2c2c2-1111-4111-8111-000000000004'$$,
  'dob correction to minor allowed on a compliant team');

-- Exemptions
-- exemption_granted_by_club_admin_throws
select throws_ok(
  $$insert into public.certification_exemptions (person_id, team_id, reason, granted_by_person_id, expires_on)
    values (current_setting('t.other')::uuid, '7e7e7e7e-1111-4111-8111-000000000001', 'paperwork pending', current_setting('t.admin')::uuid, current_date + 7)$$,
  'P0001', null, 'exemption_granted_by_club_admin_throws');
-- exemption_longer_than_30_days_throws
select throws_ok(
  $$insert into public.certification_exemptions (person_id, team_id, reason, granted_by_person_id, expires_on)
    values (current_setting('t.other')::uuid, '7e7e7e7e-1111-4111-8111-000000000001', 'paperwork pending', current_setting('t.lead')::uuid, current_date + 31)$$,
  '23514', null, 'exemption_longer_than_30_days_throws');
select throws_ok(
  $$insert into public.certification_exemptions (person_id, team_id, reason, granted_by_person_id, expires_on)
    values (current_setting('t.other')::uuid, '7e7e7e7e-1111-4111-8111-000000000001', '   ', current_setting('t.lead')::uuid, current_date + 7)$$,
  '23514', null, 'exemption with a blank reason throws');
-- exemption_granted_by_safeguarding_lead_allows_membership (+ audit rows)
select set_config('t.audit0', (select count(*)::text from public.audit_log where action = 'safeguarding.certification.exemption'), true);
insert into public.certification_exemptions (id, person_id, team_id, reason, granted_by_person_id, expires_on)
  values ('ee1ee1ee-1111-4111-8111-000000000001', current_setting('t.other')::uuid, '7e7e7e7e-1111-4111-8111-000000000001',
          'DBS application submitted 2030-01-02, ref 12345', current_setting('t.lead')::uuid, current_date + 14);
select is((select detail->>'event' from public.audit_log where action = 'safeguarding.certification.exemption' order by id desc limit 1),
  'granted', 'exemption grant writes a granted audit row');
select lives_ok(
  $$insert into public.team_memberships (id, person_id, team_id, season_id, role)
    values ('ad1ad1ad-1111-4111-8111-000000000006', current_setting('t.other')::uuid, '7e7e7e7e-1111-4111-8111-000000000001', '5e5e5e5e-1111-4111-8111-000000000001', 'coach')$$,
  'exemption_granted_by_safeguarding_lead_allows_membership');
-- exemption_use_writes_audit_row
select is((select detail->>'event' from public.audit_log where action = 'safeguarding.certification.exemption' order by id desc limit 1),
  'used', 'exemption_use_writes_audit_row');
select is((select count(*) from public.audit_log where action = 'safeguarding.certification.exemption'),
  current_setting('t.audit0')::bigint + 2, 'exactly granted + used');
-- expired_exemption_does_not_allow_membership: revoke (can't edit expires_on) then re-try
update public.team_memberships set left_at = now() where id = 'ad1ad1ad-1111-4111-8111-000000000006';
update public.certification_exemptions set revoked_at = now() where id = 'ee1ee1ee-1111-4111-8111-000000000001';
select is((select detail->>'event' from public.audit_log where action = 'safeguarding.certification.exemption' order by id desc limit 1),
  'revoked', 'exemption revocation writes a revoked audit row');
select throws_ok(
  $$insert into public.team_memberships (person_id, team_id, season_id, role)
    values (current_setting('t.other')::uuid, '7e7e7e7e-1111-4111-8111-000000000001', '5e5e5e5e-1111-4111-8111-000000000001', 'coach')$$,
  'P0001', null, 'expired_exemption_does_not_allow_membership (revoked)');
select throws_ok(
  $$update public.certification_exemptions set expires_on = current_date + 20 where id = 'ee1ee1ee-1111-4111-8111-000000000001'$$,
  'P0001', null, 'an exemption cannot be edited (no renewal without a fresh row)');
select throws_ok(
  $$update public.certification_exemptions set revoked_at = null where id = 'ee1ee1ee-1111-4111-8111-000000000001'$$,
  'P0001', null, 'a revocation cannot be undone');
select throws_ok(
  $$delete from public.certification_exemptions where id = 'ee1ee1ee-1111-4111-8111-000000000001'$$,
  'P0001', null, 'exemptions cannot be hard-deleted (owner)');
select throws_ok(
  $$delete from public.certifications where id = 'ce1ce1ce-1111-4111-8111-000000000001'$$,
  'P0001', null, 'certifications cannot be hard-deleted (owner)');

-- as club_admin: the composition-side refusal binds through RLS too
set local request.jwt.claims to '{"sub":"a2a2a2a2-1111-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$insert into public.team_memberships (person_id, team_id, season_id, role)
    values ('c2c2c2c2-1111-4111-8111-000000000001', '7e7e7e7e-1111-4111-8111-000000000002', '5e5e5e5e-1111-4111-8111-000000000001', 'player')$$,
  'P0001', null, 'club_admin: add_minor_to_team_with_uncertified_coach_throws');
select throws_ok(
  $$insert into public.certification_exemptions (person_id, team_id, reason, granted_by_person_id, expires_on)
    values (current_setting('t.other')::uuid, '7e7e7e7e-1111-4111-8111-000000000001', 'x', current_setting('t.admin')::uuid, current_date + 7)$$,
  'P0001', null, 'club_admin: exemption_granted_by_club_admin_throws (the BEFORE trigger fires before the policy WITH CHECK)');
reset role;
-- as service_role
set local role service_role;
select throws_ok(
  $$insert into public.team_memberships (person_id, team_id, season_id, role)
    values ('c2c2c2c2-1111-4111-8111-000000000001', '7e7e7e7e-1111-4111-8111-000000000002', '5e5e5e5e-1111-4111-8111-000000000001', 'player')$$,
  'P0001', null, 'service_role: add_minor_to_team_with_uncertified_coach_throws');
reset role;
-- as the lead, granted_by must be self
set local request.jwt.claims to '{"sub":"a2a2a2a2-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$insert into public.certification_exemptions (person_id, team_id, reason, granted_by_person_id, expires_on)
    values (current_setting('t.other')::uuid, '7e7e7e7e-1111-4111-8111-000000000001', 'x', current_setting('t.admin')::uuid, current_date + 7)$$,
  'P0001', null, 'lead cannot attribute an exemption to someone else');
select lives_ok(
  $$insert into public.certification_exemptions (person_id, team_id, reason, granted_by_person_id, expires_on)
    values (current_setting('t.other')::uuid, '7e7e7e7e-1111-4111-8111-000000000003', 'paperwork', current_setting('t.lead')::uuid, current_date + 7)$$,
  'lead grants an exemption as themself');
reset role;

-- ---------------------------------------------------------------------------
-- D. SG-7 on certifications
-- ---------------------------------------------------------------------------
select set_config('t.caudit0', (select count(*)::text from public.audit_log where action = 'safeguarding.certification.change'), true);
update public.certifications set notes = 'cosmetic' where id = 'ce1ce1ce-1111-4111-8111-000000000001';
select is((select count(*) from public.audit_log where action = 'safeguarding.certification.change'),
  current_setting('t.caudit0')::bigint, 'a cosmetic certification edit writes no audit row');
update public.certifications set expires_on = current_date + 700 where id = 'ce1ce1ce-1111-4111-8111-000000000001';
select is((select (detail->>'type', detail->>'new_expiry') from public.audit_log where action = 'safeguarding.certification.change' order by id desc limit 1),
  ('fa_dbs'::text, (current_date + 700)::text), 'an expiry change writes safeguarding.certification.change');

-- ---------------------------------------------------------------------------
-- E. RLS
-- ---------------------------------------------------------------------------
select set_config('t.tm_all', (select count(*)::text from public.team_memberships), true);
select set_config('t.tm_u11', (select count(*)::text from public.team_memberships where team_id = '7e7e7e7e-1111-4111-8111-000000000001'), true);

-- coach (certified, live on U11s): sees U11s memberships only (+ own rows)
set local request.jwt.claims to '{"sub":"a2a2a2a2-1111-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.team_memberships where team_id = '7e7e7e7e-1111-4111-8111-000000000001'),
  current_setting('t.tm_u11')::bigint, 'coach sees every membership on their own team');
select is((select count(*) from public.team_memberships where team_id = '7e7e7e7e-1111-4111-8111-000000000002'),
  0::bigint, 'coach sees nothing on a team they are not staff of');
select throws_ok(
  $$insert into public.teams (name) values ('Coach Made')$$, '42501', null, 'coach cannot create a team');
select is((select count(*) from public.certifications), 2::bigint, 'coach sees their own certifications only');
reset role;

-- member (player on Adults + U11s): own rows only
set local request.jwt.claims to '{"sub":"a2a2a2a2-1111-4111-8111-000000000004","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.team_memberships where person_id <> current_setting('t.member')::uuid),
  0::bigint, 'member sees no one else''s memberships');
select ok((select count(*) from public.team_memberships where person_id = current_setting('t.member')::uuid) >= 1,
  'member sees their own memberships');
select is((select count(*) from public.teams) >= 3, true, 'member can read team names');
reset role;

-- parent: reads child's memberships
set local request.jwt.claims to '{"sub":"a2a2a2a2-1111-4111-8111-000000000005","role":"authenticated"}';
set local role authenticated;
select is((select array_agg(distinct person_id) from public.team_memberships),
  array['c2c2c2c2-1111-4111-8111-000000000001']::uuid[], 'guardian sees exactly their child''s memberships');
reset role;

-- club_admin: all
set local request.jwt.claims to '{"sub":"a2a2a2a2-1111-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.team_memberships), current_setting('t.tm_all')::bigint, 'club_admin sees every membership');
select lives_ok($$insert into public.teams (name) values ('Admin Made')$$, 'club_admin can create a team');
reset role;

-- ---------------------------------------------------------------------------
-- D. The production state: SG-6 enforcement OFF (FA Clubs Portal is the
--    record — SAFEGUARDING.md amendment 2026-08-23). The same insert that
--    threw above is permitted with the switch off.
-- ---------------------------------------------------------------------------
update public.site_settings set value = '0' where key = 'safeguarding.sg6_enforcement';
select lives_ok(
  $$insert into public.team_memberships (person_id, team_id, season_id, role)
    values (current_setting('t.other')::uuid, '7e7e7e7e-1111-4111-8111-000000000001', '5e5e5e5e-1111-4111-8111-000000000001', 'coach')$$,
  'with enforcement off, an uncertified coach may join a youth team');
select lives_ok(
  $$insert into public.team_memberships (person_id, team_id, season_id, role)
    values ('c2c2c2c2-1111-4111-8111-000000000001', '7e7e7e7e-1111-4111-8111-000000000002', '5e5e5e5e-1111-4111-8111-000000000001', 'player')$$,
  'with enforcement off, a minor may join a team with an uncertified coach');
update public.site_settings set value = '1' where key = 'safeguarding.sg6_enforcement';

-- anon: nothing
set local role anon;
select throws_ok($$select count(*) from public.teams$$, '42501', null, 'anon cannot read teams');
reset role;

select * from finish();

rollback;
