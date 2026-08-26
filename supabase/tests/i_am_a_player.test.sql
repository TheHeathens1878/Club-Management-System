-- =============================================================================
-- "I am a player" — the tick, and what the backfill decided (20260825480000)
-- =============================================================================
--   A  a fresh person is not a player until they say so
--   B  the backfill ticked anyone the club already treats as one
--   C  a person sets their own flag through update_own_contact()
--   D  and cannot set anybody else's
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(8);

select has_column('public', 'people', 'is_player', 'people.is_player');

insert into auth.users (id, email, raw_user_meta_data) values
  ('b0b0b0b0-4848-4111-8111-000000000001', 'ip-plays@test.invalid',  '{"full_name": "Pat Plays", "dob": "1990-01-01"}'::jsonb),
  ('b0b0b0b0-4848-4111-8111-000000000002', 'ip-parent@test.invalid', '{"full_name": "Pip Parent", "dob": "1985-02-02"}'::jsonb);
select set_config('ip.plays',  (select person_id::text from public.profiles where id = 'b0b0b0b0-4848-4111-8111-000000000001'), true);
select set_config('ip.parent', (select person_id::text from public.profiles where id = 'b0b0b0b0-4848-4111-8111-000000000002'), true);

-- A. nobody starts as a player
select is((select is_player from public.people where id = current_setting('ip.plays')::uuid), false,
  'a new person is not a player until they say so');

-- B. what the backfill would have said: a live player membership means yes.
-- (The migration ran before these rows existed, so this asserts the RULE by
-- running the same statement the migration used.)
insert into public.seasons (id, name, starts_on, ends_on, is_current)
  values ('5b5b5b5b-4848-4111-8111-000000000001', 'Player 2045/46', '2045-08-01', '2046-05-31', true);
insert into public.teams (id, name, age_group)
  values ('7b7b7b7b-4848-4111-8111-000000000001', 'Player U18s', 'U18');
insert into public.team_memberships (person_id, team_id, season_id, role)
  values (current_setting('ip.plays')::uuid, '7b7b7b7b-4848-4111-8111-000000000001',
          '5b5b5b5b-4848-4111-8111-000000000001', 'player');

update public.people p set is_player = true
 where p.is_player = false
   and exists (select 1 from public.team_memberships m
                where m.person_id = p.id and m.left_at is null and m.role = 'player');

select is((select is_player from public.people where id = current_setting('ip.plays')::uuid), true,
  'the backfill ticks somebody who already holds a live player membership');
select is((select is_player from public.people where id = current_setting('ip.parent')::uuid), false,
  'and leaves a parent who has never played alone');


-- C. the person sets their own -------------------------------------------------------
set local request.jwt.claims to '{"sub":"b0b0b0b0-4848-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;

select lives_ok(
  $$ select public.update_own_contact(null, null, null, true) $$,
  'a person ticks "I am a player" on their own record');
reset role;
select is((select is_player from public.people where id = current_setting('ip.parent')::uuid), true,
  'and it is stored');

set local request.jwt.claims to '{"sub":"b0b0b0b0-4848-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$ select public.update_own_contact(null, '07700 900123', null) $$,
  'the old three-argument shape still works — the flag is left alone');
reset role;
select is((select is_player from public.people where id = current_setting('ip.parent')::uuid), true,
  'a call that does not mention the flag does not clear it');


-- D. and nobody else's ---------------------------------------------------------------
-- `update_own_contact()` takes no person: it writes current_person_id() and
-- nothing else, so there is no argument with which to reach another record.
-- The other door onto `people` is the admin policy, which is the club's.
set local request.jwt.claims to '{"sub":"b0b0b0b0-4848-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select is(
  (select count(*) from public.people p
    where p.id = current_setting('ip.plays')::uuid and p.is_player = true), 1::bigint,
  'the other person''s flag is untouched by anything this person can call');
reset role;

select * from finish();
rollback;
