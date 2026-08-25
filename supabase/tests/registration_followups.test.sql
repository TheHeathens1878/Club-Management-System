-- =============================================================================
-- Registration follow-ups (20260825260000)
-- =============================================================================
-- Adam, 2026-08-25 evening:
--   "New Approvals should create an admin notification."
--   "The registration form should update read-only information in the contact
--    record (consents, health etc). This is overwritten on each registration."
--   "Parents can't withdraw registration after it's been granted, only admin."
--
--   A  shape: the snapshot table, its three READ policies and no write door;
--      the three new triggers are wired to the right tables
--   B  a new pending registration and a new account request reach every live
--      club_admin in-app, once per statement, never the person who asked
--   C  the snapshot: written from the form, overwritten by the next
--      registration, terms and GDPR stamps left behind, and readable by
--      exactly the people the registration itself is readable by — a coach and
--      a stranger get nothing
--   D  a guardian withdraws a PENDING registration; an approved one refuses
--      with a readable P0001 naming the administrator, who can do it
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(39);

-- Fixtures ---------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('a9a9a9a9-9999-4111-8111-000000000001', 'rf-admin@test.invalid',    '{"full_name": "Ada Admin"}'::jsonb),
  ('a9a9a9a9-9999-4111-8111-000000000002', 'rf-admin2@test.invalid',   '{"full_name": "Bea Admin"}'::jsonb),
  ('a9a9a9a9-9999-4111-8111-000000000003', 'rf-coach@test.invalid',    '{"full_name": "Cy Coach"}'::jsonb),
  ('a9a9a9a9-9999-4111-8111-000000000004', 'rf-parent@test.invalid',   '{"full_name": "Pat Parent"}'::jsonb),
  ('a9a9a9a9-9999-4111-8111-000000000005', 'rf-adult@test.invalid',    '{"full_name": "Al Adult"}'::jsonb),
  ('a9a9a9a9-9999-4111-8111-000000000006', 'rf-stranger@test.invalid', '{"full_name": "Sam Stranger"}'::jsonb);
update public.profiles set role = 'committee'
 where id in ('a9a9a9a9-9999-4111-8111-000000000001', 'a9a9a9a9-9999-4111-8111-000000000002');
select set_config('rf.admin',    (select person_id::text from public.profiles where id = 'a9a9a9a9-9999-4111-8111-000000000001'), true);
select set_config('rf.admin2',   (select person_id::text from public.profiles where id = 'a9a9a9a9-9999-4111-8111-000000000002'), true);
select set_config('rf.coach',    (select person_id::text from public.profiles where id = 'a9a9a9a9-9999-4111-8111-000000000003'), true);
select set_config('rf.parent',   (select person_id::text from public.profiles where id = 'a9a9a9a9-9999-4111-8111-000000000004'), true);
select set_config('rf.adult',    (select person_id::text from public.profiles where id = 'a9a9a9a9-9999-4111-8111-000000000005'), true);
select set_config('rf.stranger', (select person_id::text from public.profiles where id = 'a9a9a9a9-9999-4111-8111-000000000006'), true);
update public.people set dob = '1984-04-04'
 where id in (current_setting('rf.admin')::uuid, current_setting('rf.admin2')::uuid, current_setting('rf.coach')::uuid,
              current_setting('rf.parent')::uuid, current_setting('rf.adult')::uuid, current_setting('rf.stranger')::uuid);

insert into public.people (id, first_name, last_name, dob) values
  ('c9c9c9c9-9999-4111-8111-000000000001', 'Kid', 'Snapshot', current_date - interval '9 years');
insert into public.guardianships (guardian_person_id, child_person_id, relationship)
  values (current_setting('rf.parent')::uuid, 'c9c9c9c9-9999-4111-8111-000000000001', 'parent');

insert into public.seasons (id, name, starts_on, ends_on) values
  ('59595959-9999-4111-8111-000000000001', 'RF 2036/37', '2036-08-01', '2037-05-31');
insert into public.teams (id, name) values ('79797979-9999-4111-8111-000000000001', 'RF U10s');
-- A certified coach on the team the child will join, so the coach is genuinely
-- team staff (and SG-6 has nothing to say when the child is approved onto it).
insert into public.certifications (person_id, type, expires_on, verified_at) values
  (current_setting('rf.coach')::uuid, 'fa_dbs', current_date + 300, now()),
  (current_setting('rf.coach')::uuid, 'safeguarding_children', current_date + 300, now());
