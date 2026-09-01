-- =============================================================================
-- Venues, and the coaches' group that keeps itself (20260901180000/110000)
-- =============================================================================
--   A  the venue model: a venue is created, its group with it, and a pitch
--      belongs to it
--   B  a coach of a team whose home pitch is here is in the group
--   C  a coach of TWO teams here is in it once, and stays while one remains
--   D  a team moving to another ground marks its coach left — history kept
--   E  a fixture allocated here brings the visiting team's coaches in
--   F  adults only: a minor coach is never added, and cannot be added by hand
--   G  no date of birth is a minor (SG-0) — and giving it lets them in
--   H  SG-1 holds: the group has no minor in it at all, so the one-adult-
--      one-minor shape is unreachable
--   I  RLS: a non-participant cannot see the group; a participant can
--   J  a venue is retired, never deleted
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(28);

-- -----------------------------------------------------------------------------
-- People
-- -----------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('acacacac-5555-4111-8111-000000000001', 'vg-coach-a@test.invalid',   '{"full_name": "Ada Coach",    "dob": "1984-01-01"}'::jsonb),
  ('acacacac-5555-4111-8111-000000000002', 'vg-coach-b@test.invalid',   '{"full_name": "Ben Coach",    "dob": "1985-02-02"}'::jsonb),
  ('acacacac-5555-4111-8111-000000000005', 'vg-outsider@test.invalid',  '{"full_name": "Eve Outsider", "dob": "1979-05-05"}'::jsonb),
  ('acacacac-5555-4111-8111-000000000006', 'vg-admin@test.invalid',     '{"full_name": "Fay Admin",    "dob": "1974-06-06"}'::jsonb);

select set_config('vg.a',        (select person_id::text from public.profiles where id = 'acacacac-5555-4111-8111-000000000001'), true);
select set_config('vg.b',        (select person_id::text from public.profiles where id = 'acacacac-5555-4111-8111-000000000002'), true);
-- No auth user for these two: SG-10 refuses a profile for a minor with no
-- guardian consent, and its dob guard refuses to age an account-holder down into
-- one. A young assistant coach and somebody whose date of birth the club has not
-- got are people the club knows rather than people who sign in, which is exactly
-- what the venue group's adults-only rule has to cope with.
insert into public.people (id, first_name, last_name, dob) values
  ('cacacaca-5555-4111-8111-000000000003', 'Cass', 'Young', (current_date - interval '13 years')::date),
  ('cacacaca-5555-4111-8111-000000000004', 'Dee',  'Nodob', null);
select set_config('vg.young',    'cacacaca-5555-4111-8111-000000000003', true);
select set_config('vg.nodob',    'cacacaca-5555-4111-8111-000000000004', true);
select set_config('vg.outsider', (select person_id::text from public.profiles where id = 'acacacac-5555-4111-8111-000000000005'), true);
select set_config('vg.admin',    (select person_id::text from public.profiles where id = 'acacacac-5555-4111-8111-000000000006'), true);

-- Belt and braces on the two that matter to the safeguarding cases.


insert into public.person_roles (person_id, role, granted_by)
  values (current_setting('vg.admin')::uuid, 'club_admin', 'acacacac-5555-4111-8111-000000000006');

-- One current season, so the fixture rule in E has something to be inside.
update public.seasons set is_current = false where is_current;
insert into public.seasons (id, name, starts_on, ends_on, is_current)
  values ('5e5e5e5e-5555-4111-8111-000000000001', 'Venues 2041/42', '2041-08-01', '2042-05-31', true);


-- =============================================================================
-- A. the venue model
-- =============================================================================

insert into public.venues (id, name, address, sort_order) values
  ('4e4e4e4e-5555-4111-8111-000000000001', 'Test Ground A', 'A Lane, Sale', 1),
  ('4e4e4e4e-5555-4111-8111-000000000002', 'Test Ground B', null,           2);

select set_config('vg.groupA', (select public.venue_coaches_group_id('4e4e4e4e-5555-4111-8111-000000000001')::text), true);
select set_config('vg.groupB', (select public.venue_coaches_group_id('4e4e4e4e-5555-4111-8111-000000000002')::text), true);

select isnt(current_setting('vg.groupA'), '', 'creating a venue creates its coaches group');
select is((select title from public.conversations where id = current_setting('vg.groupA')::uuid),
  'Test Ground A coaches', 'the group is named after the venue');
