-- =============================================================================
-- A collection is claimed before it is charged (20260905110000)
-- =============================================================================
--   A  shape: the claim is unique per (charge, attempt), the reference is
--      unique, a finished row carries finished_at and a started one does not
--   B  the second claimant collides — this is what stops two runs charging
--   C  the treasurer reads attempts; a household member does not; nobody
--      but the server writes
--   D  financial record: no hard delete, no truncate
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(14);

-- A finance user, a member with an account and a charge on it.
insert into auth.users (id, email, raw_user_meta_data) values
  ('6e6e6e6e-6666-4111-8111-000000000001', 'ca-treasurer@test.invalid',
     '{"full_name": "Tess Treasurer", "dob": "1980-01-01"}'::jsonb),
  ('6e6e6e6e-6666-4111-8111-000000000002', 'ca-lead@test.invalid',
     '{"full_name": "Lee Lead", "dob": "1981-02-02"}'::jsonb);
select set_config('ca.treasurer', (select person_id::text from public.profiles where id = '6e6e6e6e-6666-4111-8111-000000000001'), true);
select set_config('ca.lead',      (select person_id::text from public.profiles where id = '6e6e6e6e-6666-4111-8111-000000000002'), true);
insert into public.person_roles (person_id, role) values (current_setting('ca.treasurer')::uuid, 'finance');

select set_config('ca.account', public.create_billing_account(current_setting('ca.lead')::uuid)::text, true);
insert into public.charges (id, account_id, kind, description, amount_pence)
  values ('e6e6e6e6-6666-4111-8111-000000000001', current_setting('ca.account')::uuid, 'other', 'Test charge', 10000);

-- =============================================================================
-- A. shape
-- =============================================================================
select has_table('public', 'collection_attempts', 'collection_attempts exists');
select is((select relrowsecurity from pg_class where oid = 'public.collection_attempts'::regclass), true,
  'RLS is enabled');
select lives_ok($$
  insert into public.collection_attempts (charge_id, attempt_no, checkout_reference, amount_pence)
  values ('e6e6e6e6-6666-4111-8111-000000000001', 1, 'charge:e6e6e6e6-6666-4111-8111-000000000001:auto:1', 10000)
$$, 'the first attempt is claimed');
select throws_ok($$
  update public.collection_attempts set status = 'paid'
   where charge_id = 'e6e6e6e6-6666-4111-8111-000000000001' and attempt_no = 1
$$, '23514', null, 'a finished attempt must say when it finished');
select lives_ok($$
  update public.collection_attempts set status = 'paid', finished_at = now()
   where charge_id = 'e6e6e6e6-6666-4111-8111-000000000001' and attempt_no = 1
$$, 'and does, with finished_at');

-- =============================================================================
-- B. the collision
-- =============================================================================
select lives_ok($$
  insert into public.collection_attempts (charge_id, attempt_no, checkout_reference, amount_pence)
  values ('e6e6e6e6-6666-4111-8111-000000000001', 2, 'charge:e6e6e6e6-6666-4111-8111-000000000001:auto:2', 6000)
$$, 'a second run claims attempt 2');
select throws_ok($$
  insert into public.collection_attempts (charge_id, attempt_no, checkout_reference, amount_pence)
  values ('e6e6e6e6-6666-4111-8111-000000000001', 2, 'charge:e6e6e6e6-6666-4111-8111-000000000001:auto:2-again', 6000)
$$, '23505', null, 'an overlapping run computing the same attempt number collides and walks away');
select throws_ok($$
  insert into public.collection_attempts (charge_id, attempt_no, checkout_reference, amount_pence)
  values ('e6e6e6e6-6666-4111-8111-000000000001', 3, 'charge:e6e6e6e6-6666-4111-8111-000000000001:auto:2', 6000)
$$, '23505', null, 'and the SumUp reference can never be reused either');

-- =============================================================================
-- C. who reads, who writes
-- =============================================================================
set local request.jwt.claims to '{"sub":"6e6e6e6e-6666-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.collection_attempts where charge_id = 'e6e6e6e6-6666-4111-8111-000000000001'),
  2::bigint, 'finance reads every attempt on a charge');
select throws_ok($$
  insert into public.collection_attempts (charge_id, attempt_no, checkout_reference, amount_pence)
  values ('e6e6e6e6-6666-4111-8111-000000000001', 9, 'charge:x:auto:9', 100)
$$, '42501', null, 'finance does not write attempts — only the server claims them');
reset role;

set local request.jwt.claims to '{"sub":"6e6e6e6e-6666-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.collection_attempts), 0::bigint,
  'the household lead sees none of the machinery — their ledger is payments');
reset role;
set local request.jwt.claims to '{}';

-- =============================================================================
-- D. financial record
-- =============================================================================
select throws_ok($$delete from public.collection_attempts where attempt_no = 2$$, 'P0001', null,
  'no hard delete');
select throws_ok($$truncate public.collection_attempts$$, 'P0001', null,
  'no truncate');
select is((select count(*) from public.collection_attempts where charge_id = 'e6e6e6e6-6666-4111-8111-000000000001'),
  2::bigint, 'both attempts are still there');

select * from finish();
rollback;
