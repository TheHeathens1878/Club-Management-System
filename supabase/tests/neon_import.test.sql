-- =============================================================================
-- P3.3 — Neon pitch-booking import
-- =============================================================================
--   A  schema: stubs, legacy keys, waiting list tables, RLS, privileges, cron
--   B  migrate_neon(): people (3a email match, placeholder child), roles,
--      teams, pitches, bookings (match/training/closure), waiting list, season;
--      idempotent re-run
--   C  deferred activation: SG-0 holds (unknown-DOB rows wait), the DOB gate
--      (complete_own_dob) applies a person's rows, exemptions need a lead
--   D  handle_new_user(): adult adoption only with person_id AND email match
--   E  waiting-list RLS and the public submission function
--   F  reconcile_neon() all ok
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(113);

-- ---------------------------------------------------------------------------
-- Fixtures: an admin, a lead-to-be, and Eve — an existing account whose email
-- the Neon export also carries (D-P3-5 / 3a)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('a3a3a3a3-1111-4111-8111-000000000001', 'n-admin@test.invalid', '{"full_name": "Ada Admin"}'::jsonb),
  ('a3a3a3a3-1111-4111-8111-000000000002', 'n-lead@test.invalid',  '{"full_name": "Lee Lead"}'::jsonb),
  ('a3a3a3a3-1111-4111-8111-000000000003', 'eve@neon.test',        '{"full_name": "Eve Existing"}'::jsonb);
update public.profiles set role = 'committee' where id = 'a3a3a3a3-1111-4111-8111-000000000001';
select set_config('t.admin', (select person_id::text from public.profiles where id = 'a3a3a3a3-1111-4111-8111-000000000001'), true);
select set_config('t.lead',  (select person_id::text from public.profiles where id = 'a3a3a3a3-1111-4111-8111-000000000002'), true);
select set_config('t.eve',   (select person_id::text from public.profiles where id = 'a3a3a3a3-1111-4111-8111-000000000003'), true);
update public.people set dob = '1985-02-02' where id = current_setting('t.eve')::uuid;
update public.people set dob = '1980-01-01' where id in (current_setting('t.admin')::uuid, current_setting('t.lead')::uuid);

-- a people row WITHOUT an account that shares a Neon email: must NOT be linked (P1.2)
insert into public.people (first_name, last_name, email) values ('Harry', 'Hirer', 'coach1@neon.test');

-- Neon export (stub tables)
insert into neon_legacy."User" (id, name, email, "passwordHash", role, "clubRole", "contactPhone", "dateOfBirth", "isActive", "createdAt") values
  ('u-owner',  'Olive Owner',     'owner@neon.test',  '$2a$12$x', 'OWNER',  'Chairman', '0161 1', null, true,  '2026-05-18 09:00'),
  ('u-coach1', 'Carl Coach',      'coach1@neon.test', '$2a$12$x', 'COACH',  null, '07700 1', null, true,  '2026-05-19 09:00'),
  ('u-coach2', 'Ina Inactive',    'coach2@neon.test', '$2a$12$x', 'COACH',  null, null, null, false, '2026-05-19 09:00'),
  ('u-parent', 'Pat Parent',      'parent@neon.test', '$2a$12$x', 'PARENT', null, null, null, true,  '2026-05-20 09:00'),
  ('u-child',  'Kit Child',       'nologin-abc@placeholder.invalid', '$2a$10$x', 'PLAYER', null, null, (current_date - interval '10 years')::timestamp, true, '2026-05-20 09:00'),
  ('u-player', 'Al Adultplayer',  'player@neon.test', '$2a$12$x', 'PLAYER', null, null, '1995-06-06', true, '2026-05-21 09:00'),
  ('u-eve',    'Eve Existing',    'EVE@neon.test',    '$2a$12$x', 'COACH',  null, null, null, true,  '2026-05-21 09:00');
insert into neon_legacy."Team" (id, name, "ageGroup", "ageGroupTo", "teamGender", "isRecruiting", "isActive", "contactName", "contactEmail") values
  ('t1', 'Lions', 'U05', null,  'MIXED',  true,  true,  'Carl', 'coach1@neon.test'),
  ('t2', 'Lions', 'U18', 'U19', 'MIXED',  false, true,  null, null),
  ('t3', 'Ghosts', 'U09', null, 'FEMALE', false, false, null, null);
