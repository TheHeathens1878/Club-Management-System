-- =============================================================================
-- P4.5 — media albums/items/subjects, SG-5 consent-filtered reads, SG-7 export audit
-- =============================================================================
-- SG-5's named tests: bulk_export_excludes_unconsented_child,
-- public_gallery_excludes_unconsented_child,
-- withdrawing_consent_removes_from_gallery_immediately,
-- untagged_media_excluded_from_public_paths, consent_granted_by_non_guardian_throws
-- (P2.2). signed_url_expires is the app-level integration test.
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(34);

insert into auth.users (id, email, raw_user_meta_data) values
  ('b2b2b2b2-2222-4111-8111-000000000001', 'm-admin@test.invalid',  '{"full_name": "Ada Admin"}'::jsonb),
  ('b2b2b2b2-2222-4111-8111-000000000002', 'm-coach@test.invalid',  '{"full_name": "Cy Coach"}'::jsonb),
  ('b2b2b2b2-2222-4111-8111-000000000003', 'm-parent@test.invalid', '{"full_name": "Pat Parent"}'::jsonb),
  ('b2b2b2b2-2222-4111-8111-000000000004', 'm-other@test.invalid',  '{"full_name": "Ollie Other"}'::jsonb);
update public.profiles set role = 'committee' where id = 'b2b2b2b2-2222-4111-8111-000000000001';
select set_config('m.admin',  (select person_id::text from public.profiles where id = 'b2b2b2b2-2222-4111-8111-000000000001'), true);
select set_config('m.coach',  (select person_id::text from public.profiles where id = 'b2b2b2b2-2222-4111-8111-000000000002'), true);
select set_config('m.parent', (select person_id::text from public.profiles where id = 'b2b2b2b2-2222-4111-8111-000000000003'), true);
select set_config('m.other',  (select person_id::text from public.profiles where id = 'b2b2b2b2-2222-4111-8111-000000000004'), true);
update public.people set dob = '1985-05-05' where id in (current_setting('m.admin')::uuid, current_setting('m.coach')::uuid, current_setting('m.parent')::uuid, current_setting('m.other')::uuid);
insert into public.people (id, first_name, last_name, dob) values
  ('c2c2c2c2-2222-4111-8111-000000000001', 'Kid', 'Consented',   current_date - interval '10 years'),
  ('c2c2c2c2-2222-4111-8111-000000000002', 'Kid', 'Unconsented', current_date - interval '11 years');
insert into public.guardianships (guardian_person_id, child_person_id, relationship) values
  (current_setting('m.parent')::uuid, 'c2c2c2c2-2222-4111-8111-000000000001', 'parent'),
  (current_setting('m.parent')::uuid, 'c2c2c2c2-2222-4111-8111-000000000002', 'parent');
insert into public.certifications (person_id, type, expires_on, verified_at) values
  (current_setting('m.coach')::uuid, 'fa_dbs', current_date + 300, now()),
  (current_setting('m.coach')::uuid, 'safeguarding_children', current_date + 300, now());
insert into public.seasons (id, name, starts_on, ends_on) values ('5f5f5f5f-2222-4111-8111-000000000001', 'Med 2038/39', '2038-08-01', '2039-05-31');
insert into public.teams (id, name) values ('7f7f7f7f-2222-4111-8111-000000000001', 'Med U12s');
insert into public.team_memberships (person_id, team_id, season_id, role) values
  (current_setting('m.coach')::uuid, '7f7f7f7f-2222-4111-8111-000000000001', '5f5f5f5f-2222-4111-8111-000000000001', 'coach'),
  ('c2c2c2c2-2222-4111-8111-000000000001', '7f7f7f7f-2222-4111-8111-000000000001', '5f5f5f5f-2222-4111-8111-000000000001', 'player'),
  ('c2c2c2c2-2222-4111-8111-000000000002', '7f7f7f7f-2222-4111-8111-000000000001', '5f5f5f5f-2222-4111-8111-000000000001', 'player');
-- consent: child 1 has team album + club website; child 2 has nothing
insert into public.guardian_consents (child_person_id, guardian_person_id, consent_type, notice_version) values
  ('c2c2c2c2-2222-4111-8111-000000000001', current_setting('m.parent')::uuid, 'photo_team_album', 'photo-v1'),
  ('c2c2c2c2-2222-4111-8111-000000000001', current_setting('m.parent')::uuid, 'photo_club_website', 'photo-v1');

insert into public.media_albums (id, title, visibility, team_id) values
  ('a1b1c1d1-2222-4111-8111-000000000001', 'U12s training', 'team', '7f7f7f7f-2222-4111-8111-000000000001'),
  ('a1b1c1d1-2222-4111-8111-000000000002', 'Club website gallery', 'public', null);
