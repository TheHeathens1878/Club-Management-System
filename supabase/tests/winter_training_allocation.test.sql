-- =============================================================================
-- Winter training allocation (20260906100000)
-- =============================================================================
--   A  a slot is divided into parts and cannot be over-allocated
--   B  the plan: one session per allocation per weekday, minus the dates off
--   C  the sync adds, and a re-run changes nothing
--   D  moving the slot amends the sessions and flags the change
--   E  a new date off removes; taking it away adds back
--   F  a coach cancels a session with a reason, the households are told, the
--      re-run leaves it cancelled; reinstating puts it back
--   G  removing a team removes its future sessions; the past is never touched
--   H  doors: only a planner writes the plan or runs the sync; a block deleted
--      takes its future sessions and leaves the past
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(50);

-- People: an administrator, a coach of Alpha, an adult player of Alpha.
insert into auth.users (id, email, raw_user_meta_data) values
  ('a1a1a1a1-9999-4111-8111-000000000001', 'wt-admin@test.invalid',  '{"full_name": "Wendy Admin",  "dob": "1975-01-01"}'::jsonb),
  ('a1a1a1a1-9999-4111-8111-000000000002', 'wt-coach@test.invalid',  '{"full_name": "Colin Coach",  "dob": "1980-01-01"}'::jsonb),
  ('a1a1a1a1-9999-4111-8111-000000000003', 'wt-player@test.invalid', '{"full_name": "Paula Player", "dob": "1990-01-01"}'::jsonb);
select set_config('wt.admin',  (select person_id::text from public.profiles where id = 'a1a1a1a1-9999-4111-8111-000000000001'), true);
select set_config('wt.coach',  (select person_id::text from public.profiles where id = 'a1a1a1a1-9999-4111-8111-000000000002'), true);
select set_config('wt.player', (select person_id::text from public.profiles where id = 'a1a1a1a1-9999-4111-8111-000000000003'), true);
insert into public.person_roles (person_id, role, granted_by)
  values (current_setting('wt.admin')::uuid, 'club_admin', 'a1a1a1a1-9999-4111-8111-000000000001');

insert into public.seasons (id, name, starts_on, ends_on)
  values ('5e5e5e5e-9999-4111-8111-000000000001', 'WT 2058/59', current_date - 60, current_date + 300);
insert into public.teams (id, name, age_group) values
  ('7e7e7e7e-9999-4111-8111-000000000001', 'WT Alpha', 'U10'),
  ('7e7e7e7e-9999-4111-8111-000000000002', 'WT Beta',  'U12'),
  ('7e7e7e7e-9999-4111-8111-000000000003', 'WT Gamma', 'U14');
insert into public.team_memberships (person_id, team_id, season_id, role) values
  (current_setting('wt.coach')::uuid,  '7e7e7e7e-9999-4111-8111-000000000001', '5e5e5e5e-9999-4111-8111-000000000001', 'coach'),
  (current_setting('wt.player')::uuid, '7e7e7e7e-9999-4111-8111-000000000001', '5e5e5e5e-9999-4111-8111-000000000001', 'player');

-- The block starts on a Monday at least a week away, so every session is in
-- the future whatever the clock says, and runs eight Mondays.
select set_config('wt.mon',
  (current_date + ((8 - extract(dow from current_date)::integer) % 7) + 7)::text, true);
insert into public.training_blocks (id, name, season_id, starts_on, ends_on, created_by) values
  ('b10cb10c-9999-4111-8111-000000000001', 'WT Winter', '5e5e5e5e-9999-4111-8111-000000000001',
   current_setting('wt.mon')::date, current_setting('wt.mon')::date + 55, 'a1a1a1a1-9999-4111-8111-000000000001');
-- Half-term: the third Monday is off.
insert into public.training_blackouts (id, block_id, label, starts_on, ends_on) values
  ('b1ac0000-9999-4111-8111-000000000001', 'b10cb10c-9999-4111-8111-000000000001', 'Half-term',
   current_setting('wt.mon')::date + 14, current_setting('wt.mon')::date + 20);
-- Monday 18:00–19:00 at the 3G, in thirds.
insert into public.training_slots (id, block_id, venue_name, venue_address, weekday, start_time, end_time, parts) values
  ('510c0000-9999-4111-8111-000000000001', 'b10cb10c-9999-4111-8111-000000000001',
   'WT Grammar 3G', '1 School Lane', 1, '18:00', '19:00', 3);

