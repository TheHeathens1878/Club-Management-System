-- =============================================================================
-- End of season (20260824390000)
-- =============================================================================
--   A  bump_age_group(): the year-older spellings, padding, and the no-ops
--   B  end_of_season_rollover(): bumps and renames the upgraded team, retires
--      the folded one, carries the live roster (players, staff, shirt
--      numbers) into the new season, flips is_current, writes the audit row,
--      and refuses to run twice or run backwards
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(19);

-- A. bump_age_group -----------------------------------------------------------
select is(public.bump_age_group('U8'),  'U9',  'U8 → U9');
select is(public.bump_age_group('U08'), 'U09', 'U08 → U09 keeps the padding');
select is(public.bump_age_group('U09'), 'U10', 'U09 → U10 drops it at ten');
select is(public.bump_age_group('AoM FC U14 Mavericks'), 'AoM FC U15 Mavericks',
  'the age inside a team name bumps, the rest survives');
select is(public.bump_age_group('Under 12s'), 'Under 13s', 'Under 12s → Under 13s');
select is(public.bump_age_group('Open age'), 'Open age', 'no age number, no change');
select is(public.bump_age_group(null), null, 'null stays null');

-- B. rollover -----------------------------------------------------------------
-- Take over the current-season flag inside this transaction.
update public.seasons set is_current = false where is_current;
insert into public.seasons (id, name, starts_on, ends_on, is_current) values
  ('6e6e6e6e-3333-4333-8333-000000000001', 'EOS 2037/38', '2037-08-01', '2038-05-31', true),
  ('6e6e6e6e-3333-4333-8333-000000000002', 'EOS 2038/39', '2038-08-01', '2039-05-31', false);

insert into public.teams (id, name, age_group) values
  ('8e8e8e8e-3333-4333-8333-000000000001', 'EOS U14 United',  'U14'),
  ('8e8e8e8e-3333-4333-8333-000000000002', 'EOS U18 Leavers', 'U18');

insert into public.people (id, first_name, last_name, dob) values
  ('9e9e9e9e-3333-4333-8333-000000000001', 'Player', 'One',   '2024-01-01'),
  ('9e9e9e9e-3333-4333-8333-000000000002', 'Player', 'Two',   '2024-02-02'),
  ('9e9e9e9e-3333-4333-8333-000000000003', 'Coach',  'Three', '1990-03-03');

insert into public.team_memberships (person_id, team_id, season_id, role, shirt_number) values
  ('9e9e9e9e-3333-4333-8333-000000000001', '8e8e8e8e-3333-4333-8333-000000000001',
   '6e6e6e6e-3333-4333-8333-000000000001', 'player', 7),
  ('9e9e9e9e-3333-4333-8333-000000000002', '8e8e8e8e-3333-4333-8333-000000000001',
   '6e6e6e6e-3333-4333-8333-000000000001', 'player', 9),
  ('9e9e9e9e-3333-4333-8333-000000000003', '8e8e8e8e-3333-4333-8333-000000000001',
   '6e6e6e6e-3333-4333-8333-000000000001', 'coach', null);

-- Running backwards is refused before anything happens.
select throws_ok($$
  select public.end_of_season_rollover('6e6e6e6e-3333-4333-8333-000000000001')
$$, 'P0001', null, 'the current season is not a rollover target');

select set_config('eos.res', public.end_of_season_rollover(
  '6e6e6e6e-3333-4333-8333-000000000002',
  array['8e8e8e8e-3333-4333-8333-000000000001']::uuid[],
  array['8e8e8e8e-3333-4333-8333-000000000002']::uuid[])::text, true);

select is((current_setting('eos.res')::jsonb->>'teams_upgraded')::int, 1, 'one team upgraded');
select is((current_setting('eos.res')::jsonb->>'teams_retired')::int, 1, 'one team retired');
select is((select (age_group, name) from public.teams where id = '8e8e8e8e-3333-4333-8333-000000000001'),
  ('U15'::text, 'EOS U15 United'::text), 'the upgraded team is a year older in age group and name');
select is((select active from public.teams where id = '8e8e8e8e-3333-4333-8333-000000000002'),
  false, 'the retired team is inactive');
select is((current_setting('eos.res')::jsonb->>'players_carried')::int, 2, 'both players carried');
select is((current_setting('eos.res')::jsonb->>'staff_carried')::int, 1, 'the coach carried');
select is((select count(*) from public.team_memberships
           where team_id = '8e8e8e8e-3333-4333-8333-000000000001'
             and season_id = '6e6e6e6e-3333-4333-8333-000000000002' and left_at is null),
  3::bigint, 'the new-season roster is the old one');
select is((select shirt_number from public.team_memberships
           where person_id = '9e9e9e9e-3333-4333-8333-000000000001'
             and season_id = '6e6e6e6e-3333-4333-8333-000000000002'),
  7, 'shirt numbers travel');
select is((select id from public.seasons where is_current),
  '6e6e6e6e-3333-4333-8333-000000000002'::uuid, 'the new season is now current');
select is((select count(*) from public.audit_log
           where action = 'season.rollover'
             and entity_id = '6e6e6e6e-3333-4333-8333-000000000002'),
  1::bigint, 'the rollover is audited');

-- Running it again with the same target is refused — the double-bump guard.
select throws_ok($$
  select public.end_of_season_rollover('6e6e6e6e-3333-4333-8333-000000000002')
$$, 'P0001', null, 'a second run with the same target is refused');

select * from finish();
rollback;