insert into public.team_memberships (person_id, team_id, season_id, role) values
  (current_setting('rf.coach')::uuid, '79797979-9999-4111-8111-000000000001',
   '59595959-9999-4111-8111-000000000001', 'coach');


-- ---------------------------------------------------------------------------
-- A. Shape
-- ---------------------------------------------------------------------------
select has_table('public', 'person_registration_details', 'person_registration_details');
select ok((select relrowsecurity from pg_class where oid = 'public.person_registration_details'::regclass),
  'RLS on person_registration_details');
select policies_are('public', 'person_registration_details',
  array['person_registration_details_admin_read',
        'person_registration_details_self_read',
        'person_registration_details_guardian_read'],
  'three READ policies and no write policy at all');
select ok(not has_table_privilege('authenticated', 'public.person_registration_details', 'INSERT'),
  'no client may insert a snapshot');
select ok(not has_table_privilege('authenticated', 'public.person_registration_details', 'UPDATE'),
  'no client may edit a snapshot — it is written by the registration');
select ok(not has_table_privilege('anon', 'public.person_registration_details', 'SELECT'),
  'anon cannot read a snapshot');
select trigger_is('public', 'registrations', 'trg_registration_pending_notify', 'public', 'registration_pending_notify',
  'a new registration runs the arrival notifier');
select trigger_is('public', 'registrations', 'trg_registration_details_snapshot', 'public', 'registration_details_snapshot',
  'a new registration writes the contact-record snapshot');
select trigger_is('public', 'account_requests', 'trg_account_request_arrival_notify', 'public', 'account_request_arrival_notify',
  'a new account request runs the arrival notifier');


-- ---------------------------------------------------------------------------
-- B. The desk is told
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"a9a9a9a9-9999-4111-8111-000000000004","role":"authenticated"}';
set local role authenticated;
insert into public.registrations (id, person_id, season_id, team_id, form)
values ('e9e9e9e9-9999-4111-8111-000000000001', 'c9c9c9c9-9999-4111-8111-000000000001',
        '59595959-9999-4111-8111-000000000001', '79797979-9999-4111-8111-000000000001',
        '{"medical": {"conditions": "Asthma", "medication": "Inhaler", "allergies": ""},
          "kit_size": "9-10 years",
          "previous_club": "Old Town",
          "preferred_position": "Winger",
          "photo_preferences": {"team_album": true, "club_website": false, "social_media": false, "press": false},
          "custom": {"shirt_wish": "7"},
          "emergency_contact": {"name": "Old Nan", "phone": "07000 000000"},
          "terms_accepted_at": "2036-08-01T10:00:00Z", "terms_version": "2026-1",
          "gdpr_accepted_at": "2036-08-01T10:00:00Z", "gdpr_notice_version": "gdpr-2026-1"}'::jsonb);
reset role;

select is((select (subject, link, channel::text, entity) from public.outbound_messages
            where entity = 'registrations' and entity_id = 'e9e9e9e9-9999-4111-8111-000000000001'
              and person_id = current_setting('rf.admin')::uuid),
  ('New registration: Kid Snapshot'::text, '/registrations'::text, 'in_app'::text, 'registrations'::text),
  'the registration reaches a club administrator in-app, pointing at the queue');
select is((select count(*) from public.outbound_messages
            where entity = 'registrations' and entity_id = 'e9e9e9e9-9999-4111-8111-000000000001'
              and person_id = current_setting('rf.admin2')::uuid), 1::bigint,
  'every live club_admin is told, once');
select is((select count(*) from public.outbound_messages
            where entity = 'registrations' and entity_id = 'e9e9e9e9-9999-4111-8111-000000000001'
              and person_id = current_setting('rf.parent')::uuid), 0::bigint,
  'the parent who registered is not told about their own registration');
select is((select count(*) from public.outbound_messages
            where entity = 'registrations' and channel <> 'in_app'), 0::bigint,
  'no email and no SMS — a registration notice is in-app only');
select ok((select body like '%RF U10s%' and body like '%Registrations%'
             from public.outbound_messages
            where entity = 'registrations' and entity_id = 'e9e9e9e9-9999-4111-8111-000000000001'
              and person_id = current_setting('rf.admin')::uuid),
  'and the message names the team and where to go');

