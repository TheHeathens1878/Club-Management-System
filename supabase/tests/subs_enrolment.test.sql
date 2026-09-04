-- =============================================================================
-- Subs a household can follow (20260904200000)
-- =============================================================================
--   A  the six system plans are stamped, and keep their shape: reprice yes,
--      reshape and delete no
--   B  individual vs family is decided BY PLAYERS, automatically
--   C  the quote: membership + monthly × instalments-to-1-May, gated to the
--      household and finance
--   D  monthly enrolment: membership owed now, an agreement the cycle will
--      collect, one enrolment per season
--   E  up-front enrolment: the SAME total, as charges, agreement complete
--   F  the gates: a stranger enrols nobody
--   G  after 1 May: membership only, nothing monthly left to collect
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(32);

-- A current season ending NEXT year: 1 May of that year is always ahead, so
-- the instalment count is at least 1 whatever month CI runs in.
insert into public.seasons (id, name, starts_on, ends_on, is_current) values
  ('feeafeea-4444-4444-8444-000000000001', 'SE 2098/99', current_date - 30,
   make_date(extract(year from current_date)::int + 1, 6, 30), true);

insert into auth.users (id, email, raw_user_meta_data) values
  ('cafecafe-4444-4444-8444-000000000001', 'se-lead@test.invalid',
   '{"full_name": "Lena Leader", "dob": "1983-01-01"}'::jsonb),
  ('cafecafe-4444-4444-8444-000000000002', 'se-fin@test.invalid',
   '{"full_name": "Tam Treasurer", "dob": "1979-02-02"}'::jsonb),
  ('cafecafe-4444-4444-8444-000000000003', 'se-str@test.invalid',
   '{"full_name": "Sid Stranger", "dob": "1992-03-03"}'::jsonb);
select set_config('se.lead', (select person_id::text from public.profiles where id = 'cafecafe-4444-4444-8444-000000000001'), true);
insert into public.person_roles (person_id, role)
values ((select person_id from public.profiles where id = 'cafecafe-4444-4444-8444-000000000002'), 'finance');

insert into public.people (id, first_name, last_name, dob) values
  ('beefbeef-4444-4444-8444-000000000001', 'Kim', 'Leader', (current_date - interval '10 years')::date),
  ('beefbeef-4444-4444-8444-000000000002', 'Kai', 'Leader', (current_date - interval '8 years')::date),
  ('beefbeef-4444-4444-8444-000000000003', 'Solo', 'Player', '1990-04-04');
insert into public.guardianships (guardian_person_id, child_person_id, relationship) values
  (current_setting('se.lead')::uuid, 'beefbeef-4444-4444-8444-000000000001', 'parent'),
  (current_setting('se.lead')::uuid, 'beefbeef-4444-4444-8444-000000000002', 'parent');

select set_config('se.acc', public.create_billing_account(current_setting('se.lead')::uuid)::text, true);
select public.add_person_to_billing_account(current_setting('se.acc')::uuid, 'beefbeef-4444-4444-8444-000000000001');
select public.add_person_to_billing_account(current_setting('se.acc')::uuid, 'beefbeef-4444-4444-8444-000000000002');

-- Known prices, active — the Fees screen's write, done directly.
update public.fee_plans set amount_pence = 2000, active = true where system_key = 'membership_individual';
update public.fee_plans set amount_pence = 3000, active = true where system_key = 'membership_family';
update public.fee_plans set amount_pence = 1500, active = true where system_key = 'subs_monthly_individual';
update public.fee_plans set amount_pence = 2500, active = true where system_key = 'subs_monthly_family';


-- ---------------------------------------------------------------------------
-- A. The system six.
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public.fee_plans where system_key is not null), 6,
  'all six system plans are stamped');
select throws_like(
  $$delete from public.fee_plans where system_key = 'fine_yellow'$$,
  '%system plan%',
  'a system plan cannot be deleted — the fee boxes point at it');