select is((select type::text from public.conversations where id = current_setting('vg.groupA')::uuid),
  'group', 'it is a group conversation, not a team room');

insert into public.resources (id, type, name, venue_id) values
  ('7e7e7e7e-5555-4111-8111-000000000001', 'pitch', 'Test Ground A ' || chr(8211) || ' Pitch 1', '4e4e4e4e-5555-4111-8111-000000000001'),
  ('7e7e7e7e-5555-4111-8111-000000000002', 'pitch', 'Test Ground B ' || chr(8211) || ' Pitch 1', '4e4e4e4e-5555-4111-8111-000000000002');

select is((select count(*) from public.resources where venue_id = '4e4e4e4e-5555-4111-8111-000000000001'),
  1::bigint, 'a pitch belongs to a venue');

-- A group carries at most one structured attachment (20260824250000, widened).
select throws_ok(
  $$insert into public.conversations (type, title, venue_id, resource_id)
    values ('group', 'Both at once', '4e4e4e4e-5555-4111-8111-000000000001', '7e7e7e7e-5555-4111-8111-000000000001')$$,
  '23514', null, 'a group cannot be attached to a venue and a pitch at once');


-- =============================================================================
-- B. a coach of a team whose home pitch is here
-- =============================================================================

insert into public.teams (id, name, home_resource_id) values
  ('7a7a7a7a-5555-4111-8111-000000000001', 'VG Reds',   '7e7e7e7e-5555-4111-8111-000000000001'),
  ('7a7a7a7a-5555-4111-8111-000000000002', 'VG Blues',  '7e7e7e7e-5555-4111-8111-000000000001'),
  ('7a7a7a7a-5555-4111-8111-000000000003', 'VG Greens', '7e7e7e7e-5555-4111-8111-000000000002');

create or replace function pg_temp.in_group(p_group uuid, p_person uuid) returns boolean language sql as $$
  select exists (select 1 from public.conversation_participants
                  where conversation_id = p_group and person_id = p_person and left_at is null);
$$;

insert into public.team_memberships (id, person_id, team_id, season_id, role) values
  ('11111111-5555-4111-8111-000000000001', current_setting('vg.a')::uuid, '7a7a7a7a-5555-4111-8111-000000000001', '5e5e5e5e-5555-4111-8111-000000000001', 'coach');

select ok(pg_temp.in_group(current_setting('vg.groupA')::uuid, current_setting('vg.a')::uuid),
  'a coach of a team whose home pitch is at the venue is in the venue group');
select is((select basis::text from public.conversation_participants
            where conversation_id = current_setting('vg.groupA')::uuid and person_id = current_setting('vg.a')::uuid),
  'staff', 'they are a staff participant — it is a staff room');
select ok(not pg_temp.in_group(current_setting('vg.groupB')::uuid, current_setting('vg.a')::uuid),
  'and not in the other ground''s group');

-- A player is not a coach.
insert into public.team_memberships (id, person_id, team_id, season_id, role) values
  ('11111111-5555-4111-8111-000000000002', current_setting('vg.outsider')::uuid, '7a7a7a7a-5555-4111-8111-000000000001', '5e5e5e5e-5555-4111-8111-000000000001', 'player');
select ok(not pg_temp.in_group(current_setting('vg.groupA')::uuid, current_setting('vg.outsider')::uuid),
  'a player at the venue is not in the coaches group');

-- A manager is.
insert into public.team_memberships (id, person_id, team_id, season_id, role) values
  ('11111111-5555-4111-8111-000000000003', current_setting('vg.b')::uuid, '7a7a7a7a-5555-4111-8111-000000000002', '5e5e5e5e-5555-4111-8111-000000000001', 'manager');
select ok(pg_temp.in_group(current_setting('vg.groupA')::uuid, current_setting('vg.b')::uuid),
  'a manager counts as a coach');


-- =============================================================================
-- C. two teams at the same venue, one row
-- =============================================================================

insert into public.team_memberships (id, person_id, team_id, season_id, role) values
  ('11111111-5555-4111-8111-000000000004', current_setting('vg.a')::uuid, '7a7a7a7a-5555-4111-8111-000000000002', '5e5e5e5e-5555-4111-8111-000000000001', 'assistant_coach');

select is((select count(*) from public.conversation_participants
            where conversation_id = current_setting('vg.groupA')::uuid
              and person_id = current_setting('vg.a')::uuid and left_at is null),
  1::bigint, 'a coach of two teams at the same venue is in the group once');