-- an account request lands on the same desk
set local request.jwt.claims to '{"sub":"a9a9a9a9-9999-4111-8111-000000000006","role":"authenticated"}';
set local role authenticated;
insert into public.account_requests (id, person_id, requested_role, team_id)
values ('b9b9b9b9-9999-4111-8111-000000000001', current_setting('rf.stranger')::uuid, 'coach',
        '79797979-9999-4111-8111-000000000001');
reset role;

select is((select (subject, link, channel::text) from public.outbound_messages
            where entity = 'account_requests' and entity_id = 'b9b9b9b9-9999-4111-8111-000000000001'
              and person_id = current_setting('rf.admin')::uuid),
  ('New account request: Sam Stranger'::text, '/approvals'::text, 'in_app'::text),
  'a new account request reaches a club administrator in-app, pointing at Approvals');
select is((select count(*) from public.outbound_messages
            where entity = 'account_requests' and entity_id = 'b9b9b9b9-9999-4111-8111-000000000001'
              and person_id = current_setting('rf.stranger')::uuid), 0::bigint,
  'the requester is not told about their own request');


-- ---------------------------------------------------------------------------
-- C. The snapshot on the contact record
-- ---------------------------------------------------------------------------
select is((select count(*) from public.person_registration_details
            where person_id = 'c9c9c9c9-9999-4111-8111-000000000001'), 1::bigint,
  'the registration wrote one snapshot row for the child');
select is((select details -> 'medical' ->> 'conditions' from public.person_registration_details
            where person_id = 'c9c9c9c9-9999-4111-8111-000000000001'), 'Asthma',
  'the health answers are on the contact record');
select is((select (details ->> 'kit_size', details ->> 'previous_club', details -> 'custom' ->> 'shirt_wish')
             from public.person_registration_details
            where person_id = 'c9c9c9c9-9999-4111-8111-000000000001'),
  ('9-10 years'::text, 'Old Town'::text, '7'::text),
  'kit size, previous club and the club''s own questions come across');
select ok((select not (details ? 'terms_accepted_at') and not (details ? 'terms_version')
             and not (details ? 'gdpr_accepted_at') and not (details ? 'gdpr_notice_version')
             and not (details ? 'emergency_contact')
             from public.person_registration_details
            where person_id = 'c9c9c9c9-9999-4111-8111-000000000001'),
  'the terms and GDPR stamps stay on the registration, and the legacy emergency contact is dropped');
select is((select (registration_id, season_id) from public.person_registration_details
            where person_id = 'c9c9c9c9-9999-4111-8111-000000000001'),
  ('e9e9e9e9-9999-4111-8111-000000000001'::uuid, '59595959-9999-4111-8111-000000000001'::uuid),
  'the snapshot says which registration and season it came from');

-- an adult's own registration, for the self-read below
set local request.jwt.claims to '{"sub":"a9a9a9a9-9999-4111-8111-000000000005","role":"authenticated"}';
set local role authenticated;
insert into public.registrations (id, person_id, season_id, form)
values ('e9e9e9e9-9999-4111-8111-000000000002', current_setting('rf.adult')::uuid,
        '59595959-9999-4111-8111-000000000001',
        '{"medical": {"conditions": "None", "medication": "", "allergies": "Bees"}, "kit_size": "Adult L"}'::jsonb);
select is((select details ->> 'kit_size' from public.person_registration_details
            where person_id = current_setting('rf.adult')::uuid), 'Adult L',
  'an adult reads their own snapshot back');
reset role;

-- the second registration overwrites the first
set local request.jwt.claims to '{"sub":"a9a9a9a9-9999-4111-8111-000000000004","role":"authenticated"}';
set local role authenticated;
select lives_ok($$
  update public.registrations set status = 'withdrawn'
   where id = 'e9e9e9e9-9999-4111-8111-000000000001'
$$, 'a guardian withdraws a PENDING registration');
insert into public.registrations (id, person_id, season_id, team_id, form)
values ('e9e9e9e9-9999-4111-8111-000000000003', 'c9c9c9c9-9999-4111-8111-000000000001',
        '59595959-9999-4111-8111-000000000001', '79797979-9999-4111-8111-000000000001',
        '{"medical": {"conditions": "Nothing now", "medication": "", "allergies": ""},
          "kit_size": "11-12 years", "previous_club": "", "preferred_position": "Keeper"}'::jsonb);
reset role;