insert into neon_legacy."UserTeam" (id, "userId", "teamId", "displayName") values
  ('ut1', 'u-coach1', 't1', 'Head coach'),
  ('ut2', 'u-child',  't1', null),
  ('ut3', 'u-player', 't2', null),
  ('ut4', 'u-parent', 't1', 'Kit''s dad'),
  ('ut5', 'u-eve',    't2', null),
  ('ut6', 'u-coach2', 't1', null);
insert into neon_legacy."UserContact" (id, "parentUserId", "childUserId", relationship) values ('uc1', 'u-parent', 'u-child', 'Son');
insert into neon_legacy."Venue" (id, name, description, info) values ('v1', 'Wellfield', 'School field', 'Park on the road');
insert into neon_legacy."Pitch" (id, "venueId", name, type, "isActive") values
  ('p1', 'v1', 'Pitch 1 (7v7)', 'SEVEN_A_SIDE', true),
  ('p2', 'v1', 'Pitch 2 (7v7)', 'SEVEN_A_SIDE', false);
insert into neon_legacy."Booking" (id, "pitchId", "createdByUserId", "teamId", "opponentTeamId", "opponentName", "bookingType", title, "bookedBy", "startTime", "endTime", status, "blockId", notes) values
  ('b1', 'p1', 'u-coach1', 't1', 't2', null,       'MATCH',    'League match', 'Carl Coach', '2026-06-06 09:00', '2026-06-06 10:30', 'CONFIRMED', null, 'Bring nets'),
  ('b2', 'p1', 'u-coach1', 't1', null, null,       'TRAINING', 'Training',     'Carl Coach', '2026-06-08 17:00', '2026-06-08 18:00', 'CONFIRMED', 'blk1', null),
  ('b3', 'p1', 'u-coach1', 't1', null, 'Sale FC',  'MATCH',    'Friendly',     'Carl Coach', '2026-06-06 09:30', '2026-06-06 11:00', 'CANCELLED', null, null),
  ('b4', 'p1', 'u-parent', 't1', null, null,       'MATCH',    'Wanted slot',  'Pat Parent', '2026-07-11 09:00', '2026-07-11 10:00', 'REJECTED', null, null);
insert into neon_legacy."TrainingSession" (id, "pitchId", "startTime", "endTime", title, "recurringGroupId", "createdByUserId") values
  ('ts1', 'p1', '2026-06-01 18:00', '2026-06-01 19:00', 'Monday training', 'grp1', 'u-owner');
insert into neon_legacy."TrainingSessionTeam" (id, "trainingSessionId", "teamId") values ('tst1', 'ts1', 't1'), ('tst2', 'ts1', 't2');
insert into neon_legacy."Closure" (id, scope, "venueId", "pitchId", reason, "startTime", "endTime") values
  ('c1', 'VENUE', 'v1', null, 'Waterlogged', '2026-06-20 00:00', '2026-06-21 00:00'),
  ('c2', 'PITCH', null, 'p1', 'Reseeding',   '2026-07-01 00:00', '2026-07-03 00:00');
insert into neon_legacy."ClubSettings" (id, "clubName", "adminEmail") values ('cs', 'AoM', 'club@neon.test');
insert into neon_legacy."WaitingListAgeGroupConfig" ("ageGroup", "isOpen", "isPubliclyAdvertised") values ('U07', true, true), ('U09', false, false);
insert into neon_legacy."WaitingListEntry" (id, "playerName", dob, "ageGroup", "schoolYear", "biologicalSex", "parentName", "parentEmail", "parentPhone", "dataConsent", status, priority, "healthConditions") values
  ('w1', 'Wendy Waiter', '2019-09-09', 'U07', 'Year 2', 'FEMALE', 'Wes Waiter', 'WES@neon.test', '07700 2', true, 'PENDING', 1, 'Asthma'),
  ('w2', 'Rob Rejected', '2017-01-01', 'U09', 'Year 4', 'MALE',   'Ray Rejected', 'ray@neon.test', '07700 3', false, 'REJECTED', null, null);
