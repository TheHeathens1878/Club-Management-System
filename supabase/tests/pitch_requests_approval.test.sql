-- =============================================================================
-- A coach's pitch booking is a request, not a confirmation (20260825170000)
-- =============================================================================
-- Adam, 2026-08-25: "Coaches should not be able to book pitches as confirmed -
-- it should go to admin for approval."
--
--   A  shape: the guard and the notifier are wired to public.bookings
--   B  a coach's booking is STORED pending even when the client posts
--      'confirmed' (or 'enquiry') — the screen is not what enforces this
--   C  a coach cannot move one to confirmed; the refusal names the desk;
--      an admin can, and an admin's own booking is confirmed as before
--   D  the request reaches every club_admin in-app, once per statement, with
--      no email; nobody is told about their own request
--   E  a pending request already holds the slot and is on the requests desk
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(24);

-- Fixtures ---------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('a7a7a7a7-7777-4111-8111-000000000001', 'pa-admin@test.invalid',  '{"full_name": "Ada Admin"}'::jsonb),
  ('a7a7a7a7-7777-4111-8111-000000000002', 'pa-coach@test.invalid',  '{"full_name": "Cy Coach"}'::jsonb),
  ('a7a7a7a7-7777-4111-8111-000000000003', 'pa-admin2@test.invalid', '{"full_name": "Bea Admin"}'::jsonb);
update public.profiles set role = 'committee'
 where id in ('a7a7a7a7-7777-4111-8111-000000000001', 'a7a7a7a7-7777-4111-8111-000000000003');
select set_config('pa.admin',  (select person_id::text from public.profiles where id = 'a7a7a7a7-7777-4111-8111-000000000001'), true);
select set_config('pa.coach',  (select person_id::text from public.profiles where id = 'a7a7a7a7-7777-4111-8111-000000000002'), true);
select set_config('pa.admin2', (select person_id::text from public.profiles where id = 'a7a7a7a7-7777-4111-8111-000000000003'), true);
update public.people set dob = '1980-01-01'
 where id in (current_setting('pa.admin')::uuid, current_setting('pa.coach')::uuid, current_setting('pa.admin2')::uuid);

insert into public.seasons (id, name, starts_on, ends_on) values
  ('5a5a5a5a-7777-4111-8111-000000000001', 'PA 2034/35', '2034-08-01', '2035-05-31');
insert into public.teams (id, name) values ('7a7a7a7a-7777-4111-8111-000000000001', 'PA U13s');
insert into public.team_memberships (person_id, team_id, season_id, role) values
  (current_setting('pa.coach')::uuid, '7a7a7a7a-7777-4111-8111-000000000001',
   '5a5a5a5a-7777-4111-8111-000000000001', 'coach');
insert into public.resources (id, type, name) values
  ('c7c7c7c7-7777-4111-8111-000000000011', 'pitch', 'PA Pitch A');

-- A. shape ---------------------------------------------------------------------
select has_function('public', 'pitch_request_notify', 'pitch_request_notify()');
select trigger_is('public', 'bookings', 'trg_pitch_request_notify', 'public', 'pitch_request_notify',
  'a new booking runs the request notifier');
select trigger_is('public', 'bookings', 'trg_bookings_team_guard', 'public', 'bookings_team_guard',
  'the team guard still runs');

-- B. what a coach posts is not what is stored ----------------------------------
set local request.jwt.claims to '{"sub":"a7a7a7a7-7777-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;

select lives_ok($$
  insert into public.bookings (id, resource_id, kind, status, starts_at, ends_at, team_id,
                               booker_person_id, booker_name, booker_email, occasion)
  values ('d7d7d7d7-7777-4111-8111-000000000001', 'c7c7c7c7-7777-4111-8111-000000000011', 'training',
          'confirmed', '2034-09-05 18:00+01', '2034-09-05 19:00+01', '7a7a7a7a-7777-4111-8111-000000000001',
          current_setting('pa.coach')::uuid, 'Cy Coach', 'pa-coach@test.invalid', 'U13 training')
$$, 'a coach posting "confirmed" is accepted, not refused');

select is((select status::text from public.bookings where id = 'd7d7d7d7-7777-4111-8111-000000000001'),
  'pending', 'and it is STORED pending — the database, not the screen, decides');

select lives_ok($$
  insert into public.bookings (id, resource_id, kind, status, starts_at, ends_at, team_id,
                               booker_person_id, booker_name, booker_email, occasion)
  values ('d7d7d7d7-7777-4111-8111-000000000002', 'c7c7c7c7-7777-4111-8111-000000000011', 'block',
          'enquiry', '2034-09-06 18:00+01', '2034-09-06 19:00+01', '7a7a7a7a-7777-4111-8111-000000000001',
          current_setting('pa.coach')::uuid, 'Cy Coach', 'pa-coach@test.invalid', 'U13 fitness')
$$, 'any other status a client invents is accepted too');

select is((select status::text from public.bookings where id = 'd7d7d7d7-7777-4111-8111-000000000002'),
  'pending', 'and it is stored pending as well');

-- C. only a club administrator confirms ----------------------------------------
select throws_like($$
  update public.bookings set status = 'confirmed' where id = 'd7d7d7d7-7777-4111-8111-000000000001'
$$, '%only a club administrator can confirm%', 'a coach cannot move their own request to confirmed');

select throws_ok($$
  update public.bookings set status = 'confirmed' where id = 'd7d7d7d7-7777-4111-8111-000000000001'
$$, 'P0001', null, 'and the refusal is a readable P0001, not a bare policy violation');

