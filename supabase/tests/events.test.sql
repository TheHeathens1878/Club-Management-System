-- =============================================================================
-- Events (20260824290000)
-- =============================================================================
--   A  a fixture insert mirrors into events (type, title); competition → type
--   B  notifications: per-event when few, one summary when a statement lands
--      more than three; strangers get nothing
--   C  fixture updates sync kickoff, cancellation, venue
--   D  responses: self + guardian-of-minor only; membership guard; notes are
--      visible to staff and the responder's own household, not the team
--   E  one-off events by staff; fixture-linked rows locked to the sync
--   F  create_event_series: weekly occurrences, staff-only
--   G  remind_event_nonresponders: players without a response (guardian for a
--      minor), one send per hour, staff-only
--   H  my_events / event_detail for the pages
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(32);

-- Setup ----------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('e7e7e7e7-3333-4111-8111-000000000001', 'ev-coach@test.invalid',    '{"full_name": "Cody Coach", "dob": "1980-01-01"}'::jsonb),
  ('e7e7e7e7-3333-4111-8111-000000000002', 'ev-parent@test.invalid',   '{"full_name": "Pat Parent", "dob": "1985-02-02"}'::jsonb),
  ('e7e7e7e7-3333-4111-8111-000000000003', 'ev-player@test.invalid',   '{"full_name": "Ade Player", "dob": "1995-03-03"}'::jsonb),
  ('e7e7e7e7-3333-4111-8111-000000000004', 'ev-outsider@test.invalid', '{"full_name": "Oz Outsider", "dob": "1990-04-04"}'::jsonb);
select set_config('ev.coach',    (select person_id::text from public.profiles where id = 'e7e7e7e7-3333-4111-8111-000000000001'), true);
select set_config('ev.parent',   (select person_id::text from public.profiles where id = 'e7e7e7e7-3333-4111-8111-000000000002'), true);
select set_config('ev.player',   (select person_id::text from public.profiles where id = 'e7e7e7e7-3333-4111-8111-000000000003'), true);
select set_config('ev.outsider', (select person_id::text from public.profiles where id = 'e7e7e7e7-3333-4111-8111-000000000004'), true);

insert into public.people (id, first_name, last_name, dob)
  values ('e7e7e7e7-3333-4111-8111-00000000000a', 'Evie', 'Child', '2016-01-01');
insert into public.guardianships (guardian_person_id, child_person_id, relationship)
  values (current_setting('ev.parent')::uuid, 'e7e7e7e7-3333-4111-8111-00000000000a', 'parent');

insert into public.seasons (id, name, starts_on, ends_on, is_current)
  values ('6e6e6e6e-3333-4111-8111-000000000001', 'EV 2036/37', '2036-08-01', '2037-05-31', true);
insert into public.teams (id, name, age_group)
  values ('8e8e8e8e-3333-4111-8111-000000000001', 'EV United', 'U11');

insert into public.team_memberships (person_id, team_id, season_id, role) values
  (current_setting('ev.coach')::uuid,  '8e8e8e8e-3333-4111-8111-000000000001', '6e6e6e6e-3333-4111-8111-000000000001', 'coach'),
  (current_setting('ev.player')::uuid, '8e8e8e8e-3333-4111-8111-000000000001', '6e6e6e6e-3333-4111-8111-000000000001', 'player'),
  ('e7e7e7e7-3333-4111-8111-00000000000a', '8e8e8e8e-3333-4111-8111-000000000001', '6e6e6e6e-3333-4111-8111-000000000001', 'player');

-- A. fixture → event ---------------------------------------------------------
insert into public.fixtures (id, team_id, season_id, opponent, is_home, competition, kickoff_at)
  values ('f1f1f1f1-3333-4111-8111-000000000001', '8e8e8e8e-3333-4111-8111-000000000001',
          '6e6e6e6e-3333-4111-8111-000000000001', 'Rovers', true, 'Division Two', now() + interval '7 days');
select set_config('ev.f1ev', (select id::text from public.events where fixture_id = 'f1f1f1f1-3333-4111-8111-000000000001'), true);

select is((select type::text from public.events where fixture_id = 'f1f1f1f1-3333-4111-8111-000000000001'),
  'league_match', 'a fixture insert creates a league_match event');
select is((select title from public.events where fixture_id = 'f1f1f1f1-3333-4111-8111-000000000001'),
  'vs Rovers (H)', 'the event title carries opponent and home/away');
