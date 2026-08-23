-- =============================================================================
-- P2.2 — registrations, SG-5 photo-consent types on guardian_consents
-- =============================================================================
-- What this suite covers:
--   A  shape: enum values, table, RLS, policies, privileges
--   B  who may submit: adult self, guardian for minor, admin for anyone;
--      stranger for a minor refused (SG-4), adult for another adult refused
--   C  status machine: decisions admin-only; withdraw by subject/guardian;
--      final states; decided_* stamped; approval creates the player
--      membership and SG-6 refuses a non-compliant team at approval time
--   D  SG-5 photo consents through guardian_consents: grant by active
--      guardian, non-guardian refused, withdrawn immediately inactive,
--      per-season expiry, audit rows
--   E  RLS reads: self, guardian, admin, coach sees nothing, member nothing
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(53);

insert into auth.users (id, email, raw_user_meta_data) values
  ('a3a3a3a3-1111-4111-8111-000000000001', 'r-admin@test.invalid',  '{"full_name": "Ada Admin"}'::jsonb),
  ('a3a3a3a3-1111-4111-8111-000000000002', 'r-lead@test.invalid',   '{"full_name": "Lee Lead"}'::jsonb),
  ('a3a3a3a3-1111-4111-8111-000000000003', 'r-coach@test.invalid',  '{"full_name": "Cy Coach"}'::jsonb),
  ('a3a3a3a3-1111-4111-8111-000000000004', 'r-adult@test.invalid',  '{"full_name": "Al Adult"}'::jsonb),
  ('a3a3a3a3-1111-4111-8111-000000000005', 'r-parent@test.invalid', '{"full_name": "Pat Parent"}'::jsonb),
  ('a3a3a3a3-1111-4111-8111-000000000006', 'r-stranger@test.invalid', '{"full_name": "Sam Stranger"}'::jsonb);
update public.profiles set role = 'committee' where id = 'a3a3a3a3-1111-4111-8111-000000000001';
select set_config('r.admin',    (select person_id::text from public.profiles where id = 'a3a3a3a3-1111-4111-8111-000000000001'), true);
select set_config('r.lead',     (select person_id::text from public.profiles where id = 'a3a3a3a3-1111-4111-8111-000000000002'), true);
select set_config('r.coach',    (select person_id::text from public.profiles where id = 'a3a3a3a3-1111-4111-8111-000000000003'), true);
select set_config('r.adult',    (select person_id::text from public.profiles where id = 'a3a3a3a3-1111-4111-8111-000000000004'), true);
select set_config('r.parent',   (select person_id::text from public.profiles where id = 'a3a3a3a3-1111-4111-8111-000000000005'), true);
select set_config('r.stranger', (select person_id::text from public.profiles where id = 'a3a3a3a3-1111-4111-8111-000000000006'), true);
update public.people set dob = '1985-03-03'
 where id in (current_setting('r.admin')::uuid, current_setting('r.lead')::uuid, current_setting('r.coach')::uuid,
              current_setting('r.adult')::uuid, current_setting('r.parent')::uuid, current_setting('r.stranger')::uuid);
insert into public.person_roles (person_id, role) values (current_setting('r.lead')::uuid, 'safeguarding_lead');

insert into public.people (id, first_name, last_name, dob) values
  ('c3c3c3c3-1111-4111-8111-000000000001', 'Kid', 'Registered', current_date - interval '9 years');
insert into public.guardianships (guardian_person_id, child_person_id, relationship)
  values (current_setting('r.parent')::uuid, 'c3c3c3c3-1111-4111-8111-000000000001', 'parent');

insert into public.seasons (id, name, starts_on, ends_on)
  values ('5f5f5f5f-1111-4111-8111-000000000001', 'Reg 2032/33', '2032-08-01', '2033-05-31');
insert into public.teams (id, name) values
  ('7f7f7f7f-1111-4111-8111-000000000001', 'Reg U10s'),
  ('7f7f7f7f-1111-4111-8111-000000000002', 'Reg Adults');