insert into neon_legacy."WaitingListNote" (id, "entryId", "authorId", body) values ('n1', 'w1', 'u-coach1', 'Called mum');
insert into neon_legacy."WaitingListAccess" (id, "userId", "ageGroup", "grantedBy") values ('wa1', 'u-coach1', 'U07', 'u-owner');
insert into neon_legacy."TeamApplication" (id, "teamId", "playerName", dob, "parentName", "parentEmail", "parentPhone", message) values
  ('ap1', 't1', 'Andy Applicant', '05/03/2021', 'Ann Applicant', 'ann@neon.test', '07700 4', 'Keen');

-- ---------------------------------------------------------------------------
-- A. Schema
-- ---------------------------------------------------------------------------
select has_schema('neon_legacy', 'neon_legacy stub schema exists');
select has_column('public', 'people',    'legacy_neon_user_id', 'people.legacy_neon_user_id');
select has_column('public', 'teams',     'legacy_neon_team_id', 'teams.legacy_neon_team_id');
select has_column('public', 'resources', 'legacy_neon_pitch_id', 'resources.legacy_neon_pitch_id');
select has_column('public', 'bookings',  'legacy_neon_ref', 'bookings.legacy_neon_ref');
select has_table('public', 'waiting_list_entries', 'waiting_list_entries');
select has_table('public', 'waiting_list_notes', 'waiting_list_notes');
select has_table('public', 'waiting_list_access', 'waiting_list_access');
select has_table('public', 'waiting_list_age_groups', 'waiting_list_age_groups');
select has_table('public', 'neon_import_pending', 'neon_import_pending');
select ok((select bool_and(relrowsecurity) from pg_class where oid in
  ('public.waiting_list_entries'::regclass, 'public.waiting_list_notes'::regclass, 'public.waiting_list_access'::regclass,
   'public.waiting_list_age_groups'::regclass, 'public.neon_import_pending'::regclass)), 'RLS enabled on the five new tables');
select ok(not has_table_privilege('service_role', 'public.waiting_list_entries', 'SELECT'), 'service_role has no direct read of waiting_list_entries');
select ok(not has_table_privilege('anon', 'public.waiting_list_entries', 'SELECT'), 'anon cannot read waiting_list_entries');
select ok(not has_table_privilege('authenticated', 'public.waiting_list_entries', 'DELETE'), 'authenticated cannot DELETE waiting_list_entries');
select ok(not has_schema_privilege('anon', 'neon_legacy', 'USAGE'), 'anon has no USAGE on neon_legacy');
select ok(not has_schema_privilege('authenticated', 'neon_legacy', 'USAGE'), 'authenticated has no USAGE on neon_legacy');
select ok(has_function_privilege('anon', 'public.submit_waiting_list_entry(text, date, text, text, text, text, text, text, text, text, text, boolean, text, boolean)', 'EXECUTE'), 'anon may submit to the waiting list');
select ok(not has_function_privilege('authenticated', 'public.migrate_neon()', 'EXECUTE'), 'authenticated cannot run migrate_neon');
select ok(not has_function_privilege('authenticated', 'public.apply_neon_pending(uuid)', 'EXECUTE'), 'authenticated cannot run apply_neon_pending');
select ok(not has_function_privilege('anon', 'public.complete_own_dob(date)', 'EXECUTE'), 'anon cannot call complete_own_dob');
select is((select count(*) from cron.job where jobname = 'neon-pending-nightly'), 1::bigint, 'nightly apply_neon_pending job scheduled');
select is((select count(*) from pg_trigger where tgrelid = 'public.people'::regclass and tgname like '%dob%'), 1::bigint, 'still exactly ONE dob trigger on people');

-- ---------------------------------------------------------------------------
-- B. migrate_neon()
-- ---------------------------------------------------------------------------
select lives_ok($$select * from public.migrate_neon()$$, 'migrate_neon runs');

