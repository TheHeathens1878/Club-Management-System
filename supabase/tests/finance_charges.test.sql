-- =============================================================================
-- What the club charges, and why (20260904180000)
-- =============================================================================
--   A  the plan catalogue: the six minimum plans are seeded INACTIVE; members
--      see only active plans; finance manages the catalogue
--   B  agreements: one_off charges once and completes on the spot; monthly
--      waits for the cycle; one live agreement per account per plan
--   C  the billing cycle raises exactly what has come due, walks the date
--      forward, and completes a capped agreement
--   D  raise_charge bills the BILL-PAYER: hand it the player, the charge
--      lands on the lead member's account
--   E  paid is arithmetic: partial payment leaves pending, covering flips to
--      paid, refund flips back; a human cannot declare paid without money;
--      a waiver needs a written reason; paid cannot be voided
--   F  RLS: the household reads its own charges and payments; strangers read
--      nothing; the finance role reads the whole ledger; only the lead (or
--      finance) signs an account up
--   G  one live mandate per account; the lead reads their own
--   H  the reporting views add up
--   I  the eraser is the super user's alone (20260904190000): finance cannot
--      delete a charge, a super user can — unpaid only, audited — and plans
--      delete only while nothing references them
--
-- Run with: npx supabase test db
-- =============================================================================

begin;

select plan(51);

insert into auth.users (id, email, raw_user_meta_data) values
  ('abababab-3333-4333-8333-000000000001', 'fc-lead@test.invalid',
   '{"full_name": "Fay Payer", "dob": "1982-01-01"}'::jsonb),
  ('abababab-3333-4333-8333-000000000002', 'fc-fin@test.invalid',
   '{"full_name": "Tom Treasurer", "dob": "1978-02-02"}'::jsonb),
  ('abababab-3333-4333-8333-000000000003', 'fc-str@test.invalid',
   '{"full_name": "Stan Stranger", "dob": "1991-03-03"}'::jsonb);
select set_config('fc.lead', (select person_id::text from public.profiles where id = 'abababab-3333-4333-8333-000000000001'), true);
select set_config('fc.fin',  (select person_id::text from public.profiles where id = 'abababab-3333-4333-8333-000000000002'), true);
select set_config('fc.str',  (select person_id::text from public.profiles where id = 'abababab-3333-4333-8333-000000000003'), true);

insert into public.person_roles (person_id, role)
values (current_setting('fc.fin')::uuid, 'finance');

-- Fay's child, guarded, on her account.
insert into public.people (id, first_name, last_name, dob) values
  ('cdcdcdcd-3333-4333-8333-000000000001', 'Kid', 'Payer', (current_date - interval '11 years')::date);
insert into public.guardianships (guardian_person_id, child_person_id, relationship)
values (current_setting('fc.lead')::uuid, 'cdcdcdcd-3333-4333-8333-000000000001', 'parent');

select set_config('fc.acc', public.create_billing_account(current_setting('fc.lead')::uuid)::text, true);
select public.add_person_to_billing_account(current_setting('fc.acc')::uuid, 'cdcdcdcd-3333-4333-8333-000000000001');

-- Control plans (created directly; the seeded six are asserted, not used).
insert into public.fee_plans (id, name, kind, scope, amount_pence, schedule, active) values
  ('dededede-3333-4333-8333-000000000001', 'FC test membership', 'membership', 'family', 5000, 'one_off', true),
  ('dededede-3333-4333-8333-000000000002', 'FC test subs', 'subs', 'family', 2000, 'monthly', true),
  ('dededede-3333-4333-8333-000000000003', 'FC test fine', 'fine', null, 1000, 'one_off', true),
  ('dededede-3333-4333-8333-000000000004', 'FC hidden draft', 'other', null, 999, 'one_off', false);
update public.fee_plans set months_total = 2 where id = 'dededede-3333-4333-8333-000000000002';


-- ---------------------------------------------------------------------------
-- A. The catalogue.
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public.fee_plans
            where name in ('Club membership — Individual', 'Club membership — Family',
                           'Monthly subs — Individual', 'Monthly subs — Family',
                           'Yellow card fine', 'Red card fine')
              and active = false),
  6, 'the six minimum plans are seeded and INACTIVE — placeholder prices never charge anybody');

set local request.jwt.claims to '{"sub":"abababab-3333-4333-8333-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select count(*)::int from public.fee_plans where name = 'FC hidden draft'), 0,
  'a member does not see inactive plans');