select is((select count(*) from public.person_registration_details
            where person_id = 'c9c9c9c9-9999-4111-8111-000000000001'), 1::bigint,
  'still one row per person — the snapshot is overwritten, not appended to');
select is((select (details -> 'medical' ->> 'conditions', details ->> 'kit_size', details ->> 'preferred_position')
             from public.person_registration_details
            where person_id = 'c9c9c9c9-9999-4111-8111-000000000001'),
  ('Nothing now'::text, '11-12 years'::text, 'Keeper'::text),
  'the second registration overwrote what the first one said');
select ok((select not (details ? 'custom') from public.person_registration_details
            where person_id = 'c9c9c9c9-9999-4111-8111-000000000001'),
  'an answer the second form did not carry is gone, not left behind');
select is((select registration_id from public.person_registration_details
            where person_id = 'c9c9c9c9-9999-4111-8111-000000000001'),
  'e9e9e9e9-9999-4111-8111-000000000003'::uuid, 'and it points at the newest registration');

-- who may read it
set local request.jwt.claims to '{"sub":"a9a9a9a9-9999-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.person_registration_details), 0::bigint,
  'the child''s own coach reads nothing — a medical note is not a coach''s to browse');
reset role;

set local request.jwt.claims to '{"sub":"a9a9a9a9-9999-4111-8111-000000000006","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.person_registration_details), 0::bigint,
  'a stranger reads nothing');
reset role;

set local request.jwt.claims to '{"sub":"a9a9a9a9-9999-4111-8111-000000000004","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.person_registration_details), 1::bigint,
  'an active guardian reads their child''s and nothing else');
reset role;

set local request.jwt.claims to '{"sub":"a9a9a9a9-9999-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.person_registration_details), 2::bigint,
  'a club administrator reads both');
reset role;

set local request.jwt.claims to '{"sub":"a9a9a9a9-9999-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_ok($$
  update public.person_registration_details set details = '{"medical": {"conditions": "edited"}}'::jsonb
   where person_id = 'c9c9c9c9-9999-4111-8111-000000000001'
$$, '42501', null, 'not even a club administrator may edit a snapshot by hand');
reset role;


-- ---------------------------------------------------------------------------
-- D. Withdrawal after approval is the club's to make
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"a9a9a9a9-9999-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok($$
  update public.registrations set status = 'approved'
   where id = 'e9e9e9e9-9999-4111-8111-000000000003'
$$, 'a club administrator approves the child''s registration');
reset role;

set local request.jwt.claims to '{"sub":"a9a9a9a9-9999-4111-8111-000000000004","role":"authenticated"}';
set local role authenticated;
select throws_ok($$
  update public.registrations set status = 'withdrawn'
   where id = 'e9e9e9e9-9999-4111-8111-000000000003'
$$, 'P0001', null, 'a guardian cannot withdraw an APPROVED registration');
select throws_like($$
  update public.registrations set status = 'withdrawn'
   where id = 'e9e9e9e9-9999-4111-8111-000000000003'
$$, '%ask a club administrator%', 'and the refusal names who to ask');
reset role;

select is((select status::text from public.registrations where id = 'e9e9e9e9-9999-4111-8111-000000000003'),
  'approved', 'the refused withdrawal left the registration approved');

-- the subject of their own approved registration is in the same position
set local request.jwt.claims to '{"sub":"a9a9a9a9-9999-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
update public.registrations set status = 'approved' where id = 'e9e9e9e9-9999-4111-8111-000000000002';
reset role;
set local request.jwt.claims to '{"sub":"a9a9a9a9-9999-4111-8111-000000000005","role":"authenticated"}';
set local role authenticated;
select throws_ok($$
  update public.registrations set status = 'withdrawn'
   where id = 'e9e9e9e9-9999-4111-8111-000000000002'
$$, 'P0001', null, 'an adult cannot withdraw their own approved registration either');
reset role;

set local request.jwt.claims to '{"sub":"a9a9a9a9-9999-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok($$
  update public.registrations set status = 'withdrawn'
   where id = 'e9e9e9e9-9999-4111-8111-000000000003'
$$, 'a club administrator withdraws the approved registration');
reset role;
select is((select (status::text, decided_by) from public.registrations where id = 'e9e9e9e9-9999-4111-8111-000000000003'),
  ('withdrawn'::text, 'a9a9a9a9-9999-4111-8111-000000000001'::uuid),
  'and the withdrawal is stamped with the administrator who made it');

select * from finish();
rollback;
