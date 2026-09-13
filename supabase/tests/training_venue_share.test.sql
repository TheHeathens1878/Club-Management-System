-- =============================================================================
-- The club's share of a training venue (20260913130000)
-- =============================================================================
--   A  a venue says how its pitch is divided and how much is ours; more ours
--      than there are parts is refused
--   B  a slot in quarters of which the club has two is full at two, and a
--      team cannot hold three of it; the club's share cannot shrink under the
--      teams already in it
--   C  a clone carries the club's share
--   D  a slot lists its venue on the block; a venue with slots stays on it
--   E  bookings are noted against a venue for a season, with their weekly slots;
--      planners write, coaches read
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(21);

insert into public.teams (id, name, age_group) values
  ('7b7b7b7b-0913-4111-8111-000000000001', 'TS Alpha', 'U10'),
  ('7b7b7b7b-0913-4111-8111-000000000002', 'TS Beta',  'U12'),
  ('7b7b7b7b-0913-4111-8111-000000000003', 'TS Gamma', 'U14');
insert into public.training_blocks (id, name, starts_on, ends_on) values
  ('b40cb40c-0913-4111-8111-000000000001', 'TS Winter', current_date + 7, current_date + 62);


-- A. the venue's share -------------------------------------------------------------
insert into public.venues (id, name, for_matches, for_training, training_parts, training_shares, training_notes) values
  ('e4e4e4e4-0913-4111-8111-000000000001', 'TS Loreto 3G', false, true, 2, 1, 'The far half, by the changing rooms.');
select is((select (training_parts, training_shares) from public.venues where id = 'e4e4e4e4-0913-4111-8111-000000000001'),
  (2::smallint, 1::smallint), 'the club has half of Loreto');
select throws_ok($$
  update public.venues set training_shares = 3 where id = 'e4e4e4e4-0913-4111-8111-000000000001'
$$, '23514', null, 'the club cannot have three halves');


-- B. the slot's share --------------------------------------------------------------
insert into public.training_slots (id, block_id, venue_id, weekday, start_time, end_time, parts, club_parts) values
  ('530f0000-0913-4111-8111-000000000001', 'b40cb40c-0913-4111-8111-000000000001',
   'e4e4e4e4-0913-4111-8111-000000000001', 2, '18:00', '19:00', 4, 2);
select throws_ok($$
  insert into public.training_slots (block_id, venue_id, weekday, start_time, end_time, parts, club_parts)
  values ('b40cb40c-0913-4111-8111-000000000001', 'e4e4e4e4-0913-4111-8111-000000000001', 3, '18:00', '19:00', 4, 5)
$$, '23514', null, 'the club cannot have five quarters');

insert into public.training_allocations (slot_id, team_id, shares) values
  ('530f0000-0913-4111-8111-000000000001', '7b7b7b7b-0913-4111-8111-000000000001', 1);
insert into public.training_allocations (slot_id, team_id, shares) values
  ('530f0000-0913-4111-8111-000000000001', '7b7b7b7b-0913-4111-8111-000000000002', 1);
select throws_ok($$
  insert into public.training_allocations (slot_id, team_id, shares)
  values ('530f0000-0913-4111-8111-000000000001', '7b7b7b7b-0913-4111-8111-000000000003', 1)
$$, 'P0001', 'That slot is full — the teams in it already hold 2 of the 2 parts the club has, and this team would take 1.',
  'two quarters ours, two quarters given out — the third team is refused');
delete from public.training_allocations where team_id = '7b7b7b7b-0913-4111-8111-000000000002';
select throws_ok($$
  insert into public.training_allocations (slot_id, team_id, shares)
  values ('530f0000-0913-4111-8111-000000000001', '7b7b7b7b-0913-4111-8111-000000000003', 3)
$$, 'P0001', 'The club has 2 of 4 parts of that slot — a team cannot hold 3 of it.',
  'a team cannot hold more than the club has');
select lives_ok($$
  insert into public.training_allocations (slot_id, team_id, shares)
  values ('530f0000-0913-4111-8111-000000000001', '7b7b7b7b-0913-4111-8111-000000000003', 1)
$$, 'the second of our two quarters is still there to give');
select throws_ok($$
  update public.training_slots set club_parts = 1 where id = '530f0000-0913-4111-8111-000000000001'
$$, 'P0001', 'The teams in this slot already hold 2 parts between them — take a team out before the club''s share drops to 1.',
  'the club''s share cannot shrink under the teams in the slot');
update public.training_slots set club_parts = null where id = '530f0000-0913-4111-8111-000000000001';
select lives_ok($$
  insert into public.training_allocations (slot_id, team_id, shares)
  values ('530f0000-0913-4111-8111-000000000001', '7b7b7b7b-0913-4111-8111-000000000002', 2)
$$, 'with the whole pitch ours again, the other two quarters go');


-- C. a clone carries the share -----------------------------------------------------
-- Beta out again (2 parts), so the slot holds 2 and the club's share can drop to 3.
delete from public.training_allocations where team_id = '7b7b7b7b-0913-4111-8111-000000000002';
update public.training_slots set club_parts = 3 where id = '530f0000-0913-4111-8111-000000000001';
-- Call the function first: a volatile function in a WHERE clause runs inside
-- the scan, and the row it inserts is not visible to that scan.
select set_config('ts.clone',
  public.clone_training_slot('530f0000-0913-4111-8111-000000000001', 4, '18:00', '19:00', false)::text, true);
