-- =============================================================================
-- Match lineups — fixture_lineups, fixture_lineup_slots
-- =============================================================================
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(32);

insert into auth.users (id, email, raw_user_meta_data) values
  ('a9a9a9a9-1111-4111-8111-000000000001', 'l-admin@test.invalid',  '{"full_name": "Ada Admin"}'::jsonb),
  ('a9a9a9a9-1111-4111-8111-000000000002', 'l-coach@test.invalid',  '{"full_name": "Cy Coach"}'::jsonb),
  ('a9a9a9a9-1111-4111-8111-000000000003', 'l-player@test.invalid', '{"full_name": "Pam Player"}'::jsonb),
  ('a9a9a9a9-1111-4111-8111-000000000004', 'l-parent@test.invalid', '{"full_name": "Pat Parent"}'::jsonb),
  ('a9a9a9a9-1111-4111-8111-000000000005', 'l-other@test.invalid',  '{"full_name": "Ollie Other"}'::jsonb);
update public.profiles set role = 'committee' where id = 'a9a9a9a9-1111-4111-8111-000000000001';
select set_config('l.admin',  (select person_id::text from public.profiles where id = 'a9a9a9a9-1111-4111-8111-000000000001'), true);
select set_config('l.coach',  (select person_id::text from public.profiles where id = 'a9a9a9a9-1111-4111-8111-000000000002'), true);
select set_config('l.player', (select person_id::text from public.profiles where id = 'a9a9a9a9-1111-4111-8111-000000000003'), true);
select set_config('l.parent', (select person_id::text from public.profiles where id = 'a9a9a9a9-1111-4111-8111-000000000004'), true);
select set_config('l.other',  (select person_id::text from public.profiles where id = 'a9a9a9a9-1111-4111-8111-000000000005'), true);
update public.people set dob = '1988-08-08'
 where id in (current_setting('l.admin')::uuid, current_setting('l.coach')::uuid, current_setting('l.player')::uuid,
              current_setting('l.parent')::uuid, current_setting('l.other')::uuid);
insert into public.people (id, first_name, last_name, dob) values
  ('c9c9c9c9-1111-4111-8111-000000000001', 'Kid', 'Keeper', current_date - interval '12 years');
insert into public.guardianships (guardian_person_id, child_person_id, relationship)
  values (current_setting('l.parent')::uuid, 'c9c9c9c9-1111-4111-8111-000000000001', 'parent');
insert into public.certifications (person_id, type, expires_on, verified_at) values
  (current_setting('l.coach')::uuid, 'fa_dbs', current_date + 300, now()),
  (current_setting('l.coach')::uuid, 'safeguarding_children', current_date + 300, now());

insert into public.seasons (id, name, starts_on, ends_on)
  values ('5b5b5b5b-1111-4111-8111-000000000001', 'Line 2033/34', '2033-08-01', '2034-05-31');
insert into public.teams (id, name, age_group) values
  ('7b7b7b7b-1111-4111-8111-000000000001', 'Line U13s',  'U13'),
  ('7b7b7b7b-1111-4111-8111-000000000002', 'Line Other', 'U13');
insert into public.team_memberships (person_id, team_id, season_id, role) values
  (current_setting('l.coach')::uuid,  '7b7b7b7b-1111-4111-8111-000000000001', '5b5b5b5b-1111-4111-8111-000000000001', 'coach'),
  (current_setting('l.player')::uuid, '7b7b7b7b-1111-4111-8111-000000000001', '5b5b5b5b-1111-4111-8111-000000000001', 'player'),
  ('c9c9c9c9-1111-4111-8111-000000000001', '7b7b7b7b-1111-4111-8111-000000000001', '5b5b5b5b-1111-4111-8111-000000000001', 'player'),
  (current_setting('l.other')::uuid,  '7b7b7b7b-1111-4111-8111-000000000002', '5b5b5b5b-1111-4111-8111-000000000001', 'player');