-- a certified coach on U10s, an uncertified coach on Adults
insert into public.certifications (person_id, type, expires_on, verified_at) values
  (current_setting('r.coach')::uuid, 'fa_dbs', current_date + 300, now()),
  (current_setting('r.coach')::uuid, 'safeguarding_children', current_date + 300, now());
insert into public.team_memberships (person_id, team_id, season_id, role) values
  (current_setting('r.coach')::uuid,    '7f7f7f7f-1111-4111-8111-000000000001', '5f5f5f5f-1111-4111-8111-000000000001', 'coach'),
  (current_setting('r.stranger')::uuid, '7f7f7f7f-1111-4111-8111-000000000002', '5f5f5f5f-1111-4111-8111-000000000001', 'coach');

-- ---------------------------------------------------------------------------
-- A. Shape
-- ---------------------------------------------------------------------------
select enum_has_labels('public', 'consent_type',
  array['app_account', 'unsupervised_messaging', 'photo_team_album', 'photo_club_website', 'photo_social_media', 'photo_press'],
  'consent_type carries the four SG-5 photo values');
select enum_has_labels('public', 'registration_status', array['pending', 'approved', 'rejected', 'withdrawn'], 'registration_status');
select has_table('public', 'registrations', 'registrations');
select ok((select relrowsecurity from pg_class where oid = 'public.registrations'::regclass), 'RLS on registrations');
select policies_are('public', 'registrations',
  array['registrations_admin_read', 'registrations_admin_insert', 'registrations_admin_update',
        'registrations_self_read', 'registrations_self_insert', 'registrations_self_withdraw',
        'registrations_guardian_read', 'registrations_guardian_insert', 'registrations_guardian_withdraw'],
  'registrations policy list');
select ok(not has_table_privilege('anon', 'public.registrations', 'SELECT'), 'anon cannot read registrations');
select ok(not has_table_privilege('authenticated', 'public.registrations', 'DELETE'), 'authenticated cannot delete registrations');

-- ---------------------------------------------------------------------------
-- B. Who may submit
-- ---------------------------------------------------------------------------
-- adult self
set local request.jwt.claims to '{"sub":"a3a3a3a3-1111-4111-8111-000000000004","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$insert into public.registrations (id, person_id, season_id, team_id, form)
    values ('e3e3e3e3-1111-4111-8111-000000000001', current_setting('r.adult')::uuid, '5f5f5f5f-1111-4111-8111-000000000001',
            '7f7f7f7f-1111-4111-8111-000000000002', '{"emergency_contact": "x"}')$$,
  'an adult registers themself');
select throws_ok(
  $$insert into public.registrations (person_id, season_id)
    values (current_setting('r.parent')::uuid, '5f5f5f5f-1111-4111-8111-000000000001')$$,
  'P0001', null, 'an adult cannot register another adult (guard fires before the policy)');
select throws_ok(
  $$insert into public.registrations (person_id, season_id)
    values (current_setting('r.adult')::uuid, '5f5f5f5f-1111-4111-8111-000000000001')$$,
  '23505', null, 'one live registration per person per season');
select throws_ok(
  $$insert into public.registrations (person_id, season_id, status)
    values (current_setting('r.adult')::uuid, '5f5f5f5f-1111-4111-8111-000000000001', 'approved')$$,
  'P0001', null, 'a self-submitted registration cannot start approved') ;
reset role;
select is((select submitted_by from public.registrations where id = 'e3e3e3e3-1111-4111-8111-000000000001'),
  'a3a3a3a3-1111-4111-8111-000000000004'::uuid, 'submitted_by stamped from auth.uid()');
select is((select action from public.audit_log where entity = 'registrations' and entity_id = 'e3e3e3e3-1111-4111-8111-000000000001' order by id limit 1),
  'registration.submitted', 'submission audited');
select is((select detail ? 'form' from public.audit_log where entity = 'registrations' order by id desc limit 1), false,
  'audit detail never carries the form');

