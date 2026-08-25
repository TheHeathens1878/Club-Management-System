-- =============================================================================
-- Events ↔ pitch bookings bridge (20260824310000)
-- =============================================================================
--   A  create_team_event books the pitch (pending for a coach, confirmed for
--      an admin); a clash refuses and writes nothing; no double event
--   B  create_event_series books each week, skips clashing weeks and reports
--      them, keeping every event
--   C  a training booking made at /pitches/book mirrors into a practice event;
--      moves and cancellations follow; a season's worth is one statement and
--      therefore one summary notification
--   D  the RSVP sync in both directions, all three availability values, and
--      loop termination
--   E  cancel_team_event cancels the booking too; fixture events refused
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(30);

-- Setup ----------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('b6b6b6b6-4444-4111-8111-000000000001', 'br-coach@test.invalid',  '{"full_name": "Bree Coach", "dob": "1982-01-01"}'::jsonb),
  ('b6b6b6b6-4444-4111-8111-000000000002', 'br-admin@test.invalid',  '{"full_name": "Ada Admin", "dob": "1979-02-02"}'::jsonb),
  ('b6b6b6b6-4444-4111-8111-000000000003', 'br-player@test.invalid', '{"full_name": "Pip Player", "dob": "1996-03-03"}'::jsonb),
  ('b6b6b6b6-4444-4111-8111-000000000004', 'br-parent@test.invalid', '{"full_name": "Pat Parent", "dob": "1984-04-04"}'::jsonb);
select set_config('br.coach',  (select person_id::text from public.profiles where id = 'b6b6b6b6-4444-4111-8111-000000000001'), true);
select set_config('br.admin',  (select person_id::text from public.profiles where id = 'b6b6b6b6-4444-4111-8111-000000000002'), true);
select set_config('br.player', (select person_id::text from public.profiles where id = 'b6b6b6b6-4444-4111-8111-000000000003'), true);
select set_config('br.parent', (select person_id::text from public.profiles where id = 'b6b6b6b6-4444-4111-8111-000000000004'), true);

insert into public.person_roles (person_id, role, granted_by)
  values (current_setting('br.admin')::uuid, 'club_admin', 'b6b6b6b6-4444-4111-8111-000000000002');

insert into public.people (id, first_name, last_name, dob)
  values ('b6b6b6b6-4444-4111-8111-00000000000a', 'Kid', 'Player', (current_date - interval '10 years')::date);
insert into public.guardianships (guardian_person_id, child_person_id, relationship)
  values (current_setting('br.parent')::uuid, 'b6b6b6b6-4444-4111-8111-00000000000a', 'parent');

insert into public.seasons (id, name, starts_on, ends_on, is_current)
  values ('6f6f6f6f-4444-4111-8111-000000000001', 'BR 2038/39', '2038-08-01', '2039-05-31', true);
insert into public.teams (id, name, age_group)
  values ('8f8f8f8f-4444-4111-8111-000000000001', 'BR Rangers', 'U11');
insert into public.resources (id, type, name, active)
  values ('7a7a7a7a-4444-4111-8111-000000000001', 'pitch', 'BR Pitch 1', true),
         ('7a7a7a7a-4444-4111-8111-000000000002', 'function_room', 'BR Room', true);

insert into public.team_memberships (person_id, team_id, season_id, role) values
  (current_setting('br.coach')::uuid,  '8f8f8f8f-4444-4111-8111-000000000001', '6f6f6f6f-4444-4111-8111-000000000001', 'coach'),
  (current_setting('br.player')::uuid, '8f8f8f8f-4444-4111-8111-000000000001', '6f6f6f6f-4444-4111-8111-000000000001', 'player'),
  ('b6b6b6b6-4444-4111-8111-00000000000a', '8f8f8f8f-4444-4111-8111-000000000001', '6f6f6f6f-4444-4111-8111-000000000001', 'player');