insert into public.fixtures (id, team_id, season_id, opponent, is_home, kickoff_at) values
  ('f9f9f9f9-1111-4111-8111-000000000001', '7b7b7b7b-1111-4111-8111-000000000001', '5b5b5b5b-1111-4111-8111-000000000001',
   'Angel FC', true, '2033-09-10 10:30+01'),
  ('f9f9f9f9-1111-4111-8111-000000000002', '7b7b7b7b-1111-4111-8111-000000000001', '5b5b5b5b-1111-4111-8111-000000000001',
   'Bramhall FC', false, '2033-09-17 10:30+01');

-- A. shape
select has_table('public', 'fixture_lineups', 'fixture_lineups');
select has_table('public', 'fixture_lineup_slots', 'fixture_lineup_slots');
select ok((select bool_and(relrowsecurity) from pg_class where oid in
  ('public.fixture_lineups'::regclass, 'public.fixture_lineup_slots'::regclass)), 'RLS on both');
select ok(not has_table_privilege('anon', 'public.fixture_lineups', 'SELECT'), 'anon cannot read lineups');
select ok(not has_table_privilege('anon', 'public.fixture_lineup_slots', 'SELECT'), 'anon cannot read slots');

-- B. constraints and the guard (owner rights; RLS comes in D)
select lives_ok(
  $$insert into public.fixture_lineups (id, fixture_id, formation)
    values ('11111111-1111-4111-8111-000000000001', 'f9f9f9f9-1111-4111-8111-000000000001', '4-4-2')$$,
  'a lineup is created for a fixture');
select throws_ok(
  $$insert into public.fixture_lineups (fixture_id, formation)
    values ('f9f9f9f9-1111-4111-8111-000000000001', '4-4-2')$$,
  '23505', null, 'one lineup per fixture');
select throws_ok(
  $$insert into public.fixture_lineups (fixture_id, formation)
    values ('f9f9f9f9-1111-4111-8111-000000000002', 'four-four-two')$$,
  '23514', null, 'a formation reads as numbers with dashes');
select lives_ok(
  $$update public.fixture_lineups set formation = '3-3-2' where id = '11111111-1111-4111-8111-000000000001'$$,
  'the formation can be changed');

select lives_ok(
  $$insert into public.fixture_lineup_slots (lineup_id, slot, person_id)
    values ('11111111-1111-4111-8111-000000000001', 'GK', 'c9c9c9c9-1111-4111-8111-000000000001')$$,
  'a live player is placed in a slot');
select throws_ok(
  $$insert into public.fixture_lineup_slots (lineup_id, slot, person_id)
    values ('11111111-1111-4111-8111-000000000001', 'GK', current_setting('l.player')::uuid)$$,
  '23505', null, 'one player per slot');
select throws_ok(
  $$insert into public.fixture_lineup_slots (lineup_id, slot, person_id)
    values ('11111111-1111-4111-8111-000000000001', 'CB', 'c9c9c9c9-1111-4111-8111-000000000001')$$,
  '23505', null, 'nobody plays two positions at once');
select throws_ok(
  $$insert into public.fixture_lineup_slots (lineup_id, slot, person_id)
    values ('11111111-1111-4111-8111-000000000001', 'ST1', current_setting('l.other')::uuid)$$,
  'P0001', null, 'a player from another team cannot be placed');
select throws_ok(
  $$insert into public.fixture_lineup_slots (lineup_id, slot, person_id)
    values ('11111111-1111-4111-8111-000000000001', 'LM', current_setting('l.coach')::uuid)$$,
  'P0001', null, 'a coach is not a player and cannot be placed');
select lives_ok(
  $$insert into public.fixture_lineup_slots (lineup_id, slot, person_id)
    values ('11111111-1111-4111-8111-000000000001', 'ST1', current_setting('l.player')::uuid)$$,
  'a second player is placed');
select is((select count(*) from public.fixture_lineup_slots where lineup_id = '11111111-1111-4111-8111-000000000001'),
  2::bigint, 'two slots filled');