update public.fee_plans set amount_pence = 1 where name = 'FC test fine';
reset role;
select is((select amount_pence from public.fee_plans where name = 'FC test fine'), 1000,
  'a member''s attempt on the catalogue bites nothing — RLS holds the row out of reach');

set local request.jwt.claims to '{"sub":"abababab-3333-4333-8333-000000000002","role":"authenticated"}';
set local role authenticated;
select is((select count(*)::int from public.fee_plans where name = 'FC hidden draft'), 1,
  'finance sees drafts');
select lives_ok(
  $$insert into public.fee_plans (name, kind, amount_pence, schedule, cohort)
    values ('FC veterans membership', 'membership', 3000, 'one_off', 'Veterans')$$,
  'finance creates bespoke plans for a cohort');
reset role;


-- ---------------------------------------------------------------------------
-- B. Agreements.
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"abababab-3333-4333-8333-000000000001","role":"authenticated"}';
set local role authenticated;
select set_config('fc.ag_one',
  public.start_agreement(current_setting('fc.acc')::uuid, 'dededede-3333-4333-8333-000000000001')::text, true);
reset role;

select is((select status::text from public.billing_agreements where id = current_setting('fc.ag_one')::uuid),
  'completed', 'a one_off agreement completes on the spot');
select is((select count(*)::int from public.charges
            where agreement_id = current_setting('fc.ag_one')::uuid and status = 'pending'),
  1, '…leaving exactly one pending charge');

set local request.jwt.claims to '{"sub":"abababab-3333-4333-8333-000000000003","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select public.start_agreement(current_setting('fc.acc')::uuid, 'dededede-3333-4333-8333-000000000002')$$,
  '42501', null,
  'a stranger cannot sign somebody else''s account up');
reset role;
-- `reset role` keeps the transaction-local claims: clear them, or the
-- service-context calls below would run wearing the stranger's sub.
set local request.jwt.claims to '{"role":"service_role"}';

select set_config('fc.ag_sub',
  public.start_agreement(current_setting('fc.acc')::uuid, 'dededede-3333-4333-8333-000000000002')::text, true);
select is((select count(*)::int from public.charges where agreement_id = current_setting('fc.ag_sub')::uuid),
  0, 'a monthly agreement raises nothing until the cycle runs');
select throws_ok(
  $$select public.start_agreement(current_setting('fc.acc')::uuid, 'dededede-3333-4333-8333-000000000002')$$,
  '23505', null,
  'one live agreement per account per plan');


-- ---------------------------------------------------------------------------
-- C. The billing cycle.
-- ---------------------------------------------------------------------------
select is(public.run_billing_cycle(), 1, 'the cycle raises the one due charge');
select is((select count(*)::int from public.charges where agreement_id = current_setting('fc.ag_sub')::uuid),
  1, '…for the subs agreement');
select is(public.run_billing_cycle(), 0, 'run again the same day: nothing more is due — idempotent');
select is((select (next_charge_on - current_date) between 28 and 31 from public.billing_agreements
            where id = current_setting('fc.ag_sub')::uuid),
  true, 'the next collection moved a month out');

update public.billing_agreements set next_charge_on = current_date - 1
 where id = current_setting('fc.ag_sub')::uuid;
select is(public.run_billing_cycle(), 1, 'a due date in the past is collected on the next run');
select is((select status::text from public.billing_agreements where id = current_setting('fc.ag_sub')::uuid),
  'completed', 'months_total = 2 reached: the agreement completes itself');


-- ---------------------------------------------------------------------------
-- D. raise_charge bills the bill-payer.
-- ---------------------------------------------------------------------------
select set_config('fc.fine',
  public.raise_charge('cdcdcdcd-3333-4333-8333-000000000001', 'dededede-3333-4333-8333-000000000003')::text, true);
select is((select account_id from public.charges where id = current_setting('fc.fine')::uuid),
  current_setting('fc.acc')::uuid,
  'the child collected the card; the LEAD MEMBER''s account collects the fine');
select is((select person_id from public.charges where id = current_setting('fc.fine')::uuid),
  'cdcdcdcd-3333-4333-8333-000000000001'::uuid,
  '…and the charge still names who incurred it');
select throws_like(
  $$select public.raise_charge(current_setting('fc.str')::uuid, 'dededede-3333-4333-8333-000000000003')$$,
  '%no membership number%',
  'no account, no charge — issue the number first');