select is((select count(*) from public.people where legacy_neon_user_id is not null), 7::bigint, 'all 7 Neon users have a people row');
select is((select legacy_neon_user_id from public.people where id = current_setting('t.eve')::uuid), 'u-eve', '3a: Eve''s existing person adopted the Neon id (case-insensitive email match)');
select is((select count(*) from public.people where lower(email) = 'eve@neon.test'), 1::bigint, 'no duplicate person for Eve');
select is((select count(*) from public.people where email = 'coach1@neon.test'), 1::bigint, 'Harry Hirer (no account) keeps the email; the Neon coach is NOT linked to him');
select is((select email from public.people where legacy_neon_user_id = 'u-coach1'), null, 'Neon coach whose email belongs to a non-account person is imported without email');
select ok((select notes like '%merge by hand%' from public.people where legacy_neon_user_id = 'u-coach1'), '… and flagged for a manual merge');
select is((select email from public.people where legacy_neon_user_id = 'u-child'), null, 'placeholder child email dropped');
select is((select dob from public.people where legacy_neon_user_id = 'u-child'), (current_date - interval '10 years')::date, 'child DOB carried over');
select is((select dob from public.people where legacy_neon_user_id = 'u-owner'), null, 'adult DOB stays unknown (no invention)');
select is((select first_name || '|' || last_name from public.people where legacy_neon_user_id = 'u-owner'), 'Olive|Owner', 'name split');
select ok((select notes like '%Club role: Chairman%' from public.people where legacy_neon_user_id = 'u-owner'), 'clubRole kept in notes');
select ok((select notes like '%awaiting approval%' from public.people where legacy_neon_user_id = 'u-coach2'), 'inactive user noted');

select ok(public.person_has_role((select id from public.people where legacy_neon_user_id = 'u-owner'), 'club_admin'), 'OWNER → club_admin');
select ok(public.person_has_role((select id from public.people where legacy_neon_user_id = 'u-coach1'), 'coach'), 'COACH → coach');
select ok(not public.person_has_role((select id from public.people where legacy_neon_user_id = 'u-coach2'), 'coach'), 'inactive COACH gets no role');
select ok(public.person_has_role((select id from public.people where legacy_neon_user_id = 'u-player'), 'member'), 'PLAYER → member');
select ok(not public.person_has_role((select id from public.people where legacy_neon_user_id = 'u-parent'), 'parent'), 'PARENT gets no role (guardianship instead)');

select is((select count(*) from public.seasons where is_current), 1::bigint, 'a current season was created');
select is((select name from public.teams where legacy_neon_team_id = 't1'), 'U05 Lions', 'team name carries the age group');
select is((select age_group from public.teams where legacy_neon_team_id = 't2'), 'U18–U19', 'age group range');
select is((select active from public.teams where legacy_neon_team_id = 't3'), false, 'inactive team stays inactive');
select ok((select notes like '%Recruiting%Contact: Carl coach1@neon.test%' from public.teams where legacy_neon_team_id = 't1'), 'recruiting/contact kept in notes');

select is((select count(*) from public.resources where type = 'pitch' and legacy_neon_pitch_id is not null), 2::bigint, '2 pitches');
select is((select name from public.resources where legacy_neon_pitch_id = 'p1'), 'Wellfield – Pitch 1 (7v7)', 'pitch name = venue – pitch');
select is((select active from public.resources where legacy_neon_pitch_id = 'p2'), false, 'inactive pitch');
select is((select information from public.resources where legacy_neon_pitch_id = 'p1'), E'School field\nPark on the road', 'venue description/info → information');

