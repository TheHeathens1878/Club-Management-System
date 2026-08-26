-- =============================================================================
-- P4.1 — subscription_plans, subscriptions, payments ledger, stripe_events
-- =============================================================================
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(43);

insert into auth.users (id, email, raw_user_meta_data) values
  ('a7a7a7a7-1111-4111-8111-000000000001', 's-admin@test.invalid',  '{"full_name": "Ada Admin"}'::jsonb),
  ('a7a7a7a7-1111-4111-8111-000000000002', 's-coach@test.invalid',  '{"full_name": "Cy Coach"}'::jsonb),
  ('a7a7a7a7-1111-4111-8111-000000000003', 's-adult@test.invalid',  '{"full_name": "Al Adult"}'::jsonb),
  ('a7a7a7a7-1111-4111-8111-000000000004', 's-parent@test.invalid', '{"full_name": "Pat Parent"}'::jsonb),
  ('a7a7a7a7-1111-4111-8111-000000000005', 's-other@test.invalid',  '{"full_name": "Ollie Other"}'::jsonb);
update public.profiles set role = 'committee' where id = 'a7a7a7a7-1111-4111-8111-000000000001';
select set_config('s.admin',  (select person_id::text from public.profiles where id = 'a7a7a7a7-1111-4111-8111-000000000001'), true);
select set_config('s.coach',  (select person_id::text from public.profiles where id = 'a7a7a7a7-1111-4111-8111-000000000002'), true);
select set_config('s.adult',  (select person_id::text from public.profiles where id = 'a7a7a7a7-1111-4111-8111-000000000003'), true);
select set_config('s.parent', (select person_id::text from public.profiles where id = 'a7a7a7a7-1111-4111-8111-000000000004'), true);
select set_config('s.other',  (select person_id::text from public.profiles where id = 'a7a7a7a7-1111-4111-8111-000000000005'), true);
update public.people set dob = '1985-01-01'
 where id in (current_setting('s.admin')::uuid, current_setting('s.coach')::uuid, current_setting('s.adult')::uuid,
              current_setting('s.parent')::uuid, current_setting('s.other')::uuid);
insert into public.people (id, first_name, last_name, dob) values
  ('c7c7c7c7-1111-4111-8111-000000000001', 'Kid', 'Subs', current_date - interval '10 years');
insert into public.guardianships (guardian_person_id, child_person_id, relationship)
  values (current_setting('s.parent')::uuid, 'c7c7c7c7-1111-4111-8111-000000000001', 'parent');
-- The coach's DBS + safeguarding certificates used to be inserted here so the
-- SG-6 tier-1 guard would let them onto a team with minors. That tier was
-- retired by 20260825440000 (SAFEGUARDING.md SG-6): the FA Clubs Portal holds
-- the paperwork, and the app can no longer write a certification at all.
insert into public.seasons (id, name, starts_on, ends_on) values ('5d5d5d5d-1111-4111-8111-000000000001', 'Subs 2036/37', '2036-08-01', '2037-05-31');
insert into public.teams (id, name) values ('7d7d7d7d-1111-4111-8111-000000000001', 'Subs U11s'), ('7d7d7d7d-1111-4111-8111-000000000002', 'Subs Vets');
insert into public.team_memberships (person_id, team_id, season_id, role) values
  (current_setting('s.coach')::uuid, '7d7d7d7d-1111-4111-8111-000000000001', '5d5d5d5d-1111-4111-8111-000000000001', 'coach'),
  ('c7c7c7c7-1111-4111-8111-000000000001', '7d7d7d7d-1111-4111-8111-000000000001', '5d5d5d5d-1111-4111-8111-000000000001', 'player'),
  (current_setting('s.adult')::uuid, '7d7d7d7d-1111-4111-8111-000000000002', '5d5d5d5d-1111-4111-8111-000000000001', 'player');

-- A. shape
select has_table('public', 'subscription_plans', 'subscription_plans');
select has_table('public', 'subscriptions', 'subscriptions');
select has_table('public', 'stripe_events', 'stripe_events');
select has_view('public', 'subscription_arrears', 'subscription_arrears');
select has_column('public', 'payments', 'subscription_id', 'payments.subscription_id');
select has_column('public', 'payments', 'kind', 'payments.kind');
select ok(not has_table_privilege('authenticated', 'public.stripe_events', 'SELECT'), 'stripe_events is service_role only');
select is((select count(*) from public.payments where kind <> 'hire' and booking_id is not null), 0::bigint, 'existing booking payments are kind=hire');

