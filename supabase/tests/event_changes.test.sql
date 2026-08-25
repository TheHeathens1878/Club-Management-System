-- =============================================================================
-- "The details have changed" (20260824350000)
-- =============================================================================
--   A  moving a fixture flags its event, keeps the answers, and says what
--      changed in words
--   B  the household is told; the person who moved it is not
--   C  a response given before the change is reported stale, and re-answering
--      clears it
--   D  a burst of single-row updates (the bulk allocation shape: one statement
--      per fixture) collapses to ONE message per household, counting them all
--   E  a venue confirmed for the first time counts as a change
--   F  training bookings behave the same way
--   G  a score or a note is not "the details changed"
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(17);

insert into auth.users (id, email, raw_user_meta_data) values
  ('e2e2e2e2-7777-4111-8111-000000000001', 'ec-admin@test.invalid',  '{"full_name": "Ada Admin", "dob": "1978-01-01"}'::jsonb),
  ('e2e2e2e2-7777-4111-8111-000000000002', 'ec-parent@test.invalid', '{"full_name": "Pam Parent", "dob": "1986-02-02"}'::jsonb),
  ('e2e2e2e2-7777-4111-8111-000000000003', 'ec-player@test.invalid', '{"full_name": "Pat Player", "dob": "1994-03-03"}'::jsonb);
select set_config('ec.admin',  (select person_id::text from public.profiles where id = 'e2e2e2e2-7777-4111-8111-000000000001'), true);
select set_config('ec.parent', (select person_id::text from public.profiles where id = 'e2e2e2e2-7777-4111-8111-000000000002'), true);
select set_config('ec.player', (select person_id::text from public.profiles where id = 'e2e2e2e2-7777-4111-8111-000000000003'), true);

insert into public.person_roles (person_id, role, granted_by)
  values (current_setting('ec.admin')::uuid, 'club_admin', 'e2e2e2e2-7777-4111-8111-000000000001');

insert into public.people (id, first_name, last_name, dob)
  values ('e2e2e2e2-7777-4111-8111-00000000000a', 'Kim', 'Kid', (current_date - interval '11 years')::date);
insert into public.guardianships (guardian_person_id, child_person_id, relationship)
  values (current_setting('ec.parent')::uuid, 'e2e2e2e2-7777-4111-8111-00000000000a', 'parent');

insert into public.seasons (id, name, starts_on, ends_on, is_current)
  values ('5a5a5a5a-7777-4111-8111-000000000001', 'EC 2042/43', '2042-08-01', '2043-05-31', true);
insert into public.teams (id, name, age_group) values ('8a8a8a8a-7777-4111-8111-000000000001', 'EC Athletic', 'U12');
insert into public.resources (id, type, name, active) values
  ('7b7b7b7b-7777-4111-8111-000000000001', 'pitch', 'EC Home Pitch', true),
  ('7b7b7b7b-7777-4111-8111-000000000002', 'pitch', 'EC Far Pitch', true);
insert into public.team_memberships (person_id, team_id, season_id, role) values
  (current_setting('ec.player')::uuid, '8a8a8a8a-7777-4111-8111-000000000001', '5a5a5a5a-7777-4111-8111-000000000001', 'player'),
  ('e2e2e2e2-7777-4111-8111-00000000000a', '8a8a8a8a-7777-4111-8111-000000000001', '5a5a5a5a-7777-4111-8111-000000000001', 'player');

insert into public.fixtures (id, team_id, season_id, opponent, is_home, kickoff_at, venue_resource_id)
values ('f3f3f3f3-7777-4111-8111-000000000001', '8a8a8a8a-7777-4111-8111-000000000001',
        '5a5a5a5a-7777-4111-8111-000000000001', 'Change FC', true, now() + interval '10 days',
        '7b7b7b7b-7777-4111-8111-000000000001');
select set_config('ec.ev', (select id::text from public.events where fixture_id = 'f3f3f3f3-7777-4111-8111-000000000001'), true);

-- Both households answer before anything moves.
set local request.jwt.claims to '{"sub":"e2e2e2e2-7777-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select public.respond_to_event(current_setting('ec.ev')::uuid, current_setting('ec.player')::uuid, 'accepted');
reset role;
set local request.jwt.claims to '{"sub":"e2e2e2e2-7777-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select public.respond_to_event(current_setting('ec.ev')::uuid, 'e2e2e2e2-7777-4111-8111-00000000000a', 'accepted');
reset role;

-- In production the answers predate the move by days; in this single
-- transaction now() never advances, so the ordering has to be created by hand.
-- (set_updated_at would immediately overwrite a backdate, hence the toggle.)
alter table public.event_responses disable trigger trg_event_responses_updated;
update public.event_responses set updated_at = now() - interval '1 hour'
 where event_id = current_setting('ec.ev')::uuid;
alter table public.event_responses enable trigger trg_event_responses_updated;

-- A. the move --------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"e2e2e2e2-7777-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
update public.fixtures set kickoff_at = now() + interval '10 days 4 hours'
 where id = 'f3f3f3f3-7777-4111-8111-000000000001';
reset role;

select isnt((select details_changed_at from public.events where id = current_setting('ec.ev')::uuid), null,
  'moving the fixture flags its event');
select alike((select change_note from public.events where id = current_setting('ec.ev')::uuid), 'Moved from %',
  'the flag says what changed, in words');
select is((select count(*) from public.event_responses where event_id = current_setting('ec.ev')::uuid), 2::bigint,
  'the answers are kept â€” a move does not wipe the squad');
select is((select status::text from public.event_responses
            where event_id = current_setting('ec.ev')::uuid and person_id = current_setting('ec.player')::uuid),
  'accepted', 'and they still say what they said');

