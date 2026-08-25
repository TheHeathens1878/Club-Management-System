-- =============================================================================
-- A coach's queued membership applies without a date of birth (20260825340000)
-- =============================================================================
--   A  a queued COACH membership applies with no date of birth on record
--   B  a queued PLAYER membership still waits for one (SG-0)
--   C  and applies as soon as the date arrives
--   D  needs_dob_completion() asks anybody the club has no date for
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(10);

-- The relaxation follows the SG-6 switch, and this club runs with it off
-- (20260824240000). Set it explicitly so the case under test is the one the
-- club is actually in, whatever another suite left behind.
update public.site_settings set value = '0' where key = 'safeguarding.sg6_enforcement';

insert into auth.users (id, email, raw_user_meta_data) values
  ('d0b0d0b0-6666-4111-8111-000000000001', 'nd-coach@test.invalid', '{"full_name": "Dana Coach"}'::jsonb),
  ('d0b0d0b0-6666-4111-8111-000000000003', 'nd-known@test.invalid', '{"full_name": "Kay Known", "dob": "1990-05-05"}'::jsonb);
-- The player has no login of their own — SG-10 refuses to make an account
-- holder a minor, and this one becomes thirteen halfway through.
insert into public.people (id, first_name, last_name)
  values ('d0b0d0b0-6666-4111-8111-0000000000b1', 'Percy', 'Player');
select set_config('nd.coach',  (select person_id::text from public.profiles where id = 'd0b0d0b0-6666-4111-8111-000000000001'), true);
select set_config('nd.player', 'd0b0d0b0-6666-4111-8111-0000000000b1', true);
select set_config('nd.known',  (select person_id::text from public.profiles where id = 'd0b0d0b0-6666-4111-8111-000000000003'), true);

-- Neither the coach nor the player has a date of birth; the third does.
update public.people set dob = null
 where id in (current_setting('nd.coach')::uuid, current_setting('nd.player')::uuid);

insert into public.seasons (id, name, starts_on, ends_on, is_current)
  values ('5d0b5d0b-6666-4111-8111-000000000001', 'No-DOB 2039/40', '2039-08-01', '2040-05-31', true);
insert into public.teams (id, name, age_group)
  values ('7d0b7d0b-6666-4111-8111-000000000001', 'No-DOB U14s', 'U14');

insert into public.neon_import_pending (person_id, kind, payload) values
  (current_setting('nd.coach')::uuid, 'membership',
   jsonb_build_object('role', 'coach', 'team_id', '7d0b7d0b-6666-4111-8111-000000000001')),
  (current_setting('nd.player')::uuid, 'membership',
   jsonb_build_object('role', 'player', 'team_id', '7d0b7d0b-6666-4111-8111-000000000001'));

select is((select count(*)::integer from public.neon_import_pending where applied_at is null), 2,
  'two rows are waiting');

select lives_ok($$ select * from public.apply_neon_pending() $$, 'the queue runs');


-- A / B. what landed and what did not ------------------------------------------------
select is(
  (select count(*) from public.team_memberships m
    where m.person_id = current_setting('nd.coach')::uuid
      and m.team_id = '7d0b7d0b-6666-4111-8111-000000000001'
      and m.role = 'coach' and m.left_at is null), 1::bigint,
  'the coach is on the team without a date of birth');
select is(
  (select count(*) from public.team_memberships m
    where m.person_id = current_setting('nd.player')::uuid
      and m.team_id = '7d0b7d0b-6666-4111-8111-000000000001'), 0::bigint,
  'the player is not — SG-0 still holds a player''s membership');
select ok(
  (select last_error from public.neon_import_pending
    where person_id = current_setting('nd.player')::uuid) like '%date of birth unknown%',
  'and the queue row says why');
select is((select dob from public.people where id = current_setting('nd.coach')::uuid), null,
  'the coach still has no date of birth on record');


-- C. the date arrives ----------------------------------------------------------------
update public.people set dob = (current_date - interval '13 years')::date
 where id = current_setting('nd.player')::uuid;
select lives_ok($$ select * from public.apply_neon_pending() $$, 'the queue runs again');
select is(
  (select count(*) from public.team_memberships m
    where m.person_id = current_setting('nd.player')::uuid
      and m.team_id = '7d0b7d0b-6666-4111-8111-000000000001'
      and m.role = 'player' and m.left_at is null), 1::bigint,
  'and the player joins as soon as the club knows their age');


-- D. the first-login gate ------------------------------------------------------------
set local request.jwt.claims to '{"sub":"d0b0d0b0-6666-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is(public.needs_dob_completion(), true,
  'the coach is asked for their date of birth at sign-in');
reset role;

set local request.jwt.claims to '{"sub":"d0b0d0b0-6666-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select is(public.needs_dob_completion(), false,
  'somebody whose date the club holds is not');
reset role;

select * from finish();
rollback;