-- A. one-off event books the pitch --------------------------------------------
-- The slot is anchored to 10:00 London on day+7 rather than `now() + 7 days`.
-- Section B's series runs 19:00-20:00 on days 7, 14, 21 and 28 and expects
-- exactly ONE clashing week (the hire planted on day 21); a `now()`-relative
-- hour on day 7 collides with it whenever the suite happens to run between
-- 18:00 and 20:00 London, which made B fail on the clock rather than on the
-- code. Nothing else in the file depends on this one being "an hour from now".
set local request.jwt.claims to '{"sub":"b6b6b6b6-4444-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select set_config('br.ev1', public.create_team_event(
  '8f8f8f8f-4444-4111-8111-000000000001', 'practice', 'Tuesday practice',
  ((now() at time zone 'Europe/London' + interval '7 days')::date + time '10:00') at time zone 'Europe/London',
  60, '7a7a7a7a-4444-4111-8111-000000000001', null, null, true)::text, true);

select isnt((select booking_id from public.events where id = current_setting('br.ev1')::uuid), null,
  'a coach''s practice reserves the pitch');
select is((select b.status::text from public.bookings b
            join public.events e on e.booking_id = b.id where e.id = current_setting('br.ev1')::uuid),
  'pending', 'a coach''s pitch booking is a request, not a confirmation');
select is((select count(*) from public.events where booking_id is not null), 1::bigint,
  'the bookings mirror did not create a second event');

select throws_like($$
  select public.create_team_event('8f8f8f8f-4444-4111-8111-000000000001', 'practice', 'Clashing practice',
    ((now() at time zone 'Europe/London' + interval '7 days')::date + time '10:00') at time zone 'Europe/London',
    60, '7a7a7a7a-4444-4111-8111-000000000001', null, null, true)
$$, '%already booked%', 'a clashing slot refuses');
select is((select count(*) from public.events where title = 'Clashing practice'), 0::bigint,
  'nothing is written when the pitch is taken');

select lives_ok($$
  select public.create_team_event('8f8f8f8f-4444-4111-8111-000000000001', 'social', 'Presentation night',
    now() + interval '7 days', 120, null, 'The clubhouse', null, false)
$$, 'an event with no pitch to reserve is created regardless');
reset role;

set local request.jwt.claims to '{"sub":"b6b6b6b6-4444-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select set_config('br.ev2', public.create_team_event(
  '8f8f8f8f-4444-4111-8111-000000000001', 'practice', 'Admin practice',
  now() + interval '9 days', 60, '7a7a7a7a-4444-4111-8111-000000000001', null, null, true)::text, true);
select is((select b.status::text from public.bookings b
            join public.events e on e.booking_id = b.id where e.id = current_setting('br.ev2')::uuid),
  'confirmed', 'a club admin''s pitch booking is confirmed outright');
reset role;

set local request.jwt.claims to '{"sub":"b6b6b6b6-4444-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select throws_like($$
  select public.create_team_event('8f8f8f8f-4444-4111-8111-000000000001', 'practice', 'Player practice',
    now() + interval '11 days', 60, null, null, null, false)
$$, '%staff or a club admin%', 'a player cannot create a team event');
reset role;

-- B. series ---------------------------------------------------------------------
-- Block week three so the series has something to skip.
insert into public.bookings (resource_id, kind, status, starts_at, ends_at, booker_name, booker_email)
values ('7a7a7a7a-4444-4111-8111-000000000001', 'hire', 'confirmed',
        ((now() at time zone 'Europe/London' + interval '21 days')::date + time '19:00') at time zone 'Europe/London',
        ((now() at time zone 'Europe/London' + interval '21 days')::date + time '20:00') at time zone 'Europe/London',
        'A Hirer', 'hirer@test.invalid');

set local request.jwt.claims to '{"sub":"b6b6b6b6-4444-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select set_config('br.series', (select series_id::text from public.create_event_series(
  '8f8f8f8f-4444-4111-8111-000000000001', 'practice', 'Thursday practice',
  ((now() at time zone 'Europe/London' + interval '7 days')::date + time '19:00') at time zone 'Europe/London',
  60, ((now() at time zone 'Europe/London')::date + 28), '7a7a7a7a-4444-4111-8111-000000000001', null, null, true)), true);

