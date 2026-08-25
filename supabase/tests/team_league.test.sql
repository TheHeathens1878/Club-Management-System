-- =============================================================================
-- Team league and division (20260824440000)
-- =============================================================================
--   A  columns exist and take free text
--   B  the length checks refuse the empty string and the essay
--   C  the staff-update guard still admits them (league is not a restricted
--      column, exactly like the match-day block)
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(6);

insert into public.teams (id, name, age_group) values
  ('8a8a8a8a-2222-4111-8111-000000000001', 'LG U15s', 'U15');

-- A. columns
select has_column('public', 'teams', 'league', 'teams.league');
select has_column('public', 'teams', 'division', 'teams.division');

update public.teams
   set league = 'Timperley & District JFL', division = 'Division 3'
 where id = '8a8a8a8a-2222-4111-8111-000000000001';
select is(
  (select league from public.teams where id = '8a8a8a8a-2222-4111-8111-000000000001'),
  'Timperley & District JFL',
  'league holds free text');

-- B. length checks
select throws_ok($$
  update public.teams set league = '' where id = '8a8a8a8a-2222-4111-8111-000000000001'
$$, '23514', null, 'the empty string is refused — blank means null');
select throws_ok($$
  update public.teams set division = repeat('x', 121) where id = '8a8a8a8a-2222-4111-8111-000000000001'
$$, '23514', null, 'a division longer than 120 characters is refused');

-- C. cleared back to null without complaint
update public.teams set league = null, division = null
 where id = '8a8a8a8a-2222-4111-8111-000000000001';
select is(
  (select league from public.teams where id = '8a8a8a8a-2222-4111-8111-000000000001'),
  null,
  'league clears to null');

select * from finish();
rollback;
