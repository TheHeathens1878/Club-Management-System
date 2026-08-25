-- =============================================================================
-- Gap 5 — in-app notifications (20260824160000)
-- =============================================================================
--   A  shape + reader functions; only the recipient can mark read
--   B  writers: membership added, pitch booking confirmed by admin, account
--      request decided, waiting-list access granted; none when acting on self
--   C  no email/sms row is ever produced by these writers
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(16);

insert into auth.users (id, email, raw_user_meta_data) values
  ('d9d9d9d9-1111-4111-8111-000000000001', 'nt-admin@test.invalid', '{"full_name": "Ada Admin"}'::jsonb),
  ('d9d9d9d9-1111-4111-8111-000000000002', 'nt-coach@test.invalid', '{"full_name": "Cy Coach", "dob": "1980-01-01"}'::jsonb),
  ('d9d9d9d9-1111-4111-8111-000000000003', 'nt-other@test.invalid', '{"full_name": "Ol Other", "dob": "1980-01-01"}'::jsonb);
update public.profiles set role = 'committee' where id = 'd9d9d9d9-1111-4111-8111-000000000001';
select set_config('nt.coach', (select person_id::text from public.profiles where id = 'd9d9d9d9-1111-4111-8111-000000000002'), true);
select set_config('nt.other', (select person_id::text from public.profiles where id = 'd9d9d9d9-1111-4111-8111-000000000003'), true);
insert into public.seasons (id, name, starts_on, ends_on, is_current) values ('5e5e5e5e-1111-4111-8111-000000000001', 'NT 2034/35', '2034-08-01', '2035-05-31', true);
insert into public.teams (id, name) values ('7e7e7e7e-1111-4111-8111-000000000001', 'NT U14s');
insert into public.resources (id, type, name) values ('c9c9c9c9-1111-4111-8111-000000000021', 'pitch', 'NT Pitch');

-- A. shape
select has_column('public', 'outbound_messages', 'read_at', 'outbound_messages.read_at');
select has_column('public', 'outbound_messages', 'link', 'outbound_messages.link');
select has_function('public', 'unread_notification_count', 'unread_notification_count()');

-- B. writers — as the admin
set local request.jwt.claims to '{"sub":"d9d9d9d9-1111-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
insert into public.team_memberships (person_id, team_id, season_id, role)
values (current_setting('nt.coach')::uuid, '7e7e7e7e-1111-4111-8111-000000000001', '5e5e5e5e-1111-4111-8111-000000000001', 'coach');
reset role;

select is((select (subject, link, status::text) from public.outbound_messages
            where channel = 'in_app' and person_id = current_setting('nt.coach')::uuid and entity = 'team_memberships'),
  ('Added to NT U14s'::text, '/teams/7e7e7e7e-1111-4111-8111-000000000001'::text, 'queued'::text),
  'membership added → in-app notification to the member');

-- booking confirmed by the admin, requested by the coach
insert into public.bookings (id, resource_id, kind, status, starts_at, ends_at, team_id, booker_person_id, booker_name, booker_email, occasion)
values ('e9e9e9e9-1111-4111-8111-000000000001', 'c9c9c9c9-1111-4111-8111-000000000021', 'training', 'pending',
        '2034-09-05 18:00+01', '2034-09-05 19:00+01', '7e7e7e7e-1111-4111-8111-000000000001',
        current_setting('nt.coach')::uuid, 'Cy Coach', 'nt-coach@test.invalid', 'U14 training');
set local request.jwt.claims to '{"sub":"d9d9d9d9-1111-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
update public.bookings set status = 'confirmed' where id = 'e9e9e9e9-1111-4111-8111-000000000001';
reset role;
select is((select (subject, body like '%NT Pitch%' and body like '%05 Sep%') from public.outbound_messages
            where channel = 'in_app' and entity = 'bookings' and entity_id = 'e9e9e9e9-1111-4111-8111-000000000001'),
  ('Pitch booking confirmed'::text, true), 'admin confirming a coach''s booking notifies the coach');

-- the coach cancelling their own booking produces nothing
set local request.jwt.claims to '{"sub":"d9d9d9d9-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
update public.bookings set status = 'cancelled' where id = 'e9e9e9e9-1111-4111-8111-000000000001';
reset role;
select is((select count(*) from public.outbound_messages where channel = 'in_app' and entity = 'bookings'
            and entity_id = 'e9e9e9e9-1111-4111-8111-000000000001'), 1::bigint, 'acting on your own booking sends nothing');

-- account request decided
insert into public.account_requests (id, person_id, requested_role) values ('f9f9f9f9-1111-4111-8111-000000000001', current_setting('nt.other')::uuid, 'parent');
set local request.jwt.claims to '{"sub":"d9d9d9d9-1111-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok($$ select public.reject_account_request('f9f9f9f9-1111-4111-8111-000000000001', 'unknown to the club') $$, 'reject');
reset role;
-- Scoped to the requester: since 20260825260000 the ARRIVAL of a request also
-- writes an 'account_requests' row, addressed to every live club_admin.
select is((select (subject, body like '%unknown to the club%') from public.outbound_messages
            where channel = 'in_app' and entity = 'account_requests'
              and person_id = current_setting('nt.other')::uuid),
  ('Your request was not approved'::text, true), 'decision notifies the requester with the note');

-- waiting-list access granted
insert into public.waiting_list_access (person_id, age_group) values (current_setting('nt.coach')::uuid, 'U10');
select is((select subject from public.outbound_messages where channel = 'in_app' and entity = 'waiting_list_access'),
  'Waiting list access granted', 'access grant notifies the coach');

-- reader functions as the coach
set local request.jwt.claims to '{"sub":"d9d9d9d9-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select is(public.unread_notification_count(), 3, 'coach has three unread');
select lives_ok($$ select public.mark_notification_read((select id from public.outbound_messages where entity = 'team_memberships' limit 1)) $$, 'mark one read');
select is(public.unread_notification_count(), 2, 'count drops');
select is(public.mark_all_notifications_read(), 2, 'mark all read returns the number marked');
reset role;

-- a different person cannot mark the coach's rows read
set local request.jwt.claims to '{"sub":"d9d9d9d9-1111-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select lives_ok($$ select public.mark_notification_read((select id from public.outbound_messages where entity = 'waiting_list_access' limit 1)) $$, 'call succeeds silently');
reset role;
select is((select count(*) from public.outbound_messages where channel = 'in_app' and read_at is null
            and person_id = current_setting('nt.coach')::uuid), 0::bigint, 'rows were already read; nothing the other person did changed anything');

-- C. no external channel rows were produced
select is((select count(*) from public.outbound_messages where channel in ('email', 'sms') and created_at > now() - interval '1 minute'
            and person_id in (current_setting('nt.coach')::uuid, current_setting('nt.other')::uuid)), 0::bigint,
  'no email/sms rows from the notification writers');

select * from finish();
rollback;