select is((select kind::text || '/' || status::text from public.bookings where legacy_neon_ref = 'booking:b1'), 'fixture/confirmed', 'MATCH CONFIRMED → fixture/confirmed');
select is((select starts_at from public.bookings where legacy_neon_ref = 'booking:b1'), timestamptz '2026-06-06 09:00+00', 'Neon timestamps are UTC');
select is((select occasion from public.bookings where legacy_neon_ref = 'booking:b1'), 'League match v U18 Lions', 'occasion = title v opponent team');
select is((select occasion from public.bookings where legacy_neon_ref = 'booking:b3'), 'Friendly v Sale FC', 'external opponent name');
select is((select team_name from public.bookings where legacy_neon_ref = 'booking:b1'), 'U05 Lions', 'team_name');
select is((select booker_email from public.bookings where legacy_neon_ref = 'booking:b1'), 'coach1@neon.test', 'booker email from the creating user');
select is((select booker_person_id from public.bookings where legacy_neon_ref = 'booking:b1'), (select id from public.people where legacy_neon_user_id = 'u-coach1'), 'booker person linked');
select is((select kind::text || '/' || status::text from public.bookings where legacy_neon_ref = 'booking:b2'), 'block/confirmed', 'TRAINING → block');
select is((select status::text from public.bookings where legacy_neon_ref = 'booking:b3'), 'cancelled', 'CANCELLED → cancelled (overlap tolerated)');
select ok((select status = 'cancelled' and internal_notes like '%rejected in Neon%' from public.bookings where legacy_neon_ref = 'booking:b4'), 'REJECTED → cancelled, noted');
select is((select team_name from public.bookings where legacy_neon_ref = 'training:ts1'), 'U05 Lions, U18 Lions', 'training session teams');
select ok((select recurrence_group_id is not null from public.bookings where legacy_neon_ref = 'training:ts1'), 'recurring group id derived');
select is((select booker_email from public.bookings where legacy_neon_ref = 'training:ts1'), 'owner@neon.test', 'training booker = creator');
select is((select count(*) from public.bookings where legacy_neon_ref like 'closure:%' and kind = 'maintenance'), 3::bigint, 'venue closure × 2 pitches + pitch closure = 3 maintenance bookings');
select is((select booker_email from public.bookings where legacy_neon_ref = 'closure:c2:p1'), 'club@neon.test', 'closures booked by the club admin email');

select is((select count(*) from public.waiting_list_entries where source = 'import'), 2::bigint, '2 waiting-list entries');
select is((select status::text || '/' || parent_email from public.waiting_list_entries where legacy_neon_entry_id = 'w1'), 'pending/wes@neon.test', 'status lower-cased, email lower-cased');
select is((select dob || '|' || team_preference from public.waiting_list_entries where source = 'team_application'), '2021-03-05|U05 Lions', 'team application: UK date parsed, team preference set');
select is((select is_open from public.waiting_list_age_groups where age_group = 'U09'), false, 'age group config');
select is((select author_person_id from public.waiting_list_notes where legacy_neon_note_id = 'n1'), (select id from public.people where legacy_neon_user_id = 'u-coach1'), 'note author linked');
select is((select count(*) from public.waiting_list_access), 1::bigint, 'access row');

-- idempotent
select lives_ok($$select * from public.migrate_neon()$$, 'migrate_neon re-runs');
select is((select count(*) from public.people where legacy_neon_user_id is not null), 7::bigint, 're-run creates no people');
select is((select count(*) from public.bookings where legacy_neon_ref is not null), 8::bigint, 're-run creates no bookings (4 + 1 + 3)');
select is((select count(*) from public.audit_log where action = 'import.neon'), 2::bigint, 'each run audited');

-- ---------------------------------------------------------------------------
-- C. Deferred activation
-- ---------------------------------------------------------------------------
select is((select count(*) from public.neon_import_pending where kind = 'membership'), 4::bigint, 'coach1, child, player, eve queued (parent follows, coach2 inactive)');
select is((select count(*) from public.neon_import_pending where kind = 'guardianship'), 1::bigint, 'guardianship queued');
select is((select count(*) from public.team_memberships m join public.people p on p.id = m.person_id
            where p.legacy_neon_user_id in ('u-child', 'u-player', 'u-eve') and m.left_at is null), 3::bigint,
  'known-DOB people are on their teams straight away');
select ok((select last_error like '%date of birth unknown%' from public.neon_import_pending q join public.people p on p.id = q.person_id
            where p.legacy_neon_user_id = 'u-coach1' and q.kind = 'membership'), 'unknown-DOB coach waits for the DOB gate (SG-0)');
select ok((select last_error like '%date of birth must be known%' from public.neon_import_pending where kind = 'guardianship'), 'unknown-DOB guardian waits (SG-4)');

-- the parent signs in (auth import) and hits the gate
insert into auth.users (id, email, raw_user_meta_data)
values ('a3a3a3a3-1111-4111-8111-000000000004', 'parent@neon.test',
        jsonb_build_object('full_name', 'Pat Parent', 'person_id', (select id from public.people where legacy_neon_user_id = 'u-parent')));