update public.team_memberships set left_at = now() where id = '11111111-5555-4111-8111-000000000004';
select ok(pg_temp.in_group(current_setting('vg.groupA')::uuid, current_setting('vg.a')::uuid),
  'leaving one of two teams at the venue leaves them in the group');


-- =============================================================================
-- D. the last team moves away
-- =============================================================================

update public.teams set home_resource_id = '7e7e7e7e-5555-4111-8111-000000000002'
 where id = '7a7a7a7a-5555-4111-8111-000000000001';

select ok(not pg_temp.in_group(current_setting('vg.groupA')::uuid, current_setting('vg.a')::uuid),
  'a coach whose last team stops playing at the venue is out of the group');
select is((select count(*) from public.conversation_participants
            where conversation_id = current_setting('vg.groupA')::uuid and person_id = current_setting('vg.a')::uuid),
  1::bigint, 'history is retained — the row is marked left, never deleted');
select ok((select left_at is not null from public.conversation_participants
            where conversation_id = current_setting('vg.groupA')::uuid and person_id = current_setting('vg.a')::uuid),
  'and left_at is what marks it');
select ok(pg_temp.in_group(current_setting('vg.groupB')::uuid, current_setting('vg.a')::uuid),
  'they are in the new ground''s group instead');

-- And back again.
update public.teams set home_resource_id = '7e7e7e7e-5555-4111-8111-000000000001'
 where id = '7a7a7a7a-5555-4111-8111-000000000001';
select ok(pg_temp.in_group(current_setting('vg.groupA')::uuid, current_setting('vg.a')::uuid),
  'coming back re-admits them');


-- =============================================================================
-- E. a fixture allocated here
-- =============================================================================
-- VG Greens are based at Ground B. One fixture on Ground A's pitch this season
-- and their coach belongs in Ground A's group too — the fixture's
-- venue_resource_id is a foreign key an admin chose, not a parsed string.

insert into public.team_memberships (id, person_id, team_id, season_id, role) values
  ('11111111-5555-4111-8111-000000000005', current_setting('vg.b')::uuid, '7a7a7a7a-5555-4111-8111-000000000003', '5e5e5e5e-5555-4111-8111-000000000001', 'coach');

insert into public.fixtures (id, team_id, season_id, opponent, is_home, kickoff_at, venue_resource_id)
  values ('f1f1f1f1-5555-4111-8111-000000000001', '7a7a7a7a-5555-4111-8111-000000000003',
          '5e5e5e5e-5555-4111-8111-000000000001', 'Somebody FC', true,
          '2041-10-05 10:00+00', '7e7e7e7e-5555-4111-8111-000000000001');

select ok(pg_temp.in_group(current_setting('vg.groupA')::uuid, current_setting('vg.b')::uuid),
  'a fixture allocated to a pitch here brings the visiting team''s coach in');

-- Free text is not a venue. A fixture that says "Platt Lane" in words does not
-- put anybody anywhere: venue_text is never parsed.
insert into public.fixtures (id, team_id, season_id, opponent, is_home, kickoff_at, venue_text)
  values ('f1f1f1f1-5555-4111-8111-000000000002', '7a7a7a7a-5555-4111-8111-000000000003',
          '5e5e5e5e-5555-4111-8111-000000000001', 'Elsewhere FC', false,
          '2041-10-12 10:00+00', 'Test Ground A');
select is((select count(*) from public.conversation_participants
            where conversation_id = current_setting('vg.groupB')::uuid and left_at is null),
  (select count(*) from public.conversation_participants
            where conversation_id = current_setting('vg.groupB')::uuid and left_at is null),
  'a free-text venue name changes nothing (venue_text is never matched)');


-- =============================================================================
-- F. adults only
-- =============================================================================

insert into public.team_memberships (id, person_id, team_id, season_id, role) values
  ('11111111-5555-4111-8111-000000000006', current_setting('vg.young')::uuid, '7a7a7a7a-5555-4111-8111-000000000001', '5e5e5e5e-5555-4111-8111-000000000001', 'assistant_coach');

select ok(not pg_temp.in_group(current_setting('vg.groupA')::uuid, current_setting('vg.young')::uuid),
  'a minor recorded as a coach is NOT added to the venue group');
select ok((select adult = false from public.venue_coaching_staff('4e4e4e4e-5555-4111-8111-000000000001')
            where person_id = current_setting('vg.young')::uuid),
  'but the venue''s staff list names them, and says they are not an adult');

