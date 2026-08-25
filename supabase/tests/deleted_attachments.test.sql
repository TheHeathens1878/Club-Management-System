-- =============================================================================
-- Deleting a message takes its photo with it (20260824370000)
-- =============================================================================
--   A  a participant sees an attachment on a live message
--   B  deleting the message hides the attachment row from every participant
--   C  redaction does the same
--   D  the safeguarding lead's export still reaches the message itself (SG-2:
--      nothing was destroyed)
--
-- The storage.objects policy carries the same clause; it cannot be exercised
-- here without the storage schema's own fixtures, so it is asserted by reading
-- the policy definition — a cheap check that the clause is present and has not
-- been reverted by a later edit.
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(9);

insert into auth.users (id, email, raw_user_meta_data) values
  ('d1d1d1d1-6666-4111-8111-000000000001', 'da-one@test.invalid', '{"full_name": "Ann One", "dob": "1980-01-01"}'::jsonb),
  ('d1d1d1d1-6666-4111-8111-000000000002', 'da-two@test.invalid', '{"full_name": "Bob Two", "dob": "1981-02-02"}'::jsonb),
  ('d1d1d1d1-6666-4111-8111-000000000003', 'da-out@test.invalid', '{"full_name": "Cid Out", "dob": "1982-03-03"}'::jsonb);
select set_config('da.one', (select person_id::text from public.profiles where id = 'd1d1d1d1-6666-4111-8111-000000000001'), true);
select set_config('da.two', (select person_id::text from public.profiles where id = 'd1d1d1d1-6666-4111-8111-000000000002'), true);

insert into public.conversations (id, type, created_by_person_id) values
  ('c0c0c0c0-6666-4111-8111-000000000001', 'group', current_setting('da.one')::uuid);
insert into public.conversation_participants (conversation_id, person_id, basis) values
  ('c0c0c0c0-6666-4111-8111-000000000001', current_setting('da.one')::uuid, 'creator'),
  ('c0c0c0c0-6666-4111-8111-000000000001', current_setting('da.two')::uuid, 'member');

insert into public.messages (id, conversation_id, sender_person_id, body) values
  ('11111111-6666-4111-8111-000000000001', 'c0c0c0c0-6666-4111-8111-000000000001', current_setting('da.one')::uuid, 'Here is the team photo'),
  ('11111111-6666-4111-8111-000000000002', 'c0c0c0c0-6666-4111-8111-000000000001', current_setting('da.one')::uuid, 'And another');
insert into public.message_attachments (message_id, storage_path, content_type) values
  ('11111111-6666-4111-8111-000000000001', 'c0c0c0c0-6666-4111-8111-000000000001/11111111-6666-4111-8111-000000000001/team.jpg', 'image/jpeg'),
  ('11111111-6666-4111-8111-000000000002', 'c0c0c0c0-6666-4111-8111-000000000001/11111111-6666-4111-8111-000000000002/other.jpg', 'image/jpeg');

-- A. the live message ---------------------------------------------------------
set local request.jwt.claims to '{"sub":"d1d1d1d1-6666-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.message_attachments), 2::bigint,
  'a participant sees both attachments while the messages stand');
reset role;

-- B. the sender deletes their photo message ------------------------------------
set local request.jwt.claims to '{"sub":"d1d1d1d1-6666-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok($$
  update public.messages set deleted_at = now()
   where id = '11111111-6666-4111-8111-000000000001'
$$, 'the sender deletes their own message');
select is((select count(*) from public.message_attachments), 1::bigint,
  'the sender no longer sees the deleted message''s attachment');
reset role;

set local request.jwt.claims to '{"sub":"d1d1d1d1-6666-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.message_attachments), 1::bigint,
  'nor does anyone else in the conversation');
select is((select count(*) from public.message_attachments
            where message_id = '11111111-6666-4111-8111-000000000002'), 1::bigint,
  'the other message keeps its photo');
reset role;

-- C. redaction ------------------------------------------------------------------
update public.messages set redacted_at = now(), redaction_reason = 'test'
 where id = '11111111-6666-4111-8111-000000000002';
set local request.jwt.claims to '{"sub":"d1d1d1d1-6666-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.message_attachments), 0::bigint,
  'a redacted message hides its attachment too');
reset role;

-- D. nothing was destroyed (SG-2) ------------------------------------------------
select is((select count(*) from public.message_attachments), 2::bigint,
  'both rows are still there for the owner — soft hiding, not deletion');
select is((select count(*) from public.messages
            where conversation_id = 'c0c0c0c0-6666-4111-8111-000000000001'), 2::bigint,
  'and both messages remain for the safeguarding export');

-- The storage policy carries the same clause.
select ok(
  (select pg_get_expr(polqual, polrelid) like '%deleted_at%'
     from pg_policy
     where polname = 'attachments_participant_read'
       and polrelid = 'storage.objects'::regclass),
  'the storage read policy also refuses a deleted message''s object');

select * from finish();
rollback;
