-- =============================================================================
-- Team match-day defaults (20260824200000)
-- =============================================================================
--   A  columns + guards: home pitch must be a pitch; staff may edit the
--      match-day block (staff guard already allows non-restricted columns)
--   B  team_match_duration(); new fixtures inherit the team duration, an
--      explicit duration and existing fixtures are untouched
--   C  allocate_fixture(): buffer chain argument → team → pitch
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(16);

insert into auth.users (id, email, raw_user_meta_data) values
  ('a2a2a2a2-1111-4111-8111-000000000001', 'md-admin@test.invalid', '{"full_name": "Ada Admin"}'::jsonb);
update public.profiles set role = 'committee' where id = 'a2a2a2a2-1111-4111-8111-000000000001';

insert into public.seasons (id, name, starts_on, ends_on, is_current) values ('6a6a6a6a-1111-4111-8111-000000000001', 'MD 2034/35', '2034-08-01', '2035-05-31', true);
insert into public.teams (id, name, age_group) values ('8a8a8a8a-1111-4111-8111-000000000001', 'MD U14s', 'U14');
insert into public.resources (id, type, name, default_pre_buffer_minutes, default_post_buffer_minutes) values
  ('b2b2b2b2-1111-4111-8111-000000000041', 'pitch', 'MD Park – Pitch 1', 15, 15),
  ('b2b2b2b2-1111-4111-8111-000000000043', 'function_room', 'MD Room', 0, 0);

-- A. columns + guard
select has_column('public', 'teams', 'home_resource_id', 'teams.home_resource_id');
select has_column('public', 'teams', 'half_length_minutes', 'teams.half_length_minutes');
select throws_ok($$
  update public.teams set home_resource_id = 'b2b2b2b2-1111-4111-8111-000000000043' where id = '8a8a8a8a-1111-4111-8111-000000000001'
$$, 'P0001', null, 'a function room cannot be a home pitch');
update public.teams
   set home_resource_id = 'b2b2b2b2-1111-4111-8111-000000000041',
       match_halves = 2, half_length_minutes = 35, half_time_minutes = 10,
       default_pre_buffer_minutes = 20, default_post_buffer_minutes = 5
 where id = '8a8a8a8a-1111-4111-8111-000000000001';

-- B. duration
select is(public.team_match_duration('8a8a8a8a-1111-4111-8111-000000000001'), 80, '2×35 + 10 = 80 minutes');

insert into public.fixtures (id, team_id, season_id, opponent, is_home, kickoff_at, source, external_ref)
values ('c2c2c2c2-1111-4111-8111-000000000001', '8a8a8a8a-1111-4111-8111-000000000001', '6a6a6a6a-1111-4111-8111-000000000001',
        'Rovers', true, '2034-09-09 10:30+01', 'fulltime', 'md-1');
select is((select duration_minutes from public.fixtures where id = 'c2c2c2c2-1111-4111-8111-000000000001'), 80,
  'a new fixture inherits the team match duration');

insert into public.fixtures (id, team_id, season_id, opponent, is_home, kickoff_at, source, external_ref, duration_minutes)
values ('c2c2c2c2-1111-4111-8111-000000000002', '8a8a8a8a-1111-4111-8111-000000000001', '6a6a6a6a-1111-4111-8111-000000000001',
        'City', true, '2034-09-16 10:30+01', 'fulltime', 'md-2', 120);
select is((select duration_minutes from public.fixtures where id = 'c2c2c2c2-1111-4111-8111-000000000002'), 120,
  'an explicit duration wins');

update public.teams set half_length_minutes = null where id = '8a8a8a8a-1111-4111-8111-000000000001';
insert into public.fixtures (id, team_id, season_id, opponent, is_home, kickoff_at, source, external_ref)
values ('c2c2c2c2-1111-4111-8111-000000000003', '8a8a8a8a-1111-4111-8111-000000000001', '6a6a6a6a-1111-4111-8111-000000000001',
        'Town', true, '2034-09-23 10:30+01', 'fulltime', 'md-3');
select is((select duration_minutes from public.fixtures where id = 'c2c2c2c2-1111-4111-8111-000000000003'), 90,
  'no team setting → the 90-minute default stands');
select is(public.team_match_duration('8a8a8a8a-1111-4111-8111-000000000001'), null, 'duration is null while unset');
update public.teams set half_length_minutes = 35 where id = '8a8a8a8a-1111-4111-8111-000000000001';

-- C. allocation buffer chain
select set_config('md.b1', public.allocate_fixture('c2c2c2c2-1111-4111-8111-000000000001', 'b2b2b2b2-1111-4111-8111-000000000041')::text, true);
select is((select (pre_buffer_minutes, post_buffer_minutes) from public.bookings where id = current_setting('md.b1')::uuid),
  (20, 5), 'team buffers beat the pitch defaults');
select is((select (ends_at - starts_at) from public.bookings where id = current_setting('md.b1')::uuid),
  interval '80 minutes', 'the pitch slot is the team match duration');

update public.teams set default_pre_buffer_minutes = null, default_post_buffer_minutes = null
 where id = '8a8a8a8a-1111-4111-8111-000000000001';
select set_config('md.b3', public.allocate_fixture('c2c2c2c2-1111-4111-8111-000000000003', 'b2b2b2b2-1111-4111-8111-000000000041')::text, true);
select is((select (pre_buffer_minutes, post_buffer_minutes) from public.bookings where id = current_setting('md.b3')::uuid),
  (15, 15), 'without team buffers the pitch defaults apply');

select set_config('md.b2', public.allocate_fixture('c2c2c2c2-1111-4111-8111-000000000002', 'b2b2b2b2-1111-4111-8111-000000000041', 0, 0)::text, true);
select is((select (pre_buffer_minutes, post_buffer_minutes) from public.bookings where id = current_setting('md.b2')::uuid),
  (0, 0), 'an explicit argument beats both');

-- D. settings changes re-default untouched future fixtures (20260824210000)
insert into public.fixtures (id, team_id, season_id, opponent, is_home, kickoff_at, source, external_ref)
values ('c2c2c2c2-1111-4111-8111-000000000004', '8a8a8a8a-1111-4111-8111-000000000001', '6a6a6a6a-1111-4111-8111-000000000001',
        'United', true, '2034-10-07 10:30+01', 'fulltime', 'md-4');
-- md-4 inherited 80 (2×35+10). Change to 2×30+10 = 70:
update public.teams set half_length_minutes = 30 where id = '8a8a8a8a-1111-4111-8111-000000000001';
select is((select duration_minutes from public.fixtures where id = 'c2c2c2c2-1111-4111-8111-000000000004'), 70,
  'an untouched future fixture follows the new settings');
select is((select duration_minutes from public.fixtures where id = 'c2c2c2c2-1111-4111-8111-000000000002'), 120,
  'a hand-sized fixture is left alone');
select is((select duration_minutes from public.fixtures where id = 'c2c2c2c2-1111-4111-8111-000000000001'), 80,
  'an allocated fixture is left alone');
-- clearing the settings returns untouched fixtures to 90
update public.teams set half_length_minutes = null where id = '8a8a8a8a-1111-4111-8111-000000000001';
select is((select duration_minutes from public.fixtures where id = 'c2c2c2c2-1111-4111-8111-000000000004'), 90,
  'clearing the settings restores the 90 default');

select * from finish();
rollback;