-- B. who hears about it ------------------------------------------------------------
select is((select count(*) from public.outbound_messages
            where person_id = current_setting('ec.parent')::uuid and channel = 'in_app'
              and subject like 'Details changed:%'), 1::bigint,
  'the guardian of a minor player is told once');
select is((select count(*) from public.outbound_messages
            where person_id = current_setting('ec.admin')::uuid and channel = 'in_app'
              and subject like 'Details changed:%'), 0::bigint,
  'the person who moved it is not told about their own change');
select alike((select body from public.outbound_messages
              where person_id = current_setting('ec.parent')::uuid and subject like 'Details changed:%'),
  '%still stands%', 'the message says the answer still stands');

-- C. staleness ---------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"e2e2e2e2-7777-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select is((select response_stale from public.event_people(current_setting('ec.ev')::uuid)
            where person_id = 'e2e2e2e2-7777-4111-8111-00000000000a'), true,
  'an answer given before the change is reported stale');
select is((select (people -> 0 ->> 'stale')::boolean from public.my_events(120)
            where event_id = current_setting('ec.ev')::uuid), true,
  'my_events carries the same flag for the people the caller answers for');
-- Answering again is the acknowledgement; there is no second state to keep.
select public.respond_to_event(current_setting('ec.ev')::uuid, 'e2e2e2e2-7777-4111-8111-00000000000a', 'accepted');
select is((select response_stale from public.event_people(current_setting('ec.ev')::uuid)
            where person_id = 'e2e2e2e2-7777-4111-8111-00000000000a'), false,
  're-answering clears the staleness');
select is((select response_stale from public.event_people(current_setting('ec.ev')::uuid)
            where person_id = current_setting('ec.player')::uuid), true,
  'the player who has not re-answered is still stale');
reset role;

-- D. the bulk shape: one statement per fixture, one message per household -----------
insert into public.fixtures (team_id, season_id, opponent, is_home, kickoff_at, venue_resource_id)
select '8a8a8a8a-7777-4111-8111-000000000001', '5a5a5a5a-7777-4111-8111-000000000001',
       'Bulk ' || k, true, now() + make_interval(days => 20 + k), '7b7b7b7b-7777-4111-8111-000000000001'
from generate_series(1, 5) k;

select set_config('ec.before', (select count(*)::text from public.outbound_messages
  where person_id = current_setting('ec.parent')::uuid and subject like 'Details changed:%'), true);

-- Exactly the allocate_team_fixtures() shape: a loop of single-row updates.
set local request.jwt.claims to '{"sub":"e2e2e2e2-7777-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
do $$
declare f record;
begin
  for f in select id from public.fixtures where opponent like 'Bulk %' order by opponent loop
    update public.fixtures set kickoff_at = kickoff_at + interval '2 hours' where id = f.id;
  end loop;
end $$;
reset role;

select is((select count(*) from public.outbound_messages
            where person_id = current_setting('ec.parent')::uuid and subject like 'Details changed:%'),
  current_setting('ec.before')::bigint,
  'five separate update statements add no new message â€” the existing one absorbs them');
select alike((select body from public.outbound_messages
              where person_id = current_setting('ec.parent')::uuid and subject like 'Details changed:%'
              order by created_at desc limit 1),
  '%6 events%', 'and it now counts every event that changed in the window');

-- E. a venue confirmed for the first time -------------------------------------------
insert into public.fixtures (id, team_id, season_id, opponent, is_home, kickoff_at)
values ('f3f3f3f3-7777-4111-8111-000000000002', '8a8a8a8a-7777-4111-8111-000000000001',
        '5a5a5a5a-7777-4111-8111-000000000001', 'Venue Later', true, now() + interval '40 days');
update public.fixtures set venue_resource_id = '7b7b7b7b-7777-4111-8111-000000000002'
 where id = 'f3f3f3f3-7777-4111-8111-000000000002';
select alike((select change_note from public.events where fixture_id = 'f3f3f3f3-7777-4111-8111-000000000002'),
  'Venue confirmed: EC Far Pitch.%', 'a venue set for the first time is a change worth telling people about');

-- F. training ------------------------------------------------------------------------
insert into public.bookings (id, resource_id, team_id, kind, status, starts_at, ends_at, booker_name, booker_email, occasion)
values ('b3b3b3b3-7777-4111-8111-000000000001', '7b7b7b7b-7777-4111-8111-000000000001',
        '8a8a8a8a-7777-4111-8111-000000000001', 'training', 'confirmed',
        now() + interval '50 days', now() + interval '50 days 1 hour', 'Ada Admin', 'ec-admin@test.invalid', 'Skills night');
update public.bookings set starts_at = now() + interval '50 days 2 hours', ends_at = now() + interval '50 days 3 hours'
 where id = 'b3b3b3b3-7777-4111-8111-000000000001';
select isnt((select details_changed_at from public.events where booking_id = 'b3b3b3b3-7777-4111-8111-000000000001'), null,
  'moving a training booking flags its event too');
select alike((select change_note from public.events where booking_id = 'b3b3b3b3-7777-4111-8111-000000000001'), 'Moved from %',
  'with the same sentence');

-- G. what is NOT a change --------------------------------------------------------------
select set_config('ec.note_before',
  (select coalesce(details_changed_at::text, '') from public.events where id = current_setting('ec.ev')::uuid), true);
update public.fixtures set home_score = 3, away_score = 1, notes = 'good game'
 where id = 'f3f3f3f3-7777-4111-8111-000000000001';
select is((select coalesce(details_changed_at::text, '') from public.events where id = current_setting('ec.ev')::uuid),
  current_setting('ec.note_before'), 'a score or a note is not "the details changed"');

select * from finish();
rollback;