select is((select count(*) from public.events where series_id = current_setting('br.series')::uuid), 4::bigint,
  'every week of the series has an event');
select is((select count(*) from public.events
            where series_id = current_setting('br.series')::uuid and booking_id is not null), 3::bigint,
  'three of the four weeks reserved the pitch');
select is((select count(*) from public.events
            where series_id = current_setting('br.series')::uuid and booking_id is null), 1::bigint,
  'the clashing week keeps its event without a booking');
select is((select count(distinct b.recurrence_group_id) from public.bookings b
            join public.events e on e.booking_id = b.id
            where e.series_id = current_setting('br.series')::uuid), 1::bigint,
  'the series'' bookings share one recurrence group');
reset role;

-- C. booking → event ------------------------------------------------------------
set local request.jwt.claims to '{"sub":"b6b6b6b6-4444-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
insert into public.bookings (id, resource_id, team_id, kind, status, starts_at, ends_at, booker_name, booker_email, occasion)
values ('c1c1c1c1-4444-4111-8111-000000000001', '7a7a7a7a-4444-4111-8111-000000000001',
        '8f8f8f8f-4444-4111-8111-000000000001', 'training', 'confirmed',
        now() + interval '40 days', now() + interval '40 days 1 hour', 'Ada Admin', 'br-admin@test.invalid', 'Keeper session');
reset role;

select set_config('br.bkev', (select id::text from public.events where booking_id = 'c1c1c1c1-4444-4111-8111-000000000001'), true);
select isnt(current_setting('br.bkev'), '', 'a training booking mirrors into an event');
select is((select title from public.events where id = current_setting('br.bkev')::uuid), 'Keeper session',
  'the booking''s occasion names the event');
select is((select type::text from public.events where id = current_setting('br.bkev')::uuid), 'practice',
  'a training booking is a practice');

update public.bookings set starts_at = now() + interval '41 days', ends_at = now() + interval '41 days 1 hour'
 where id = 'c1c1c1c1-4444-4111-8111-000000000001';
select is((select starts_at from public.events where id = current_setting('br.bkev')::uuid),
  (select starts_at from public.bookings where id = 'c1c1c1c1-4444-4111-8111-000000000001'),
  'moving the booking moves the event');

-- A season of training in one statement: one summary, not one per week.
select set_config('br.before', (select count(*)::text from public.outbound_messages
  where person_id = current_setting('br.parent')::uuid and channel = 'in_app'), true);
insert into public.bookings (resource_id, team_id, kind, status, starts_at, ends_at, booker_name, booker_email, occasion)
select '7a7a7a7a-4444-4111-8111-000000000001', '8f8f8f8f-4444-4111-8111-000000000001', 'training', 'confirmed',
       now() + make_interval(days => 60 + 7 * k), now() + make_interval(days => 60 + 7 * k, hours => 1),
       'Ada Admin', 'br-admin@test.invalid', 'Block training'
from generate_series(1, 10) k;
select is((select count(*) from public.outbound_messages
            where person_id = current_setting('br.parent')::uuid and channel = 'in_app'
              and subject like 'New events:%' and body like '10 new events%'), 1::bigint,
  'ten weeks of training booked at once is one summary notification');

-- D. the RSVP sync ---------------------------------------------------------------
set local request.jwt.claims to '{"sub":"b6b6b6b6-4444-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select public.respond_to_event(current_setting('br.bkev')::uuid, current_setting('br.player')::uuid, 'accepted', 'see you there');
reset role;
select is((select status::text from public.booking_availability
            where booking_id = 'c1c1c1c1-4444-4111-8111-000000000001' and person_id = current_setting('br.player')::uuid),
  'available', 'accepting an event marks the coach''s availability sheet');

-- The coach's own screen writing straight to the sheet updates the RSVP.
update public.booking_availability set status = 'unavailable'
 where booking_id = 'c1c1c1c1-4444-4111-8111-000000000001' and person_id = current_setting('br.player')::uuid;
