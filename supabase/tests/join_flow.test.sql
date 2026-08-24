-- =============================================================================
-- Join-the-club flow (20260824280000)
-- =============================================================================
--   A  sign-up address lands on the person; update_own_contact edits own row only
--   B  add_household_adult: adult-only, known-adult caller, audited
--   C  registrations: household adult registerable by their creator; a person
--      with their own login is not; strangers refused
--   D  create_membership: individual for one, family for 2–6, cap at six,
--      household check, idempotent re-submission
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(17);

insert into auth.users (id, email, raw_user_meta_data) values
  ('a5a5a5a5-2222-4111-8111-000000000001', 'jf-adam@test.invalid',
   '{"full_name": "Jo Iner", "dob": "1985-05-05", "phone": "07700 900123", "address": {"line1": "1 Club Lane", "town": "Sale", "postcode": "M33 1AA"}}'::jsonb),
  ('a5a5a5a5-2222-4111-8111-000000000002', 'jf-other@test.invalid', '{"full_name": "Ol Other", "dob": "1984-04-04"}'::jsonb),
  ('a5a5a5a5-2222-4111-8111-000000000003', 'jf-nodob@test.invalid', '{"full_name": "No Dob"}'::jsonb);
select set_config('jf.me',    (select person_id::text from public.profiles where id = 'a5a5a5a5-2222-4111-8111-000000000001'), true);
select set_config('jf.other', (select person_id::text from public.profiles where id = 'a5a5a5a5-2222-4111-8111-000000000002'), true);
insert into public.seasons (id, name, starts_on, ends_on, is_current) values ('6b6b6b6b-2222-4111-8111-000000000001', 'JF 2034/35', '2034-08-01', '2035-05-31', true);
insert into public.teams (id, name, age_group) values ('8c8c8c8c-2222-4111-8111-000000000001', 'JF Vets', 'Open');

-- A. sign-up address + own contact ------------------------------------------------
select is((select address ->> 'postcode' from public.people where id = current_setting('jf.me')::uuid),
  'M33 1AA', 'the sign-up address lands on the person');

set local request.jwt.claims to '{"sub":"a5a5a5a5-2222-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok($$ select public.update_own_contact('{"line1": "2 Club Lane", "town": "Sale", "postcode": "M33 1AB"}'::jsonb, null, null) $$,
  'a person updates their own address');
reset role;
select is((select address ->> 'line1' from public.people where id = current_setting('jf.me')::uuid), '2 Club Lane', 'the update stuck');

-- B. household adult -----------------------------------------------------------------
set local request.jwt.claims to '{"sub":"a5a5a5a5-2222-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select set_config('jf.spouse', public.add_household_adult('Sam', 'Iner', '1986-06-06', 'sam@test.invalid')::text, true);
select isnt(current_setting('jf.spouse'), '', 'household adult created');
select throws_like($$ select public.add_household_adult('Kid', 'Iner', (current_date - interval '8 years')::date) $$,
  '%add_child%', 'a minor cannot be added as a household adult');
reset role;
set local request.jwt.claims to '{"sub":"a5a5a5a5-2222-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select throws_like($$ select public.add_household_adult('Any', 'One', '1990-01-01') $$, '%known adult%',
  'a caller without a known date of birth cannot add household members');
reset role;
select is((select count(*) from public.audit_log where action = 'family.adult_added' and entity_id = current_setting('jf.spouse')),
  1::bigint, 'adult_added is audited');

-- C. registrations for the household ---------------------------------------------------
set local request.jwt.claims to '{"sub":"a5a5a5a5-2222-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok($$
  insert into public.registrations (person_id, season_id, team_id, form)
  values (current_setting('jf.spouse')::uuid, '6b6b6b6b-2222-4111-8111-000000000001', '8c8c8c8c-2222-4111-8111-000000000001',
          '{"emergency": {"name": "Jo Iner", "phone": "07700 900123"}, "medical": {"conditions": "none"}}'::jsonb)
$$, 'the creator registers their household adult');
select throws_like($$
  insert into public.registrations (person_id, season_id, form)
  values (current_setting('jf.other')::uuid, '6b6b6b6b-2222-4111-8111-000000000001', '{}'::jsonb)
$$, '%an adult registers themself%', 'an adult with their own login cannot be registered by someone else');
reset role;

-- D. memberships ------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"a5a5a5a5-2222-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select set_config('jf.child', public.add_child('Kid', 'Iner', (current_date - interval '8 years')::date)::text, true);

select is((select kind::text from public.create_membership(array[]::uuid[])), 'individual', 'one person → individual');
select is((select kind::text from public.create_membership(array[current_setting('jf.spouse')::uuid, current_setting('jf.child')::uuid])),
  'family', 'three people → family (idempotent upsert replaces the earlier row)');
select is((select count(*) from public.membership_people mp
            join public.memberships m on m.id = mp.membership_id
            where m.primary_person_id = current_setting('jf.me')::uuid), 3::bigint, 'membership lists all three');
select throws_like($$ select public.create_membership(array[current_setting('jf.other')::uuid]) $$,
  '%not in your household%', 'someone else''s person cannot be claimed');
select throws_like($$
  select public.create_membership((select array_agg(public.add_household_adult('A' || i, 'Iner', '1980-01-01')) from generate_series(1, 6) i))
$$, '%at most six%', 'the six-person cap holds');
select is((select count(*) from public.memberships where primary_person_id = current_setting('jf.me')::uuid), 1::bigint,
  'one membership per person per season');
reset role;

set local request.jwt.claims to '{"sub":"a5a5a5a5-2222-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.memberships), 0::bigint, 'another member sees no memberships');
reset role;
select is((select count(*) from public.audit_log where action = 'membership.submitted'), 2::bigint, 'submissions audited');

select * from finish();
rollback;