select is((select club_parts from public.training_slots where id = current_setting('ts.clone')::uuid),
  3::smallint, 'a clone has the same share of the pitch');



-- D. a block's venues ---------------------------------------------------------------
-- The slot in B put Loreto on the block on its own.
select is((select count(*)::int from public.training_block_venues
            where block_id = 'b40cb40c-0913-4111-8111-000000000001' and venue_id = 'e4e4e4e4-0913-4111-8111-000000000001'),
  1, 'a slot at a venue lists the venue on its block');
select throws_ok($$
  delete from public.training_block_venues
   where block_id = 'b40cb40c-0913-4111-8111-000000000001' and venue_id = 'e4e4e4e4-0913-4111-8111-000000000001'
$$, 'P0001', 'This block has 2 slots at that venue — remove or move them before taking the venue off the block.',
  'a venue with slots in the block stays on the block');
insert into public.venues (id, name, for_matches, for_training) values
  ('e4e4e4e4-0913-4111-8111-000000000002', 'TS Ashton Park', true, false);
insert into public.training_block_venues (block_id, venue_id) values
  ('b40cb40c-0913-4111-8111-000000000001', 'e4e4e4e4-0913-4111-8111-000000000002');
select is((select for_training from public.venues where id = 'e4e4e4e4-0913-4111-8111-000000000002'),
  true, 'a match ground picked for a block becomes a training venue');
select lives_ok($$
  delete from public.training_block_venues
   where block_id = 'b40cb40c-0913-4111-8111-000000000001' and venue_id = 'e4e4e4e4-0913-4111-8111-000000000002'
$$, 'a venue with no slots in the block comes off it');


-- E. a venue's bookings, season by season ----------------------------------------------
insert into public.seasons (id, name, starts_on, ends_on) values
  ('5ea50000-0913-4111-8111-000000000001', 'TS 2026/27', '2026-08-01', '2027-07-31');
insert into public.venue_bookings (id, venue_id, season_id, starts_on, ends_on, reference) values
  ('b0b0b0b0-0913-4111-8111-000000000001', 'e4e4e4e4-0913-4111-8111-000000000002', '5ea50000-0913-4111-8111-000000000001',
   '2026-10-06', '2027-03-23', 'LHS-0412');
insert into public.venue_booking_slots (booking_id, weekday, start_time, end_time) values
  ('b0b0b0b0-0913-4111-8111-000000000001', 2, '19:00', '20:00'),
  ('b0b0b0b0-0913-4111-8111-000000000001', 4, '18:00', '19:30');
select is((select count(*)::int from public.venue_booking_slots where booking_id = 'b0b0b0b0-0913-4111-8111-000000000001'),
  2, 'a booking has its weekly slots — Tuesday and Thursday');
select throws_ok($$
  insert into public.venue_booking_slots (booking_id, weekday, start_time, end_time) values
  ('b0b0b0b0-0913-4111-8111-000000000001', 2, '20:00', '19:00')
$$, '23514', null, 'a slot cannot end before it starts');
select is((select count(*)::int from public.venue_bookings where venue_id = 'e4e4e4e4-0913-4111-8111-000000000002'),
  1, 'a booking is noted against the venue for the season');
select throws_ok($$
  insert into public.venue_bookings (venue_id, starts_on, ends_on) values
  ('e4e4e4e4-0913-4111-8111-000000000002', '2027-03-23', '2026-10-06')
$$, '23514', null, 'a booking cannot end before it starts');

-- A coach may read the bookings and may not write them; a club admin may.
insert into auth.users (id, email, raw_user_meta_data) values
  ('c0ac0000-0913-4111-8111-000000000001', 'ts-coach@example.test', '{"full_name":"TS Coach"}'),
  ('ad000000-0913-4111-8111-000000000001', 'ts-admin@example.test', '{"full_name":"TS Admin"}');
update public.profiles set role = 'committee' where id = 'ad000000-0913-4111-8111-000000000001';

set local request.jwt.claims = '{"sub":"c0ac0000-0913-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select count(*)::int from public.venue_bookings where venue_id = 'e4e4e4e4-0913-4111-8111-000000000002'),
  1, 'a coach can see the booking');
select throws_ok($$
  insert into public.venue_bookings (venue_id, starts_on, ends_on) values
  ('e4e4e4e4-0913-4111-8111-000000000002', '2027-04-06', '2027-05-25')
$$, '42501', null, 'a coach cannot note a booking');
reset role;

set local request.jwt.claims = '{"sub":"ad000000-0913-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok($$
  insert into public.venue_bookings (venue_id, starts_on, ends_on, notes) values
  ('e4e4e4e4-0913-4111-8111-000000000002', '2027-04-06', '2027-05-25', 'Summer term, same slot')
$$, 'a planner notes a booking');
reset role;

-- Removing the booking takes its slots with it.
delete from public.venue_bookings where id = 'b0b0b0b0-0913-4111-8111-000000000001';
select is((select count(*)::int from public.venue_booking_slots where booking_id = 'b0b0b0b0-0913-4111-8111-000000000001'),
  0, 'a removed booking takes its slots with it');

select * from finish();
rollback;