select throws_like(
  $$select public.raise_charge('cdcdcdcd-3333-4333-8333-000000000001')$$,
  '%needs a description and an amount%',
  'a bespoke charge without plan, description or amount is refused');


-- ---------------------------------------------------------------------------
-- E. Paid is arithmetic.
-- ---------------------------------------------------------------------------
insert into public.payments (charge_id, amount_pence, paid_at, method, source)
values (current_setting('fc.fine')::uuid, 400, now(), 'cash', 'manual');
select is((select status::text from public.charges where id = current_setting('fc.fine')::uuid),
  'pending', '£4 against a £10 fine: still pending');
select is((select kind::text from public.payments where charge_id = current_setting('fc.fine')::uuid),
  'charge', 'the ledger derives kind = charge from the link');

insert into public.payments (id, charge_id, amount_pence, paid_at, method, source)
values ('efefefef-3333-4333-8333-000000000001', current_setting('fc.fine')::uuid, 600, now(), 'cash', 'manual');
select is((select status::text from public.charges where id = current_setting('fc.fine')::uuid),
  'paid', 'covering the amount flips the charge to PAID — no human hand involved');

update public.payments set refunded_pence = 600, refunded_at = now()
 where id = 'efefefef-3333-4333-8333-000000000001';
select is((select status::text from public.charges where id = current_setting('fc.fine')::uuid),
  'pending', 'a refund reopens the charge');

select throws_like(
  $$update public.charges set status = 'paid' where id = current_setting('fc.fine')::uuid$$,
  '%derived from the ledger%',
  'a human cannot declare a charge paid without the money');
select throws_ok(
  $$update public.charges set status = 'waived' where id = current_setting('fc.fine')::uuid$$,
  '23514', null,
  'a waiver without a written reason is refused');
select lives_ok(
  $$update public.charges set status = 'waived', waived_reason = 'testing mercy'
     where id = current_setting('fc.fine')::uuid$$,
  'a waiver with its reason is recorded');
select isnt((select waived_at from public.charges where id = current_setting('fc.fine')::uuid),
  null, '…and stamped');

update public.payments set refunded_pence = 0, refunded_at = null
 where id = 'efefefef-3333-4333-8333-000000000001';
select set_config('fc.paidcharge',
  (select id::text from public.charges where agreement_id = current_setting('fc.ag_one')::uuid), true);
insert into public.payments (charge_id, amount_pence, paid_at, method, source)
values (current_setting('fc.paidcharge')::uuid, 5000, now(), 'sumup', 'sumup');
select throws_like(
  $$update public.charges set status = 'void' where id = current_setting('fc.paidcharge')::uuid$$,
  '%cannot be voided%',
  'a paid charge cannot be voided — refund it');


-- ---------------------------------------------------------------------------
-- F. RLS.
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"abababab-3333-4333-8333-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select count(*)::int from public.charges), 4,
  'the lead reads every charge on the household — membership, both subs months, the fine');
select is((select count(*)::int from public.payments where charge_id is not null), 3,
  'and every payment against them, as they land');
select throws_ok(
  $$insert into public.charges (account_id, kind, description, amount_pence)
    values (current_setting('fc.acc')::uuid, 'other', 'self-serve discount', 1)$$,
  '42501', null,
  'a member cannot raise charges, not even on their own account');
reset role;

set local request.jwt.claims to '{"sub":"abababab-3333-4333-8333-000000000003","role":"authenticated"}';
set local role authenticated;
select is((select count(*)::int from public.charges), 0, 'a stranger reads no charges');
select is((select count(*)::int from public.payments), 0, '…and no payments');
reset role;

set local request.jwt.claims to '{"sub":"abababab-3333-4333-8333-000000000002","role":"authenticated"}';
set local role authenticated;
select is((select count(*)::int from public.charges), 4, 'finance reads the whole book');
select lives_ok(
  $$insert into public.payments (charge_id, amount_pence, paid_at, method, source)
    values ((select id from public.charges where agreement_id = current_setting('fc.ag_sub')::uuid
              order by created_at limit 1), 2000, now(), 'bank_transfer', 'manual')$$,
  'finance records a manual payment through their own login');


-- ---------------------------------------------------------------------------
-- G. Mandates.
-- ---------------------------------------------------------------------------
reset role;
insert into public.payment_mandates (account_id, sumup_customer_id, card_last4, status, covers_fines, consented_at)
values (current_setting('fc.acc')::uuid, 'CUST-1', '4242', 'active', true, now());
select throws_ok(
  $$insert into public.payment_mandates (account_id, sumup_customer_id, status)
    values (current_setting('fc.acc')::uuid, 'CUST-2', 'pending')$$,
  '23505', null,
  'one live card on file per account');