select throws_ok(
  format($$insert into public.conversation_participants (conversation_id, person_id, basis)
           values (%L, %L, 'member')$$, current_setting('vg.groupA'), current_setting('vg.young')),
  'P0001', null, 'and adding them by hand is refused by the database');


-- =============================================================================
-- G. no date of birth is a minor (SG-0)
-- =============================================================================

insert into public.team_memberships (id, person_id, team_id, season_id, role) values
  ('11111111-5555-4111-8111-000000000007', current_setting('vg.nodob')::uuid, '7a7a7a7a-5555-4111-8111-000000000001', '5e5e5e5e-5555-4111-8111-000000000001', 'coach');

select ok(not pg_temp.in_group(current_setting('vg.groupA')::uuid, current_setting('vg.nodob')::uuid),
  'a coach with no date of birth is not admitted — SG-0 says unknown is a minor');

update public.people set dob = '1988-08-08' where id = current_setting('vg.nodob')::uuid;
select ok(pg_temp.in_group(current_setting('vg.groupA')::uuid, current_setting('vg.nodob')::uuid),
  'giving the date of birth at sign-in puts them in');

update public.people set dob = current_date - interval '15 years' where id = current_setting('vg.nodob')::uuid;
select ok(not pg_temp.in_group(current_setting('vg.groupA')::uuid, current_setting('vg.nodob')::uuid),
  'and a date that makes them a minor walks them back out');


-- =============================================================================
-- H. SG-1 is unreachable in this room
-- =============================================================================

select is((select count(*) from public.conversation_participants p
            where p.conversation_id = current_setting('vg.groupA')::uuid
              and p.left_at is null and public.is_minor(p.person_id)),
  0::bigint, 'no minor is an active participant of a venue coaches group');
select ok(public.conversation_is_compliant(current_setting('vg.groupA')::uuid),
  'so the group satisfies SG-1');

-- Shrink it to two people and it is still compliant, because both are adults.
update public.conversation_participants set left_at = now()
 where conversation_id = current_setting('vg.groupA')::uuid and left_at is null
   and person_id not in (current_setting('vg.a')::uuid, current_setting('vg.b')::uuid);
select ok(public.conversation_is_compliant(current_setting('vg.groupA')::uuid),
  'and still SG-1 compliant with exactly two people in it');

-- The room works: an adult coach can post in it.
select lives_ok(
  format($$insert into public.messages (conversation_id, sender_person_id, body)
           values (%L, %L, 'Gates are locked, use the side entrance')$$,
         current_setting('vg.groupA'), current_setting('vg.a')),
  'a coach can post to the venue group');


-- =============================================================================
-- I. RLS
-- =============================================================================

set local request.jwt.claims to '{"sub":"acacacac-5555-4111-8111-000000000005","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.conversations where id = current_setting('vg.groupA')::uuid),
  0::bigint, 'a non-participant cannot see the venue group at all');
select is((select count(*) from public.messages where conversation_id = current_setting('vg.groupA')::uuid),
  0::bigint, 'nor read a word of it');
select throws_ok(
  $$insert into public.venues (name) values ('Sneaky Ground')$$,
  '42501', null, 'and cannot create a venue');
reset role;

set local request.jwt.claims to '{"sub":"acacacac-5555-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.conversations where id = current_setting('vg.groupA')::uuid),
  1::bigint, 'a participating coach sees the group');
reset role;


-- =============================================================================
-- J. retired, never deleted
-- =============================================================================

set local request.jwt.claims to '{"sub":"acacacac-5555-4111-8111-000000000006","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$insert into public.venues (name, sort_order) values ('Admin Ground', 9)$$,
  'a club administrator creates a venue');
select throws_ok(
  $$delete from public.venues where name = 'Admin Ground'$$,
  '42501', null, 'but nobody may delete one — a venue is retired, not deleted');
select lives_ok(
  $$update public.venues set active = false where name = 'Admin Ground'$$,
  'retiring it is the way');
reset role;

select is((select title from public.conversations where venue_id = '4e4e4e4e-5555-4111-8111-000000000001' and closed_at is null),
  'Test Ground A coaches', 'the group survives everything above');

update public.venues set name = 'Test Ground A (renamed)' where id = '4e4e4e4e-5555-4111-8111-000000000001';
select is((select title from public.conversations where venue_id = '4e4e4e4e-5555-4111-8111-000000000001' and closed_at is null),
  'Test Ground A (renamed) coaches', 'renaming the venue renames its group');

select * from finish();
rollback;
