-- =============================================================================
-- A notification is the club's, not the caller's (20260913100000)
-- =============================================================================
-- Kate Conlin, coach, asked for a pitch and the database refused — not her
-- request, the PUSH TWIN of the notification it sent the administrators:
-- `enqueue_message()`'s admin-only gate read the coach's own claims inside the
-- trigger. Both halves must hold:
--
--   A  a coach's pitch request goes through, and the administrator with a
--      registered device gets the in-app row AND the push twin
--   B  the club's voice does not linger: the flag is clear once notify() is
--      done, and a member calling enqueue_message() directly is refused
--      exactly as before
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(9);

-- Fixtures ---------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('cc0a0a0a-0913-4111-8111-000000000001', 'nc-admin@test.invalid', '{"full_name": "Ada Admin"}'::jsonb),
  ('cc0a0a0a-0913-4111-8111-000000000002', 'nc-coach@test.invalid', '{"full_name": "Kate Coach"}'::jsonb);
update public.profiles set role = 'committee' where id = 'cc0a0a0a-0913-4111-8111-000000000001';
select set_config('nc.admin', (select person_id::text from public.profiles where id = 'cc0a0a0a-0913-4111-8111-000000000001'), true);
select set_config('nc.coach', (select person_id::text from public.profiles where id = 'cc0a0a0a-0913-4111-8111-000000000002'), true);
update public.people set dob = '1980-01-01'
 where id in (current_setting('nc.admin')::uuid, current_setting('nc.coach')::uuid);

-- The administrator carries a phone: exactly what turns notify() into a push
-- twin, and so exactly what broke a coach's request.
insert into public.push_tokens (token, person_id, platform) values
  ('ExponentPushToken[nc-admin-phone]', current_setting('nc.admin')::uuid, 'ios');

insert into public.seasons (id, name, starts_on, ends_on) values
  ('5c0a0a0a-0913-4111-8111-000000000001', 'NC 2034/35', '2034-08-01', '2035-05-31');
insert into public.teams (id, name) values
  ('7c0a0a0a-0913-4111-8111-000000000001', 'NC U09 Vulcamos');
insert into public.team_memberships (person_id, team_id, season_id, role) values
  (current_setting('nc.coach')::uuid, '7c0a0a0a-0913-4111-8111-000000000001',
   '5c0a0a0a-0913-4111-8111-000000000001', 'coach');
insert into public.resources (id, type, name) values
  ('c1c0a0a0-0913-4111-8111-000000000011', 'pitch', 'NC Pitch A');


-- A. the coach's request goes through, phone or no phone ------------------------
set local request.jwt.claims to '{"sub":"cc0a0a0a-0913-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;

select is((select public.is_club_admin()), false, 'the caller is a coach, not an administrator');
select is((select public.is_team_staff('7c0a0a0a-0913-4111-8111-000000000001')), true,
  'and the team is theirs');

select lives_ok($$
  select * from public.request_team_pitch_booking(
    '7c0a0a0a-0913-4111-8111-000000000001',
    'c1c0a0a0-0913-4111-8111-000000000011',
    'training',
    array['2034-09-05 18:00+01'::timestamptz],
    array['2034-09-05 19:00+01'::timestamptz],
    'Kate Coach', 'nc-coach@test.invalid', 'U9 training', null, null, null)
$$, 'a coach asks for a pitch while an administrator carries a phone — and is not refused');

reset role;

select is((select count(*) from public.bookings
            where team_id = '7c0a0a0a-0913-4111-8111-000000000001' and status = 'pending'),
  1::bigint, 'the request landed on the desk, pending');
select is((select count(*) from public.outbound_messages
            where person_id = current_setting('nc.admin')::uuid and channel = 'in_app'
              and entity = 'pitch_requests'),
  1::bigint, 'the administrator has the in-app notification');
select is((select count(*) from public.outbound_messages
            where person_id = current_setting('nc.admin')::uuid and channel = 'push'
              and entity = 'pitch_requests'),
  1::bigint, 'and its push twin, queued as the club');


-- B. the club's voice does not linger, and a member still cannot queue email ----
select is(coalesce(current_setting('club.notify_internal', true), ''), '',
  'the flag notify() raised is clear again once it has spoken');

set local request.jwt.claims to '{"sub":"cc0a0a0a-0913-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;

select throws_ok($$
  select * from public.enqueue_message('email', 'transactional', null, 'someone@test.invalid', 'Hello', 'From a coach')
$$, '42501', 'enqueue_message: service_role or club_admin only',
  'a member calling the queue directly is refused, as before');
select throws_ok($$
  select * from public.enqueue_message('push', 'transactional', current_setting('nc.admin')::uuid, null, 'Hello', 'From a coach')
$$, '42501', 'enqueue_message: service_role or club_admin only',
  'nor may a member push to an administrator by hand');

reset role;

select * from finish();
rollback;