-- stranger for a minor: refused by policy (no guardianship)
set local request.jwt.claims to '{"sub":"a3a3a3a3-1111-4111-8111-000000000006","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$insert into public.registrations (person_id, season_id)
    values ('c3c3c3c3-1111-4111-8111-000000000001', '5f5f5f5f-1111-4111-8111-000000000001')$$,
  'P0001', null, 'a non-guardian cannot register a minor (SG-4 guard)');
reset role;

-- guardian for the minor
set local request.jwt.claims to '{"sub":"a3a3a3a3-1111-4111-8111-000000000005","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$insert into public.registrations (id, person_id, season_id, team_id, form)
    values ('e3e3e3e3-1111-4111-8111-000000000002', 'c3c3c3c3-1111-4111-8111-000000000001', '5f5f5f5f-1111-4111-8111-000000000001',
            '7f7f7f7f-1111-4111-8111-000000000001', '{"medical": "asthma"}')$$,
  'an active guardian registers their child');
select throws_ok(
  $$update public.registrations set status = 'approved' where id = 'e3e3e3e3-1111-4111-8111-000000000002'$$,
  'P0001', null, 'a guardian cannot approve');
reset role;

-- ended guardianship: refused
update public.guardianships set ended_at = now() where child_person_id = 'c3c3c3c3-1111-4111-8111-000000000001';
set local request.jwt.claims to '{"sub":"a3a3a3a3-1111-4111-8111-000000000005","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.registrations), 0::bigint, 'an ended guardianship sees nothing');
reset role;
update public.guardianships set ended_at = null where child_person_id = 'c3c3c3c3-1111-4111-8111-000000000001';

-- admin for anyone (trigger path, no policy needed beyond admin insert)
set local request.jwt.claims to '{"sub":"a3a3a3a3-1111-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$insert into public.registrations (id, person_id, season_id)
    values ('e3e3e3e3-1111-4111-8111-000000000003', current_setting('r.stranger')::uuid, '5f5f5f5f-1111-4111-8111-000000000001')$$,
  'club_admin registers someone else');
reset role;

-- ---------------------------------------------------------------------------
-- C. Status machine
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"a3a3a3a3-1111-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
-- approving the minor onto U10s (certified coach): creates the player membership
select lives_ok(
  $$update public.registrations set status = 'approved' where id = 'e3e3e3e3-1111-4111-8111-000000000002'$$,
  'admin approves the child''s registration');
reset role;
select is(
  (select (status::text, decided_by, decided_at is not null) from public.registrations where id = 'e3e3e3e3-1111-4111-8111-000000000002'),
  ('approved'::text, 'a3a3a3a3-1111-4111-8111-000000000001'::uuid, true), 'decided_* stamped by the trigger');
select is(
  (select count(*) from public.team_memberships
    where person_id = 'c3c3c3c3-1111-4111-8111-000000000001' and team_id = '7f7f7f7f-1111-4111-8111-000000000001'
      and role = 'player' and left_at is null),
  1::bigint, 'approval created the live player membership');
select is((select action from public.audit_log where entity = 'registrations' and entity_id = 'e3e3e3e3-1111-4111-8111-000000000002' order by id desc limit 1),
  'registration.decided', 'decision audited');

-- approving a minor onto a team with an uncertified coach FAILS at approval (SG-6)
insert into public.people (id, first_name, last_name, dob) values
  ('c3c3c3c3-1111-4111-8111-000000000002', 'Kid', 'Two', current_date - interval '11 years');
insert into public.registrations (id, person_id, season_id, team_id)
  values ('e3e3e3e3-1111-4111-8111-000000000004', 'c3c3c3c3-1111-4111-8111-000000000002', '5f5f5f5f-1111-4111-8111-000000000001',
          '7f7f7f7f-1111-4111-8111-000000000002');
select throws_ok(
  $$update public.registrations set status = 'approved' where id = 'e3e3e3e3-1111-4111-8111-000000000004'$$,
  'P0001', null, 'approving a minor onto a team with an uncertified coach is refused (SG-6 at approval time)');