select is(public.event_type_for_competition('Presidents Cup')::text, 'cup_match', 'a cup competition maps to cup_match');

-- B. notifications -----------------------------------------------------------
select is((select count(*) from public.outbound_messages
           where person_id = current_setting('ev.parent')::uuid and channel = 'in_app' and subject like 'New event:%'),
  1::bigint, 'the guardian of a minor player is notified of the new event');
select is((select count(*) from public.outbound_messages
           where person_id = current_setting('ev.outsider')::uuid and channel = 'in_app'),
  0::bigint, 'a person with no link to the team hears nothing');

insert into public.fixtures (team_id, season_id, opponent, is_home, kickoff_at)
select '8e8e8e8e-3333-4111-8111-000000000001', '6e6e6e6e-3333-4111-8111-000000000001',
       'Bulk FC ' || k, false, now() + make_interval(days => 14 + 7 * k)
from generate_series(1, 4) k;
select is((select count(*) from public.outbound_messages
           where person_id = current_setting('ev.parent')::uuid and channel = 'in_app' and subject like 'New events:%'),
  1::bigint, 'more than three events in one statement collapse to one summary');
select is((select count(*) from public.outbound_messages
           where person_id = current_setting('ev.parent')::uuid and channel = 'in_app' and subject like 'New event:%'),
  1::bigint, 'no per-event notifications for the bulk statement');

-- C. fixture updates sync ----------------------------------------------------
update public.fixtures set kickoff_at = now() + interval '8 days' where id = 'f1f1f1f1-3333-4111-8111-000000000001';
select is((select e.starts_at from public.events e where e.id = current_setting('ev.f1ev')::uuid),
  (select kickoff_at from public.fixtures where id = 'f1f1f1f1-3333-4111-8111-000000000001'),
  'a kickoff change moves the event');
update public.fixtures set status = 'postponed' where id = 'f1f1f1f1-3333-4111-8111-000000000001';
select is((select status::text from public.events where id = current_setting('ev.f1ev')::uuid),
  'cancelled', 'postponing the fixture cancels the event');
update public.fixtures set status = 'scheduled' where id = 'f1f1f1f1-3333-4111-8111-000000000001';
update public.fixtures set venue_text = 'Away Ground, Sale' where id = 'f1f1f1f1-3333-4111-8111-000000000001';

-- D. responses ---------------------------------------------------------------
set local request.jwt.claims to '{"sub":"e7e7e7e7-3333-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select lives_ok($$ select public.respond_to_event(current_setting('ev.f1ev')::uuid, current_setting('ev.player')::uuid, 'accepted', 'knee strapped') $$,
  'an adult player accepts for themself');
reset role;

set local request.jwt.claims to '{"sub":"e7e7e7e7-3333-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select lives_ok($$ select public.respond_to_event(current_setting('ev.f1ev')::uuid, 'e7e7e7e7-3333-4111-8111-00000000000a', 'declined', 'on holiday') $$,
  'a guardian declines for their child');
select throws_like($$ select public.respond_to_event(current_setting('ev.f1ev')::uuid, current_setting('ev.player')::uuid, 'accepted') $$,
  '%yourself or a child in your care%', 'a parent cannot answer for another adult');
reset role;
select throws_like($$
  insert into public.event_responses (event_id, person_id, status)
  values (current_setting('ev.f1ev')::uuid, current_setting('ev.outsider')::uuid, 'accepted')
$$, '%live member%', 'a response needs a live membership on the event''s team');

set local request.jwt.claims to '{"sub":"e7e7e7e7-3333-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select is((select response from public.event_people(current_setting('ev.f1ev')::uuid) where person_id = 'e7e7e7e7-3333-4111-8111-00000000000a'),
  'declined', 'event_people shows the child''s decline to the guardian');
select is((select note from public.event_people(current_setting('ev.f1ev')::uuid) where person_id = current_setting('ev.player')::uuid),
  null, 'another member''s note is not shown to a parent');
reset role;
set local request.jwt.claims to '{"sub":"e7e7e7e7-3333-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select note from public.event_people(current_setting('ev.f1ev')::uuid) where person_id = current_setting('ev.player')::uuid),
  'knee strapped', 'team staff do see the note');
select is((select is_organiser from public.event_people(current_setting('ev.f1ev')::uuid) where person_id = current_setting('ev.coach')::uuid),
  true, 'the coach is listed as an organiser');
