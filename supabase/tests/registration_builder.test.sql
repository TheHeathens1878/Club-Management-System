-- =============================================================================
-- registration_builder (20260825140000)
-- =============================================================================
--   A  the builder's guards — system rows are structural, locked rows (photo
--      permissions, GDPR, terms) can be neither archived nor made optional,
--      and reordering is a club_admin act
--   B  the player photo — a path must live under that person's own folder
--   C  the "we have seen their ID" tick — club_admin only, and it is what
--      turns needs_id_document() off
--   D  identity_documents — a guardian may file one for their own child, a
--      stranger may neither file nor read one, and the purge is the job's
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(33);

insert into auth.users (id, email, raw_user_meta_data) values
  ('ab000000-1111-4111-8111-000000000001', 'rb-admin@test.invalid',    '{"full_name": "Ada Admin", "dob": "1975-03-03"}'::jsonb),
  ('ab000000-1111-4111-8111-000000000002', 'rb-parent@test.invalid',   '{"full_name": "Pat Parent", "dob": "1982-04-04"}'::jsonb),
  ('ab000000-1111-4111-8111-000000000003', 'rb-stranger@test.invalid', '{"full_name": "Sam Stranger", "dob": "1985-05-05"}'::jsonb);

select set_config('rb.admin',    (select person_id::text from public.profiles where id = 'ab000000-1111-4111-8111-000000000001'), true);
select set_config('rb.parent',   (select person_id::text from public.profiles where id = 'ab000000-1111-4111-8111-000000000002'), true);
select set_config('rb.stranger', (select person_id::text from public.profiles where id = 'ab000000-1111-4111-8111-000000000003'), true);

insert into public.person_roles (person_id, role, granted_by)
  values (current_setting('rb.admin')::uuid, 'club_admin', 'ab000000-1111-4111-8111-000000000001');

-- Two children, so the "document filed" route and the "admin ticked the box"
-- route can be told apart.
set local request.jwt.claims to '{"sub":"ab000000-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select set_config('rb.childa', public.add_child('Alfie', 'Parent', (current_date - interval '9 years')::date)::text, true);
select set_config('rb.childb', public.add_child('Bella', 'Parent', (current_date - interval '11 years')::date)::text, true);
reset role;


-- --- A: the builder's guards -------------------------------------------------
set local request.jwt.claims to '{"sub":"ab000000-1111-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;

select throws_like(
  $ update public.registration_questions set qtype = 'short_text' where qkey = 'kit_size' $,
  '%its type cannot change%',
  'a built-in question keeps its type — the screen renders it by name');

select lives_ok(
  $ update public.registration_questions set archived_at = now() where qkey = 'kit_size' $,
  'but the club may retire it: what is built in is how it is asked, not whether');

select lives_ok(
  $ update public.registration_questions set required = false where qkey = 'gdpr_consent' $,
  'and the club may make its own GDPR statement optional — its paperwork, its call');

select throws_like(
  $ update public.registration_questions set required = false where qkey = 'photo_consents' $,
  '%SG-5%',
  'photo permissions may not be made optional — SG-5 is the one the database keeps');

select throws_like(
  $ update public.registration_questions set archived_at = now() where qkey = 'photo_consents' $,
  '%SG-5%',
  'nor archived');

select throws_like(
  $ update public.registration_questions set locked = false where qkey = 'photo_consents' $,
  '%SG-5%',
  'nor unlocked, which is what a weakening would have to do first');

select throws_ok(
  $$ update public.registration_questions set qkey = 'photo_perms' where qkey = 'photo_consents' $$,
  'P0001', null,
  'a built-in question keeps its key');

select lives_ok(
  $$ insert into public.registration_questions (qkey, label, qtype, required, position)
     values ('school_year', 'School year', 'short_text', false, 11) $$,
  'a club administrator adds a question of their own');

select lives_ok(
  $$ update public.registration_questions set archived_at = now() where qkey = 'school_year' $$,
  'and can archive it again');

-- Nine live questions, not ten: 20260825150000 took the emergency contact off
-- the form and moved it onto the person.
select is(
  (select public.set_registration_question_order(
     array(select id from public.registration_questions
            where archived_at is null
            order by (qkey = 'terms') desc, "position"))),
  8,
  'reordering renumbers every live question — kit_size having just been retired');

reset role;

select is(
  (select "position" from public.registration_questions where qkey = 'terms'),
  1,
  'the question dragged to the top is now first');

set local request.jwt.claims to '{"sub":"ab000000-1111-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$ insert into public.registration_questions (qkey, label, qtype, position)
     values ('sneaky', 'Sneaky', 'short_text', 99) $$,
  '42501', null,
  'a member cannot add a question to the form');