-- B. plans
insert into public.subscription_plans (id, season_id, team_id, name, amount_pence, billing) values
  ('91919191-1111-4111-8111-000000000001', '5d5d5d5d-1111-4111-8111-000000000001', '7d7d7d7d-1111-4111-8111-000000000001', 'U11s season', 18000, 'one_off'),
  ('91919191-1111-4111-8111-000000000002', '5d5d5d5d-1111-4111-8111-000000000001', null, 'Club membership', 2500, 'annual');
select throws_ok(
  $$insert into public.subscription_plans (season_id, name, amount_pence, billing) values ('5d5d5d5d-1111-4111-8111-000000000001', 'Monthly', 1000, 'monthly')$$,
  '23514', null, 'a monthly plan needs instalments');

-- C. subscriptions guard
-- payer must be an adult with known dob
select throws_ok(
  $$insert into public.subscriptions (plan_id, person_id, payer_person_id)
    values ('91919191-1111-4111-8111-000000000001', 'c7c7c7c7-1111-4111-8111-000000000001', 'c7c7c7c7-1111-4111-8111-000000000001')$$,
  'P0001', null, 'a minor cannot be the payer');
-- payer must be the player or an active guardian
select throws_ok(
  $$insert into public.subscriptions (plan_id, person_id, payer_person_id)
    values ('91919191-1111-4111-8111-000000000001', 'c7c7c7c7-1111-4111-8111-000000000001', current_setting('s.other')::uuid)$$,
  'P0001', null, 'a non-guardian cannot pay for a child (SG-4)');
-- parent signs up child (as the parent)
set local request.jwt.claims to '{"sub":"a7a7a7a7-1111-4111-8111-000000000004","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$insert into public.subscriptions (id, plan_id, person_id, payer_person_id)
    values ('5b5b5b5b-2222-4111-8111-000000000001', '91919191-1111-4111-8111-000000000001', 'c7c7c7c7-1111-4111-8111-000000000001', current_setting('s.parent')::uuid)$$,
  'guardian signs up their child');
select throws_ok(
  $$insert into public.subscriptions (plan_id, person_id, payer_person_id, status)
    values ('91919191-1111-4111-8111-000000000002', current_setting('s.parent')::uuid, current_setting('s.parent')::uuid, 'active')$$,
  'P0001', null, 'a self sign-up cannot start active');
select throws_ok(
  $$update public.subscriptions set status = 'active' where id = '5b5b5b5b-2222-4111-8111-000000000001'$$,
  'P0001', null, 'a payer cannot activate');
reset role;
select is((select (status::text, amount_due_pence, created_by) from public.subscriptions where id = '5b5b5b5b-2222-4111-8111-000000000001'),
  ('pending'::text, 18000, 'a7a7a7a7-1111-4111-8111-000000000004'::uuid), 'pending, amount snapshotted from the plan, created_by stamped');
select throws_ok(
  $$insert into public.subscriptions (plan_id, person_id, payer_person_id)
    values ('91919191-1111-4111-8111-000000000001', 'c7c7c7c7-1111-4111-8111-000000000001', current_setting('s.parent')::uuid)$$,
  '23505', null, 'one live subscription per plan per person');
-- adult signs up self
set local request.jwt.claims to '{"sub":"a7a7a7a7-1111-4111-8111-000000000003","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$insert into public.subscriptions (id, plan_id, person_id, payer_person_id)
    values ('5b5b5b5b-2222-4111-8111-000000000002', '91919191-1111-4111-8111-000000000002', current_setting('s.adult')::uuid, current_setting('s.adult')::uuid)$$,
  'adult signs up themself');
select throws_ok(
  $$insert into public.subscriptions (plan_id, person_id, payer_person_id)
    values ('91919191-1111-4111-8111-000000000002', current_setting('s.other')::uuid, current_setting('s.other')::uuid)$$,
  'P0001', null, 'cannot sign up someone else as their payer');
select lives_ok(
  $$update public.subscriptions set status = 'cancelled' where id = '5b5b5b5b-2222-4111-8111-000000000002'$$,
  'a payer may cancel their own pending sign-up');
reset role;
select is((select (status::text, ended_at is not null) from public.subscriptions where id = '5b5b5b5b-2222-4111-8111-000000000002'),
  ('cancelled'::text, true), 'cancellation stamped ended_at');

-- service_role (the webhook) activates, records a payment. A service-key request carries no sub.
set local request.jwt.claims to '{"role":"service_role"}';
set local role service_role;
select lives_ok(
  $$update public.subscriptions set status = 'active', stripe_customer_id = 'cus_1', stripe_subscription_id = 'sub_1'
     where id = '5b5b5b5b-2222-4111-8111-000000000001'$$,
  'service_role activates from a webhook');
