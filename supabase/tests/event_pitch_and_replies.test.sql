-- =============================================================================
-- Event pitch assignment + per-type replies (20260824500000)
-- =============================================================================
--   A  assign_event_pitch: admin-only; an unbooked practice gains a booking
--      and the link; holding a pitch refuses by name; a clash refuses
--   B  a fixture event routes through allocate_fixture (the P2.5 arbiter)
--   C  event_detail carries the venue's address
--   D  the notification asks for a reply on socials and not on matches
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(11);

insert into auth.users (id, email, raw_user_meta_data) values
  ('e4e4e4e4-cccc-4111-8111-000000000001', 'ep-admin@test.invalid',  '{"full_name": "Ada Admin", "dob": "1974-01-01"}'::jsonb),
  ('e4e4e4e4-cccc-4111-8111-000000000002', 'ep-coach@test.invalid',  '{"full_name": "Cy Coach", "dob": "1982-02-02"}'::jsonb),
  ('e4e4e4e4-cccc-4111-8111-000000000003', 'ep-parent@test.invalid', '{"full_name": "Pam Parent", "dob": "1985-03-03"}'::jsonb);
select set_config('ep.admin',  (select person_id::text from public.profiles where id = 'e4e4e4e4-cccc-4111-8111-000000000001'), true);
select set_config('ep.coach',  (select person_id::text from public.profiles where id = 'e4e4e4e4-cccc-4111-8111-000000000002'), true);
select set_config('ep.parent', (select person_id::text from public.profiles where id = 'e4e4e4e4-cccc-4111-8111-000000000003'), true);
insert into public.person_roles (person_id, role, granted_by)
  values (current_setting('ep.admin')::uuid, 'club_admin', 'e4e4e4e4-cccc-4111-8111-000000000001');

insert into public.people (id, first_name, last_name, dob)
  values ('e4e4e4e4-cccc-4111-8111-00000000000a', 'Kid', 'Player', (current_date - interval '10 years')::date);
insert into public.guardianships (guardian_person_id, child_person_id, relationship)
  values (current_setting('ep.parent')::uuid, 'e4e4e4e4-cccc-4111-8111-00000000000a', 'parent');

insert into public.seasons (id, name, starts_on, ends_on, is_current)
  values ('5d5d5d5d-cccc-4111-8111-000000000001', 'EP 2052/53', current_date - 30, current_date + 300, true);
insert into public.teams (id, name, age_group) values ('9f9f9f9f-cccc-4111-8111-000000000001', 'EP Rovers', 'U11');
insert into public.resources (id, type, name, active, address) values
  ('7d7d7d7d-cccc-4111-8111-000000000001', 'pitch', 'EP Pitch 1', true, 'Banky Lane, Sale M33 5SL'),
  ('7d7d7d7d-cccc-4111-8111-000000000002', 'pitch', 'EP Pitch 2', true, null);
insert into public.team_memberships (person_id, team_id, season_id, role) values
  (current_setting('ep.coach')::uuid, '9f9f9f9f-cccc-4111-8111-000000000001', '5d5d5d5d-cccc-4111-8111-000000000001', 'coach'),
  ('e4e4e4e4-cccc-4111-8111-00000000000a', '9f9f9f9f-cccc-4111-8111-000000000001', '5d5d5d5d-cccc-4111-8111-000000000001', 'player');

-- A. the practice ---------------------------------------------------------------
set local request.jwt.claims to '{"sub":"e4e4e4e4-cccc-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select set_config('ep.practice', public.create_team_event(
  '9f9f9f9f-cccc-4111-8111-000000000001', 'practice', 'Assign me', now() + interval '5 days', 60)::text, true);
select throws_like($$
  select public.assign_event_pitch(current_setting('ep.practice')::uuid, '7d7d7d7d-cccc-4111-8111-000000000001')
$$, '%club administrator%', 'a coach cannot assign from the event - allocation is the club''s');
reset role;

set local request.jwt.claims to '{"sub":"e4e4e4e4-cccc-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok($$
  select public.assign_event_pitch(current_setting('ep.practice')::uuid, '7d7d7d7d-cccc-4111-8111-000000000001')
$$, 'an admin assigns the pitch from the event');
select isnt((select booking_id from public.events where id = current_setting('ep.practice')::uuid), null,
  'the event now holds the booking');
select throws_like($$
  select public.assign_event_pitch(current_setting('ep.practice')::uuid, '7d7d7d7d-cccc-4111-8111-000000000002')
$$, '%already holds EP Pitch 1%', 'a held pitch refuses by name');

-- A clash on the other pitch for a second event at the same time.
select set_config('ep.practice2', public.create_team_event(
  '9f9f9f9f-cccc-4111-8111-000000000001', 'practice', 'Clash me', now() + interval '5 days', 60)::text, true);
select throws_like($$
  select public.assign_event_pitch(current_setting('ep.practice2')::uuid, '7d7d7d7d-cccc-4111-8111-000000000001')
$$, '%already booked%', 'a taken slot refuses');

-- B. the fixture ----------------------------------------------------------------
insert into public.fixtures (id, team_id, season_id, opponent, is_home, kickoff_at)
values ('f8f8f8f8-cccc-4111-8111-000000000001', '9f9f9f9f-cccc-4111-8111-000000000001',
        '5d5d5d5d-cccc-4111-8111-000000000001', 'Foe FC', true, now() + interval '9 days');
select lives_ok($$
  select public.assign_event_pitch(
    (select id from public.events where fixture_id = 'f8f8f8f8-cccc-4111-8111-000000000001'),
    '7d7d7d7d-cccc-4111-8111-000000000001')
$$, 'a fixture event assigns through allocate_fixture');
select is((select count(*) from public.bookings
            where fixture_id = 'f8f8f8f8-cccc-4111-8111-000000000001' and status = 'confirmed'), 1::bigint,
  'and the fixture holds a confirmed booking');

-- C. the address -----------------------------------------------------------------
select is((select public.event_detail(current_setting('ep.practice')::uuid) ->> 'venue_address'),
  'Banky Lane, Sale M33 5SL', 'event_detail carries the venue''s address');
select is((select public.event_detail(current_setting('ep.practice2')::uuid) ->> 'venue_address'), null,
  'no address recorded, no address returned');
reset role;

-- D. the call to action -------------------------------------------------------------
set local request.jwt.claims to '{"sub":"e4e4e4e4-cccc-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select lives_ok($$
  select public.create_team_event('9f9f9f9f-cccc-4111-8111-000000000001', 'social', 'Family social',
    now() + interval '12 days', 120, null, 'The clubhouse')
$$, 'a social is created');
reset role;
select is((select count(*) from public.outbound_messages
            where person_id = current_setting('ep.parent')::uuid and channel = 'in_app'
              and subject = 'New event: Family social' and body like '%accept or decline%'), 1::bigint,
  'a social asks the parent for a reply - matches and training do not');

select * from finish();
rollback;