set local request.jwt.claims to '{"sub":"abababab-3333-4333-8333-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select card_last4 from public.payment_mandates), '4242',
  'the lead sees the card on file');
reset role;
set local request.jwt.claims to '{"sub":"abababab-3333-4333-8333-000000000003","role":"authenticated"}';
set local role authenticated;
select is((select count(*)::int from public.payment_mandates), 0, 'nobody else does');
reset role;


-- ---------------------------------------------------------------------------
-- H. The views add up.
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"abababab-3333-4333-8333-000000000002","role":"authenticated"}';
set local role authenticated;
-- Live book: membership 5000 (paid 5000), subs month 1 2000 (paid 2000), subs
-- month 2 2000 (unpaid), fine WAIVED (out of the arithmetic). Fine's £10 of
-- payments still count as paid money received.
select is((select charged_pence from public.finance_account_summary
            where account_id = current_setting('fc.acc')::uuid),
  9000, 'charged = the pending and paid charges, not the waived one');
select is((select paid_pence from public.finance_account_summary
            where account_id = current_setting('fc.acc')::uuid),
  8000, 'paid = payments net of refunds against those charges');
select is((select balance_pence from public.finance_account_summary
            where account_id = current_setting('fc.acc')::uuid),
  1000, 'balance = the unpaid subs month, minus the fine''s stray tenner');
select is((select lead_name from public.finance_account_summary
            where account_id = current_setting('fc.acc')::uuid),
  'Fay Payer', 'the treasurer sees who the account belongs to');
reset role;


-- ---------------------------------------------------------------------------
-- I. The eraser is the super user's alone.
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"role":"service_role"}';
insert into auth.users (id, email, raw_user_meta_data) values
  ('abababab-3333-4333-8333-000000000004', 'fc-super@test.invalid',
   '{"full_name": "Sue Super", "dob": "1975-04-04"}'::jsonb);
update public.profiles set role = 'super_user' where id = 'abababab-3333-4333-8333-000000000004';
select set_config('fc.unpaid',
  (select id::text from public.charges
    where agreement_id = current_setting('fc.ag_sub')::uuid and status = 'pending'
    order by created_at desc limit 1), true);

-- The finance role's delete bites nothing: RLS holds the row out of reach.
set local request.jwt.claims to '{"sub":"abababab-3333-4333-8333-000000000002","role":"authenticated"}';
set local role authenticated;
delete from public.charges where id = current_setting('fc.unpaid')::uuid;
reset role;
set local request.jwt.claims to '{"role":"service_role"}';
select is((select count(*)::int from public.charges where id = current_setting('fc.unpaid')::uuid),
  1, 'the finance role cannot delete a charge — the row survives the attempt');

set local request.jwt.claims to '{"sub":"abababab-3333-4333-8333-000000000004","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$delete from public.charges where id = current_setting('fc.unpaid')::uuid$$,
  'a super user deletes an unpaid charge');
reset role;
set local request.jwt.claims to '{"role":"service_role"}';
select is((select count(*)::int from public.charges where id = current_setting('fc.unpaid')::uuid),
  0, '…and it is gone');
select is((select count(*)::int from public.audit_log
            where action = 'finance.charge_deleted' and entity_id = current_setting('fc.unpaid')),
  1, '…with the deletion on the audit log before the row went');

set local request.jwt.claims to '{"sub":"abababab-3333-4333-8333-000000000004","role":"authenticated"}';
set local role authenticated;
select throws_like(
  $$delete from public.charges where id = current_setting('fc.paidcharge')::uuid$$,
  '%money has moved%',
  'a charge with payments is never deleted, super user or not — refund first');

-- Plans: finance deletes an unused one; a referenced one is a database no.
set local request.jwt.claims to '{"sub":"abababab-3333-4333-8333-000000000002","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$delete from public.fee_plans where id = 'dededede-3333-4333-8333-000000000004'$$,
  'finance deletes an unused plan');
select is((select count(*)::int from public.fee_plans where id = 'dededede-3333-4333-8333-000000000004'),
  0, '…and it is gone');
select throws_ok(
  $$delete from public.fee_plans where id = 'dededede-3333-4333-8333-000000000003'$$,
  '23503', null,
  'a plan referenced by charges or agreements is refused by the foreign keys');
reset role;

select * from finish();

rollback;