-- C. helper
select is(public.lineup_team_id('11111111-1111-4111-8111-000000000001'),
  '7b7b7b7b-1111-4111-8111-000000000001'::uuid, 'lineup_team_id finds the fixture''s team');

-- D. RLS
-- coach: writes the lineup and its slots for their own team
set local request.jwt.claims to '{"sub":"a9a9a9a9-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$update public.fixture_lineups set formation = '3-2-3' where fixture_id = 'f9f9f9f9-1111-4111-8111-000000000001'$$,
  'coach changes the formation');
select lives_ok(
  $$insert into public.fixture_lineup_slots (lineup_id, slot, person_id)
    values ('11111111-1111-4111-8111-000000000001', 'CM', current_setting('l.player')::uuid)
    on conflict (lineup_id, person_id) do update set slot = excluded.slot$$,
  'coach moves a player to another slot');
select lives_ok(
  $$insert into public.fixture_lineups (fixture_id, formation)
    values ('f9f9f9f9-1111-4111-8111-000000000002', '2-4-2')$$,
  'coach starts a lineup on their other fixture');
reset role;
select is((select placed_by from public.fixture_lineup_slots
            where lineup_id = '11111111-1111-4111-8111-000000000001' and slot = 'CM'),
  'a9a9a9a9-1111-4111-8111-000000000002'::uuid, 'placed_by is stamped from the caller');

-- player: reads the team's lineup, writes nothing
set local request.jwt.claims to '{"sub":"a9a9a9a9-1111-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.fixture_lineups), 2::bigint, 'player reads the team''s lineups');
select is((select count(*) from public.fixture_lineup_slots), 2::bigint, 'player reads the placements');
-- A write policy the caller fails is silence, not an error, on UPDATE: the row
-- is simply not visible to write, so nothing changes.
select lives_ok(
  $$update public.fixture_lineups set formation = '4-4-2' where fixture_id = 'f9f9f9f9-1111-4111-8111-000000000001'$$,
  'a player''s update runs');
select is((select formation from public.fixture_lineups where fixture_id = 'f9f9f9f9-1111-4111-8111-000000000001'),
  '3-2-3', 'but changes nothing — the formation is the coach''s');
select throws_ok(
  $$insert into public.fixture_lineup_slots (lineup_id, slot, person_id)
    values ('11111111-1111-4111-8111-000000000001', 'RB', current_setting('l.player')::uuid)$$,
  '42501', null, 'player cannot place themselves');
reset role;

-- parent of a squad minor: reads
set local request.jwt.claims to '{"sub":"a9a9a9a9-1111-4111-8111-000000000004","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.fixture_lineup_slots), 2::bigint, 'guardian sees where their child stands');
reset role;

-- outsider (a player of another team): sees nothing
set local request.jwt.claims to '{"sub":"a9a9a9a9-1111-4111-8111-000000000005","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.fixture_lineups), 0::bigint, 'another team''s player sees no lineup');
select is((select count(*) from public.fixture_lineup_slots), 0::bigint, 'another team''s player sees no placements');
reset role;

-- club_admin: writes anywhere
set local request.jwt.claims to '{"sub":"a9a9a9a9-1111-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$delete from public.fixture_lineup_slots
     where lineup_id = '11111111-1111-4111-8111-000000000001' and slot = 'GK'$$,
  'club_admin unplaces a player');
reset role;

-- E. the fixture owns the lineup
delete from public.fixtures where id = 'f9f9f9f9-1111-4111-8111-000000000001';
select is((select count(*) from public.fixture_lineups where fixture_id = 'f9f9f9f9-1111-4111-8111-000000000001'),
  0::bigint, 'deleting a fixture takes its lineup with it');
select is((select count(*) from public.fixture_lineup_slots where lineup_id = '11111111-1111-4111-8111-000000000001'),
  0::bigint, 'and its placements');

select * from finish();

rollback;