select lives_ok(
  $$insert into public.stripe_events (id, type, payload) values ('evt_1', 'invoice.paid', '{}'::jsonb)$$,
  'stripe event recorded');
with ins as (insert into public.stripe_events (id, type, payload) values ('evt_1', 'invoice.paid', '{}'::jsonb) on conflict (id) do nothing returning id)
select is((select count(*) from ins), 0::bigint, 'a redelivered event inserts nothing (idempotent)');
select lives_ok(
  $$insert into public.payments (subscription_id, amount_pence, method, source, stripe_payment_intent_id)
    values ('5b5b5b5b-2222-4111-8111-000000000001', 9000, 'card', 'stripe', 'pi_1')$$,
  'a subscription payment lands');
select throws_ok(
  $$insert into public.payments (subscription_id, amount_pence, method, source, stripe_payment_intent_id)
    values ('5b5b5b5b-2222-4111-8111-000000000001', 9000, 'card', 'stripe', 'pi_1')$$,
  '23505', null, 'the same payment intent cannot be recorded twice');
reset role;
select is((select started_at is not null from public.subscriptions where id = '5b5b5b5b-2222-4111-8111-000000000001'), true, 'activation stamped started_at');
select is((select kind::text from public.payments where stripe_payment_intent_id = 'pi_1'), 'subscription', 'kind derived as subscription');
select throws_ok(
  $$insert into public.payments (booking_id, subscription_id, amount_pence)
    values (gen_random_uuid(), '5b5b5b5b-2222-4111-8111-000000000001', 1)$$,
  '23514', null, 'a payment cannot link both a booking and a subscription');
select throws_ok(
  $$update public.payments set refunded_pence = 9001 where stripe_payment_intent_id = 'pi_1'$$,
  '23514', null, 'refund cannot exceed the amount');
select throws_ok(
  $$update public.subscriptions set person_id = current_setting('s.adult')::uuid where id = '5b5b5b5b-2222-4111-8111-000000000001'$$,
  'P0001', null, 'player is immutable');

-- D. arrears
select is((select (paid_pence, outstanding_pence, team_name) from public.subscription_arrears where subscription_id = '5b5b5b5b-2222-4111-8111-000000000001'),
  (9000, 9000, 'Subs U11s'::text), 'arrears: 9000 paid of 18000');
update public.payments set refunded_pence = 1000, refunded_at = now() where stripe_payment_intent_id = 'pi_1';
select is((select outstanding_pence from public.subscription_arrears where subscription_id = '5b5b5b5b-2222-4111-8111-000000000001'),
  10000, 'refunds count against paid');

-- E. RLS
set local request.jwt.claims to '{"sub":"a7a7a7a7-1111-4111-8111-000000000002","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.subscription_arrears), 1::bigint, 'coach sees arrears for their team only');
select is((select count(*) from public.payments where subscription_id is not null), 1::bigint, 'coach sees their team''s subscription payments');
select throws_ok(
  $$insert into public.subscription_plans (season_id, name, amount_pence) values ('5d5d5d5d-1111-4111-8111-000000000001', 'X', 1)$$,
  '42501', null, 'coach cannot create a plan');
reset role;
set local request.jwt.claims to '{"sub":"a7a7a7a7-1111-4111-8111-000000000004","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.subscriptions), 1::bigint, 'parent sees the child''s subscription');
select is((select count(*) from public.payments where subscription_id is not null), 1::bigint, 'parent sees its payments');
reset role;
set local request.jwt.claims to '{"sub":"a7a7a7a7-1111-4111-8111-000000000005","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.subscriptions), 0::bigint, 'outsider sees no subscriptions');
select is((select count(*) from public.subscription_arrears), 0::bigint, 'outsider sees no arrears');
select is((select count(*) from public.subscription_plans), 2::bigint, 'anyone logged in sees active plans');
reset role;
set local request.jwt.claims to '{"sub":"a7a7a7a7-1111-4111-8111-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.subscriptions), 2::bigint, 'club_admin sees all');
select lives_ok(
  $$update public.subscriptions set status = 'past_due' where id = '5b5b5b5b-2222-4111-8111-000000000001'$$,
  'club_admin changes status');
reset role;
set local role anon;
select throws_ok($$select count(*) from public.subscriptions$$, '42501', null, 'anon cannot read subscriptions');
reset role;

select * from finish();

rollback;