select is((select status::text from public.event_responses
            where event_id = current_setting('br.bkev')::uuid and person_id = current_setting('br.player')::uuid),
  'declined', 'a write to the availability sheet updates the event response');

update public.booking_availability set status = 'maybe'
 where booking_id = 'c1c1c1c1-4444-4111-8111-000000000001' and person_id = current_setting('br.player')::uuid;
select is((select count(*) from public.event_responses
            where event_id = current_setting('br.bkev')::uuid and person_id = current_setting('br.player')::uuid),
  0::bigint, '"maybe" has no RSVP equivalent and clears the response');
select is((select status::text from public.booking_availability
            where booking_id = 'c1c1c1c1-4444-4111-8111-000000000001' and person_id = current_setting('br.player')::uuid),
  'maybe', 'and the sheet keeps saying maybe — the sync did not bounce back');

-- Fixtures use `availability`, the table the selection screens read.
insert into public.fixtures (id, team_id, season_id, opponent, is_home, kickoff_at)
values ('f2f2f2f2-4444-4111-8111-000000000001', '8f8f8f8f-4444-4111-8111-000000000001',
        '6f6f6f6f-4444-4111-8111-000000000001', 'Bridge FC', true, now() + interval '14 days');
select set_config('br.fxev', (select id::text from public.events where fixture_id = 'f2f2f2f2-4444-4111-8111-000000000001'), true);

set local request.jwt.claims to '{"sub":"b6b6b6b6-4444-4111-8111-000000000004","role":"authenticated"}';
set local role authenticated;
select public.respond_to_event(current_setting('br.fxev')::uuid, 'b6b6b6b6-4444-4111-8111-00000000000a', 'accepted');
reset role;
select is((select status::text from public.availability
            where fixture_id = 'f2f2f2f2-4444-4111-8111-000000000001'
              and person_id = 'b6b6b6b6-4444-4111-8111-00000000000a'),
  'available', 'a parent''s accept on a fixture event reaches the coach''s headcount');

update public.availability set status = 'unavailable'
 where fixture_id = 'f2f2f2f2-4444-4111-8111-000000000001' and person_id = 'b6b6b6b6-4444-4111-8111-00000000000a';
select is((select status::text from public.event_responses
            where event_id = current_setting('br.fxev')::uuid and person_id = 'b6b6b6b6-4444-4111-8111-00000000000a'),
  'declined', 'the marker page''s answer reaches the event page');
select is((select count(*) from public.availability
            where fixture_id = 'f2f2f2f2-4444-4111-8111-000000000001'
              and person_id = 'b6b6b6b6-4444-4111-8111-00000000000a' and status = 'unavailable'),
  1::bigint, 'the round trip settled — no ping-pong between the two tables');

-- E. cancellation -----------------------------------------------------------------
set local request.jwt.claims to '{"sub":"b6b6b6b6-4444-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok($$ select public.cancel_team_event(current_setting('br.ev1')::uuid) $$,
  'a coach cancels their own practice');
select throws_like($$ select public.cancel_team_event(current_setting('br.fxev')::uuid) $$,
  '%cancel or postpone the fixture%', 'a fixture event cannot be cancelled this way');
reset role;
select is((select b.status::text from public.bookings b
            join public.events e on e.booking_id = b.id where e.id = current_setting('br.ev1')::uuid),
  'cancelled', 'cancelling the practice hands the pitch back');

update public.bookings set status = 'cancelled' where id = 'c1c1c1c1-4444-4111-8111-000000000001';
select is((select status::text from public.events where id = current_setting('br.bkev')::uuid), 'cancelled',
  'cancelling a training booking cancels its event');

-- The badge the event page renders.
set local request.jwt.claims to '{"sub":"b6b6b6b6-4444-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select is((select public.event_detail(current_setting('br.ev2')::uuid) ->> 'booked'), 'true',
  'a confirmed pitch shows as booked');
select is((select public.event_detail(current_setting('br.ev2')::uuid) ->> 'booking_status'), 'confirmed',
  'the booking status travels to the page');
reset role;

select * from finish();
rollback;