insert into public.media_items (id, album_id, storage_path, subjects_confirmed) values
  ('d1d1d1d1-2222-4111-8111-000000000001', 'a1b1c1d1-2222-4111-8111-000000000001', 'u12s/consented.jpg', false),
  ('d1d1d1d1-2222-4111-8111-000000000002', 'a1b1c1d1-2222-4111-8111-000000000001', 'u12s/unconsented.jpg', false),
  ('d1d1d1d1-2222-4111-8111-000000000003', 'a1b1c1d1-2222-4111-8111-000000000001', 'u12s/group.jpg', false),
  ('d1d1d1d1-2222-4111-8111-000000000004', 'a1b1c1d1-2222-4111-8111-000000000001', 'u12s/pitch.jpg', false),
  ('d1d1d1d1-2222-4111-8111-000000000005', 'a1b1c1d1-2222-4111-8111-000000000001', 'u12s/untagged.jpg', false),
  ('d1d1d1d1-2222-4111-8111-000000000006', 'a1b1c1d1-2222-4111-8111-000000000002', 'web/consented.jpg', false);

-- A. privileges: authenticated cannot SELECT the raw tables
select ok(not has_table_privilege('authenticated', 'public.media_items', 'SELECT'), 'authenticated has no SELECT on media_items (SG-5)');
select ok(not has_table_privilege('authenticated', 'public.media_subjects', 'SELECT'), 'authenticated has no SELECT on media_subjects');
select ok(not has_table_privilege('authenticated', 'public.media_items', 'DELETE'), 'no deletes on media_items');
select ok((select not public from storage.buckets where id = 'media'), 'media bucket is private');
select is((select value from public.site_settings where key = 'media.signed_url_ttl_seconds'), '900', 'signed URL TTL ≤ 15 minutes');

-- B. confirm subjects (as the coach)
set local request.jwt.claims to '{"sub":"b2b2b2b2-2222-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_ok($$select count(*) from public.media_items$$, '42501', null, 'coach cannot read media_items directly');
select lives_ok($$select public.confirm_media_subjects('d1d1d1d1-2222-4111-8111-000000000001', array['c2c2c2c2-2222-4111-8111-000000000001']::uuid[])$$, 'coach confirms consented child');
select lives_ok($$select public.confirm_media_subjects('d1d1d1d1-2222-4111-8111-000000000002', array['c2c2c2c2-2222-4111-8111-000000000002']::uuid[])$$, 'coach confirms unconsented child');
select lives_ok($$select public.confirm_media_subjects('d1d1d1d1-2222-4111-8111-000000000003', array['c2c2c2c2-2222-4111-8111-000000000001', 'c2c2c2c2-2222-4111-8111-000000000002']::uuid[])$$, 'coach confirms group (both)');
select lives_ok($$select public.confirm_media_subjects('d1d1d1d1-2222-4111-8111-000000000004', array[]::uuid[])$$, 'coach confirms a photo of nobody (the pitch)');
-- item 5 stays untagged/unconfirmed
reset role;
set local request.jwt.claims to '{"sub":"b2b2b2b2-2222-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok($$select public.confirm_media_subjects('d1d1d1d1-2222-4111-8111-000000000006', array['c2c2c2c2-2222-4111-8111-000000000001']::uuid[])$$, 'admin confirms the website photo');
reset role;

-- C. gallery (team album): consented + pitch only
set local request.jwt.claims to '{"sub":"b2b2b2b2-2222-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select is((select array_agg(storage_path order by storage_path) from public.media_gallery('a1b1c1d1-2222-4111-8111-000000000001')),
  array['u12s/consented.jpg', 'u12s/pitch.jpg']::text[],
  'public_gallery_excludes_unconsented_child (and the group photo, and the untagged one)');
reset role;
-- untagged_media_excluded_from_public_paths
select is(public.media_item_showable('d1d1d1d1-2222-4111-8111-000000000005', 'photo_team_album'), false, 'untagged_media_excluded_from_public_paths');
select is(public.media_item_showable('d1d1d1d1-2222-4111-8111-000000000004', 'photo_team_album'), true, 'a confirmed photo of nobody shows');
select is(public.media_item_showable('d1d1d1d1-2222-4111-8111-000000000003', 'photo_team_album'), false, 'a group photo needs every child consented');
-- purpose matters: website gallery requires photo_club_website
select is(public.media_item_showable('d1d1d1d1-2222-4111-8111-000000000006', 'photo_club_website'), true, 'website photo of a child with website consent shows');
select is(public.media_item_showable('d1d1d1d1-2222-4111-8111-000000000006', 'photo_press'), false, 'the same photo is not showable for press (separate consent)');

