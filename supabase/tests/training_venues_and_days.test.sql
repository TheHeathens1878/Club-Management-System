-- =============================================================================
-- Training venues, training days, and a slot that can be cloned (20260913110000)
-- =============================================================================
--   A  a venue says what it is for: matches by default, training once a slot
--      names it; a slot at a venue takes the venue's name and address, and
--      follows a rename
--   B  a team has a default training day, 0–6 and nothing else
--   C  clone: same venue, division and teams on another day or hour; the
--      same day and hour is refused; only a planner may
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(16);

insert into auth.users (id, email, raw_user_meta_data) values
  ('a2a2a2a2-0913-4111-8111-000000000001', 'tv-admin@test.invalid', '{"full_name": "Wendy Admin", "dob": "1975-01-01"}'::jsonb),
  ('a2a2a2a2-0913-4111-8111-000000000002', 'tv-coach@test.invalid', '{"full_name": "Colin Coach", "dob": "1980-01-01"}'::jsonb);
select set_config('tv.admin', (select person_id::text from public.profiles where id = 'a2a2a2a2-0913-4111-8111-000000000001'), true);
insert into public.person_roles (person_id, role, granted_by)
  values (current_setting('tv.admin')::uuid, 'club_admin', 'a2a2a2a2-0913-4111-8111-000000000001');

insert into public.teams (id, name, age_group) values
  ('7f7f7f7f-0913-4111-8111-000000000001', 'TV Alpha', 'U10'),
  ('7f7f7f7f-0913-4111-8111-000000000002', 'TV Beta',  'U12');
insert into public.training_blocks (id, name, starts_on, ends_on, created_by) values
  ('b20cb20c-0913-4111-8111-000000000001', 'TV Winter', current_date + 7, current_date + 62, 'a2a2a2a2-0913-4111-8111-000000000001');


-- A. venues and the slots at them ---------------------------------------------
insert into public.venues (id, name, address) values
  ('e1e1e1e1-0913-4111-8111-000000000001', 'TV Grammar 3G', '1 School Lane');
select is((select (for_matches, for_training) from public.venues where id = 'e1e1e1e1-0913-4111-8111-000000000001'),
  (true, false), 'a venue is for matches by default and not yet for training');

insert into public.training_slots (id, block_id, venue_id, weekday, start_time, end_time, parts) values
  ('510d0000-0913-4111-8111-000000000001', 'b20cb20c-0913-4111-8111-000000000001',
   'e1e1e1e1-0913-4111-8111-000000000001', 2, '18:00', '19:00', 3);
select is((select (venue_name, venue_address) from public.training_slots where id = '510d0000-0913-4111-8111-000000000001'),
  ('TV Grammar 3G'::text, '1 School Lane'::text), 'a slot at a venue takes its name and address');
select is((select for_training from public.venues where id = 'e1e1e1e1-0913-4111-8111-000000000001'),
  true, 'and the venue is now a training venue');

update public.venues set name = 'TV Grammar School 3G' where id = 'e1e1e1e1-0913-4111-8111-000000000001';
select is((select venue_name from public.training_slots where id = '510d0000-0913-4111-8111-000000000001'),
  'TV Grammar School 3G', 'renaming the venue renames it on the slot');

insert into public.training_slots (id, block_id, venue_id, venue_address, weekday, start_time, end_time, parts) values
  ('510d0000-0913-4111-8111-000000000002', 'b20cb20c-0913-4111-8111-000000000001',
   'e1e1e1e1-0913-4111-8111-000000000001', 'Side gate, Park Road', 2, '19:00', '20:00', 1);
select is((select venue_address from public.training_slots where id = '510d0000-0913-4111-8111-000000000002'),
  'Side gate, Park Road', 'a slot may still carry its own address, and then the slot wins');

select throws_ok($$
  insert into public.training_slots (block_id, venue_id, weekday, start_time, end_time)
  values ('b20cb20c-0913-4111-8111-000000000001', 'e1e1e1e1-0913-4111-8111-00000000dead', 1, '18:00', '19:00')
$, 'P0001', 'training_slots: that venue does not exist', 'a slot cannot be at a venue that does not exist');


-- B. the training day ---------------------------------------------------------
update public.teams set default_training_day = 2 where id = '7f7f7f7f-0913-4111-8111-000000000001';
select is((select default_training_day from public.teams where id = '7f7f7f7f-0913-4111-8111-000000000001'),
  2::smallint, 'a team trains on a Tuesday');
select throws_ok($$
  update public.teams set default_training_day = 7 where id = '7f7f7f7f-0913-4111-8111-000000000001'
$$, '23514', null, 'there is no eighth day');


-- C. clone --------------------------------------------------------------------
insert into public.training_allocations (slot_id, team_id, shares) values
  ('510d0000-0913-4111-8111-000000000001', '7f7f7f7f-0913-4111-8111-000000000001', 2),
  ('510d0000-0913-4111-8111-000000000001', '7f7f7f7f-0913-4111-8111-000000000002', 1);

set local request.jwt.claims to '{"sub":"a2a2a2a2-0913-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;

select set_config('tv.clone',
  public.clone_training_slot('510d0000-0913-4111-8111-000000000001', 4, '18:30', '19:30', true)::text, true);
select is((select (weekday, start_time::text, end_time::text, parts, venue_id) from public.training_slots
            where id = current_setting('tv.clone')::uuid),
  (4::smallint, '18:30:00'::text, '19:30:00'::text, 3::smallint, 'e1e1e1e1-0913-4111-8111-000000000001'::uuid),
  'the clone is the same venue and division on Thursday at half past');
select is((select array_agg(team_id::text || ':' || shares order by team_id) from public.training_allocations
            where slot_id = current_setting('tv.clone')::uuid),
  array['7f7f7f7f-0913-4111-8111-000000000001:2', '7f7f7f7f-0913-4111-8111-000000000002:1'],
  'with the same teams holding the same shares');

select set_config('tv.clone2',
  public.clone_training_slot('510d0000-0913-4111-8111-000000000001', 2, '20:00', '21:00', false)::text, true);
select is((select count(*) from public.training_allocations where slot_id = current_setting('tv.clone2')::uuid),
  0::bigint, 'or empty, when the teams are not wanted');

select throws_ok($$
  select public.clone_training_slot('510d0000-0913-4111-8111-000000000001', 2, '18:00', '19:00', true)
$$, 'P0001', 'That is the same day and time as the slot being cloned — change one of them.',
  'the same day and hour is not a clone');
select throws_ok($$
  select public.clone_training_slot('510d0000-0913-4111-8111-000000000001', 5, '19:00', '18:00', true)
$$, 'P0001', 'The slot must end after it starts.', 'nor is one that ends before it starts');
select throws_ok($$
  select public.clone_training_slot('510d0000-0913-4111-8111-00000000dead', 5, '18:00', '19:00', true)
$$, 'P0001', 'training_slots: no such slot', 'a slot that does not exist cannot be cloned');

reset role;

-- The coach is not a planner: the policies refuse the insert the clone makes.
set local request.jwt.claims to '{"sub":"a2a2a2a2-0913-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_ok($$
  select public.clone_training_slot('510d0000-0913-4111-8111-000000000001', 6, '10:00', '11:00', true)
$$, '42501', null, 'only a planner may clone a slot');
reset role;

select is((select count(*) from public.training_slots where block_id = 'b20cb20c-0913-4111-8111-000000000001'),
  4::bigint, 'two slots planned, two cloned, nothing else');

select * from finish();
rollback;