select is((select status::text from public.registrations where id = 'e3e3e3e3-1111-4111-8111-000000000004'), 'pending',
  'the refused approval left the registration pending');

-- transitions
select throws_ok(
  $$update public.registrations set status = 'pending' where id = 'e3e3e3e3-1111-4111-8111-000000000002'$$,
  'P0001', null, 'cannot return to pending');
update public.registrations set status = 'rejected' where id = 'e3e3e3e3-1111-4111-8111-000000000003';
select throws_ok(
  $$update public.registrations set status = 'approved' where id = 'e3e3e3e3-1111-4111-8111-000000000003'$$,
  'P0001', null, 'a rejected registration is final');
select throws_ok(
  $$update public.registrations set person_id = current_setting('r.adult')::uuid where id = 'e3e3e3e3-1111-4111-8111-000000000003'$$,
  'P0001', null, 'person_id is immutable');
select throws_ok(
  $$update public.registrations set decided_at = now() where id = 'e3e3e3e3-1111-4111-8111-000000000004'$$,
  'P0001', null, 'decided_at cannot be set by hand');

-- adult withdraws their own
set local request.jwt.claims to '{"sub":"a3a3a3a3-1111-4111-8111-000000000004","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$update public.registrations set status = 'approved' where id = 'e3e3e3e3-1111-4111-8111-000000000001'$$,
  'P0001', null, 'the subject cannot approve their own');
select lives_ok(
  $$update public.registrations set status = 'withdrawn' where id = 'e3e3e3e3-1111-4111-8111-000000000001'$$,
  'the subject withdraws their own registration');
reset role;
-- guardian withdraws the child's
set local request.jwt.claims to '{"sub":"a3a3a3a3-1111-4111-8111-000000000005","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$update public.registrations set status = 'withdrawn' where id = 'e3e3e3e3-1111-4111-8111-000000000002'$$,
  'a guardian withdraws their child''s registration');
reset role;
select is((select status::text from public.registrations where id = 'e3e3e3e3-1111-4111-8111-000000000002'), 'withdrawn',
  'the guardian withdrawal took effect (approved → withdrawn)');
-- after a withdrawal a new one may be submitted (as the adult themself)
set local request.jwt.claims to '{"sub":"a3a3a3a3-1111-4111-8111-000000000004","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$insert into public.registrations (person_id, season_id) values (current_setting('r.adult')::uuid, '5f5f5f5f-1111-4111-8111-000000000001')$$,
  'a new registration may follow a withdrawn one');
reset role;

-- ---------------------------------------------------------------------------
-- D. SG-5 photo consent through guardian_consents
-- ---------------------------------------------------------------------------
select is(public.has_active_consent('c3c3c3c3-1111-4111-8111-000000000001', 'photo_team_album'), false,
  'no row = no consent (fail closed)');
select set_config('r.caudit0', (select count(*)::text from public.audit_log where action = 'safeguarding.consent.granted'), true);
-- consent_granted_by_non_guardian_throws
select throws_ok(
  $$insert into public.guardian_consents (child_person_id, guardian_person_id, consent_type, notice_version)
    values ('c3c3c3c3-1111-4111-8111-000000000001', current_setting('r.stranger')::uuid, 'photo_team_album', 'v1')$$,
  'P0001', null, 'consent_granted_by_non_guardian_throws');
-- guardian grants, per season (expires with the season)
set local request.jwt.claims to '{"sub":"a3a3a3a3-1111-4111-8111-000000000005","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$insert into public.guardian_consents (id, child_person_id, guardian_person_id, consent_type, notice_version, expires_at)
    values ('ac1ac1ac-1111-4111-8111-000000000001', 'c3c3c3c3-1111-4111-8111-000000000001', current_setting('r.parent')::uuid,
            'photo_team_album', 'photo-v1', '2033-05-31 23:59:59+01')$$,
  'guardian grants team-album photo consent for the season');