select lives_ok($$
  update public.bookings set status = 'cancelled' where id = 'd7d7d7d7-7777-4111-8111-000000000002'
$$, 'a coach may still cancel their own request');
reset role;

set local request.jwt.claims to '{"sub":"a7a7a7a7-7777-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok($$
  update public.bookings set status = 'confirmed' where id = 'd7d7d7d7-7777-4111-8111-000000000001'
$$, 'a club administrator confirms it');
select is((select status::text from public.bookings where id = 'd7d7d7d7-7777-4111-8111-000000000001'),
  'confirmed', 'and the booking is confirmed');

-- an administrator's own booking is confirmed on the spot, exactly as before
select lives_ok($$
  insert into public.bookings (id, resource_id, kind, status, starts_at, ends_at, team_id,
                               booker_person_id, booker_name, booker_email, occasion)
  values ('d7d7d7d7-7777-4111-8111-000000000003', 'c7c7c7c7-7777-4111-8111-000000000011', 'training',
          'confirmed', '2034-09-19 18:00+01', '2034-09-19 19:00+01', '7a7a7a7a-7777-4111-8111-000000000001',
          current_setting('pa.admin')::uuid, 'Ada Admin', 'pa-admin@test.invalid', 'Admin-made session')
$$, 'an administrator books directly');
select is((select status::text from public.bookings where id = 'd7d7d7d7-7777-4111-8111-000000000003'),
  'confirmed', 'an admin-created booking is confirmed, unchanged by this migration');
reset role;

-- D. the desk is told ------------------------------------------------------------
select is((select (subject, link, channel::text, entity) from public.outbound_messages
            where entity = 'pitch_requests' and entity_id = 'd7d7d7d7-7777-4111-8111-000000000001'
              and person_id = current_setting('pa.admin')::uuid),
  ('Pitch request: PA U13s'::text, '/pitches/requests'::text, 'in_app'::text, 'pitch_requests'::text),
  'the coach''s request reaches a club administrator in-app');

select is((select count(*) from public.outbound_messages
            where entity = 'pitch_requests' and person_id = current_setting('pa.admin2')::uuid), 2::bigint,
  'every live club_admin is told, once per request');

select is((select count(*) from public.outbound_messages
            where entity = 'pitch_requests' and channel <> 'in_app'), 0::bigint,
  'no email and no SMS — a pitch request is in-app only');

select is((select count(*) from public.outbound_messages
            where entity = 'pitch_requests' and person_id = current_setting('pa.coach')::uuid), 0::bigint,
  'the coach is not notified of their own request');

select is((select count(*) from public.outbound_messages
            where entity = 'pitch_requests' and entity_id = 'd7d7d7d7-7777-4111-8111-000000000003'), 0::bigint,
  'an administrator''s own confirmed booking raises no request');

-- a weekly repeat is one INSERT, so it is one message
select set_config('pa.before', (select count(*)::text from public.outbound_messages
  where entity = 'pitch_requests' and person_id = current_setting('pa.admin')::uuid), true);
set local request.jwt.claims to '{"sub":"a7a7a7a7-7777-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
insert into public.bookings (resource_id, kind, status, starts_at, ends_at, team_id,
                             booker_person_id, booker_name, booker_email, occasion)
select 'c7c7c7c7-7777-4111-8111-000000000011', 'training', 'pending',
       '2034-10-03 18:00+01'::timestamptz + make_interval(days => 7 * k),
       '2034-10-03 19:00+01'::timestamptz + make_interval(days => 7 * k),
       '7a7a7a7a-7777-4111-8111-000000000001',
       current_setting('pa.coach')::uuid, 'Cy Coach', 'pa-coach@test.invalid', 'Autumn block'
from generate_series(0, 2) k;
reset role;
select is((select count(*) from public.outbound_messages
            where entity = 'pitch_requests' and person_id = current_setting('pa.admin')::uuid)
          - current_setting('pa.before')::bigint, 1::bigint,
  'three weeks requested in one statement is one notification, not three');
select ok((select body like '%3 sessions%' from public.outbound_messages
            where entity = 'pitch_requests' and person_id = current_setting('pa.admin')::uuid
              and body like '%Autumn block%'),
  'and the message says how many sessions were asked for');

-- E. a pending request already holds the pitch ---------------------------------
select is((select count(*) from public.bookings b join public.resources r on r.id = b.resource_id
            where r.type = 'pitch' and b.status = 'pending' and b.kind in ('training', 'block')
              and b.team_id = '7a7a7a7a-7777-4111-8111-000000000001'), 3::bigint,
  'the requests desk query finds every pending training/block request');

set local request.jwt.claims to '{"sub":"a7a7a7a7-7777-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select throws_ok($$
  insert into public.bookings (resource_id, kind, status, starts_at, ends_at,
                               booker_name, booker_email, occasion)
  values ('c7c7c7c7-7777-4111-8111-000000000011', 'maintenance', 'confirmed',
          '2034-10-03 18:30+01', '2034-10-03 19:30+01', 'Ada Admin', 'pa-admin@test.invalid', 'Closed')
$$, '23P01', null, 'a pending request holds the slot against everything else, confirmed or not');
reset role;

select is((select count(*) from public.pitch_calendar('2034-10-01', '2034-10-31')
            where status = 'pending' and team_id = '7a7a7a7a-7777-4111-8111-000000000001'), 3::bigint,
  'and the pitch calendar shows a pending request, so nobody double-books it');

select * from finish();
rollback;
