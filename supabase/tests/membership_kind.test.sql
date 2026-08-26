-- =============================================================================
-- Membership kind is counted in PLAYERS (20260825500000)
-- =============================================================================
--   A  a parent and one playing child is an INDIVIDUAL membership;
--      a parent and two playing children is a FAMILY
--   B  the kind does not go stale: registering a second child later flips a
--      membership to family, withdrawing that registration flips it back
--   C  a live squad place counts as playing too, and ending it flips back
--   D  another season's registration does not move this season's membership
--   E  the backfill (refresh_membership_kind) corrects a wrongly-typed row
--   F  person_memberships carries the tag and names the lead contact
--   G  membership_kind_for() is the database's own arithmetic, not a member's
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(17);

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaabbbb-1111-4111-8111-000000000001', 'mk-pat@test.invalid',
   '{"full_name": "Pat One", "dob": "1980-01-01"}'::jsonb),
  ('aaaabbbb-1111-4111-8111-000000000002', 'mk-sol@test.invalid',
   '{"full_name": "Sol Two", "dob": "1979-02-02"}'::jsonb);
select set_config('mk.pat', (select person_id::text from public.profiles where id = 'aaaabbbb-1111-4111-8111-000000000001'), true);
select set_config('mk.sol', (select person_id::text from public.profiles where id = 'aaaabbbb-1111-4111-8111-000000000002'), true);

insert into public.seasons (id, name, starts_on, ends_on, is_current) values
  ('bbbbcccc-1111-4111-8111-000000000001', 'MK 2040/41', current_date - 10, current_date + 300, true);
insert into public.seasons (id, name, starts_on, ends_on) values
  ('bbbbcccc-1111-4111-8111-000000000002', 'MK 2041/42', current_date + 301, current_date + 600);
insert into public.teams (id, name, age_group) values
  ('ccccdddd-1111-4111-8111-000000000001', 'MK Colts', 'U10');


-- ---------------------------------------------------------------------------
-- A. Two people, one player. Then three people, two players.
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"aaaabbbb-1111-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select set_config('mk.kit', public.add_child('Kit', 'One', (current_date - interval '9 years')::date)::text, true);
select set_config('mk.kim', public.add_child('Kim', 'One', (current_date - interval '7 years')::date)::text, true);

insert into public.registrations (person_id, season_id, team_id, form)
values (current_setting('mk.kit')::uuid, 'bbbbcccc-1111-4111-8111-000000000001',
        'ccccdddd-1111-4111-8111-000000000001', '{}'::jsonb);

select is((select kind::text from public.create_membership(array[current_setting('mk.kit')::uuid])),
  'individual', 'a parent and one playing child: two people, one player, INDIVIDUAL');

insert into public.registrations (person_id, season_id, team_id, form)
values (current_setting('mk.kim')::uuid, 'bbbbcccc-1111-4111-8111-000000000001',
        'ccccdddd-1111-4111-8111-000000000001', '{}'::jsonb);

select is((select kind::text from public.create_membership(
             array[current_setting('mk.kit')::uuid, current_setting('mk.kim')::uuid])),
  'family', 'a parent and two playing children: three people, two players, FAMILY');
reset role;

set local request.jwt.claims to '{"role":"service_role"}';
select set_config('mk.pat_membership',
  (select id::text from public.memberships where primary_person_id = current_setting('mk.pat')::uuid), true);


-- ---------------------------------------------------------------------------
-- B. The second child is registered LATER — the kind must not go stale.
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"aaaabbbb-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select set_config('mk.ali', public.add_child('Ali', 'Two', (current_date - interval '10 years')::date)::text, true);
select set_config('mk.bea', public.add_child('Bea', 'Two', (current_date - interval '8 years')::date)::text, true);

insert into public.registrations (person_id, season_id, team_id, form)
values (current_setting('mk.ali')::uuid, 'bbbbcccc-1111-4111-8111-000000000001',
        'ccccdddd-1111-4111-8111-000000000001', '{}'::jsonb);

select is((select kind::text from public.create_membership(
             array[current_setting('mk.ali')::uuid, current_setting('mk.bea')::uuid])),
  'individual', 'three people on the membership but only one of them is playing yet');
reset role;

set local request.jwt.claims to '{"role":"service_role"}';
select set_config('mk.sol_membership',
  (select id::text from public.memberships where primary_person_id = current_setting('mk.sol')::uuid), true);

set local request.jwt.claims to '{"sub":"aaaabbbb-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
insert into public.registrations (id, person_id, season_id, team_id, form)
values ('ddddeeee-1111-4111-8111-000000000001', current_setting('mk.bea')::uuid,
        'bbbbcccc-1111-4111-8111-000000000001', 'ccccdddd-1111-4111-8111-000000000001', '{}'::jsonb);
reset role;