select throws_like(
  $$update public.fee_plans set kind = 'other' where system_key = 'fine_yellow'$$,
  '%keeps its shape%',
  'a system plan cannot be reshaped');
select lives_ok(
  $$update public.fee_plans set amount_pence = 1100 where system_key = 'fine_yellow'$$,
  'but repricing is exactly what the boxes do');


-- ---------------------------------------------------------------------------
-- B. Players decide individual vs family.
-- ---------------------------------------------------------------------------
select is(public.household_fee_kind(current_setting('se.acc')::uuid)::text, 'individual',
  'a household with nobody playing yet is individual');

insert into public.registrations (person_id, season_id, form)
values ('beefbeef-4444-4444-8444-000000000001', 'feeafeea-4444-4444-8444-000000000001', '{}'::jsonb);
select is(public.household_fee_kind(current_setting('se.acc')::uuid)::text, 'individual',
  'one playing child: still individual');

insert into public.registrations (person_id, season_id, form)
values ('beefbeef-4444-4444-8444-000000000002', 'feeafeea-4444-4444-8444-000000000001', '{}'::jsonb);
select is(public.household_fee_kind(current_setting('se.acc')::uuid)::text, 'family',
  'the second playing child makes it a family — automatically');


-- ---------------------------------------------------------------------------
-- C. The quote.
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"cafecafe-4444-4444-8444-000000000001","role":"authenticated"}';
set local role authenticated;
select set_config('se.quote', (select to_jsonb(q)::text from public.subs_quote(current_setting('se.acc')::uuid) q), true);
reset role;
set local request.jwt.claims to '{"role":"service_role"}';

select is((current_setting('se.quote')::jsonb ->> 'scope'), 'family', 'the quote knows the household is a family');
select is((current_setting('se.quote')::jsonb ->> 'membership_pence')::int, 3000, 'family membership fee quoted');
select is((current_setting('se.quote')::jsonb ->> 'monthly_pence')::int, 2500, 'family monthly rate quoted');
select ok((current_setting('se.quote')::jsonb ->> 'instalments')::int >= 1,
  'at least one instalment remains before 1 May');
select is((current_setting('se.quote')::jsonb ->> 'first_on')::date,
  (date_trunc('month', (now() at time zone 'Europe/London')::date) + interval '1 month')::date,
  'the first instalment is the 1st of next month');
select is(extract(month from (current_setting('se.quote')::jsonb ->> 'last_on')::date)::int, 5,
  'the last payment date is a 1 May, in all cases');
select is((current_setting('se.quote')::jsonb ->> 'total_pence')::int,
  3000 + 2500 * (current_setting('se.quote')::jsonb ->> 'instalments')::int,
  'the total is membership + monthly × instalments — both doors add up the same');

set local request.jwt.claims to '{"sub":"cafecafe-4444-4444-8444-000000000003","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select * from public.subs_quote(current_setting('se.acc')::uuid)$$,
  '42501', null,
  'a stranger gets no quote for somebody else''s household');
reset role;
set local request.jwt.claims to '{"role":"service_role"}';


-- ---------------------------------------------------------------------------
-- D. Monthly enrolment, by the lead member themself.
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"cafecafe-4444-4444-8444-000000000001","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$select public.enroll_household(current_setting('se.acc')::uuid, 'monthly')$$,
  'the lead member enrols their own household');
select throws_like(
  $$select public.enroll_household(current_setting('se.acc')::uuid, 'upfront')$$,
  '%already enrolled%',
  'one enrolment per household per season');
reset role;
set local request.jwt.claims to '{"role":"service_role"}';

select is((select count(*)::int from public.charges
            where account_id = current_setting('se.acc')::uuid and kind = 'membership' and amount_pence = 3000),
  1, 'the membership fee is owed immediately');
select is((select count(*)::int from public.charges
            where account_id = current_setting('se.acc')::uuid and kind = 'subs'),
  0, 'no subs charge yet — the cycle collects those month by month');
