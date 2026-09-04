-- =============================================================================
-- A card is shown to its own wallet (20260904210000)
-- =============================================================================
--   A  a coach reads their own squad's cards — number, letter, name
--   B  and NOT another team's
--   C  someone who staffs nothing reads nothing at all
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(4);

insert into public.seasons (id, name, starts_on, ends_on, is_current) values
  ('dcdcdcdc-5555-4555-8555-000000000001', 'TPC 2097/98', current_date - 10, current_date + 300, true);
insert into public.teams (id, name, age_group) values
  ('dcdcdcdc-5555-4555-8555-000000000002', 'TPC Foxes', 'U10'),
  ('dcdcdcdc-5555-4555-8555-000000000003', 'TPC Owls', 'U11');

insert into auth.users (id, email, raw_user_meta_data) values
  ('dcdcdcdc-5555-4555-8555-000000000004', 'tpc-coach@test.invalid',
   '{"full_name": "Cody Coach", "dob": "1985-05-05"}'::jsonb),
  ('dcdcdcdc-5555-4555-8555-000000000005', 'tpc-member@test.invalid',
   '{"full_name": "Marla Member", "dob": "1987-06-06"}'::jsonb);
select set_config('tpc.coach', (select person_id::text from public.profiles where id = 'dcdcdcdc-5555-4555-8555-000000000004'), true);

insert into public.people (id, first_name, last_name, dob) values
  ('dcdcdcdc-5555-4555-8555-000000000006', 'Fern', 'Fox', (current_date - interval '9 years')::date),
  ('dcdcdcdc-5555-4555-8555-000000000007', 'Ollie', 'Owl', (current_date - interval '10 years')::date),
  ('dcdcdcdc-5555-4555-8555-000000000008', 'Lead', 'Fox', '1980-07-07'),
  ('dcdcdcdc-5555-4555-8555-000000000009', 'Lead', 'Owl', '1981-08-08');

insert into public.guardianships (guardian_person_id, child_person_id, relationship) values
  ('dcdcdcdc-5555-4555-8555-000000000008', 'dcdcdcdc-5555-4555-8555-000000000006', 'parent'),
  ('dcdcdcdc-5555-4555-8555-000000000009', 'dcdcdcdc-5555-4555-8555-000000000007', 'parent');

-- Numbers: each child under their lead's account.
select set_config('tpc.acc1', public.create_billing_account('dcdcdcdc-5555-4555-8555-000000000008')::text, true);
select public.add_person_to_billing_account(current_setting('tpc.acc1')::uuid, 'dcdcdcdc-5555-4555-8555-000000000006');
select set_config('tpc.acc2', public.create_billing_account('dcdcdcdc-5555-4555-8555-000000000009')::text, true);
select public.add_person_to_billing_account(current_setting('tpc.acc2')::uuid, 'dcdcdcdc-5555-4555-8555-000000000007');

-- The coach staffs the Foxes; Fern plays for them, Ollie for the Owls.
insert into public.team_memberships (person_id, team_id, season_id, role) values
  (current_setting('tpc.coach')::uuid, 'dcdcdcdc-5555-4555-8555-000000000002', 'dcdcdcdc-5555-4555-8555-000000000001', 'coach'),
  ('dcdcdcdc-5555-4555-8555-000000000006', 'dcdcdcdc-5555-4555-8555-000000000002', 'dcdcdcdc-5555-4555-8555-000000000001', 'player'),
  ('dcdcdcdc-5555-4555-8555-000000000007', 'dcdcdcdc-5555-4555-8555-000000000003', 'dcdcdcdc-5555-4555-8555-000000000001', 'player');


-- The expected reference, read as the database itself — the coach's own RLS
-- could not read the billing rows, which is rather the point.
select set_config('tpc.fern_ref',
  (select lpad(a.member_no::text, 5, '0') || bap.letter
     from public.billing_account_people bap
     join public.billing_accounts a on a.id = bap.account_id
    where bap.person_id = 'dcdcdcdc-5555-4555-8555-000000000006' and bap.removed_at is null), true);

set local request.jwt.claims to '{"sub":"dcdcdcdc-5555-4555-8555-000000000004","role":"authenticated"}';
set local role authenticated;

select is((select count(*)::int from public.team_player_cards()), 1,
  'the coach reads exactly their own squad''s cards');
select is((select c.first_name || ' ' || c.last_name from public.team_player_cards() c), 'Fern Fox',
  '…their player');
select is((select c.card_ref from public.team_player_cards() c), current_setting('tpc.fern_ref'),
  '…with the household number and their own letter, nothing else about the household');
reset role;

set local request.jwt.claims to '{"sub":"dcdcdcdc-5555-4555-8555-000000000005","role":"authenticated"}';
set local role authenticated;
select is((select count(*)::int from public.team_player_cards()), 0,
  'someone who staffs nothing reads nothing');
reset role;

select * from finish();

rollback;