set local request.jwt.claims to '{"role":"service_role"}';
select is((select kind::text from public.memberships where id = current_setting('mk.sol_membership')::uuid),
  'family', 'registering the second child later flips the membership to FAMILY');

-- ...and withdrawing that registration flips it straight back.
set local request.jwt.claims to '{"sub":"aaaabbbb-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
update public.registrations set status = 'withdrawn' where id = 'ddddeeee-1111-4111-8111-000000000001';
reset role;

set local request.jwt.claims to '{"role":"service_role"}';
select is((select kind::text from public.memberships where id = current_setting('mk.sol_membership')::uuid),
  'individual', 'withdrawing the second registration flips it back to INDIVIDUAL');


-- ---------------------------------------------------------------------------
-- C. A live squad place is playing too — and ending it flips back.
-- ---------------------------------------------------------------------------
insert into public.team_memberships (id, person_id, team_id, season_id, role)
values ('eeeeffff-1111-4111-8111-000000000001', current_setting('mk.bea')::uuid,
        'ccccdddd-1111-4111-8111-000000000001', 'bbbbcccc-1111-4111-8111-000000000001', 'player');
select is((select kind::text from public.memberships where id = current_setting('mk.sol_membership')::uuid),
  'family', 'a live squad place counts as playing: back to FAMILY');

update public.team_memberships set left_at = now() where id = 'eeeeffff-1111-4111-8111-000000000001';
select is((select kind::text from public.memberships where id = current_setting('mk.sol_membership')::uuid),
  'individual', 'ending that player''s squad place flips it back to INDIVIDUAL');

-- A COACH is not a player, however live the row is.
insert into public.team_memberships (person_id, team_id, season_id, role)
values (current_setting('mk.sol')::uuid, 'ccccdddd-1111-4111-8111-000000000001',
        'bbbbcccc-1111-4111-8111-000000000001', 'coach');
select is((select kind::text from public.memberships where id = current_setting('mk.sol_membership')::uuid),
  'individual', 'the lead contact coaching the team does not make it a family');


-- ---------------------------------------------------------------------------
-- D. Another season is another membership's business.
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"aaaabbbb-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
insert into public.registrations (person_id, season_id, form)
values (current_setting('mk.bea')::uuid, 'bbbbcccc-1111-4111-8111-000000000002', '{}'::jsonb);
reset role;

set local request.jwt.claims to '{"role":"service_role"}';
select is((select kind::text from public.memberships where id = current_setting('mk.sol_membership')::uuid),
  'individual', 'a registration for NEXT season leaves this season''s membership alone');


-- ---------------------------------------------------------------------------
-- E. The backfill corrects a wrongly-typed row.
-- ---------------------------------------------------------------------------
-- `memberships` carries no trigger of its own (that is what makes the three
-- sync triggers non-recursive), so a hand-written wrong answer stays wrong
-- until something re-derives it. That is exactly the production row this
-- migration's backfill is for.
update public.memberships set kind = 'family' where id = current_setting('mk.sol_membership')::uuid;
select is((select kind::text from public.memberships where id = current_setting('mk.sol_membership')::uuid),
  'family', 'a hand-written kind stays wrong: nothing on memberships re-derives it');

select is(public.refresh_membership_kind(array[current_setting('mk.sol_membership')::uuid]), 1,
  'the backfill reports the one row it moved');
select is((select kind::text from public.memberships where id = current_setting('mk.sol_membership')::uuid),
  'individual', 'and the row now says what the players say');
select is(public.refresh_membership_kind(array[current_setting('mk.sol_membership')::uuid]), 0,
  'a second pass writes nothing');


-- ---------------------------------------------------------------------------
-- F. Removing a player from the membership re-derives it too.
-- ---------------------------------------------------------------------------
delete from public.membership_people
 where membership_id = current_setting('mk.pat_membership')::uuid
   and person_id = current_setting('mk.kim')::uuid;
select is((select kind::text from public.memberships where id = current_setting('mk.pat_membership')::uuid),
  'individual', 'taking the second player off the membership flips it back to INDIVIDUAL');


-- ---------------------------------------------------------------------------
-- G. The tag a screen reads, and the arithmetic it may not run.
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"aaaabbbb-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.person_memberships
            where membership_id = current_setting('mk.sol_membership')::uuid), 3::bigint,
  'person_memberships tags every person on the membership');
select is((select (kind::text, is_primary, season_name::text) from public.person_memberships
            where membership_id = current_setting('mk.sol_membership')::uuid
              and person_id = current_setting('mk.sol')::uuid),
  ('individual'::text, true, 'MK 2040/41'::text),
  'the lead contact''s row carries the kind, the flag and the season');
select throws_ok(
  $$ select public.membership_kind_for(current_setting('mk.sol_membership')::uuid) $$,
  '42501', null, 'membership_kind_for() is the database''s own arithmetic, not a member''s');
reset role;

select * from finish();
rollback;