select is((select person_id from public.profiles where id = 'a3a3a3a3-1111-4111-8111-000000000004'),
          (select id from public.people where legacy_neon_user_id = 'u-parent'), 'D: adult adopted on matching person_id + email');

set local request.jwt.claims to '{"sub":"a3a3a3a3-1111-4111-8111-000000000004","role":"authenticated"}';
set local role authenticated;
select is(public.needs_dob_completion(), true, 'gate: parent needs a DOB');
select throws_ok($$select public.complete_own_dob(current_date + 1)$$, 'P0001', null, 'gate rejects a future DOB');
select lives_ok($$select public.complete_own_dob('1979-03-03')$$, 'gate accepts the DOB');
select is(public.needs_dob_completion(), false, 'gate satisfied');
select throws_ok($$select public.complete_own_dob('1979-03-04')$$, 'P0001', null, 'DOB can be supplied once only');
reset role;
set local request.jwt.claims to '{}';
select is((select dob from public.people where legacy_neon_user_id = 'u-parent'), date '1979-03-03', 'DOB stored');
select is((select count(*) from public.guardianships g join public.people p on p.id = g.guardian_person_id
            where p.legacy_neon_user_id = 'u-parent' and g.relationship = 'parent' and g.ended_at is null), 1::bigint,
  'guardianship applied on the gate (Son → parent)');
select is((select count(*) from public.audit_log where action = 'people.dob.self_completed'), 1::bigint, 'gate audited');

-- the coach: DOB known but no lead yet → exemption impossible → still pending
update public.people set dob = '1975-05-05' where legacy_neon_user_id = 'u-coach1';
select lives_ok($$select * from public.apply_neon_pending(null)$$, 'apply_neon_pending runs');
select ok((select last_error like '%no safeguarding_lead%' from public.neon_import_pending q join public.people p on p.id = q.person_id
            where p.legacy_neon_user_id = 'u-coach1'), 'coach on a team with a minor waits for a safeguarding_lead (D-P3-2)');
insert into public.person_roles (person_id, role) values (current_setting('t.lead')::uuid, 'safeguarding_lead');
select is((select applied from public.apply_neon_pending(null)), 1, 'with a lead, the coach is applied');
select is((select count(*) from public.neon_import_pending where applied_at is null), 0::bigint, 'queue drained');
select is((select count(*) from public.certification_exemptions e join public.people p on p.id = e.person_id
            where p.legacy_neon_user_id = 'u-coach1' and e.expires_on = (now() at time zone 'Europe/London')::date + 30
              and e.granted_by_person_id = current_setting('t.lead')::uuid), 1::bigint, '30-day exemption granted by the lead');
select ok((select m.notes like '%Head coach%' from public.team_memberships m join public.people p on p.id = m.person_id
            where p.legacy_neon_user_id = 'u-coach1'), 'displayName kept on the membership');

-- ---------------------------------------------------------------------------
-- F. reconcile_neon()
-- ---------------------------------------------------------------------------
select diag(coalesce((select string_agg("check" || ': ' || legacy || '/' || unified, '; ') from public.reconcile_neon() where not ok), 'all ok'));
select is((select count(*) from public.reconcile_neon() where not ok), 0::bigint, 'every reconcile check passes');
select ok((select count(*) > 20 from public.reconcile_neon()), 'reconcile covers every mapped table');

-- ---------------------------------------------------------------------------
-- D. handle_new_user(): adoption needs BOTH person_id and the email
-- ---------------------------------------------------------------------------
select set_config('t.people_before', (select count(*)::text from public.people), true);
insert into auth.users (id, email, raw_user_meta_data)
values ('a3a3a3a3-1111-4111-8111-000000000005', 'impostor@test.invalid',
        jsonb_build_object('full_name', 'Imp Ostor', 'person_id', (select id from public.people where legacy_neon_user_id = 'u-owner')));
select isnt((select person_id from public.profiles where id = 'a3a3a3a3-1111-4111-8111-000000000005'),
            (select id from public.people where legacy_neon_user_id = 'u-owner'), 'metadata person_id alone does not adopt a person');