-- A. parts ---------------------------------------------------------------------
insert into public.training_allocations (id, slot_id, team_id, shares) values
  ('a110c000-9999-4111-8111-000000000001', '510c0000-9999-4111-8111-000000000001', '7e7e7e7e-9999-4111-8111-000000000001', 1),
  ('a110c000-9999-4111-8111-000000000002', '510c0000-9999-4111-8111-000000000001', '7e7e7e7e-9999-4111-8111-000000000002', 2);
select throws_ok($$
  insert into public.training_allocations (slot_id, team_id, shares)
  values ('510c0000-9999-4111-8111-000000000001', '7e7e7e7e-9999-4111-8111-000000000003', 1)
$$, 'P0001', null, 'a fourth third does not exist — the slot is full');
select throws_ok($$
  update public.training_allocations set shares = 2 where id = 'a110c000-9999-4111-8111-000000000001'
$$, 'P0001', null, 'nor can a team grow into parts another team holds');
select throws_ok($$
  update public.training_slots set parts = 2 where id = '510c0000-9999-4111-8111-000000000001'
$$, 'P0001', null, 'nor can the slot be re-divided under the teams already in it');
select throws_ok($$
  insert into public.training_allocations (slot_id, team_id, shares)
  values ('510c0000-9999-4111-8111-000000000001', '7e7e7e7e-9999-4111-8111-000000000003', 4)
$$, 'P0001', null, 'a team cannot hold more parts than the slot has');
select is(public.training_share_label(1, 3), 'A third of the pitch',    'one of three reads as a third');
select is(public.training_share_label(2, 3), 'Two thirds of the pitch', 'two of three read as two thirds');
select is(public.training_share_label(1, 2), 'Half of the pitch',       'one of two reads as half');
select is(public.training_share_label(1, 1), 'The whole pitch',         'one of one is the whole pitch');
select is(public.training_parts_label(4),    'quarters',                'four parts are quarters');

-- B. the plan ------------------------------------------------------------------
select is((select count(*) from public.training_block_plan('b10cb10c-9999-4111-8111-000000000001')),
  14::bigint, 'two teams × eight Mondays, less the half-term Monday, is fourteen sessions');
select is((select count(distinct training_on) from public.training_block_plan('b10cb10c-9999-4111-8111-000000000001')),
  7::bigint, 'on seven distinct Mondays');
select is((select count(*) from public.training_block_plan('b10cb10c-9999-4111-8111-000000000001')
            where training_on between current_setting('wt.mon')::date + 14 and current_setting('wt.mon')::date + 20),
  0::bigint, 'none of them in half-term');
select is((select to_char(min(starts_at) at time zone 'Europe/London', 'HH24:MI')
             from public.training_block_plan('b10cb10c-9999-4111-8111-000000000001')),
  '18:00', 'the slot time is London wall clock');

-- C. the sync ------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"a1a1a1a1-9999-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select results_eq(
  $$ select added, updated, removed, unchanged from public.sync_training_block('b10cb10c-9999-4111-8111-000000000001', true) $$,
  $$ values (14, 0, 0, 0) $$,
  'a dry run says fourteen to add and nothing else');
reset role;
select is((select count(*) from public.events where training_block_id = 'b10cb10c-9999-4111-8111-000000000001'),
  0::bigint, 'and a dry run writes nothing');

set local request.jwt.claims to '{"sub":"a1a1a1a1-9999-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select results_eq(
  $$ select added, updated, removed, unchanged from public.sync_training_block('b10cb10c-9999-4111-8111-000000000001') $$,
  $$ values (14, 0, 0, 0) $$,
  'the real run adds the fourteen');
reset role;
select is((select count(*) from public.events where training_block_id = 'b10cb10c-9999-4111-8111-000000000001'),
  14::bigint, 'fourteen sessions are on the calendar');
select is((select count(*) from public.events
            where training_block_id = 'b10cb10c-9999-4111-8111-000000000001'
              and type = 'practice' and status = 'scheduled'
              and title = 'Winter training' and venue_text = 'WT Grammar 3G'),
  14::bigint, 'each is a scheduled practice with the block''s title at the venue');
select is((select notes from public.events
            where training_allocation_id = 'a110c000-9999-4111-8111-000000000001' order by starts_at limit 1),
  'A third of the pitch · WT Winter', 'Alpha''s note says a third');
