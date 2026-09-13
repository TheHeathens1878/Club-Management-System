-- =============================================================================
-- A training slot puts the coaches in the venue group (20260913120000)
-- =============================================================================
--   A  a team placed in a slot at a venue: its coach is in the venue's group
--      the moment the allocation exists, and the group was created on demand
--   B  the team taken out again: the coach has left (left_at, not deleted)
--   C  a slot moved to another venue takes the coach with it; a block that has
--      ended counts for nothing
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(9);

insert into auth.users (id, email, raw_user_meta_data) values
  ('a3a3a3a3-0913-4111-8111-000000000001', 'tg-admin@test.invalid', '{"full_name": "Wendy Admin", "dob": "1975-01-01"}'::jsonb),
  ('a3a3a3a3-0913-4111-8111-000000000002', 'tg-coach@test.invalid', '{"full_name": "Colin Coach", "dob": "1980-01-01"}'::jsonb);
select set_config('tg.admin', (select person_id::text from public.profiles where id = 'a3a3a3a3-0913-4111-8111-000000000001'), true);
select set_config('tg.coach', (select person_id::text from public.profiles where id = 'a3a3a3a3-0913-4111-8111-000000000002'), true);
insert into public.person_roles (person_id, role, granted_by)
  values (current_setting('tg.admin')::uuid, 'club_admin', 'a3a3a3a3-0913-4111-8111-000000000001');

insert into public.seasons (id, name, starts_on, ends_on, is_current)
  values ('5f5f5f5f-0913-4111-8111-000000000001', 'TG 2059/60', current_date - 60, current_date + 300, true);
insert into public.teams (id, name, age_group) values
  ('7a7a7a7a-0913-4111-8111-000000000001', 'TG Alpha', 'U10');
insert into public.team_memberships (person_id, team_id, season_id, role) values
  (current_setting('tg.coach')::uuid, '7a7a7a7a-0913-4111-8111-000000000001', '5f5f5f5f-0913-4111-8111-000000000001', 'coach');

insert into public.venues (id, name, for_matches, for_training) values
  ('e2e2e2e2-0913-4111-8111-000000000001', 'TG Grammar 3G', false, true),
  ('e2e2e2e2-0913-4111-8111-000000000002', 'TG Academy Dome', false, true);
insert into public.training_blocks (id, name, starts_on, ends_on, created_by) values
  ('b30cb30c-0913-4111-8111-000000000001', 'TG Winter', current_date + 7, current_date + 62, 'a3a3a3a3-0913-4111-8111-000000000001'),
  ('b30cb30c-0913-4111-8111-000000000002', 'TG Last winter', current_date - 200, current_date - 100, 'a3a3a3a3-0913-4111-8111-000000000001');
insert into public.training_slots (id, block_id, venue_id, weekday, start_time, end_time, parts) values
  ('520e0000-0913-4111-8111-000000000001', 'b30cb30c-0913-4111-8111-000000000001', 'e2e2e2e2-0913-4111-8111-000000000001', 2, '18:00', '19:00', 1),
  ('520e0000-0913-4111-8111-000000000002', 'b30cb30c-0913-4111-8111-000000000002', 'e2e2e2e2-0913-4111-8111-000000000002', 2, '18:00', '19:00', 1);

-- Nobody trains anywhere yet.
select is((select count(*) from public.venues_for_team('7a7a7a7a-0913-4111-8111-000000000001')),
  0::bigint, 'a team with no slot trains nowhere');


-- A. placed ---------------------------------------------------------------------
insert into public.training_allocations (id, slot_id, team_id, shares) values
  ('a10c0000-0913-4111-8111-000000000001', '520e0000-0913-4111-8111-000000000001', '7a7a7a7a-0913-4111-8111-000000000001', 1);

select is((select array_agg(venue_id) from public.venues_for_team('7a7a7a7a-0913-4111-8111-000000000001') v(venue_id)),
  array['e2e2e2e2-0913-4111-8111-000000000001'::uuid], 'the team now trains at the 3G');
select set_config('tg.group', coalesce(public.venue_coaches_group_id('e2e2e2e2-0913-4111-8111-000000000001')::text, ''), true);
select isnt(current_setting('tg.group', true), '', 'the venue has a coaches group, created on demand');
select is((select count(*) from public.conversation_participants
            where conversation_id = current_setting('tg.group')::uuid
              and person_id = current_setting('tg.coach')::uuid and left_at is null),
  1::bigint, 'and the coach is in it the moment the team is placed');


-- B. taken out -------------------------------------------------------------------
delete from public.training_allocations where id = 'a10c0000-0913-4111-8111-000000000001';
select is((select count(*) from public.conversation_participants
            where conversation_id = current_setting('tg.group')::uuid
              and person_id = current_setting('tg.coach')::uuid and left_at is null),
  0::bigint, 'the coach leaves the room when the team is taken out');
select is((select count(*) from public.conversation_participants
            where conversation_id = current_setting('tg.group')::uuid
              and person_id = current_setting('tg.coach')::uuid),
  1::bigint, 'left, not deleted — the row and the history stay');


-- C. moved, and long ago -----------------------------------------------------------
insert into public.training_allocations (id, slot_id, team_id, shares) values
  ('a10c0000-0913-4111-8111-000000000002', '520e0000-0913-4111-8111-000000000001', '7a7a7a7a-0913-4111-8111-000000000001', 1);
update public.training_slots set venue_id = 'e2e2e2e2-0913-4111-8111-000000000002'
 where id = '520e0000-0913-4111-8111-000000000001';
select is((select count(*) from public.conversation_participants
            where conversation_id = current_setting('tg.group')::uuid
              and person_id = current_setting('tg.coach')::uuid and left_at is null),
  0::bigint, 'the slot moved to the Dome: the coach has left the 3G group');
select is((select count(*) from public.conversation_participants
            where conversation_id = public.venue_coaches_group_id('e2e2e2e2-0913-4111-8111-000000000002')
              and person_id = current_setting('tg.coach')::uuid and left_at is null),
  1::bigint, 'and is in the Dome group');

-- Last winter's block is over: a place in it counts for nothing.
delete from public.training_allocations where id = 'a10c0000-0913-4111-8111-000000000002';
insert into public.training_allocations (slot_id, team_id, shares) values
  ('520e0000-0913-4111-8111-000000000002', '7a7a7a7a-0913-4111-8111-000000000001', 1);
select is((select count(*) from public.venues_for_team('7a7a7a7a-0913-4111-8111-000000000001')),
  0::bigint, 'a slot in a block that has ended does not make the team train there');

select * from finish();
rollback;