select throws_ok(
  $$ select public.set_registration_question_order(
       array(select id from public.registration_questions order by "position")) $$,
  '42501', null,
  'a member cannot reorder the form');
reset role;


-- --- B: the player photo -----------------------------------------------------
set local request.jwt.claims to '{"sub":"ab000000-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  format($$ select public.set_person_photo(%L::uuid, %L) $$,
         current_setting('rb.childa'), current_setting('rb.childb') || '/other.jpg'),
  '22023', null,
  'a photo path outside the person''s own folder is refused');

select lives_ok(
  format($$ select public.set_person_photo(%L::uuid, %L) $$,
         current_setting('rb.childa'), current_setting('rb.childa') || '/1-alfie.jpg'),
  'a guardian sets their own child''s photo');

select is(
  (select photo_path from public.people where id = current_setting('rb.childa')::uuid),
  current_setting('rb.childa') || '/1-alfie.jpg',
  'the photo becomes the person''s picture');

reset role;
set local request.jwt.claims to '{"sub":"ab000000-1111-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  format($$ select public.set_person_photo(%L::uuid, %L) $$,
         current_setting('rb.childa'), current_setting('rb.childa') || '/2-nope.jpg'),
  '42501', null,
  'someone else''s child is not theirs to photograph');
reset role;


-- --- C: the "we have seen their ID" tick -------------------------------------
set local request.jwt.claims to '{"sub":"ab000000-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  format($$ select public.set_id_verified(%L::uuid, true) $$, current_setting('rb.childb')),
  '42501', null,
  'a guardian cannot certify that the club has seen the ID');
select ok(
  public.needs_id_document(current_setting('rb.childb')::uuid),
  'ID is needed before anybody has certified it');
reset role;

set local request.jwt.claims to '{"sub":"ab000000-1111-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  format($$ select public.set_id_verified(%L::uuid, true) $$, current_setting('rb.childb')),
  'a club administrator ticks the box');
select ok(
  not public.needs_id_document(current_setting('rb.childb')::uuid),
  'and the upload stops being required');
reset role;

select is(
  (select count(*)::integer from public.audit_log
    where action = 'people.id_verified' and entity_id = current_setting('rb.childb')),
  1,
  'the tick is audited');


-- --- D: identity documents ---------------------------------------------------
set local request.jwt.claims to '{"sub":"ab000000-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;

select ok(
  public.needs_id_document(current_setting('rb.childa')::uuid),
  'the other child still needs a document');

select lives_ok(
  format($$ insert into public.identity_documents (person_id, kind, storage_path, uploaded_by)
            values (%L::uuid, 'birth_certificate', %L, 'ab000000-1111-4111-8111-000000000002') $$,
         current_setting('rb.childa'), current_setting('rb.childa') || '/1-birth.pdf'),
  'a guardian files an identity document for their own child');

select ok(
  not public.needs_id_document(current_setting('rb.childa')::uuid),
  'a live document is enough — the club need not have ticked the box');

reset role;
set local request.jwt.claims to '{"sub":"ab000000-1111-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;

select throws_ok(
  format($$ insert into public.identity_documents (person_id, kind, storage_path, uploaded_by)
            values (%L::uuid, 'passport', 'x/y.pdf', 'ab000000-1111-4111-8111-000000000003') $$,
         current_setting('rb.childa')),
  '42501', null,
  'a stranger cannot file a document against somebody else''s child');

select is(
  (select count(*)::integer from public.identity_documents),
  0,
  'a stranger reads no identity documents at all');

reset role;
set local request.jwt.claims to '{"sub":"ab000000-1111-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is(
  (select count(*)::integer from public.identity_documents),
  1,
  'a club administrator reads the document row');
select throws_ok(
  $$ select public.identity_document_purged(
       (select id from public.identity_documents limit 1)) $$,
  '42501', null,
  'the purge is the scheduled job''s, not a user''s');
reset role;

-- As the table OWNER, where the grant is no defence and only the trigger is.
select throws_ok(
  $$ delete from public.identity_documents $$,
  'P0001', null,
  'identity documents are never hard-deleted');

select ok(
  not has_function_privilege('authenticated', 'public.identity_documents_due_purge()', 'execute'),
  'the due-purge listing is service_role only');

-- The job's own path: no auth.uid(), so the purge is admitted and the row
-- survives with its file gone.
set local request.jwt.claims to '{"role":"service_role"}';
set local role service_role;
select lives_ok(
  $$ select public.identity_document_purged((select id from public.identity_documents limit 1)) $$,
  'the job purges a due document');
reset role;
select is(
  (select (storage_path is null and purged_at is not null)
     from public.identity_documents limit 1),
  true,
  'the file is gone and the record of holding it remains');

select * from finish();
rollback;