select is((select notes from public.events
            where training_allocation_id = 'a110c000-9999-4111-8111-000000000002' order by starts_at limit 1),
  'Two thirds of the pitch · WT Winter', 'Beta''s says two thirds');
select is((select created_by from public.events
            where training_block_id = 'b10cb10c-9999-4111-8111-000000000001' order by starts_at limit 1),
  'a1a1a1a1-9999-4111-8111-000000000001'::uuid, 'the administrator who ran it is the creator');
select isnt((select last_synced_at from public.training_blocks where id = 'b10cb10c-9999-4111-8111-000000000001'),
  null, 'the block records when it was last synced');

set local request.jwt.claims to '{"sub":"a1a1a1a1-9999-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select results_eq(
  $$ select added, updated, removed, unchanged from public.sync_training_block('b10cb10c-9999-4111-8111-000000000001') $$,
  $$ values (0, 0, 0, 14) $$,
  'a re-run with nothing changed changes nothing');
reset role;

-- D. moving the slot -----------------------------------------------------------
update public.training_slots set start_time = '19:00', end_time = '20:00'
 where id = '510c0000-9999-4111-8111-000000000001';
set local request.jwt.claims to '{"sub":"a1a1a1a1-9999-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select results_eq(
  $$ select added, updated, removed, unchanged from public.sync_training_block('b10cb10c-9999-4111-8111-000000000001', true) $$,
  $$ values (0, 14, 0, 0) $$,
  'moving the slot an hour later is fourteen to change');
select results_eq(
  $$ select added, updated, removed, unchanged from public.sync_training_block('b10cb10c-9999-4111-8111-000000000001') $$,
  $$ values (0, 14, 0, 0) $$,
  'and the run changes them');
reset role;
select is((select count(*) from public.events
            where training_block_id = 'b10cb10c-9999-4111-8111-000000000001'
              and to_char(starts_at at time zone 'Europe/London', 'HH24:MI') = '19:00'
              and details_changed_at is not null and change_note like 'Moved from%'),
  14::bigint, 'every session is at 19:00, flagged, with the sentence saying what moved');
select is((select count(*) from public.outbound_messages
            where person_id = current_setting('wt.player')::uuid and subject like 'Details changed:%'),
  1::bigint, 'Alpha''s player heard once about the move');

-- E. dates off -----------------------------------------------------------------
insert into public.training_blackouts (id, block_id, label, starts_on, ends_on) values
  ('b1ac0000-9999-4111-8111-000000000002', 'b10cb10c-9999-4111-8111-000000000001', 'Tournament',
   current_setting('wt.mon')::date + 28, current_setting('wt.mon')::date + 28);
set local request.jwt.claims to '{"sub":"a1a1a1a1-9999-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select results_eq(
  $$ select added, updated, removed, unchanged from public.sync_training_block('b10cb10c-9999-4111-8111-000000000001') $$,
  $$ values (0, 0, 2, 12) $$,
  'a new date off removes that Monday''s two sessions');
reset role;
select is((select count(*) from public.events where training_on = current_setting('wt.mon')::date + 28),
  0::bigint, 'and they are gone');
delete from public.training_blackouts where id = 'b1ac0000-9999-4111-8111-000000000002';
set local request.jwt.claims to '{"sub":"a1a1a1a1-9999-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select results_eq(
  $$ select added, updated, removed, unchanged from public.sync_training_block('b10cb10c-9999-4111-8111-000000000001') $$,
  $$ values (2, 0, 0, 12) $$,
  'taking the date off away adds them back');
reset role;

-- F. the coach's tap -----------------------------------------------------------
select set_config('wt.session',
  (select id::text from public.events
    where training_allocation_id = 'a110c000-9999-4111-8111-000000000001' order by starts_at limit 1), true);
set local request.jwt.claims to '{"sub":"a1a1a1a1-9999-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  format($$ select public.cancel_training_session(%L, 'no') $$, current_setting('wt.session')),
  'P0001', null, 'a player cannot cancel training');
reset role;
set local request.jwt.claims to '{"sub":"a1a1a1a1-9999-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  format($$ select public.cancel_training_session(%L, 'Half the squad is away') $$, current_setting('wt.session')),
  'the coach can');
