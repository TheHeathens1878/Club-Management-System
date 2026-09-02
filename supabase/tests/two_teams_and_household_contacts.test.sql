-- =============================================================================
-- Two teams, and every adult's contact (20260902200000)
-- =============================================================================
--   A  one person registers for TWO teams in one season (Adam: "They should
--      be able to join unlimited teams"), and the same team twice is still
--      one registration
--   B  a withdrawn registration frees its team slot again
--   C  team-less registrations stay one-at-a-time (the coalesce limb)
--   D  the household keeps a login-less adult's emergency contacts: the
--      account that added them writes and reads them; a stranger is refused;
--      an adult WITH their own login is nobody else's to edit
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(13);

insert into auth.users (id, email, raw_user_meta_data) values
  ('22aa0000-3333-4111-8111-000000000001', 'tt-owner@test.invalid',
   '{"full_name":"Olive Owner","dob":"1985-02-02"}'::jsonb),
  ('22aa0000-3333-4111-8111-000000000002', 'tt-other@test.invalid',
   '{"full_name":"Stan Stranger","dob":"1984-04-04"}'::jsonb);
select set_config('tt.owner',
  (select person_id::text from public.profiles where id = '22aa0000-3333-4111-8111-000000000001'), true);

insert into public.seasons (id, name, starts_on, ends_on, is_current) values
  ('52aa0000-3333-4111-8111-000000000001', 'TT 2044/45', '2044-08-01', '2045-05-31', true)
  on conflict do nothing;
insert into public.teams (id, name, age_group) values
  ('72aa0000-3333-4111-8111-000000000001', 'TT Ladies Firsts', 'Open Age'),
  ('72aa0000-3333-4111-8111-000000000002', 'TT Ladies Reserves', 'Open Age');

-- Stephanie: an adult player with her own login? No — the report was about a
-- player being registered twice, so the subject here is the owner themself.
-- And Hattie: an adult in the owner's household with NO login of her own.
insert into public.people (id, first_name, last_name, dob, created_by) values
  ('92aa0000-3333-4111-8111-000000000001', 'Hattie', 'Household', '1988-08-08',
   '22aa0000-3333-4111-8111-000000000001');
insert into public.household_links (owner_user_id, person_id, match_basis) values
  ('22aa0000-3333-4111-8111-000000000001', '92aa0000-3333-4111-8111-000000000001', 'email');

-- A ── unlimited teams ───────────────────────────────────────────────────────

select lives_ok($$
  insert into public.registrations (person_id, team_id, season_id)
  values (current_setting('tt.owner')::uuid, '72aa0000-3333-4111-8111-000000000001',
          '52aa0000-3333-4111-8111-000000000001')
$$, 'a player registers for the Firsts');

select lives_ok($$
  insert into public.registrations (person_id, team_id, season_id)
  values (current_setting('tt.owner')::uuid, '72aa0000-3333-4111-8111-000000000002',
          '52aa0000-3333-4111-8111-000000000001')
$$, 'and for the Reserves in the same season — two teams, two registrations');

select throws_ok($$
  insert into public.registrations (person_id, team_id, season_id)
  values (current_setting('tt.owner')::uuid, '72aa0000-3333-4111-8111-000000000001',
          '52aa0000-3333-4111-8111-000000000001')
$$, '23505', null, 'but the SAME team twice is still one registration');

-- B ── a withdrawal frees the slot ───────────────────────────────────────────

update public.registrations set status = 'withdrawn'
 where person_id = current_setting('tt.owner')::uuid
   and team_id = '72aa0000-3333-4111-8111-000000000001';

select lives_ok($$
  insert into public.registrations (person_id, team_id, season_id)
  values (current_setting('tt.owner')::uuid, '72aa0000-3333-4111-8111-000000000001',
          '52aa0000-3333-4111-8111-000000000001')
$$, 'a withdrawn registration frees its team for a fresh one');

-- C ── team-less registrations stay one-at-a-time ────────────────────────────

select lives_ok($$
  insert into public.registrations (person_id, season_id)
  values ('92aa0000-3333-4111-8111-000000000001', '52aa0000-3333-4111-8111-000000000001')
$$, 'a team-less registration (the club follows up by hand) still works');

select throws_ok($$
  insert into public.registrations (person_id, season_id)
  values ('92aa0000-3333-4111-8111-000000000001', '52aa0000-3333-4111-8111-000000000001')
$$, '23505', null, 'but a second open team-less request would be the same request twice');

-- D ── the household keeps a login-less adult's contacts ─────────────────────

set local role authenticated;
set local request.jwt.claims to '{"sub":"22aa0000-3333-4111-8111-000000000001","role":"authenticated"}';

select lives_ok($$
  select public.set_emergency_contacts('92aa0000-3333-4111-8111-000000000001',
    '[{"first_name":"Olive","last_name":"Owner","phone":"07000 000001","relationship":"Spouse"}]'::jsonb)
$$, 'the account that added a login-less adult sets their emergency contact');

select is(
  (select count(*) from public.emergency_contacts
    where person_id = '92aa0000-3333-4111-8111-000000000001'),
  1::bigint, 'and can read it back — the register form sees it on record');

reset role;
set local request.jwt.claims to '{}';

set local role authenticated;
set local request.jwt.claims to '{"sub":"22aa0000-3333-4111-8111-000000000002","role":"authenticated"}';

select throws_ok($$
  select public.set_emergency_contacts('92aa0000-3333-4111-8111-000000000001',
    '[{"first_name":"Stan","last_name":"Stranger","phone":"07000 000002"}]'::jsonb)
$$, '42501', null, 'a stranger is refused — household means THIS household');

select is(
  (select count(*) from public.emergency_contacts
    where person_id = '92aa0000-3333-4111-8111-000000000001'),
  0::bigint, 'and cannot read the contact either');

select ok(
  not public.is_household_member_of('92aa0000-3333-4111-8111-000000000001'),
  'the predicate itself answers no to the stranger');

reset role;
set local request.jwt.claims to '{}';

-- An adult WITH their own login is nobody else's to act for, however they
-- are linked: put the stranger's own person into the owner's household and
-- ask again — the predicate looks for a profile first.
select set_config('tt.stranger_person',
  (select person_id::text from public.profiles where id = '22aa0000-3333-4111-8111-000000000002'), true);
insert into public.household_links (owner_user_id, person_id, match_basis)
values ('22aa0000-3333-4111-8111-000000000001', current_setting('tt.stranger_person')::uuid, 'email');

set local role authenticated;
set local request.jwt.claims to '{"sub":"22aa0000-3333-4111-8111-000000000001","role":"authenticated"}';

select ok(
  not public.is_household_member_of(current_setting('tt.stranger_person')::uuid),
  'an adult with their own login is not a household member to act for');

select throws_ok(
  format($sql$
    select public.set_emergency_contacts('%s',
      '[{"first_name":"Olive","last_name":"Owner","phone":"07000 000001"}]'::jsonb)
  $sql$, current_setting('tt.stranger_person')),
  '42501', null, 'so their contacts are theirs alone');

reset role;
set local request.jwt.claims to '{}';

select * from finish();

rollback;