select is((select count(*) from public.people), current_setting('t.people_before')::bigint + 1, '… a fresh person was created instead');
insert into auth.users (id, email, raw_user_meta_data)
values ('a3a3a3a3-1111-4111-8111-000000000006', 'whoever@test.invalid',
        jsonb_build_object('full_name', 'Kit Child', 'person_id', (select id from public.people where legacy_neon_user_id = 'u-child')));
select isnt((select person_id from public.profiles where id = 'a3a3a3a3-1111-4111-8111-000000000006'),
            (select id from public.people where legacy_neon_user_id = 'u-child'), 'a known minor without app_account consent is never adopted');

-- ---------------------------------------------------------------------------
-- E. Waiting-list RLS and public submission
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data)
values ('a3a3a3a3-1111-4111-8111-000000000007', 'coach1@neon.test',
        jsonb_build_object('full_name', 'Carl Coach', 'person_id', (select id from public.people where legacy_neon_user_id = 'u-coach1')));
select isnt((select person_id from public.profiles where id = 'a3a3a3a3-1111-4111-8111-000000000007'),
            (select id from public.people where legacy_neon_user_id = 'u-coach1'),
            'coach1 (email dropped at import) is NOT adopted by email — merge is manual');
-- link him by hand, as the admin merge would
update public.profiles set person_id = (select id from public.people where legacy_neon_user_id = 'u-coach1')
 where id = 'a3a3a3a3-1111-4111-8111-000000000007';

set local request.jwt.claims to '{"sub":"a3a3a3a3-1111-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.waiting_list_entries), 3::bigint, 'club_admin reads every entry');
select lives_ok($$update public.waiting_list_entries set status = 'contacted' where legacy_neon_entry_id = 'w1'$$, 'club_admin updates an entry');
reset role;
set local request.jwt.claims to '{"sub":"a3a3a3a3-1111-4111-8111-000000000007","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.waiting_list_entries), 1::bigint, 'coach with U07 access sees the U07 entry only');
select is((select count(*) from public.waiting_list_entries where age_group = 'U09'), 0::bigint, '… not U09');
select lives_ok($$insert into public.waiting_list_notes (entry_id, author_person_id, body)
  values ((select id from public.waiting_list_entries where legacy_neon_entry_id = 'w1'), public.current_person_id(), 'Trial Tuesday')$$,
  'coach adds a note on an entry he can see');
select throws_ok($$insert into public.waiting_list_notes (entry_id, author_person_id, body)
  values ((select id from public.waiting_list_entries where legacy_neon_entry_id = 'w2'), public.current_person_id(), 'x')$$,
  '42501', null, 'coach cannot note an entry he cannot see');
update public.waiting_list_entries set priority = 9 where legacy_neon_entry_id = 'w1';
reset role;
set local request.jwt.claims to '{}';
select is((select priority from public.waiting_list_entries where legacy_neon_entry_id = 'w1'), 1, 'coach update affected nothing (no policy)');
set local request.jwt.claims to '{"sub":"a3a3a3a3-1111-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.waiting_list_entries), 0::bigint, 'plain member sees nothing');
reset role;
set local request.jwt.claims to '{}';

set local role anon;
select lives_ok($$select public.submit_waiting_list_entry('New Kid', '2020-02-02', 'U07', 'Year 1', 'MALE', null, null, null, 'New Parent', 'New@Parent.test', '07700 5', false, null, true)$$,
  'anon submits to an open age group');
select throws_ok($$select public.submit_waiting_list_entry('New Kid', '2020-02-02', 'U09', 'Year 1', 'MALE', null, null, null, 'New Parent', 'new@parent.test', '07700 5', false, null, true)$$,
  'P0001', null, 'closed age group refused');
select throws_ok($$select public.submit_waiting_list_entry('New Kid', '2020-02-02', 'U07', 'Year 1', 'MALE', null, null, null, 'New Parent', 'new@parent.test', '07700 5', false, null, false)$$,
  'P0001', null, 'no consent, no entry');
select is((select count(*) from public.waiting_list_open_age_groups()), 1::bigint, 'anon sees the open age groups');
reset role;
select is((select parent_email || '/' || source from public.waiting_list_entries where player_name = 'New Kid'), 'new@parent.test/form', 'submitted entry stored, email normalised');

select * from finish();
rollback;