reset role;
select is((select status::text from public.events where id = current_setting('wt.session')::uuid),
  'cancelled', 'the session is cancelled');
select is((select change_note from public.events where id = current_setting('wt.session')::uuid),
  'Cancelled — Half the squad is away', 'with the coach''s reason kept on it');
select is((select count(*) from public.outbound_messages
            where person_id = current_setting('wt.player')::uuid and subject = 'Training cancelled: WT Alpha'
              and body like '%Half the squad is away%'),
  1::bigint, 'the player is told, reason and all');
select is((select count(*) from public.outbound_messages
            where person_id = current_setting('wt.coach')::uuid and subject like 'Training cancelled:%'),
  0::bigint, 'the coach who cancelled it is not');

set local request.jwt.claims to '{"sub":"a1a1a1a1-9999-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select results_eq(
  $$ select added, updated, removed, unchanged, cancelled from public.sync_training_block('b10cb10c-9999-4111-8111-000000000001') $$,
  $$ values (0, 0, 0, 14, 1) $$,
  'a re-run leaves the cancelled session cancelled, and says so');
reset role;
select is((select status::text from public.events where id = current_setting('wt.session')::uuid),
  'cancelled', 'it was not quietly put back on');

set local request.jwt.claims to '{"sub":"a1a1a1a1-9999-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  format($$ select public.reinstate_training_session(%L) $$, current_setting('wt.session')),
  'the coach reinstates it');
reset role;
select is((select status::text || '|' || change_note from public.events where id = current_setting('wt.session')::uuid),
  'scheduled|Training is back on.', 'it is back on, and says so');

-- G. removing a team; the past ---------------------------------------------------
delete from public.training_allocations where id = 'a110c000-9999-4111-8111-000000000002';
-- A session that already happened, written by an earlier run.
insert into public.events (id, team_id, type, title, status, starts_at, ends_at, venue_text,
                           training_block_id, training_allocation_id, training_on) values
  ('e0e0e0e0-9999-4111-8111-000000000001', '7e7e7e7e-9999-4111-8111-000000000001', 'practice', 'Winter training', 'scheduled',
   now() - interval '7 days', now() - interval '7 days' + interval '1 hour', 'WT Grammar 3G',
   'b10cb10c-9999-4111-8111-000000000001', 'a110c000-9999-4111-8111-000000000001', (now() - interval '7 days')::date);
set local request.jwt.claims to '{"sub":"a1a1a1a1-9999-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select results_eq(
  $$ select added, updated, removed, unchanged from public.sync_training_block('b10cb10c-9999-4111-8111-000000000001') $$,
  $$ values (0, 0, 7, 7) $$,
  'Beta''s seven future sessions go; the past one is not counted');
reset role;
select is((select count(*) from public.events where team_id = '7e7e7e7e-9999-4111-8111-000000000002'),
  0::bigint, 'Beta has no sessions left');
select is((select count(*) from public.events where id = 'e0e0e0e0-9999-4111-8111-000000000001'),
  1::bigint, 'the session that already happened is untouched');

-- H. doors ------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"a1a1a1a1-9999-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select throws_ok($$
  insert into public.training_blocks (name, starts_on, ends_on) values ('Coach''s block', current_date, current_date + 7)
$$, '42501', null, 'a coach cannot plan a block');
select throws_ok($$
  select public.sync_training_block('b10cb10c-9999-4111-8111-000000000001')
$$, 'P0001', null, 'nor run the sync');
select is((select count(*) from public.training_slots where block_id = 'b10cb10c-9999-4111-8111-000000000001'),
  1::bigint, 'but can read the plan');
reset role;
select ok(not has_function_privilege('anon', 'public.sync_training_block(uuid, boolean)', 'EXECUTE'),
  'anon has no door to the sync');

delete from public.training_blocks where id = 'b10cb10c-9999-4111-8111-000000000001';
select is((select count(*) from public.events where training_allocation_id is not null
            or (training_block_id is not null)),
  0::bigint, 'deleting the block takes every future session and unlinks the rest');
select is((select count(*) from public.events where id = 'e0e0e0e0-9999-4111-8111-000000000001'),
  1::bigint, 'the past session survives the block');
select is((select count(*) from public.events where team_id = '7e7e7e7e-9999-4111-8111-000000000001' and starts_at > now()),
  0::bigint, 'and Alpha''s future ones are gone');

select * from finish();
rollback;