select lives_ok(
  $$insert into public.guardian_consents (id, child_person_id, guardian_person_id, consent_type, notice_version, granted_at, expires_at)
    values ('ac1ac1ac-1111-4111-8111-000000000002', 'c3c3c3c3-1111-4111-8111-000000000001', current_setting('r.parent')::uuid,
            'photo_social_media', 'photo-v1', now() - interval '30 days', now() - interval '1 day')$$,
  'an already-expired consent row can be recorded (history)');
reset role;
select is(public.has_active_consent('c3c3c3c3-1111-4111-8111-000000000001', 'photo_team_album'), true, 'team album consent active');
select is(public.has_active_consent('c3c3c3c3-1111-4111-8111-000000000001', 'photo_social_media'), false, 'expired consent inactive');
select is(public.has_active_consent('c3c3c3c3-1111-4111-8111-000000000001', 'photo_press'), false, 'separate decision: press not consented');
select is((select count(*) from public.audit_log where action = 'safeguarding.consent.granted'),
  current_setting('r.caudit0')::bigint + 2, 'both grants audited (SG-7)');
-- withdrawing_consent_removes_immediately
set local request.jwt.claims to '{"sub":"a3a3a3a3-1111-4111-8111-000000000005","role":"authenticated"}';
set local role authenticated;
update public.guardian_consents set revoked_at = now() where id = 'ac1ac1ac-1111-4111-8111-000000000001';
reset role;
select is(public.has_active_consent('c3c3c3c3-1111-4111-8111-000000000001', 'photo_team_album'), false,
  'withdrawing consent takes effect immediately');
select is((select action from public.audit_log where entity = 'guardian_consents' order by id desc limit 1),
  'safeguarding.consent.revoked', 'withdrawal audited');
select lives_ok(
  $$insert into public.guardian_consents (child_person_id, guardian_person_id, consent_type, notice_version)
    values ('c3c3c3c3-1111-4111-8111-000000000001', current_setting('r.parent')::uuid, 'photo_team_album', 'photo-v2')$$,
  'consent can be granted again as a new row (versioned)');

-- ---------------------------------------------------------------------------
-- E. RLS reads
-- ---------------------------------------------------------------------------
select set_config('r.all', (select count(*)::text from public.registrations), true);
set local request.jwt.claims to '{"sub":"a3a3a3a3-1111-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.registrations), 0::bigint, 'a coach sees no registrations (form is sensitive)');
reset role;
set local request.jwt.claims to '{"sub":"a3a3a3a3-1111-4111-8111-000000000005","role":"authenticated"}';
set local role authenticated;
select is((select array_agg(distinct person_id) from public.registrations),
  array['c3c3c3c3-1111-4111-8111-000000000001']::uuid[], 'guardian sees only their child''s registrations');
select is((select form->>'medical' from public.registrations where id = 'e3e3e3e3-1111-4111-8111-000000000002'), 'asthma',
  'guardian can read the form');
reset role;
set local request.jwt.claims to '{"sub":"a3a3a3a3-1111-4111-8111-000000000004","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.registrations where person_id <> current_setting('r.adult')::uuid), 0::bigint,
  'an adult sees only their own');
reset role;
set local request.jwt.claims to '{"sub":"a3a3a3a3-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.registrations), current_setting('r.all')::bigint, 'safeguarding_lead reads all');
update public.registrations set status = 'approved' where id = 'e3e3e3e3-1111-4111-8111-000000000004';
reset role;
select is((select status::text from public.registrations where id = 'e3e3e3e3-1111-4111-8111-000000000004'), 'pending',
  'safeguarding_lead cannot decide (no update policy: 0 rows affected)');
set local request.jwt.claims to '{"sub":"a3a3a3a3-1111-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.registrations), current_setting('r.all')::bigint, 'club_admin reads all');
reset role;
set local role anon;
select throws_ok($$select count(*) from public.registrations$$, '42501', null, 'anon cannot read registrations');
reset role;

select * from finish();

rollback;