-- D. who can open which album
set local request.jwt.claims to '{"sub":"b2b2b2b2-2222-4111-8111-000000000004","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.media_gallery('a1b1c1d1-2222-4111-8111-000000000001')), 0::bigint, 'an outsider cannot open a team album');
select is((select count(*) from public.media_gallery('a1b1c1d1-2222-4111-8111-000000000002')), 1::bigint, 'an outsider can open the club gallery (filtered)');
select is((select count(*) from public.media_albums), 1::bigint, 'outsider sees only the public album''s metadata');
reset role;

-- E. bulk export: excludes unconsented, audited with counts
set local request.jwt.claims to '{"sub":"b2b2b2b2-2222-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select set_config('m.audit0', (select count(*)::text from public.audit_log where action = 'media.bulk_export'), true);
select is((select array_agg(storage_path order by storage_path) from public.media_export('a1b1c1d1-2222-4111-8111-000000000001')),
  array['u12s/consented.jpg', 'u12s/pitch.jpg']::text[], 'bulk_export_excludes_unconsented_child');
reset role;
select is((select (detail->>'item_count', detail->>'excluded_unconsented') from public.audit_log where action = 'media.bulk_export' order by id desc limit 1),
  ('2'::text, '3'::text), 'export audited with item_count and excluded_unconsented (SG-7)');
set local request.jwt.claims to '{"sub":"b2b2b2b2-2222-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select throws_ok($$select * from public.media_export('a1b1c1d1-2222-4111-8111-000000000001')$$, '42501', null, 'a parent cannot bulk export');
reset role;

-- F. withdrawing_consent_removes_from_gallery_immediately (+ quarantine flag)
set local request.jwt.claims to '{"sub":"b2b2b2b2-2222-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
update public.guardian_consents set revoked_at = now()
 where child_person_id = 'c2c2c2c2-2222-4111-8111-000000000001' and consent_type = 'photo_team_album';
select is((select array_agg(storage_path order by storage_path) from public.media_gallery('a1b1c1d1-2222-4111-8111-000000000001')),
  array['u12s/pitch.jpg']::text[], 'withdrawing_consent_removes_from_gallery_immediately');
reset role;
select is((select count(*) from public.media_items where needs_quarantine), 3::bigint, 'withdrawal flags every item the child appears in for quarantine (team x2 + website)');
set local request.jwt.claims to '{"role":"service_role"}';
set local role service_role;
select lives_ok($$select public.media_quarantined('d1d1d1d1-2222-4111-8111-000000000001', 'quarantine/u12s/consented.jpg')$$, 'quarantine recorded');
reset role;
select is((select (storage_path, needs_quarantine) from public.media_items where id = 'd1d1d1d1-2222-4111-8111-000000000001'),
  ('quarantine/u12s/consented.jpg'::text, false), 'path moved, flag cleared');
-- re-consent shows it again (new row)
insert into public.guardian_consents (child_person_id, guardian_person_id, consent_type, notice_version)
  values ('c2c2c2c2-2222-4111-8111-000000000001', current_setting('m.parent')::uuid, 'photo_team_album', 'photo-v2');
select is(public.media_item_showable('d1d1d1d1-2222-4111-8111-000000000001', 'photo_team_album'), true, 're-consent makes it showable again');

-- G. SG-8 / SG-2 on media
select throws_ok($$delete from public.media_items where id = 'd1d1d1d1-2222-4111-8111-000000000004'$$, 'P0001', null, 'media rows are never hard-deleted');
set local request.jwt.claims to '{"sub":"b2b2b2b2-2222-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select throws_ok($$update public.media_items set legal_hold = true where id = 'd1d1d1d1-2222-4111-8111-000000000004'$$, '42501', null, 'club_admin cannot set media legal_hold (lead only)');
reset role;
set local request.jwt.claims to '{}';
update public.media_items set legal_hold = true where id = 'd1d1d1d1-2222-4111-8111-000000000004';
select throws_ok($$update public.media_items set redacted_at = now() where id = 'd1d1d1d1-2222-4111-8111-000000000004'$$, 'P0001', null, 'legal hold beats redaction');
update public.media_items set redacted_at = now() where id = 'd1d1d1d1-2222-4111-8111-000000000003';
select is(public.media_item_showable('d1d1d1d1-2222-4111-8111-000000000003', 'photo_team_album'), false, 'a redacted item never shows');

-- H. storage policy exists
select ok(exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'media_staff_upload'), 'upload policy on storage.objects');
set local request.jwt.claims to '{"sub":"b2b2b2b2-2222-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_ok($$select count(*) from public.media_subjects$$, '42501', null, 'coach cannot read media_subjects directly');
reset role;

select * from finish();

rollback;
