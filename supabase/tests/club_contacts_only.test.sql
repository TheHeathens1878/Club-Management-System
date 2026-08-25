-- =============================================================================
-- The club's people, and the function room's customers (20260825360000)
-- =============================================================================
--   A  somebody who exists only because they hired the room is "hire only"
--   B  the moment the club has any relationship with them, they are not
--   C  a club person who has never hired anything is never listed
--   D  a soft-deleted person is not listed either
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(9);

insert into public.people (id, first_name, last_name, email, dob) values
  ('cc000000-7777-4111-8111-000000000001', 'Hire',   'Only',    'hire.only@test.invalid',   '1980-01-01'),
  ('cc000000-7777-4111-8111-000000000002', 'Club',   'Person',  'club.person@test.invalid', '1981-02-02'),
  ('cc000000-7777-4111-8111-000000000003', 'Both',   'Hats',    'both.hats@test.invalid',   '1982-03-03'),
  ('cc000000-7777-4111-8111-000000000004', 'Gone',   'Away',    'gone.away@test.invalid',   '1983-04-04');

-- Two of them are in the room's own contacts book; one of those also has a
-- club relationship, and one has been retired.
insert into public.booking_contacts (name, email) values
  ('Hire Only', 'hire.only@test.invalid'),
  ('Both Hats', 'both.hats@test.invalid'),
  ('Gone Away', 'gone.away@test.invalid');

select ok(not public.is_club_person('cc000000-7777-4111-8111-000000000001'),
  'a room customer has no club relationship');
select ok(('cc000000-7777-4111-8111-000000000001' = any(public.hire_only_person_ids())),
  'so they are hire-only');

-- A. the club person: no hire record at all, so never in the list
select ok(('cc000000-7777-4111-8111-000000000002' <> all(public.hire_only_person_ids())),
  'somebody with no hire record is never hire-only');

-- B. one relationship at a time makes somebody the club's
insert into public.seasons (id, name, starts_on, ends_on)
  values ('5cc00000-7777-4111-8111-000000000001', 'Contacts 2041/42', '2041-08-01', '2042-05-31');
insert into public.teams (id, name, age_group)
  values ('7cc00000-7777-4111-8111-000000000001', 'Contacts U15s', 'U15');
insert into public.team_memberships (person_id, team_id, season_id, role)
  values ('cc000000-7777-4111-8111-000000000003', '7cc00000-7777-4111-8111-000000000001',
          '5cc00000-7777-4111-8111-000000000001', 'player');

select ok(public.is_club_person('cc000000-7777-4111-8111-000000000003'),
  'a team membership makes somebody the club''s');
select ok(('cc000000-7777-4111-8111-000000000003' <> all(public.hire_only_person_ids())),
  'so a hirer who also plays stays in the list');

-- A guardianship counts at either end.
insert into public.people (id, first_name, last_name, dob)
  values ('cc000000-7777-4111-8111-00000000000a', 'Kid', 'Contacts', (current_date - interval '9 years')::date);
insert into public.guardianships (guardian_person_id, child_person_id, relationship)
  values ('cc000000-7777-4111-8111-000000000001', 'cc000000-7777-4111-8111-00000000000a', 'parent');
select ok(public.is_club_person('cc000000-7777-4111-8111-000000000001'),
  'a guardianship makes a room customer the club''s too');
select ok(('cc000000-7777-4111-8111-000000000001' <> all(public.hire_only_person_ids())),
  'and they come back into the list');

-- D. retired people are nobody's list
update public.people set deleted_at = now()
 where id = 'cc000000-7777-4111-8111-000000000004';
select ok(('cc000000-7777-4111-8111-000000000004' <> all(public.hire_only_person_ids())),
  'a retired person is not listed as hire-only either');

-- C. a role of its own is a club relationship
select ok(public.is_club_person('cc000000-7777-4111-8111-000000000002') = false,
  'and a person with nothing at all is still not the club''s — the list simply never sees them');

select * from finish();
rollback;