select is((select ba.months_total from public.billing_agreements ba
            where ba.account_id = current_setting('se.acc')::uuid and ba.season_id is not null),
  (current_setting('se.quote')::jsonb ->> 'instalments')::int,
  'the agreement counts down exactly the quoted instalments');
select is((select ba.next_charge_on from public.billing_agreements ba
            where ba.account_id = current_setting('se.acc')::uuid and ba.season_id is not null),
  (current_setting('se.quote')::jsonb ->> 'first_on')::date,
  '…starting the 1st of next month');
select is(public.run_billing_cycle(), 0,
  'nothing is due today — the first 1st has not arrived');


-- ---------------------------------------------------------------------------
-- E. Up front is the same total, by the treasurer.
-- ---------------------------------------------------------------------------
insert into public.registrations (person_id, season_id, form)
values ('beefbeef-4444-4444-8444-000000000003', 'feeafeea-4444-4444-8444-000000000001', '{}'::jsonb);
select set_config('se.acc2', public.create_billing_account('beefbeef-4444-4444-8444-000000000003')::text, true);

set local request.jwt.claims to '{"sub":"cafecafe-4444-4444-8444-000000000002","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$select public.enroll_household(current_setting('se.acc2')::uuid, 'upfront')$$,
  'the finance user enrols a household up front — the club''s door');
reset role;
set local request.jwt.claims to '{"role":"service_role"}';

select is((select count(*)::int from public.charges
            where account_id = current_setting('se.acc2')::uuid and kind = 'membership' and amount_pence = 2000),
  1, 'a solo player is an individual membership');
select is((select ch.amount_pence from public.charges ch
            where ch.account_id = current_setting('se.acc2')::uuid and ch.kind = 'subs'),
  1500 * (current_setting('se.quote')::jsonb ->> 'instalments')::int,
  'the up-front subs charge is the monthly rate × the same instalment count');
select is((select ba.status::text from public.billing_agreements ba
            where ba.account_id = current_setting('se.acc2')::uuid and ba.season_id is not null),
  'completed', 'an up-front enrolment is complete on the spot — the cycle will never touch it');
select is(public.run_billing_cycle(), 0, 'and indeed nothing is due');


-- ---------------------------------------------------------------------------
-- F. A stranger enrols nobody.
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"cafecafe-4444-4444-8444-000000000003","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select public.enroll_household(current_setting('se.acc')::uuid, 'monthly')$$,
  '42501', null,
  'a stranger cannot enrol somebody else''s household');
reset role;
set local request.jwt.claims to '{"role":"service_role"}';


-- ---------------------------------------------------------------------------
-- G. After 1 May: membership only.
-- ---------------------------------------------------------------------------
-- Make the current season one whose 1 May has passed: it ended LAST year.
update public.seasons set is_current = false where id = 'feeafeea-4444-4444-8444-000000000001';
insert into public.seasons (id, name, starts_on, ends_on, is_current) values
  ('feeafeea-4444-4444-8444-000000000002', 'SE old', current_date - 700,
   make_date(extract(year from current_date)::int - 1, 6, 30), true);

insert into public.people (id, first_name, last_name, dob) values
  ('beefbeef-4444-4444-8444-000000000004', 'Late', 'Joiner', '1991-05-05');
select set_config('se.acc3', public.create_billing_account('beefbeef-4444-4444-8444-000000000004')::text, true);

select is((select q.instalments from public.subs_quote(current_setting('se.acc3')::uuid) q), 0,
  'past that season''s 1 May there are no instalments left');
select lives_ok(
  $$select public.enroll_household(current_setting('se.acc3')::uuid, 'monthly')$$,
  'enrolling still works');
select is((select count(*)::int from public.charges where account_id = current_setting('se.acc3')::uuid),
  1, 'membership fee only — no subs charge');
select is((select ba.status::text from public.billing_agreements ba
            where ba.account_id = current_setting('se.acc3')::uuid and ba.season_id is not null),
  'completed', 'and nothing is left running for the cycle to collect');

select * from finish();

rollback;