reset role;
set local request.jwt.claims to '{"sub":"e7e7e7e7-3333-4111-8111-000000000004","role":"authenticated"}';
set local role authenticated;
select throws_like($$ select * from public.event_people(current_setting('ev.f1ev')::uuid) $$,
  '%only the team%', 'an outsider may not read the responses');
reset role;

-- E. one-off events; fixture rows are locked ---------------------------------
set local request.jwt.claims to '{"sub":"e7e7e7e7-3333-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok($$
  insert into public.events (id, team_id, type, title, starts_at, ends_at, venue_text)
  values ('e1e1e1e1-3333-4111-8111-000000000001', '8e8e8e8e-3333-4111-8111-000000000001', 'social',
          'End of season BBQ', now() + interval '30 days', now() + interval '30 days 3 hours', 'The clubhouse')
$$, 'staff create a one-off social event');
select throws_like($$
  insert into public.events (team_id, type, title, starts_at, fixture_id)
  values ('8e8e8e8e-3333-4111-8111-000000000001', 'friendly', 'vs Nobody (H)', now() + interval '9 days',
          'f1f1f1f1-3333-4111-8111-000000000001')
$$, '%created automatically%', 'fixture events cannot be created by hand');
select throws_like($$ delete from public.events where id = current_setting('ev.f1ev')::uuid $$,
  '%cancel or delete the fixture%', 'fixture events cannot be deleted by hand');

-- F. series ------------------------------------------------------------------
select set_config('ev.series', (select series_id::text from public.create_event_series(
  '8e8e8e8e-3333-4111-8111-000000000001', 'practice', 'Tuesday practice',
  now() + interval '3 days', 60,
  (now() at time zone 'Europe/London')::date + 38)), true);
select is((select count(*) from public.events where series_id = current_setting('ev.series')::uuid),
  6::bigint, 'a weekly series until day 38 materialises six occurrences');
reset role;
select is((select count(*) from public.outbound_messages
           where person_id = current_setting('ev.parent')::uuid and channel = 'in_app' and subject like 'New events:%'),
  2::bigint, 'the series lands as one summary notification');
set local request.jwt.claims to '{"sub":"e7e7e7e7-3333-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select throws_like($$
  select public.create_event_series('8e8e8e8e-3333-4111-8111-000000000001', 'practice', 'Rogue practice',
    now() + interval '3 days', 60, (now() at time zone 'Europe/London')::date + 10)
$$, '%staff%', 'a player cannot create a series');
reset role;

-- G. reminders ---------------------------------------------------------------
select set_config('ev.s1ev', (select id::text from public.events
  where series_id = current_setting('ev.series')::uuid order by starts_at limit 1), true);
set local request.jwt.claims to '{"sub":"e7e7e7e7-3333-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is(public.remind_event_nonresponders(current_setting('ev.s1ev')::uuid), 2,
  'both unanswered players are chased (the minor via their guardian)');
reset role;
select is((select count(*) from public.outbound_messages
           where person_id = current_setting('ev.parent')::uuid and channel = 'in_app' and subject like 'Please respond:%'),
  1::bigint, 'the guardian receives the child''s reminder');
set local request.jwt.claims to '{"sub":"e7e7e7e7-3333-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select throws_like($$ select public.remind_event_nonresponders(current_setting('ev.s1ev')::uuid) $$,
  '%already sent in the last hour%', 'reminders are throttled to one send per hour');
reset role;
set local request.jwt.claims to '{"sub":"e7e7e7e7-3333-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select throws_like($$ select public.remind_event_nonresponders(current_setting('ev.s1ev')::uuid) $$,
  '%staff or a club admin%', 'only staff may send reminders');
reset role;

-- H. the page feeds ----------------------------------------------------------
set local request.jwt.claims to '{"sub":"e7e7e7e7-3333-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select is((select jsonb_array_length(people) from public.my_events(120) where event_id = current_setting('ev.f1ev')::uuid),
  1, 'my_events lists the guardian''s one respondable person on this team');
select is((select public.event_detail(current_setting('ev.f1ev')::uuid) ->> 'booked'), 'false',
  'an unallocated fixture shows unbooked');
select is((select public.event_detail(current_setting('ev.f1ev')::uuid) ->> 'venue'), 'Away Ground, Sale',
  'the venue falls back to the fixture''s venue text');
reset role;
set local request.jwt.claims to '{"sub":"e7e7e7e7-3333-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select is_staff from public.my_events(120) where event_id = current_setting('ev.f1ev')::uuid),
  true, 'my_events marks the coach as staff for the event');
reset role;

select * from finish();
rollback;
